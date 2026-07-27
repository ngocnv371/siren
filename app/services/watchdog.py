"""ComfyUI Watchdog — monitors health, pauses/resumes ComfyUI-dependent queues, auto-restarts."""
from __future__ import annotations

import asyncio
import logging
import os
import platform
import subprocess
import time

from app.events import emit

log = logging.getLogger(__name__)

_COMFY_QUEUES = {"music_queue", "image_queue", "tts_queue"}


class ComfyWatchdog:
    """Background task that monitors ComfyUI health and manages queue pausing."""

    _running: bool = False
    _comfy_available: bool = True
    _resume_event: asyncio.Event | None = None
    _restart_attempts: int = 0
    _last_restart_time: float = 0
    _restart_lock: asyncio.Lock | None = None

    @classmethod
    async def start(cls) -> None:
        cls._running = True
        cls._resume_event = asyncio.Event()
        cls._restart_lock = asyncio.Lock()
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
                        cls._restart_attempts = 0
                        cls._resume_event.set()
                    else:
                        # ComfyUI went down — attempt auto-restart if configured
                        await cls._try_restart()
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
    async def _try_restart(cls) -> None:
        """Attempt to restart ComfyUI if auto_restart is enabled."""
        from app.config import get_config
        cfg = get_config()
        comfy_cfg = cfg.comfy

        if not comfy_cfg.auto_restart:
            return
        if not comfy_cfg.restart_cmd:
            log.warning("ComfyUI is down but no restart_cmd configured — skipping auto-restart")
            return

        async with cls._restart_lock:
            # Check max restart attempts
            if cls._restart_attempts >= comfy_cfg.max_restart_attempts:
                log.warning(
                    "ComfyUI restart limit reached (%d attempts). Manual intervention required.",
                    comfy_cfg.max_restart_attempts,
                )
                return

            # Check cooldown period
            elapsed = time.monotonic() - cls._last_restart_time
            if elapsed < comfy_cfg.restart_delay:
                log.info(
                    "ComfyUI restart cooldown: %.0fs elapsed, %.0fs remaining",
                    elapsed, comfy_cfg.restart_delay - elapsed,
                )
                return

            cls._restart_attempts += 1
            attempt_num = cls._restart_attempts
            cls._last_restart_time = time.monotonic()

        log.info("Attempting ComfyUI restart (attempt %d/%d) via: %s",
                 attempt_num, comfy_cfg.max_restart_attempts, comfy_cfg.restart_cmd)

        success = await cls._execute_restart(comfy_cfg.restart_cmd)
        if success:
            log.info("ComfyUI restart command executed successfully (attempt %d)", attempt_num)
            emit("comfy_status", available=False, event="restart_attempt", attempt=attempt_num)
        else:
            log.error("ComfyUI restart command failed (attempt %d)", attempt_num)
            emit("comfy_status", available=False, event="restart_failed", attempt=attempt_num)

    @classmethod
    async def _execute_restart(cls, cmd: str) -> bool:
        """Execute the restart command. Cleans up zombie ComfyUI processes first."""
        try:
            # Kill any existing ComfyUI processes on port 8188
            cls._kill_comfyui_processes()

            # Resolve the working directory from the command path
            # (bat files use relative paths like python_env/python.exe)
            if platform.system() == "Windows":
                cwd = os.path.dirname(os.path.abspath(cmd))
                print(f"Executing ComfyUI restart command in cwd={cwd}: {cmd}")
                # CREATE_NEW_CONSOLE opens a visible window; cwd ensures relative paths work
                # Quote the command to handle paths with spaces
                subprocess.Popen(
                    [cmd],
                    cwd=cwd,
                    creationflags=subprocess.CREATE_NEW_CONSOLE,
                )
            else:
                cwd = os.path.dirname(os.path.abspath(cmd))
                subprocess.Popen(
                    cmd,
                    shell=True,
                    cwd=cwd,
                )

            return True
        except Exception:
            log.exception("ComfyUI restart execution failed")
            return False

    @classmethod
    def _kill_comfyui_processes(cls) -> None:
        """Kill any processes listening on ComfyUI port (8188)."""
        try:
            if platform.system() == "Windows":
                # Use netstat + taskkill to find and kill processes on port 8188
                result = subprocess.run(
                    ["netstat", "-ano"],
                    capture_output=True, text=True, check=True,
                )
                for line in result.stdout.splitlines():
                    if ":8188" in line and "LISTENING" in line:
                        pid = line.strip().split()[-1]
                        try:
                            subprocess.run(
                                ["taskkill", "/F", "/PID", pid, "/T"],
                                capture_output=True, check=False,
                            )
                            log.info("Killed ComfyUI process PID %s", pid)
                        except Exception:
                            log.exception("Failed to kill PID %s", pid)
            else:
                # Unix: use lsof or fuser
                try:
                    subprocess.run(
                        ["fuser", "-k", "8188/tcp"],
                        capture_output=True, check=True,
                    )
                    log.info("Killed processes on port 8188")
                except subprocess.CalledProcessError:
                    pass
        except Exception:
            log.exception("ComfyUI process cleanup failed")

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

    @classmethod
    async def manual_restart(cls) -> bool:
        """Manually trigger a ComfyUI restart (called from API endpoint)."""
        from app.config import get_config
        cfg = get_config()
        comfy_cfg = cfg.comfy

        if not comfy_cfg.restart_cmd:
            raise ValueError("No restart_cmd configured")

        async with cls._restart_lock:
            cls._restart_attempts += 1
            cls._last_restart_time = time.monotonic()
            attempt_num = cls._restart_attempts

        log.info("Manual ComfyUI restart triggered (attempt %d)", attempt_num)
        success = await cls._execute_restart(comfy_cfg.restart_cmd)
        if success:
            emit("comfy_status", available=False, event="manual_restart", attempt=attempt_num)
        return success

    @classmethod
    def get_status(cls) -> dict:
        """Return current watchdog status for API endpoint."""
        from app.config import get_config
        cfg = get_config()
        return {
            "available": cls._comfy_available,
            "watchdog_available": cls._comfy_available,
            "restart_attempts": cls._restart_attempts,
            "max_restart_attempts": cfg.comfy.max_restart_attempts,
            "auto_restart_enabled": cfg.comfy.auto_restart,
            "restart_cmd": cfg.comfy.restart_cmd,
        }
