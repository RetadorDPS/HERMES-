"""Configuración del microservicio de scraping."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Servidor
    host: str = "0.0.0.0"
    port: int = 8000
    api_key: str | None = None  # si se define, exige cabecera X-API-Key

    # Navegador
    headless: bool = True
    browser_timeout_ms: int = 45_000
    navigation_timeout_ms: int = 30_000
    max_concurrency: int = 4
    block_resources: bool = True  # bloquea fuentes/media para acelerar
    human_delay_ms: int = 450  # micro-movimientos de ratón / scroll

    # ── Proxies ─────────────────────────────────────────────────────────────
    # Dos formas de configurar proxies:
    #   A) PROXY_LIST: lista explícita "http://user:pass@host:port,http://..."
    #   B) PROXY_PROVIDER: gateway rotativo de un proveedor residencial (recomendado)
    proxy_list: str = ""
    proxy_rotation: str = "round-robin"  # round-robin | random | sticky
    proxy_required: bool = False  # si True y no hay proxy, falla en lugar de salir con IP propia

    # Proveedor residencial (B). Presets: brightdata | oxylabs | smartproxy | iproyal | webshare | custom
    proxy_provider: str = ""
    proxy_username: str = ""  # p. ej. "brd-customer-hl_xxx-zone-residential"
    proxy_password: str = ""
    proxy_gateway_url: str = ""  # sólo para provider=custom: http://user:pass@host:port
    proxy_country: str = "es"  # país de salida deseado (ISO-2 en minúsculas)
    proxy_sessions: int = 12  # nº de sesiones rotativas que se generan en el pool
    proxy_session_ttl_min: int = 10  # minutos por sesión fija (sticky cuando se pide la misma)

    @property
    def has_provider_credentials(self) -> bool:
        return bool(self.proxy_provider and (self.proxy_gateway_url or (self.proxy_username and self.proxy_password)))

    def build_provider_proxies(self) -> list[str]:
        """Construye el pool de URLs rotativas del proveedor residencial.

        Cada proveedor usa una convención distinta para fijar país y sesión:
          · Bright Data  → usuario con "-country-es-session-<id>"
          · Oxylabs      → usuario con "-cc-ES-sessid-<id>"
          · Smartproxy   → usuario con "-country-es-session-<id>"
          · IPRoyal      → usuario con "_country-es_session-<id>_lifetime-10m"
          · Webshare     → gateway simple (rotación por IP de la lista)
          · custom       → se usa proxy_gateway_url tal cual (se le añade sesión si procede)
        """
        provider = self.proxy_provider.lower().strip()
        if not provider:
            return []

        cc = (self.proxy_country or "es").upper() if provider == "oxylabs" else (self.proxy_country or "es").lower()
        user, pwd, gateway = self.proxy_username, self.proxy_password, self.proxy_gateway_url

        presets = {
            "brightdata": "brd.superproxy.io:33335",
            "oxylabs": "pr.oxylabs.io:7777",
            "smartproxy": "gate.smartproxy.com:7000",
            "iproyal": "geo.iproyal.com:12321",
            "webshare": "p.webshare.io:80",
        }

        if provider in presets and not gateway:
            gateway = presets[provider]
        if not gateway:
            return []

        if provider == "custom" and not user:
            return [gateway if gateway.startswith("http") else f"http://{gateway}"]

        pool: list[str] = []
        for i in range(max(1, self.proxy_sessions)):
            session = f"ds{self.proxy_session_ttl_min}m{i:02d}"
            if provider == "oxylabs":
                u = f"user-{user}-cc-{cc}-sessid-{session}"
            elif provider == "iproyal":
                u = f"user-{user}_country-{cc}_session-{session}_lifetime-{self.proxy_session_ttl_min}m"
            else:  # brightdata | smartproxy | webshare | custom
                u = f"{user}-country-{cc}-session-{session}" if provider != "webshare" else user
            host = gateway if gateway.startswith("http") else f"http://{gateway}"
            if "@" in host:  # gateway ya trae credenciales
                pool.append(host)
            else:
                scheme, rest = host.split("://", 1)
                pool.append(f"{scheme}://{u}:{pwd}@{rest}")
        return pool

    # Anti-bot
    captcha_solver: str = "none"  # none | 2captcha | capsolver
    captcha_api_key: str | None = None
    stealth_patch: bool = True

    # Caché de extracciones (segundos). 0 = desactivada
    cache_ttl_seconds: int = 900
    redis_url: str | None = None

    # Lista de países soportados para cotizar envío
    default_country: str = "ES"
    supported_countries: list[str] = ["ES", "FR", "DE", "IT", "PT", "NL", "BE", "US", "MX", "GB", "BR"]

    @property
    def proxies(self) -> list[str]:
        explicit = [p.strip() for p in self.proxy_list.split(",") if p.strip()]
        return explicit + self.build_provider_proxies()


@lru_cache
def get_settings() -> Settings:
    return Settings()
