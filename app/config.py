from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import yaml


@dataclass
class DatabaseConfig:
    path: str = "./data/sqlite.db"


@dataclass
class GeminiConfig:
    api_key: str = ""
    text_model: str = "gemini-2.0-flash"
    image_model: str = "gemini-3.1-flash-image-preview"
    tts_model: str = "gemini-2.5-flash-preview-tts"
    tts_voice: str = "Kore"


@dataclass
class OpenAIConfig:
    base_url: str = "http://localhost:11434/v1"
    api_key: str = "ollama"
    model: str = "llama3.2"


@dataclass
class DeepSeekConfig:
    base_url: str = "https://api.deepseek.com/v1"
    api_key: str = ""
    model: str = "deepseek-v4-flash"


@dataclass
class ComfyWorkflows:
    image: str = "./assets/comfy-zimage.json"
    music: str = "./assets/comfy-music.json"
    tts: str = "./assets/comfy-tts-kokoro.json"


@dataclass
class ComfyConfig:
    base_url: str = "http://127.0.0.1:8188"
    workflows: ComfyWorkflows = field(default_factory=ComfyWorkflows)
    restart_cmd: str = ""           # command/script to restart ComfyUI (e.g. "D:\\ComfyUI\\start.bat")
    auto_restart: bool = False      # auto-restart ComfyUI when crash detected
    restart_delay: int = 30         # seconds to wait before attempting restart
    max_restart_attempts: int = 5   # max restart attempts before giving up


@dataclass
class KittenTTSConfig:
    model: str = "KittenML/kitten-tts-nano-0.8"
    voice: str = "expr-voice-5-m"


@dataclass
class ProvidersConfig:
    text: str = "gemini"    # gemini | openai | deepseek
    image: str = "comfy"    # gemini | comfy
    tts: str = "kittentts"  # gemini | kittentts
    music: str = "comfy"    # comfy
    tts_delay: float = 0.0  # seconds to wait between per-scene TTS calls
    tts_language: str = "en"  # BCP-47 language code for TTS alignment


@dataclass
class SubtitleStyle:
    font: str = "Arial"
    fontSize: int = 24
    color: str = "#FFFFFF"
    stroke: str = "#000000"


@dataclass
class VideoConfig:
    enableKenBurns: bool = True
    enableParticles: bool = False
    enableSubtitles: bool = False
    subtitleStyle: SubtitleStyle = field(default_factory=SubtitleStyle)
    whisper_model: str = "base"  # stable-ts model for script alignment (tiny/base/small/medium/large)
    scene_gap: float = 0.5  # seconds of silence appended to each scene's audio segment


@dataclass
class ServerConfig:
    host: str = "0.0.0.0"
    port: int = 8000


@dataclass
class YouTubeConfig:
    name: str = ""                  # Display name for the YouTube channel/profile
    firefox_profile: str = ""       # absolute or relative path to a Firefox profile directory
    visibility: str = "unlisted"    # public | unlisted | private
    headless: bool = False          # Whether to run the browser in headless mode (no GUI). Set to true for server deployments.


@dataclass
class SchedulerConfig:
    enabled: bool = False
    upload_rendered_cron: str = "0 9 * * *"


@dataclass
class ProfilePromptsConfig:
    ideate: str = ""
    script: str = ""


@dataclass
class ProfileConfig:
    name: str = "default"
    form: str = "short"            # short | long
    aspect: str = "auto"           # auto | portrait | landscape
    youtube: YouTubeConfig = field(default_factory=YouTubeConfig)
    schedule: SchedulerConfig = field(default_factory=SchedulerConfig)
    prompts: ProfilePromptsConfig = field(default_factory=ProfilePromptsConfig)


@dataclass
class AppConfig:
    database: DatabaseConfig = field(default_factory=DatabaseConfig)
    temp_dir: str = "./temp"
    providers: ProvidersConfig = field(default_factory=ProvidersConfig)
    gemini: GeminiConfig = field(default_factory=GeminiConfig)
    openai: OpenAIConfig = field(default_factory=OpenAIConfig)
    deepseek: DeepSeekConfig = field(default_factory=DeepSeekConfig)
    comfy: ComfyConfig = field(default_factory=ComfyConfig)
    kittentts: KittenTTSConfig = field(default_factory=KittenTTSConfig)
    video: VideoConfig = field(default_factory=VideoConfig)
    server: ServerConfig = field(default_factory=ServerConfig)
    youtube: YouTubeConfig = field(default_factory=YouTubeConfig)
    scheduler: SchedulerConfig = field(default_factory=SchedulerConfig)
    profiles: list[ProfileConfig] = field(default_factory=list)


def _parse_profiles(data: dict, cfg: AppConfig) -> list[ProfileConfig]:
    raw_profiles = data.get("profiles")
    profiles: list[ProfileConfig] = []

    if isinstance(raw_profiles, list) and raw_profiles:
        for i, raw in enumerate(raw_profiles):
            if not isinstance(raw, dict):
                raise ValueError(f"profiles[{i}] must be a mapping")

            name = str(raw.get("name", "")).strip()
            if not name:
                raise ValueError(f"profiles[{i}].name is required")

            schedule_raw = raw.get("schedule", {})
            if isinstance(schedule_raw, str):
                schedule = SchedulerConfig(enabled=True, upload_rendered_cron=schedule_raw)
            elif isinstance(schedule_raw, dict):
                schedule = SchedulerConfig(**schedule_raw)
            else:
                raise ValueError(
                    f"profiles[{i}].schedule must be a cron string or mapping"
                )

            prompts_raw = raw.get("prompts", {})
            if isinstance(prompts_raw, dict):
                prompts = ProfilePromptsConfig(**prompts_raw)
            else:
                raise ValueError(f"profiles[{i}].prompts must be a mapping")

            form = str(raw.get("form", "short")).lower()
            if form not in ("short", "long"):
                form = "short"

            aspect = str(raw.get("aspect", "auto")).lower()
            if aspect not in ("auto", "portrait", "landscape"):
                aspect = "auto"

            profiles.append(
                ProfileConfig(
                    name=name,
                    form=form,
                    aspect=aspect,
                    youtube=YouTubeConfig(**raw.get("youtube", {})),
                    schedule=schedule,
                    prompts=prompts,
                )
            )
    else:
        # Legacy fallback: synthesize a single profile from top-level sections.
        profiles.append(
            ProfileConfig(
                name="default",
                youtube=cfg.youtube,
                schedule=cfg.scheduler,
                prompts=ProfilePromptsConfig(),
            )
        )

    seen: set[str] = set()
    for p in profiles:
        key = p.name.lower()
        if key in seen:
            raise ValueError(f"Duplicate profile name: {p.name}")
        seen.add(key)

    return profiles


def _build_config(data: dict) -> AppConfig:
    cfg = AppConfig()

    if "database" in data:
        cfg.database = DatabaseConfig(**data["database"])

    if "temp_dir" in data:
        cfg.temp_dir = data["temp_dir"]

    if "providers" in data:
        cfg.providers = ProvidersConfig(**data["providers"])

    if "gemini" in data:
        cfg.gemini = GeminiConfig(**data["gemini"])

    if "openai" in data:
        cfg.openai = OpenAIConfig(**data["openai"])

    if "deepseek" in data:
        cfg.deepseek = DeepSeekConfig(**data["deepseek"])

    if "comfy" in data:
        d = data["comfy"]
        cfg.comfy = ComfyConfig(
            base_url=d.get("base_url", "http://127.0.0.1:8188"),
            workflows=ComfyWorkflows(**d.get("workflows", {})),
            restart_cmd=d.get("restart_cmd", ""),
            auto_restart=d.get("auto_restart", False),
            restart_delay=d.get("restart_delay", 30),
            max_restart_attempts=d.get("max_restart_attempts", 5),
        )

    if "kittentts" in data:
        d = data["kittentts"]
        # Legacy configs may only have 'model' as a Piper voice name;
        # map that to 'voice' and keep the HF model name as default.
        if "model" in d and "voice" not in d:
            cfg.kittentts = KittenTTSConfig(voice=d["model"])
        else:
            cfg.kittentts = KittenTTSConfig(**d)

    if "video" in data:
        d = data["video"]
        cfg.video = VideoConfig(
            enableKenBurns=d.get("enableKenBurns", True),
            enableParticles=d.get("enableParticles", False),
            enableSubtitles=d.get("enableSubtitles", False),
            subtitleStyle=SubtitleStyle(**d.get("subtitleStyle", {})),
            whisper_model=d.get("whisper_model", "base"),
            scene_gap=d.get("scene_gap", 0.5),
        )

    if "server" in data:
        cfg.server = ServerConfig(**data["server"])

    if "youtube" in data:
        cfg.youtube = YouTubeConfig(**data["youtube"])

    if "scheduler" in data:
        cfg.scheduler = SchedulerConfig(**data["scheduler"])

    cfg.profiles = _parse_profiles(data, cfg)

    if not cfg.profiles:
        raise ValueError("At least one profile must be configured")

    return cfg


def get_profile(profile_name: str | None = None) -> ProfileConfig:
    cfg = get_config()
    target = profile_name or cfg.profiles[0].name
    for profile in cfg.profiles:
        if profile.name == target:
            return profile
    available = ", ".join(p.name for p in cfg.profiles)
    raise ValueError(f"Unknown profile '{target}'. Available profiles: {available}")


def get_profile_names() -> list[str]:
    return [p.name for p in get_config().profiles]


_config: Optional[AppConfig] = None


def load_config(path: str = "config.yml") -> AppConfig:
    global _config
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    _config = _build_config(data)
    return _config


def get_config() -> AppConfig:
    global _config
    if _config is None:
        _config = load_config()
    return _config
