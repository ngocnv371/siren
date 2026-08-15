from __future__ import annotations

import asyncio
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_config, get_profile
from app.database import get_session
from app.models import Project, Topic
from app.schemas import GenerateIdeasRequest, ProjectOut
from app.services.generation.service import GenerationService

router = APIRouter()

Session = Annotated[AsyncSession, Depends(get_session)]

def _build_prompt(topic: str, count: int) -> str:
    return (
        f"Generate {count} unique, engaging video ideas based on this topic:\n"
        f'"{topic}"\n\n'
        "Rules:\n"
        "- Each idea must have a compelling one-sentence title.\n"
        "- Each idea must have a one-sentence summary.\n"
        "- Ideas should be varied (different angles, hooks, and formats).\n\n"
        "Respond with a JSON array ONLY — no explanation, no markdown fences:\n"
        '[{"title": "...", "summary": "..."}, ...]'
    )


def _with_profile_prompt(base_prompt: str, profile_ideate_prompt: str) -> str:
    prompt = profile_ideate_prompt.strip()
    if not prompt:
        return base_prompt
    return f"{base_prompt}\n\nProfile strategy for this channel:\n{prompt}"


def _parse_ideas(raw: str) -> list[dict]:
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    raw = raw.strip()
    data = json.loads(raw)
    if not isinstance(data, list):
        raise ValueError("Expected a JSON array")
    ideas = []
    for item in data:
        if isinstance(item, dict) and "title" in item:
            ideas.append(
                {
                    "title": str(item["title"]).strip(),
                    "summary": str(item.get("summary", "")).strip(),
                }
            )
    return ideas


@router.get("/preview")
async def preview_ideas(session: Session, topic_id: str, count: int = 5, profile: str | None = None):
    if count < 1 or count > 20:
        raise HTTPException(400, "count must be between 1 and 20")

    result = await session.execute(select(Topic).where(Topic.id == topic_id))
    topic = result.scalar_one_or_none()
    if not topic:
        raise HTTPException(404, "Topic not found")

    cfg = get_config()
    profile_name = (profile or cfg.profiles[0].name).strip()
    try:
        profile = get_profile(profile_name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    prompt = _with_profile_prompt(_build_prompt(topic.topic, count), profile.prompts.ideate)
    return {"prompt": prompt}


@router.post("/generate", response_model=list[ProjectOut])
async def generate_ideas(body: GenerateIdeasRequest, session: Session):
    if body.count < 1 or body.count > 20:
        raise HTTPException(400, "count must be between 1 and 20")

    result = await session.execute(select(Topic).where(Topic.id == body.topic_id))
    topic = result.scalar_one_or_none()
    if not topic:
        raise HTTPException(404, "Topic not found")

    cfg = get_config()
    profile_name = (body.profile or cfg.profiles[0].name).strip()
    try:
        profile = get_profile(profile_name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    if topic.profile != profile_name:
        raise HTTPException(400, "Topic does not belong to the selected profile")

    svc = GenerationService()
    prompt = _with_profile_prompt(_build_prompt(topic.topic, body.count), profile.prompts.ideate)
    try:
        raw = await asyncio.to_thread(svc.generate_text, prompt)
    except Exception as e:
        raise HTTPException(502, f"LLM error: {e}")

    try:
        ideas = _parse_ideas(raw)
    except Exception:
        raise HTTPException(502, f"Failed to parse LLM response: {raw[:300]}")

    if not ideas:
        raise HTTPException(502, "LLM returned no ideas")

    now = datetime.now(timezone.utc)
    projects = []
    for idea in ideas:
        meta = {"summary": idea["summary"]} if idea["summary"] else {}
        p = Project(
            id=str(uuid.uuid4()),
            topic_id=body.topic_id,
            profile=profile.name,
            title=idea["title"],
            status="idea",
            tags_json="[]",
            meta_json=json.dumps(meta),
            created_at=now,
            updated_at=now,
        )
        session.add(p)
        projects.append(p)

    await session.commit()
    for p in projects:
        await session.refresh(p)
    return [p.to_dict() for p in projects]
