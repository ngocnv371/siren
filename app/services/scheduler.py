from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from croniter import croniter
from sqlalchemy import func, select

from app.config import AppConfig, ProfileConfig
from app.database import get_session_factory
from app.models import Project
from app.services.pipeline.upload import run_upload_stage

log = logging.getLogger(__name__)


def get_next_run_times(cron_expr: str, count: int = 3, from_time: datetime | None = None) -> list[datetime]:
    """Get the next N scheduled run times for a cron expression."""
    if count <= 0:
        return []

    base_time = from_time or datetime.now()
    cron = croniter(cron_expr, base_time)
    return [cron.get_next(datetime) for _ in range(count)]


class UploadScheduler:
    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self._loop_tasks: dict[str, asyncio.Task[None]] = {}
        self._stop_event = asyncio.Event()
        self._upload_tasks: dict[str, asyncio.Task[None]] = {}

    async def start(self) -> None:
        enabled_profiles = [p for p in self._config.profiles if p.schedule.enabled]
        if not enabled_profiles:
            log.info("upload scheduler disabled")
            return

        self._stop_event.clear()
        for profile in enabled_profiles:
            self._loop_tasks[profile.name] = asyncio.create_task(
                self._run_loop(profile),
                name=f"upload-scheduler-{profile.name}",
            )
            log.info(
                "upload scheduler started profile=%s cron=%s",
                profile.name,
                profile.schedule.upload_rendered_cron,
            )

    async def stop(self) -> None:
        self._stop_event.set()

        for name, task in list(self._loop_tasks.items()):
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            finally:
                self._loop_tasks.pop(name, None)

        for name, task in list(self._upload_tasks.items()):
            try:
                await task
            finally:
                self._upload_tasks.pop(name, None)

    async def _run_loop(self, profile: ProfileConfig) -> None:
        cron_expr = profile.schedule.upload_rendered_cron
        while not self._stop_event.is_set():
            now = datetime.now()
            
            crox = croniter(cron_expr, now)
            next_run = crox.get_next(datetime)
            log.info(
                "upload scheduler profile=%s next run at %s",
                profile.name,
                next_run.isoformat(),
            )

            delay = (next_run - now).total_seconds()
            
            if delay > 0:
                log.info(
                    "upload scheduler profile=%s sleeping for %.2f seconds until next run",
                    profile.name,
                    delay,
                )
                await asyncio.sleep(delay)

            try:
                log.info(
                    "upload scheduler profile=%s woke up for scheduled run at %s",
                    profile.name,
                    datetime.now().isoformat(),
                )
                await self._trigger_upload(profile.name)
            except Exception as e:
                log.error(
                    "Error in upload scheduler loop for profile=%s: %s",
                    profile.name,
                    e,
                    exc_info=True,
                )

    async def _trigger_upload(self, profile_name: str) -> None:
        log.info(
            "upload scheduler triggered profile=%s at %s",
            profile_name,
            datetime.now().isoformat(),
        )
        current = self._upload_tasks.get(profile_name)
        if current is not None and not current.done():
            log.info(
                "upload scheduler skipped profile=%s; previous scheduled upload still running",
                profile_name,
            )
            return

        project_id = await self._pick_random_rendered_project_id(profile_name)
        if project_id is None:
            log.info(
                "upload scheduler found no rendered projects to upload for profile=%s",
                profile_name,
            )
            return

        log.info("upload scheduler picked profile=%s project=%s", profile_name, project_id)
        self._upload_tasks[profile_name] = asyncio.create_task(
            run_upload_stage(project_id),
            name=f"scheduled-upload-{profile_name}-{project_id}",
        )

    async def _pick_random_rendered_project_id(self, profile_name: str) -> str | None:
        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(
                select(Project.id)
                .where(Project.status == "rendered", Project.profile == profile_name)
                .order_by(func.random())
                .limit(1)
            )
            return result.scalar_one_or_none()