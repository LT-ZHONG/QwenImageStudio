from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.models import GenerationTask, ImageAsset
from app.schemas import ImageAssetOut, Page
from app.services.serializers import image_out
from app.services.storage import EXT_MIME

router = APIRouter(prefix="/assets", tags=["assets"])


async def _get(s: AsyncSession, asset_id: str) -> ImageAsset:
    a = await s.get(ImageAsset, asset_id)
    if a is None:
        raise HTTPException(404, "图片不存在")
    return a


@router.get("", response_model=Page[ImageAssetOut])
async def list_assets(
    q: str | None = Query(None, description="按提示词搜索"),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    s: AsyncSession = Depends(get_session),
) -> Page[ImageAssetOut]:
    stmt = select(ImageAsset)
    count = select(func.count()).select_from(ImageAsset)
    if q:
        cond = GenerationTask.prompt.contains(q, autoescape=True)
        stmt = stmt.join(GenerationTask).where(cond)
        count = count.join(GenerationTask).where(cond)
    total = await s.scalar(count)
    rows = await s.scalars(stmt.order_by(ImageAsset.created_at.desc()).limit(limit).offset(offset))
    return Page(items=[image_out(a) for a in rows], total=total or 0, limit=limit, offset=offset)


@router.get("/{asset_id}/file")
async def asset_file(asset_id: str, request: Request, s: AsyncSession = Depends(get_session)) -> FileResponse:
    a = await _get(s, asset_id)
    return FileResponse(
        request.app.state.storage.resolve(a.storage_key),
        media_type=EXT_MIME.get(a.format, "application/octet-stream"),
        filename=f"qwen-{a.id[:8]}.{a.format}",
        content_disposition_type="inline",
    )


@router.get("/{asset_id}/thumbnail")
async def asset_thumbnail(asset_id: str, request: Request, s: AsyncSession = Depends(get_session)) -> FileResponse:
    a = await _get(s, asset_id)
    return FileResponse(request.app.state.storage.resolve(a.thumbnail_key), media_type="image/webp")


@router.delete("/{asset_id}", status_code=204)
async def delete_asset(asset_id: str, request: Request, s: AsyncSession = Depends(get_session)) -> None:
    a = await _get(s, asset_id)
    request.app.state.storage.delete(a.storage_key, a.thumbnail_key)
    await s.delete(a)
    await s.commit()
