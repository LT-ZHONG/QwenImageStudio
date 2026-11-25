import asyncio
import io

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.models import GenerationTask, UploadAsset
from app.schemas import UploadOut
from app.services.comfyui_client import ComfyUIError
from app.services.serializers import upload_out
from app.services.storage import EXT_MIME, FORMAT_EXT

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("", response_model=UploadOut, status_code=201)
async def create_upload(request: Request, file: UploadFile, s: AsyncSession = Depends(get_session)) -> UploadOut:
    cfg, storage, comfy = request.app.state.settings, request.app.state.storage, request.app.state.comfy
    data = await file.read(cfg.max_upload_bytes + 1)
    if len(data) > cfg.max_upload_bytes:
        raise HTTPException(413, f"文件超过 {cfg.max_upload_bytes // 1024 // 1024}MB 限制")
    if not data:
        raise HTTPException(400, "文件为空")
    try:
        with Image.open(io.BytesIO(data)) as img:
            img.verify()
        with Image.open(io.BytesIO(data)) as img:  # verify() invalidates the handle
            fmt, (w, h) = img.format, img.size
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(400, "无法识别的图片文件") from None
    if fmt not in FORMAT_EXT:
        raise HTTPException(415, "仅支持 PNG、JPG、JPEG、WEBP")
    if max(w, h) > cfg.max_image_edge or min(w, h) < cfg.min_image_edge:
        raise HTTPException(
            422, f"图片尺寸需在 {cfg.min_image_edge}–{cfg.max_image_edge}px 之间，当前 {w}x{h}"
        )
    ext = FORMAT_EXT[fmt]
    mime = EXT_MIME[ext]
    key = storage.save_input(data, ext)  # server-generated name; client filename is never trusted
    upload = UploadAsset(
        storage_key=key,
        original_name=(file.filename or "image")[:255],
        mime_type=mime,
        size_bytes=len(data),
        width=w,
        height=h,
        comfy_filename="",
    )
    try:
        comfy_name = await comfy.upload_image(f"qis_{key.split('/')[-1]}", data, mime)
    except ComfyUIError as e:
        storage.delete(key)
        raise HTTPException(503, f"上传到 ComfyUI 失败: {e}") from e
    upload.comfy_filename = comfy_name
    s.add(upload)
    await s.commit()
    return upload_out(upload)


async def _get(s: AsyncSession, upload_id: str) -> UploadAsset:
    u = await s.get(UploadAsset, upload_id)
    if u is None:
        raise HTTPException(404, "上传记录不存在")
    return u


@router.get("/{upload_id}", response_model=UploadOut)
async def get_upload(upload_id: str, s: AsyncSession = Depends(get_session)) -> UploadOut:
    return upload_out(await _get(s, upload_id))


@router.get("/{upload_id}/file")
async def upload_file(upload_id: str, request: Request, s: AsyncSession = Depends(get_session)) -> FileResponse:
    u = await _get(s, upload_id)
    return FileResponse(request.app.state.storage.resolve(u.storage_key), media_type=u.mime_type)


@router.get("/{upload_id}/thumbnail")
async def upload_thumbnail(upload_id: str, request: Request, s: AsyncSession = Depends(get_session)) -> FileResponse:
    u = await _get(s, upload_id)
    storage = request.app.state.storage
    key = await asyncio.to_thread(storage.input_thumbnail, u.storage_key)
    return FileResponse(storage.resolve(key), media_type="image/webp")


@router.delete("/{upload_id}", status_code=204)
async def delete_upload(upload_id: str, request: Request, s: AsyncSession = Depends(get_session)) -> None:
    u = await _get(s, upload_id)
    used = await s.scalar(select(func.count()).select_from(GenerationTask).where(GenerationTask.upload_id == u.id))
    if used:
        raise HTTPException(409, "该图片已被生成任务引用，无法删除")
    storage = request.app.state.storage
    storage.delete(u.storage_key, storage.input_thumbnail_key(u.storage_key))
    await s.delete(u)
    await s.commit()
