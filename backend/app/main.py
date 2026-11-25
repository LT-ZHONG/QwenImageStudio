import asyncio
import logging
from contextlib import asynccontextmanager

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import assets, generations, system, uploads
from app.config import BACKEND_DIR, Settings, get_settings
from app.db import make_engine, make_session_factory
from app.services.comfyui_client import ComfyUIClient
from app.services.hub import EventHub
from app.services.storage import Storage
from app.services.task_manager import TaskManager
from app.services.workflow_manager import WorkflowManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def _migrate(settings: Settings) -> None:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", settings.sync_db_url)
    command.upgrade(cfg, "head")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        storage = Storage(settings.storage_dir, settings.thumbnail_edge)
        await asyncio.to_thread(_migrate, settings)
        engine = make_engine(settings.db_url)
        sf = make_session_factory(engine)
        comfy = ComfyUIClient(settings.comfyui_url, settings.http_timeout, settings.poll_interval)
        hub = EventHub()
        workflows = WorkflowManager(settings.mapping_file)
        tasks = TaskManager(sf, comfy, workflows, storage, hub, settings.task_timeout)
        for name, value in dict(
            settings=settings, storage=storage, session_factory=sf, comfy=comfy,
            hub=hub, workflows=workflows, tasks=tasks,
        ).items():
            setattr(app.state, name, value)
        await tasks.start()
        yield
        await tasks.stop()
        await comfy.aclose()
        await engine.dispose()

    app = FastAPI(title="Qwen Image Studio", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"]
    )
    for r in (system.router, uploads.router, generations.router, assets.router, generations.ws_router):
        app.include_router(r, prefix="/api/v1")
    return app


app = create_app()
