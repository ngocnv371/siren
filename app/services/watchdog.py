"""ComfyUI Watchdog — monitors health, pauses/resumes ComfyUI-dependent queues."""
from __future__ import annotations

import asyncio
import logging

from app.events import emit

log = logging.getLogger(__name__)

_COMFY_QUEUES = {"music_queue", "image_queue", "tts_queue"}


class ComfyWatchdog:
    """Background task that monitors ComfyUI health and manages queue pausing."""

    _running: bool = False
    _comfy_available: bool = True
    _resume_event: asyncio.Event | None = None

    @classmethod
    async def start(cls) -> None:
        cls._running = True
        cls._resume_event = asyncio.Event()
        asyncio.create_task(cls._monitor_loop())
        log.info("ComfyWatchdog started")

    @classmethod
    async def stop(cls) -> None:
        cls._running = False
        if cls._resume_event:
            cls._resume_event.set()
        log.info("ComfyWatchdog stopped")

    @classmethod
    async def _monitor_loop(cls) -> None:
        while cls._running:
            try:
                available = cls._check_comfy()
                if available != cls._comfy_available:
                    old_status = "up" if cls._comfy_available else "down"
                    new_status = "up" if available else "down"
                    log.info("ComfyUI status changed: %s -> %s", old_status, new_status)
                    cls._comfy_available = available
                    emit("comfy_status", available=available)
                    if available:
                        cls._resume_event.set()
            except Exception:
                log.exception("ComfyWatchdog health check failed")
            await asyncio.sleep(30)

    @classmethod
    def _check_comfy(cls) -> bool:
        try:
            from app.services.generation.providers.comfy import ComfyHealth
            return ComfyHealth.is_available()
        except Exception:
            return False

    @classmethod
    def is_available(cls) -> bool:
        return cls._comfy_available

    @classmethod
    def is_queue_paused(cls, queue: str) -> bool:
        return not cls._comfy_available and queue in _COMFY_QUEUES

    @classmethod
    async def wait_for_recovery(cls, timeout: float = 600) -> bool:
        """Block until ComfyUI comes back or timeout is reached."""
        if cls._comfy_available:
            return True
        if cls._resume_event:
            try:
                await asyncio.wait_for(cls._resume_event.wait(), timeout=timeout)
                return cls._comfy_available
            except asyncio.TimeoutError:
                return False
        return False
