"""Stage 3 — images  (audio_ready → images_ready)."""
from __future__ import annotations

import asyncio
import logging
import os
import time

from app.config import get_config, get_profile
from app.database import get_session_factory
from app.models import Project
from app.services.generation.service import GenerationService

from ._helpers import (
    _elapsed,
    _emit,
    _fail_project,
    _format_project_slug,
    _kb,
    _load_project,
    _persist_scene_image,
    _project_dir,
)

log = logging.getLogger(__name__)

# Default dimensions for 9:16 short-form video.
_DEFAULT_WIDTH = 1080
_DEFAULT_HEIGHT = 1920


def _resolve_dimensions(profile_name: str) -> tuple[int, int]:
    """Return (width, height) based on the profile's aspect setting."""
    profile = get_profile(profile_name)
    if profile.aspect == "landscape":
        return _DEFAULT_HEIGHT, _DEFAULT_WIDTH
    if profile.aspect == "portrait":
        return _DEFAULT_WIDTH, _DEFAULT_HEIGHT
    # auto: derive from form
    if profile.form == "long":
        return _DEFAULT_HEIGHT, _DEFAULT_WIDTH
    return _DEFAULT_WIDTH, _DEFAULT_HEIGHT


def _build_prompt(scene: dict, visual_guide: str) -> str:
    """Build the image prompt for a single scene."""
    base = scene.get("image_prompt") or f"Cinematic scene: {scene.get('voiceover', '')}"
    return f"{base}. Style: {visual_guide}" if visual_guide else base


async def _generate_scene_image(
    svc: GenerationService,
    scene: dict,
    i: int,
    total: int,
    visual_guide: str,
    img_width: int,
    img_height: int,
    out_dir: str,
    project_id: str,
    log_prefix: str,
) -> str | None:
    """Generate an image for one scene. Returns the path, or None if skipped."""
    existing_path = scene.get("image_path")
    if existing_path and os.path.exists(existing_path):
        log.info(
            "%s: scene %d/%d already exists, reusing  path=%s",
            log_prefix, i + 1, total, existing_path,
        )
        return existing_path

    prompt = _build_prompt(scene, visual_guide)
    log.debug("%s: scene %d/%d  prompt=%r  dims=%dx%d",
              log_prefix, i + 1, total, prompt[:120], img_width, img_height)

    t_img = time.monotonic()
    image_bytes = await asyncio.to_thread(svc.generate_image, prompt, img_width, img_height)
    image_path = os.path.join(out_dir, f"scene_{i:03d}_image.png")
    with open(image_path, "wb") as f:
        f.write(image_bytes)
    log.info(
        "%s: scene %d/%d done  size=%s  elapsed=%s  path=%s",
        log_prefix, i + 1, total, _kb(len(image_bytes)), _elapsed(t_img), image_path,
    )
    _emit(f"Image: scene {i + 1}/{total} done", level="success", project_id=project_id, stage="image")
    await _persist_scene_image(project_id, i, image_path)
    return image_path


async def run_image_stage(project_id: str) -> None:
    """Generate one image per scene."""
    from app.events import inc_active, dec_active, emit as _emit_event
    log.info("image_stage start project=%s", project_id)
    inc_active()
    _emit("Image stage started", project_id=project_id, stage="image")
    try:
        project = await _load_project(project_id)
        if project is None:
            log.warning("image_stage: project %s not found", project_id)
            return
        log.info("image_stage: project=%s", _format_project_slug(project))
        _emit("Generating images for %s", _format_project_slug(project), project_id=project_id, stage="image")

        meta = project.get_metadata()
        scenes = meta.get("scenes", [])
        if not scenes:
            _emit(
                "image_stage: project %s has no scenes in metadata (status=%s), skipping",
                project_id, project.status,
            )
            return

        if project.status != "music_ready":
            # May be running in parallel with music stage via asyncio.gather()
            # Wait briefly and re-check — music stage may commit while we're waiting
            await asyncio.sleep(3)
            project = await _load_project(project_id)
            if project is None:
                log.warning("image_stage: project %s disappeared during retry wait", project_id)
                return
            if project.status != "music_ready":
                _emit(
                    "image_stage: project %s has status %r, expected 'music_ready'",
                    project_id, project.status,
                )
                return

        visual_guide = meta.get("visual_guide", "")
        log.info("image_stage: %d scenes  provider=%r  visual_guide=%r",
                 len(scenes), get_config().providers.image, visual_guide[:80])

        out_dir = _project_dir(project_id)
        svc = GenerationService()
        img_width, img_height = _resolve_dimensions(project.profile)
        log.info("image_stage: profile=%r  form=%r  aspect=%r  dimensions=%dx%d",
                 project.profile, get_profile(project.profile).form, get_profile(project.profile).aspect, img_width, img_height)

        for i, scene in enumerate(scenes):
            await _generate_scene_image(
                svc, scene, i, len(scenes), visual_guide,
                img_width, img_height, out_dir, project_id, "image_stage",
            )

        factory = get_session_factory()
        async with factory() as session:
            p = await session.get(Project, project_id)
            if p is None:
                log.warning("image_stage: project %s disappeared during processing", project_id)
                return
            m = p.get_metadata()
            m["images_done"] = True
            p.set_metadata(m)
            p.status = "images_ready"
            p.touch()
            await session.commit()
            new_status = p.status

        log.info("image_stage done project=%s  status=%s", project_id, new_status)
        _emit("Images complete", level="success", project_id=project_id, stage="image")
        _emit_event("project_update", project_id=project_id, status=new_status)

    except Exception as exc:
        log.exception("image_stage failed project=%s", project_id)
        error_type = "unknown"
        if "ComfyUnavailable" in type(exc).__name__:
            error_type = "comfy_unavailable"
        elif "ComfyTimeout" in type(exc).__name__:
            error_type = "comfy_timeout"
        elif "ComfyWorkflow" in type(exc).__name__:
            error_type = "workflow_error"
        await _fail_project(project_id, "image_stage failed — see server logs", error_type)
    finally:
        dec_active()


async def run_scene_image(project_id: str, scene_index: int) -> None:
    """Re-generate the image for a single scene without changing project status."""
    from app.events import inc_active, dec_active, emit as _emit_event
    log.info("scene_image start project=%s scene=%d", project_id, scene_index)
    inc_active()
    _emit(f"Re-generating image for scene {scene_index + 1}", project_id=project_id, stage="image")
    try:
        project = await _load_project(project_id)
        if project is None:
            log.warning("scene_image: project %s not found", project_id)
            return
        log.info("scene_image: project=%s scene=%d", _format_project_slug(project), scene_index)
        _emit(f"Re-generating image for scene {scene_index + 1} of %s", _format_project_slug(project), project_id=project_id, stage="image")

        meta = project.get_metadata()
        scenes = meta.get("scenes", [])
        if scene_index < 0 or scene_index >= len(scenes):
            log.warning("scene_image: scene index %d out of range (0-%d)", scene_index, len(scenes) - 1)
            return

        scene = scenes[scene_index]
        visual_guide = meta.get("visual_guide", "")
        out_dir = _project_dir(project_id)
        svc = GenerationService()
        img_width, img_height = _resolve_dimensions(project.profile)

        await _generate_scene_image(
            svc, scene, scene_index, len(scenes), visual_guide,
            img_width, img_height, out_dir, project_id, "scene_image",
        )

        factory = get_session_factory()
        async with factory() as session:
            p = await session.get(Project, project_id)
            if p is None:
                log.warning("scene_image: project %s disappeared during processing", project_id)
                return
            m = p.get_metadata()
            m["scenes"][scene_index] = {**m["scenes"][scene_index], "image_path": os.path.join(out_dir, f"scene_{scene_index:03d}_image.png")}
            p.set_metadata(m)
            p.touch()
            await session.commit()

        log.info("scene_image done project=%s scene=%d", project_id, scene_index)
        _emit(f"Scene {scene_index + 1} image ready", level="success", project_id=project_id, stage="image")
        _emit_event("project_update", project_id=project_id, status=None)

    except Exception:
        log.exception("scene_image failed project=%s scene=%d", project_id, scene_index)
        _emit(f"Scene {scene_index + 1} image failed", level="error", project_id=project_id, stage="image")
    finally:
        dec_active()


async def run_all_scene_images(project_id: str) -> None:
    """Re-generate images for every scene without changing project status."""
    from app.events import inc_active, dec_active, emit as _emit_event
    log.info("all_scene_images start project=%s", project_id)
    inc_active()
    _emit("Re-generating all images", project_id=project_id, stage="image")
    try:
        project = await _load_project(project_id)
        if project is None:
            log.warning("all_scene_images: project %s not found", project_id)
            return
        log.info("all_scene_images: project=%s", _format_project_slug(project))
        _emit("Re-generating all images for %s", _format_project_slug(project), project_id=project_id, stage="image")

        meta = project.get_metadata()
        scenes = meta.get("scenes", [])
        if not scenes:
            log.warning("all_scene_images: project %s has no scenes", project_id)
            return

        visual_guide = meta.get("visual_guide", "")
        out_dir = _project_dir(project_id)
        svc = GenerationService()
        img_width, img_height = _resolve_dimensions(project.profile)
        log.info("all_scene_images: profile=%r  form=%r  aspect=%r  dimensions=%dx%d",
                 project.profile, get_profile(project.profile).form, get_profile(project.profile).aspect, img_width, img_height)

        for i, scene in enumerate(scenes):
            await _generate_scene_image(
                svc, scene, i, len(scenes), visual_guide,
                img_width, img_height, out_dir, project_id, "all_scene_images",
            )

        log.info("all_scene_images done project=%s", project_id)
        _emit("All images ready", level="success", project_id=project_id, stage="image")
        _emit_event("project_update", project_id=project_id, status=None)

    except Exception:
        log.exception("all_scene_images failed project=%s", project_id)
        _emit("All images re-gen failed", level="error", project_id=project_id, stage="image")
    finally:
        dec_active()
