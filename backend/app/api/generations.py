import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.models import GenerationTask, UploadAsset
from app.schemas import TERMINAL, GenerationCreate, GenerationOut, Page, RetryRequest, TaskStatus
from app.services.serializers import task_out

router = APIRouter(prefix="/generations", tags=["generations"])
ws_router = APIRouter(tags=["realtime"])


async def _get(s: AsyncSession, task_id: str) -> GenerationTask:
    t = await s.get(GenerationTask, task_id)
    if t is None:
        raise HTTPException(404, "任务不存在")
    return t


@router.post("", response_model=GenerationOut, status_code=202)
async def create_generation(
    body: GenerationCreate, request: Request, s: AsyncSession = Depends(get_session)
) -> GenerationOut:
    if await s.get(UploadAsset, body.upload_id) is None:
        raise HTTPException(404, "upload_id 不存在")
    task = await request.app.state.tasks.create(s, body, body.upload_id)
    return task_out(task)


@router.get("", response_model=Page[GenerationOut])
async def list_generations(
    status: TaskStatus | None = None,
    q: str | None = Query(None, description="按提示词搜索"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    s: AsyncSession = Depends(get_session),
) -> Page[GenerationOut]:
    cond = []
    if status:
        cond.append(GenerationTask.status == status)
    if q:
        cond.append(GenerationTask.prompt.contains(q, autoescape=True))
    total = await s.scalar(select(func.count()).select_from(GenerationTask).where(*cond))
    rows = (
        await s.scalars(
            select(GenerationTask).where(*cond).order_by(GenerationTask.created_at.desc()).limit(limit).offset(offset)
        )
    ).unique()
    return Page(items=[task_out(t) for t in rows], total=total or 0, limit=limit, offset=offset)


@router.get("/{task_id}", response_model=GenerationOut)
async def get_generation(task_id: str, s: AsyncSession = Depends(get_session)) -> GenerationOut:
    return task_out(await _get(s, task_id))


@router.post("/{task_id}/cancel", response_model=GenerationOut)
async def cancel_generation(task_id: str, request: Request, s: AsyncSession = Depends(get_session)) -> GenerationOut:
    await _get(s, task_id)
    task = await request.app.state.tasks.cancel(task_id)
    return task_out(task)


@router.post("/{task_id}/retry", response_model=GenerationOut, status_code=202)
async def retry_generation(
    task_id: str, request: Request, body: RetryRequest | None = None, s: AsyncSession = Depends(get_session)
) -> GenerationOut:
    old = await _get(s, task_id)
    if old.status not in TERMINAL:
        raise HTTPException(409, "任务仍在进行中")
    p = old.generation_params
    randomize = (body.randomize_seed if body else False) or p.get("seed_mode") == "random"
    req = GenerationCreate(
        upload_id=old.upload_id,
        prompt=old.prompt,
        negative_prompt=old.negative_prompt,
        seed=None if randomize else p["seed"],
        steps=p["steps"],
        cfg=p["cfg"],
        denoise=p["denoise"],
        resolution=p["resolution"],
    )
    return task_out(await request.app.state.tasks.create(s, req, old.upload_id))


@ws_router.websocket("/ws/generations/{task_id}")
async def ws_generation(ws: WebSocket, task_id: str) -> None:
    app = ws.app
    await ws.accept()
    q = app.state.hub.subscribe(task_id)  # subscribe first so no update is missed
    try:
        async with app.state.session_factory() as s:
            task = await s.get(GenerationTask, task_id)
            if task is None:
                await ws.send_json({"type": "error", "detail": "任务不存在"})
                await ws.close(code=4404)
                return
            snapshot = task_out(task).model_dump(mode="json")
        await ws.send_json({"type": "task", "task": snapshot})
        if snapshot["status"] in TERMINAL:
            await ws.close()
            return
        while True:
            try:
                event = await asyncio.wait_for(q.get(), 30)
            except TimeoutError:
                await ws.send_json({"type": "ping"})
                continue
            await ws.send_json(event)
            if event["task"]["status"] in TERMINAL:
                await ws.close()
                return
    except WebSocketDisconnect:
        pass
    finally:
        app.state.hub.unsubscribe(task_id, q)
