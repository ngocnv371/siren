from __future__ import annotations

from fastapi import APIRouter

from app.config import get_config
from app.schemas import ProfileOut

router = APIRouter()


@router.get("", response_model=list[ProfileOut])
async def list_profiles() -> list[ProfileOut]:
    cfg = get_config()
    return [
        ProfileOut(
            name=profile.name,
            form=profile.form,
            aspect=profile.aspect,
            youtube_name=profile.youtube.name,
            schedule_enabled=profile.schedule.enabled,
            upload_rendered_cron=profile.schedule.upload_rendered_cron,
            prompts_ideate=profile.prompts.ideate,
            prompts_script=profile.prompts.script,
        )
        for profile in cfg.profiles
    ]
