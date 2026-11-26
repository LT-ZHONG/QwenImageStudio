import asyncio
import logging
import uuid
from contextlib import asynccontextmanager

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import assets, generations, settings as settings_api, system, uploads
from app.config import BACKEND_DIR, Settings, get_settings
from app.db import make_engine, make_session_factory
from app.frontend import mount_frontend
from app.logging_setup import setup_logging
from app.services.maintenance import maintenance_loop
from app.services.comfyui_client import ComfyUIClient
from app.services.hub import EventHub
from app.services.storage import Storage
from app.services.task_manager import TaskManager
from app.services.workflow_manager import WorkflowManager

log = logging.getLogger(__name__)


def _migrate(settings: Settings) -> None:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", settings.sync_db_url)
    command.upgrade(cfg, "head")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    setup_logging(settings.logs_path, settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        storage = Storage(settings.storage_dir, settings.thumbnail_edge)
        await asyncio.to_thread(_migrate, settings)
        engine = make_engine(settings.db_url)
        sf = make_session_factory(engine)
        id_file = settings.storage_dir / "comfyui_client_id"
        if not id_file.exists():
            id_file.write_text(uuid.uuid4().hex)
        comfy = ComfyUIClient(
            settings.comfyui_url, settings.http_timeout, settings.poll_interval, client_id=id_file.read_text().strip()
        )
        hub = EventHub()
        workflows = WorkflowManager(settings.mapping_file)
        tasks = TaskManager(sf, comfy, workflows, storage, hub, settings.task_timeout, settings.max_active_tasks)
        for name, value in dict(
            settings=settings, storage=storage, session_factory=sf, comfy=comfy,
            hub=hub, workflows=workflows, tasks=tasks,
        ).items():
            setattr(app.state, name, value)
        await tasks.start()
        maintenance = asyncio.create_task(
            maintenance_loop(sf, storage, settings.orphan_upload_hours, settings.maintenance_interval_hours),
            name="maintenance",
        )
        log.info("Qwen Image Studio started (ComfyUI: %s, storage: %s)", settings.comfyui_url, settings.storage_dir)
        yield
        maintenance.cancel()
        await asyncio.gather(maintenance, return_exceptions=True)  # let it unwind before the engine closes
        await tasks.stop()
        await comfy.aclose()
        await engine.dispose()

    app = FastAPI(title="Qwen Image Studio", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"]
    )
    for r in (system.router, uploads.router, generations.router, assets.router, settings_api.router, generations.ws_router):
        app.include_router(r, prefix="/api/v1")
    if mount_frontend(app, settings.frontend_dist):
        log.info("serving frontend from %s", settings.frontend_dist)
    else:
        log.warning("frontend build not found at %s (API only; run `npm run build` in frontend/)", settings.frontend_dist)
    return app


app = create_app()
