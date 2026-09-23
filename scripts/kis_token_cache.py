"""Process-safe shared KIS access-token cache for local batch jobs."""

from __future__ import annotations

import fcntl
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

import requests


KIS_BASE_URL = "https://openapi.koreainvestment.com:9443"
TOKEN_URL = f"{KIS_BASE_URL}/oauth2/tokenP"
TOKEN_MIN_INTERVAL_SECONDS = 300
TOKEN_SAFETY_MARGIN_SECONDS = 600
DEFAULT_CACHE_PATH = (
    Path.home()
    / "Library"
    / "Application Support"
    / "my-stock-scheduler"
    / "kis-token.json"
)


class KisTokenManager:
    """Reuse one KIS token across independent local Python processes.

    The cache is protected by an OS file lock and written atomically. This lets
    the US 06:10 job and the Korean 15:35 job share the same token without
    making a second token-issuance request while the cached token is valid.
    """

    def __init__(
        self,
        app_key: str,
        app_secret: str,
        *,
        session: requests.Session | None = None,
        cache_path: str | Path | None = None,
        timeout: tuple[float, float] = (5, 20),
    ) -> None:
        self.app_key = app_key
        self.app_secret = app_secret
        self.session = session or requests.Session()
        configured_path = cache_path or os.environ.get("KIS_TOKEN_CACHE_PATH")
        self.cache_path = Path(configured_path).expanduser() if configured_path else DEFAULT_CACHE_PATH
        self.lock_path = self.cache_path.with_name(f"{self.cache_path.name}.lock")
        self.timeout = timeout

    def get_token(self, force_refresh: bool = False) -> str:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            os.chmod(self.cache_path.parent, 0o700)
        except OSError:
            pass

        with self.lock_path.open("a+", encoding="utf-8") as lock_file:
            try:
                os.chmod(self.lock_path, 0o600)
            except OSError:
                pass
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                cached = self._read_cache()
                now = time.time()
                if self._is_valid(cached, now) and (
                    not force_refresh
                    or now - float(cached.get("issued_at", 0)) < TOKEN_MIN_INTERVAL_SECONDS
                ):
                    return str(cached["access_token"])
                return self._issue_token(now)
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    def refresh_token(self) -> str:
        """Refresh after an authentication failure, respecting KIS's limit."""

        return self.get_token(force_refresh=True)

    def _issue_token(self, issued_at: float) -> str:
        response = self.session.post(
            TOKEN_URL,
            headers={"content-type": "application/json"},
            json={
                "grant_type": "client_credentials",
                "appkey": self.app_key,
                "appsecret": self.app_secret,
            },
            timeout=self.timeout,
        )
        if response.status_code == 403:
            raise RuntimeError(
                "KIS token endpoint returned HTTP 403; reuse the cached token "
                "or wait before requesting another token."
            )
        response.raise_for_status()
        payload: dict[str, Any] = response.json()
        token = payload.get("access_token")
        if not token:
            raise RuntimeError(
                f"KIS token issuance failed: {payload.get('msg_cd', 'unknown')}"
            )

        try:
            expires_in = max(int(payload.get("expires_in", 86400)), 1)
        except (TypeError, ValueError):
            expires_in = 86400
        cache = {
            "access_token": str(token),
            "issued_at": issued_at,
            "expires_in": expires_in,
        }
        self._write_cache(cache)
        return str(token)

    def _read_cache(self) -> dict[str, Any]:
        try:
            with self.cache_path.open("r", encoding="utf-8") as cache_file:
                data = json.load(cache_file)
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return {}
        return data if isinstance(data, dict) else {}

    @staticmethod
    def _is_valid(cache: dict[str, Any], now: float) -> bool:
        token = cache.get("access_token")
        try:
            issued_at = float(cache.get("issued_at", 0))
            expires_in = float(cache.get("expires_in", 0))
        except (TypeError, ValueError):
            return False
        return bool(token) and now < issued_at + expires_in - TOKEN_SAFETY_MARGIN_SECONDS

    def _write_cache(self, cache: dict[str, Any]) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temp_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=self.cache_path.parent,
                prefix=f".{self.cache_path.name}.",
                delete=False,
            ) as temp_file:
                temp_path = temp_file.name
                json.dump(cache, temp_file, separators=(",", ":"))
                temp_file.write("\n")
                temp_file.flush()
                os.fsync(temp_file.fileno())
            os.chmod(temp_path, 0o600)
            os.replace(temp_path, self.cache_path)
        finally:
            if temp_path:
                try:
                    os.unlink(temp_path)
                except FileNotFoundError:
                    pass
