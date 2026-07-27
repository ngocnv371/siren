from __future__ import annotations

import json
import logging
import random
import time

import requests

log = logging.getLogger(__name__)

from app.config import ComfyConfig
from .base import ImageProvider, MusicProvider, TTSProvider

# ── Typed exceptions ─────────────────────────────────────────────────────────

class ComfyUnavailableError(Exception):
    """ComfyUI server is down or unreachable (transient)."""

class ComfyTimeoutError(Exception):
    """Workflow exceeded poll timeout (likely transient)."""

class ComfyWorkflowError(RuntimeError):
    """Workflow itself failed (fatal — not retryable)."""

# ── Constants ────────────────────────────────────────────────────────────────

_POLL_INTERVAL = 2.0
_POLL_TIMEOUT = 600
_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 5  # seconds


# ── ComfyHealth ──────────────────────────────────────────────────────────────

class ComfyHealth:
    """Lightweight health checker for ComfyUI. Caches results to avoid spamming the API."""

    _available: bool = True
    _last_check: float = 0
    _CACHE_TTL = 10  # seconds

    @classmethod
    def is_available(cls) -> bool:
        now = time.monotonic()
        if now - cls._last_check < cls._CACHE_TTL:
            return cls._available
        cls._available = cls._check_sync()
        cls._last_check = now
        return cls._available

    @classmethod
    def mark_available(cls, available: bool) -> None:
        cls._available = available
        cls._last_check = time.monotonic()

    @classmethod
    def _check_sync(cls) -> bool:
        try:
            from app.config import get_config
            cfg = get_config()
            base = cfg.comfy.base_url.rstrip("/")
            resp = requests.get(f"{base}/api/queue", timeout=5)
            return resp.status_code == 200
        except Exception:
            return False


# ── _ComfyClient ─────────────────────────────────────────────────────────────

class _ComfyClient:
    """Thin wrapper around the ComfyUI HTTP API."""

    def __init__(self, base_url: str) -> None:
        self._base = base_url.rstrip("/")

    def queue_prompt(self, workflow: dict) -> str:
        try:
            resp = requests.post(
                f"{self._base}/prompt",
                json={"prompt": workflow, "client_id": "siren"},
                timeout=30,
            )
            resp.raise_for_status()
        except requests.exceptions.RequestException as exc:
            raise ComfyUnavailableError(f"ComfyUI /prompt failed: {exc}") from exc
        return resp.json()["prompt_id"]

    def get_history(self, prompt_id: str) -> dict:
        try:
            resp = requests.get(f"{self._base}/history/{prompt_id}", timeout=30)
            resp.raise_for_status()
        except requests.exceptions.RequestException as exc:
            raise ComfyUnavailableError(f"ComfyUI /history failed: {exc}") from exc
        return resp.json()

    def download(self, filename: str, subfolder: str, file_type: str = "output") -> bytes:
        try:
            resp = requests.get(
                f"{self._base}/view",
                params={"filename": filename, "subfolder": subfolder, "type": file_type},
                timeout=120,
            )
            resp.raise_for_status()
        except requests.exceptions.RequestException as exc:
            raise ComfyUnavailableError(f"ComfyUI /view failed: {exc}") from exc
        return resp.content

    def wait_for_result(self, prompt_id: str) -> dict:
        """Block until the workflow completes and return the outputs dict."""
        deadline = time.monotonic() + _POLL_TIMEOUT
        while time.monotonic() < deadline:
            try:
                history = self.get_history(prompt_id)
            except ComfyUnavailableError:
                time.sleep(_POLL_INTERVAL)
                continue
            if prompt_id in history:
                entry = history[prompt_id]
                status = entry.get("status", {})
                if status.get("completed"):
                    return entry["outputs"]
                if status.get("status_str") == "error":
                    raise ComfyWorkflowError(f"ComfyUI workflow failed: {status}")
            time.sleep(_POLL_INTERVAL)
        raise ComfyTimeoutError(
            f"ComfyUI workflow {prompt_id!r} did not complete within {_POLL_TIMEOUT}s"
        )


def _load_workflow(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _apply_placeholders(workflow: dict, replacements: dict[str, str]) -> dict:
    """String-replace __PLACEHOLDER__ tokens in the serialised workflow."""
    text = json.dumps(workflow)
    for token, value in replacements.items():
        text = text.replace(token, value)
    return json.loads(text)


def _randomise_seeds(workflow: dict) -> None:
    """Randomise any fixed 'seed' values so each run is unique."""
    for node in workflow.values():
        if isinstance(node, dict) and "seed" in node.get("inputs", {}):
            node["inputs"]["seed"] = random.randint(0, 2**32 - 1)


class ComfyImageProvider(ImageProvider):
    def __init__(self, config: ComfyConfig) -> None:
        self._config = config
        self._client = _ComfyClient(config.base_url)

    def generate(self, prompt: str, width: int, height: int) -> bytes:
        workflow = _load_workflow(self._config.workflows.image)
        workflow = _apply_placeholders(workflow, {
            "__PROMPT__": prompt,
            "__WIDTH__": str(width),
            "__HEIGHT__": str(height),
        })
        _randomise_seeds(workflow)

        last_exc = None
        for attempt in range(_MAX_RETRIES):
            try:
                prompt_id = self._client.queue_prompt(workflow)
                outputs = self._client.wait_for_result(prompt_id)
                break
            except ComfyUnavailableError as exc:
                last_exc = exc
                if attempt < _MAX_RETRIES - 1:
                    wait = _RETRY_BASE_DELAY * (2 ** attempt)
                    log.warning("ComfyUI unavailable (image), retrying in %ds (attempt %d/%d)",
                                wait, attempt + 1, _MAX_RETRIES)
                    time.sleep(wait)
            except ComfyTimeoutError as exc:
                last_exc = exc
                if attempt < _MAX_RETRIES - 1:
                    wait = _RETRY_BASE_DELAY * (2 ** attempt)
                    log.warning("ComfyUI workflow timed out (image), retrying in %ds (attempt %d/%d)",
                                wait, attempt + 1, _MAX_RETRIES)
                    time.sleep(wait)

        if last_exc is not None:
            raise last_exc

        for node_output in outputs.values():
            if "images" in node_output:
                img = node_output["images"][0]
                return self._client.download(img["filename"], img.get("subfolder", ""))

        raise ComfyWorkflowError("ComfyUI image workflow produced no image output")


class ComfyMusicProvider(MusicProvider):
    def __init__(self, config: ComfyConfig) -> None:
        self._config = config
        self._client = _ComfyClient(config.base_url)

    def generate(self, prompt: str, duration: int = 60) -> bytes:
        workflow = _load_workflow(self._config.workflows.music)
        workflow = _apply_placeholders(workflow, {
            "__PROMPT__": prompt,
            "1900": str(duration),
        })
        _randomise_seeds(workflow)

        last_exc = None
        for attempt in range(_MAX_RETRIES):
            try:
                prompt_id = self._client.queue_prompt(workflow)
                outputs = self._client.wait_for_result(prompt_id)
                break
            except ComfyUnavailableError as exc:
                last_exc = exc
                if attempt < _MAX_RETRIES - 1:
                    wait = _RETRY_BASE_DELAY * (2 ** attempt)
                    log.warning("ComfyUI unavailable (music), retrying in %ds (attempt %d/%d)",
                                wait, attempt + 1, _MAX_RETRIES)
                    time.sleep(wait)
            except ComfyTimeoutError as exc:
                last_exc = exc
                if attempt < _MAX_RETRIES - 1:
                    wait = _RETRY_BASE_DELAY * (2 ** attempt)
                    log.warning("ComfyUI workflow timed out (music), retrying in %ds (attempt %d/%d)",
                                wait, attempt + 1, _MAX_RETRIES)
                    time.sleep(wait)

        if last_exc is not None:
            raise last_exc

        for node_output in outputs.values():
            if "audio" in node_output:
                aud = node_output["audio"][0]
                return self._client.download(aud["filename"], aud.get("subfolder", ""))

        raise ComfyWorkflowError("ComfyUI music workflow produced no audio output")



class ComfyTTSProvider(TTSProvider):
    def __init__(self, config: ComfyConfig) -> None:
        self._config = config
        self._client = _ComfyClient(config.base_url)

    def synthesize(self, text: str, narrator: str | None = None, voice: str | None = None, speed: float = 1.0) -> bytes:
        workflow = _load_workflow(self._config.workflows.tts)
        workflow = _apply_placeholders(workflow, {
            "__PROMPT__": text,
        })
        _randomise_seeds(workflow)

        last_exc = None
        for attempt in range(_MAX_RETRIES):
            try:
                prompt_id = self._client.queue_prompt(workflow)
                outputs = self._client.wait_for_result(prompt_id)
                break
            except ComfyUnavailableError as exc:
                last_exc = exc
                if attempt < _MAX_RETRIES - 1:
                    wait = _RETRY_BASE_DELAY * (2 ** attempt)
                    log.warning("ComfyUI unavailable (TTS), retrying in %ds (attempt %d/%d)",
                                wait, attempt + 1, _MAX_RETRIES)
                    time.sleep(wait)
            except ComfyTimeoutError as exc:
                last_exc = exc
                if attempt < _MAX_RETRIES - 1:
                    wait = _RETRY_BASE_DELAY * (2 ** attempt)
                    log.warning("ComfyUI workflow timed out (TTS), retrying in %ds (attempt %d/%d)",
                                wait, attempt + 1, _MAX_RETRIES)
                    time.sleep(wait)

        if last_exc is not None:
            raise last_exc

        for node_output in outputs.values():
            print(f"output: {node_output}")
            if "audio" in node_output:
                aud = node_output["audio"][0]
                return self._client.download(aud["filename"], aud.get("subfolder", ""))

        raise ComfyWorkflowError("ComfyUI TTS workflow produced no audio output")
