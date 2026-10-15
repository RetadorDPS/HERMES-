"""Rotación de proxies con health-tracking y backoff por proxy bloqueado."""
from __future__ import annotations

import random
import threading
import time
from dataclasses import dataclass, field

from config import get_settings


@dataclass
class ProxyState:
    url: str
    successes: int = 0
    failures: int = 0
    cooldown_until: float = 0.0
    last_error: str | None = None

    @property
    def score(self) -> float:
        total = self.successes + self.failures
        if total == 0:
            return 0.5
        return self.successes / total


@dataclass
class ProxyManager:
    """Gestiona el pool de proxies: round-robin/random + cooldown tras N fallos."""

    _states: list[ProxyState] = field(default_factory=list)
    _cursor: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def __post_init__(self) -> None:
        settings = get_settings()
        self._states = [ProxyState(url=u) for u in settings.proxies]
        self._strategy = settings.proxy_rotation

    @property
    def size(self) -> int:
        return len(self._states)

    def acquire(self, preferred: str | None = None) -> str | None:
        if preferred:
            return preferred
        with self._lock:
            if not self._states:
                return None
            now = time.time()
            alive = [s for s in self._states if s.cooldown_until <= now]
            pool = alive or self._states  # si todos en cooldown, usamos el menos malo
            if self._strategy == "random":
                chosen = random.choice(pool)
            elif self._strategy == "sticky":
                chosen = max(pool, key=lambda s: s.score)
            else:  # round-robin
                chosen = pool[self._cursor % len(pool)]
                self._cursor += 1
            return chosen.url

    def report_success(self, proxy: str | None) -> None:
        if not proxy:
            return
        for s in self._states:
            if s.url == proxy:
                s.successes += 1
                s.cooldown_until = 0.0
                s.last_error = None

    def report_failure(self, proxy: str | None, error: str, cooldown_seconds: int = 120) -> None:
        if not proxy:
            return
        for s in self._states:
            if s.url == proxy:
                s.failures += 1
                s.last_error = error
                # 3 fallos consecutivos => cooldown
                if s.failures % 3 == 0:
                    s.cooldown_until = time.time() + cooldown_seconds

    def snapshot(self) -> list[dict]:
        return [
            {
                "proxy": s.url.split("@")[-1],  # sin credenciales
                "successes": s.successes,
                "failures": s.failures,
                "score": round(s.score, 2),
                "cooldown": s.cooldown_until > time.time(),
                "last_error": s.last_error,
            }
            for s in self._states
        ]


proxy_manager = ProxyManager()
