"""Housekeeping: remove uploads that no task ever used, and files that have no DB row."""
import asyncio
import logging
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import GenerationTask, ImageAsset, UploadAsset
from app.services.storage import Storage

log = logging.getLogger(__name__)
FILE_GRACE_SECONDS = 3600  # never touch files younger than this (an upload may be mid-flight)


async def cleanup_orphan_uploads(
    sf: async_sessionmaker[AsyncSession], storage: Storage, older_than_hours: float
) -> int:
    cutoff = datetime.now(UTC) - timedelta(hours=older_than_hours)
    async with sf() as s:
        used = select(GenerationTask.upload_id)
        rows = (
            await s.scalars(select(UploadAsset).where(UploadAsset.id.not_in(used), UploadAsset.created_at < cutoff))
        ).all()
        keys = []
        for u in rows:
            keys += [u.storage_key, storage.input_thumbnail_key(u.storage_key)]
            await s.delete(u)
        await s.commit()
    storage.delete(*keys)
    return len(rows)


async def cleanup_orphan_files(sf: async_sessionmaker[AsyncSession], storage: Storage) -> int:
    """Delete stored files that no DB row points to (e.g. crash between file write and commit)."""
    async with sf() as s:
        known = set(await s.scalars(select(UploadAsset.storage_key)))
        known |= {k for k in await s.scalars(select(ImageAsset.storage_key))}
        known |= {k for k in await s.scalars(select(ImageAsset.thumbnail_key))}
        known |= {storage.input_thumbnail_key(k) for k in await s.scalars(select(UploadAsset.storage_key))}
    now = time.time()
    removed = 0
    for sub in ("input", "images", "thumbnails"):
        for path in Path(storage.root / sub).rglob("*"):
            if not path.is_file() or now - path.stat().st_mtime < FILE_GRACE_SECONDS:
                continue
            if path.relative_to(storage.root).as_posix() not in known:
                path.unlink(missing_ok=True)
                removed += 1
    return removed


async def run_maintenance(sf, storage, older_than_hours: float) -> None:
    try:
        uploads = await cleanup_orphan_uploads(sf, storage, older_than_hours)
        files = await cleanup_orphan_files(sf, storage)
        if uploads or files:
            log.info("maintenance: removed %d orphan uploads, %d orphan files", uploads, files)
    except Exception:  # noqa: BLE001
        log.exception("maintenance failed")


async def maintenance_loop(
    sf, storage, older_than_hours: float, interval_hours: float, initial_delay: float = 60.0
) -> None:
    await asyncio.sleep(initial_delay)  # don't compete with startup recovery
    while True:
        await run_maintenance(sf, storage, older_than_hours)
        await asyncio.sleep(interval_hours * 3600)
