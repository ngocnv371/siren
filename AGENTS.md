# auto-streams — Agent Guide

## Running the app

```bash
uvicorn app.main:app --reload          # dev server (port 8000)
start.bat                              # Windows wrapper (activates venv first)
```

Python 3.12 only (`.python-version`). No lockfile; install from `requirements.txt`.

## Configuration

All runtime config lives in **`config.yml`** — no `.env`, no env vars. The YAML is parsed into dataclasses by `app/config.py`. Copy `config.example.yml` to start, then edit.

Key sections:
- `providers.*` — which AI provider to use per generation type (`gemini | openai | comfy | kittentts`)
- `comfy.base_url` — ComfyUI HTTP endpoint (default `http://127.0.0.1:8188`)
- `profiles[*].youtube.*` — per-profile upload target/channel settings
- `profiles[*].schedule.*` — per-profile in-process cron scheduler settings
- `profiles[*].prompts.*` — per-profile ideation/script strategy overrides

## Architecture overview

```
app/main.py              — FastAPI entry, lifespan (DB init + scheduler start)
app/config.py            — YAML → dataclass config loader (singleton via get_config())
app/database.py          — async SQLAlchemy engine + session factory (aiosqlite)
app/models.py            — Project + Topic ORM models; status lifecycle in PROJECT_STATUSES[]
app/schemas.py           — Pydantic request/response schemas
app/events.py            — In-memory SSE event bus (subscribe/unsubscribe)

app/routers/             — REST API: projects, dashboard, topics, ideas
app/services/pipeline/   — Pipeline stage implementations (see below)
app/services/generation/ — AI provider abstraction + concrete providers
```

### Generation providers

Abstract base classes in `app/services/generation/providers/base.py`. Concrete implementations:

| Provider | File | Used for |
|----------|------|----------|
| Gemini | `gemini.py` | text, image, TTS |
| OpenAI-compatible / Ollama | `openai_compat.py` | text |
| ComfyUI | `comfy.py` | image, music (prompt-polling workflow) |
| KittenTTS | `kittentts.py` | TTS |

ComfyUI workflows are JSON templates in `assets/`. The placeholder `__PROMPT__` is replaced at runtime before submitting to the ComfyUI API.

### Pipeline stages & batch queuing

Stages run sequentially within a single project, but across projects they're **batched** to keep ComfyUI models loaded:

| Queue | From status | To status |
|-------|-------------|-----------|
| `text_queue` | approved | scenes_ready |
| `tts_queue` | scenes_ready | tts_ready |
| `music_queue` | tts_ready | media_ready (waits for images) |
| `image_queue` | tts_ready | media_ready (waits for music) |
| `render_queue` | media_ready | clips_ready → rendered |

Music and image queues run in parallel; the last-completing one advances to `media_ready`.

**Full pipeline** (`run_full_pipeline`) runs all stages sequentially for a single project: text → tts → [music+image] → render → upload.

### Project status lifecycle

```
idea → approved → content_ready → scenes_ready → tts_ready
  → music_ready / images_ready (parallel) → media_ready
  → clips_ready → rendered → uploaded | failed
```

Any unrecoverable error transitions a project to `failed`.

Generated assets live under `./temp/{project_id}/` (configurable via `temp_dir`).

## YouTube upload

Uses Selenium Firefox WebDriver with a pre-authenticated profile (`profiles[*].youtube.firefox_profile` in config). Set `headless: true` for server deployments. Each enabled profile scheduler picks one random `rendered` project for that profile on each cron tick and runs `run_upload_stage()`.

## Frontend

Vanilla JS + CSS served as static files by FastAPI. Single-page app at `/` with SSE client at `/api/events` for real-time pipeline updates. No build step, no framework.

## Gotchas & conventions

- **No tests.** The repo has no test suite or CI.
- **Config is hot-reloaded per-request** — `get_config()` loads from disk each call if `_config` is None; otherwise returns the cached singleton. Changes to `config.yml` take effect on next request that calls `get_config()`.
- **KittenTTS legacy config:** old configs may have `kittentts.model` as a Piper voice name instead of an HF model path — the loader maps it to `voice` automatically.
- **ComfyUI workflow JSON** files use `__PROMPT__` as the placeholder for injected prompts; do not rename this token.
- **Database path** defaults to `./data/auto-streams.db`; ensure the parent directory exists (created lazily by `_get_engine()`).
