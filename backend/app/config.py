from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="QIS_", env_file=".env", extra="ignore")

    comfyui_url: str = "http://127.0.0.1:8188"
    storage_dir: Path = BACKEND_DIR / "storage"
    database_path: Path | None = None  # default: <storage_dir>/qwen_studio.db
    mapping_file: Path = BACKEND_DIR / "workflow_mapping.json"
    max_upload_bytes: int = 20 * 1024 * 1024
    max_image_edge: int = 4096
    min_image_edge: int = 64
    thumbnail_edge: int = 512
    http_timeout: float = 30.0
    task_timeout: float = 3600.0
    poll_interval: float = 2.0
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    @property
    def db_file(self) -> Path:
        return self.database_path or (self.storage_dir / "qwen_studio.db")

    @property
    def db_url(self) -> str:
        return f"sqlite+aiosqlite:///{self.db_file}"

    @property
    def sync_db_url(self) -> str:
        return f"sqlite:///{self.db_file}"


def get_settings() -> Settings:
    return Settings()
