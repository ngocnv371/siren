from __future__ import annotations

import requests

from app.config import DeepSeekConfig
from .base import TextProvider


class DeepSeekTextProvider(TextProvider):
    """Text generation via the DeepSeek OpenAI-compatible API."""

    def __init__(self, config: DeepSeekConfig) -> None:
        self._config = config

    def generate(self, prompt: str, system_prompt: str | None = None) -> str:
        url = f"{self._config.base_url.rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {self._config.api_key}"}

        messages: list[dict] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        body = {"model": self._config.model, "messages": messages}

        resp = requests.post(url, headers=headers, json=body, timeout=120)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
