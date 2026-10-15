"""
services/scraper/main.py — Microservicio FastAPI + Playwright

Endpoints:
  GET  /health          → estado del navegador, proxies y concurrencia
  POST /scrape          → extracción completa de la PDP (producto + variantes + envío + reseñas)
  POST /scrape/price    → comprobación ligera de precio/stock (path de los workers 24/7)
  POST /scrape/bulk     → varias URLs en paralelo (importación masiva)
  GET  /proxies         → salud del pool de proxies

Uso:
  pip install -r requirements.txt && playwright install chromium
  uvicorn main:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager

import orjson
from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import ORJSONResponse

from config import get_settings
from browser import pool
from extractors import detect_supplier, get_extractor
from extractors.base import detect_blocked
from models import HealthResponse, ProxyTestRequest, ProxyTestResponse, ScrapeRequest, ScrapeResponse
from proxy_manager import proxy_manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
log = logging.getLogger("scraper.api")

STARTED_AT = time.time()
VERSION = "1.4.0"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    log.info("Arrancando scraper service v%s (proxies=%s, concurrency=%s)", VERSION, proxy_manager.size, settings.max_concurrency)
    try:
        await pool.start()
        log.info("Chromium iniciado correctamente")
    except Exception as exc:  # permite arrancar el servicio aunque falte el binario
        log.error("No se pudo iniciar Chromium: %s", exc)
    yield
    await pool.stop()
    log.info("Scraper service detenido")


app = FastAPI(
    title="DropshipPilot Scraper Service",
    description="Extracción de productos de AliExpress / Amazon / CJ con Playwright y rotación de proxies",
    version=VERSION,
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
)


# ─────────────────────────────── Auth + caché ───────────────────────────────

_cache: dict[str, tuple[float, dict]] = {}


def _check_api_key(x_api_key: str | None) -> None:
    settings = get_settings()
    if settings.api_key and x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="X-API-Key inválida")


def _cache_get(key: str, ttl: int) -> dict | None:
    hit = _cache.get(key)
    if not hit:
        return None
    ts, value = hit
    if ttl and time.time() - ts > ttl:
        _cache.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: dict) -> None:
    _cache[key] = (time.time(), value)
    if len(_cache) > 5000:  # poda simple
        oldest = sorted(_cache.items(), key=lambda kv: kv[1][0])[:1000]
        for k, _ in oldest:
            _cache.pop(k, None)


# ──────────────────────────────── Endpoints ─────────────────────────────────

@app.get("/health")
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        browser_ready=pool._browser is not None,  # noqa: SLF001 (intencional: estado interno del pool)
        proxies_configured=proxy_manager.size,
        active_jobs=pool.active_jobs,
        uptime_seconds=round(time.time() - STARTED_AT, 1),
        version=VERSION,
    )


@app.get("/proxies")
async def proxies() -> dict:
    settings = get_settings()
    return {
        "count": proxy_manager.size,
        "strategy": settings.proxy_rotation,
        "provider": settings.proxy_provider or None,
        "country": settings.proxy_country,
        "pool": proxy_manager.snapshot(),
    }


@app.post("/proxies/test")
async def test_proxies(req: ProxyTestRequest, x_api_key: str | None = Header(default=None)) -> Response:
    """Valida una lista de proxies con un navegador REAL.

    Para cada proxy: mide latencia, obtiene la IP de salida y comprueba si el
    proveedor objetivo bloquea esa IP (página de captcha). Es la forma fiable de
    saber qué proxies residenciales sirven antes de ponerlos en producción.
    """
    _check_api_key(x_api_key)
    if not req.proxies:
        raise HTTPException(status_code=400, detail="Lista de proxies vacía")
    if len(req.proxies) > 25:
        raise HTTPException(status_code=400, detail="Máximo 25 proxies por lote")

    async def test_one(proxy: str) -> dict:
        started = time.time()
        masked = proxy.split("@")[-1]
        try:
            async with pool.page(proxy=proxy) as page:
                # 1) IP de salida y latencia
                await page.goto(req.ip_check_url, wait_until="domcontentloaded", timeout=req.timeout_ms)
                raw = (await page.inner_text("body")).strip()[:300]
                exit_ip = raw.strip().strip('"').split("\n")[0]

                # 2) ¿El proveedor objetivo bloquea esta IP?
                blocked = None
                if req.target_url:
                    await page.goto(req.target_url, wait_until="domcontentloaded", timeout=req.timeout_ms)
                    blocked = detect_blocked(await page.content())

                latency = int((time.time() - started) * 1000)
                status = "ok" if blocked is False else ("blocked" if blocked else "ok")
                if blocked:
                    proxy_manager.report_failure(proxy, "bloqueado en el test")
                else:
                    proxy_manager.report_success(proxy)
                return {
                    "proxy": masked,
                    "ok": not blocked,
                    "status": status,
                    "exitIp": exit_ip,
                    "latencyMs": latency,
                    "targetUrl": req.target_url,
                    "error": "El proveedor objetivo muestra captcha/verificación para esta IP" if blocked else None,
                }
        except Exception as exc:
            proxy_manager.report_failure(proxy, str(exc))
            return {
                "proxy": masked,
                "ok": False,
                "status": "error",
                "latencyMs": int((time.time() - started) * 1000),
                "error": str(exc)[:220],
            }

    # Concurrencia limitada por el pool de navegadores
    results = await asyncio.gather(*(test_one(p) for p in req.proxies))
    working = [r for r in results if r["ok"]]
    log.info("Test de proxies: %s/%s operativos", len(working), len(results))
    return ORJSONResponse(
        {
            "ok": len(working) > 0,
            "tested": len(results),
            "working": len(working),
            "fastest": min([r["latencyMs"] for r in working], default=None),
            "results": sorted(results, key=lambda r: (not r["ok"], r.get("latencyMs", 99999))),
        }
    )


@app.post("/scrape")
async def scrape(req: ScrapeRequest, x_api_key: str | None = Header(default=None)) -> Response:
    _check_api_key(x_api_key)
    settings = get_settings()
    cache_key = f"full:{req.url}:{req.country}:{req.include_reviews}"
    if (cached := _cache_get(cache_key, settings.cache_ttl_seconds)) is not None:
        return ORJSONResponse({"ok": True, "data": cached, "cached": True})

    started = time.time()
    try:
        payload = await _scrape_with_retries(req, is_full=True)
    except Exception as exc:
        log.warning("Extracción fallida %s: %s", req.url, exc)
        return ORJSONResponse({"ok": False, "error": str(exc)}, status_code=502)

    data = orjson.loads(payload.model_dump_json())
    data["extractionMeta"].update(
        {"mode": "service", "durationMs": int((time.time() - started) * 1000), "extractedAt": _iso_now()}
    )
    _cache_set(cache_key, data)
    return ORJSONResponse({"ok": True, "data": data})


@app.post("/scrape/price")
async def scrape_price(req: ScrapeRequest, x_api_key: str | None = Header(default=None)) -> Response:
    """Comprobación rápida precio+stock (sin reseñas ni imágenes HD).

    Este es el endpoint que usa el worker de sincronización cada hora: navega a la
    PDP, lee el payload embebido y devuelve sólo lo que cambia.
    """
    _check_api_key(x_api_key)
    ttl = max(get_settings().cache_ttl_seconds // 4, 60)
    cache_key = f"price:{req.url}:{req.country}"
    if (cached := _cache_get(cache_key, ttl)) is not None:
        return ORJSONResponse({"ok": True, "data": cached, "cached": True})

    try:
        payload = await _scrape_with_retries(req, is_full=False)
    except Exception as exc:
        return ORJSONResponse({"ok": False, "error": str(exc)}, status_code=502)

    variants = [
        {
            "supplierVariantId": v.supplierVariantId,
            "sku": v.sku,
            "price": v.price,
            "stock": v.stock,
        }
        for v in payload.variants
    ]
    data = {
        "sourceUrl": str(req.url),
        "supplier": payload.supplier,
        "currency": payload.currency,
        "minPrice": min([v["price"] for v in variants], default=0),
        "maxPrice": max([v["price"] for v in variants], default=0),
        "stockTotal": sum(v["stock"] for v in variants),
        "variants": variants,
        "shippingCost": payload.shipping.cheapestCost,
        "checkedAt": _iso_now(),
    }
    _cache_set(cache_key, data)
    return ORJSONResponse({"ok": True, "data": data})


@app.post("/scrape/bulk")
async def scrape_bulk(reqs: list[ScrapeRequest], x_api_key: str | None = Header(default=None)) -> Response:
    _check_api_key(x_api_key)
    if len(reqs) > 25:
        raise HTTPException(status_code=400, detail="Máximo 25 URLs por lote")

    async def run(r: ScrapeRequest):
        try:
            p = await _scrape_with_retries(r, is_full=False)
            return {"url": str(r.url), "ok": True, "title": p.title, "variants": len(p.variants), "minPrice": min([v.price for v in p.variants], default=0)}
        except Exception as exc:
            return {"url": str(r.url), "ok": False, "error": str(exc)}

    return ORJSONResponse({"results": await asyncio.gather(*(run(r) for r in reqs))})


# ─────────────────────────────── Internals ──────────────────────────────────

async def _scrape_with_retries(req: ScrapeRequest, *, is_full: bool):
    settings = get_settings()
    last_error: Exception | None = None
    # Reintentar desde la MISMA IP no aporta nada: solo tiene sentido si hay
    # pool de proxies (cada reintento sale por una IP distinta).
    attempts = 3 if proxy_manager.size > 0 else 1
    if attempts == 1 and proxy_manager.size == 0:
        log.info("Sin proxies configurados: 1 intento por URL (configura PROXY_LIST para reintentos con rotación de IP)")

    for attempt in range(1, attempts + 1):
        proxy = proxy_manager.acquire(preferred=req.proxy)
        if settings.proxy_required and not proxy:
            raise RuntimeError("PROXY_REQUIRED: no hay proxies configurados en PROXY_LIST")

        try:
            async with pool.page(proxy=proxy) as page:
                await page.goto(str(req.url), wait_until="domcontentloaded", timeout=req.timeout_ms)
                await pool.humanize(page)
                extractor, key = get_extractor(req.supplier, str(req.url))
                payload = await extractor(
                    page,
                    str(req.url),
                    include_reviews=is_full and req.include_reviews,
                    country=req.country,
                    max_reviews=req.max_reviews,
                )
                payload.extractionMeta.update(
                    {
                        "proxyUsed": _mask_proxy(proxy),
                        "attempts": attempt,
                        "supplierKey": key,
                    }
                )
                proxy_manager.report_success(proxy)
                return payload
        except Exception as exc:
            last_error = exc
            proxy_manager.report_failure(proxy, str(exc))
            log.warning("Intento %s/%s fallido para %s (proxy=%s): %s", attempt, attempts, req.url, _mask_proxy(proxy) or "directo", exc)
            await asyncio.sleep(1.2 * attempt)

    raise RuntimeError(f"Extracción fallida tras {attempts} intentos: {last_error}")


def _mask_proxy(proxy: str | None) -> str | None:
    if not proxy:
        return None
    return proxy.split("@")[-1]


def _iso_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


@app.middleware("http")
async def log_requests(request: Request, call_next):
    started = time.time()
    response = await call_next(request)
    elapsed = int((time.time() - started) * 1000)
    log.info("%s %s → %s (%sms)", request.method, request.url.path, response.status_code, elapsed)
    return response
