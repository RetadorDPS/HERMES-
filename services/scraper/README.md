# Scraper Service (FastAPI + Playwright)

Microservicio de extracción de producto de proveedores (AliExpress, Amazon, CJ Dropshipping).

## Arranque

```bash
cd services/scraper
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium        # descarga el binario de Chromium
cp .env.example .env               # PROXY_LIST, CJ_API_KEY, API_KEY...
uvicorn main:app --host 0.0.0.0 --port 8000
```

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Navegador, proxies y jobs activos |
| POST | `/scrape` | Extracción completa (variantes, envío por país, reseñas, imágenes HD) |
| POST | `/scrape/price` | Comprobación ligera precio+stock usada por los workers 24/7 |
| POST | `/scrape/bulk` | Hasta 25 URLs en paralelo |
| GET | `/proxies` | Salud del pool de proxies |

### Ejemplo

```bash
curl -X POST localhost:8000/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://es.aliexpress.com/item/1005006123456789.html","country":"ES","include_reviews":true}'
```

## Respuesta (`ScrapedPayload`)

```json
{
  "ok": true,
  "data": {
    "sourceUrl": "...", "supplier": "ALIEXPRESS", "title": "...",
    "description": "...", "bullets": [], "categoryPath": [],
    "images": [{ "url": "...", "hdUrl": "..." }],
    "variants": [{ "supplierVariantId": "...", "sku": "...", "color": "...", "size": "...",
                   "price": 12.4, "stock": 410, "imageUrl": "..." }],
    "shipping": { "options": [{ "method": "...", "cost": 2.4, "minDays": 11, "maxDays": 19 }],
                  "cheapestCost": 0, "fastest": {}, "shipsTo": ["ES","FR"] },
    "reviews": [{ "rating": 5, "author": "...", "text": "...", "images": [] }],
    "ratingAvg": 4.8, "ratingCount": 3421, "stockTotal": 842,
    "extractionMeta": { "mode": "service", "proxyUsed": "1.2.3.4:8000", "attempts": 1 }
  }
}
```

## Anti-bot

1. **Stealth patches** en `browser.py` (webdriver, plugins, WebGL, permisos).
2. **Rotación de proxies** round-robin/random/sticky con cooldown automático tras
   3 fallos por proxy (`proxy_manager.py`).
3. **Reintentos** con backoff y IP nueva por intento (3 intentos por URL).
4. **Bloqueo de recursos** (fuentes/media/trackers) → ~40% más rápido.
5. Hooks para solucionadores de captcha (`CAPTCHA_SOLVER=2captcha`) en `config.py`.

## Variables de entorno

Ver `config.py`. Las principales: `PROXY_LIST`, `PROXY_ROTATION`, `MAX_CONCURRENCY`,
`HEADLESS`, `API_KEY`, `CACHE_TTL_SECONDS`, `CJ_API_KEY`.

## Docker

```bash
docker build -t dropship-scraper .
docker run -p 8000:8000 --env-file .env dropship-scraper
```
