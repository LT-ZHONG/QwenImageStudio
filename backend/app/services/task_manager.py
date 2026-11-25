"""Task queue + single worker. One ComfyUI instance => one prompt at a time."""
import asyncio
import logging
import secrets
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import GenerationTask, ImageAsset
from app.schemas import TERMINAL, GenerationCreate
from app.services.comfyui_client import ComfyUIClient, ComfyUIError, PromptResult
from app.services.hub import EventHub
from app.services.serializers import task_out
from app.services.storage import Storage
from app.services.workflow_manager import WorkflowManager

log = logging.getLogger(__name__)
SEED_MAX = 2**53 - 1  # keep JS-safe integers


def _now() -> datetime:
    return datetime.now(UTC)


class TaskManager:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        client: ComfyUIClient,
        workflows: WorkflowManager,
        storage: Storage,
        hub: EventHub,
        task_timeout: float = 3600.0,
    ):
        self.sf = session_factory
        self.client = client
        self.wm = workflows
        self.storage = storage
        self.hub = hub
        self.task_timeout = task_timeout
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self._worker: asyncio.Task | None = None
        self._current: tuple[str, str | None] | None = None  # (task_id, prompt_id)

    # ---- lifecycle -------------------------------------------------------
    async def start(self) -> None:
        async with self.sf() as s:
            rows = (
                await s.scalars(
                    select(GenerationTask)
                    .where(GenerationTask.status.in_(["queued", "submitting", "running", "cancelling"]))
                    .order_by(GenerationTask.created_at)
                )
            ).all()
            for t in rows:
                if t.status == "cancelling" and not t.prompt_id:
                    t.status, t.completed_at = "cancelled", _now()
                elif t.status == "submitting" and not t.prompt_id:
                    t.status = "queued"  # never reached ComfyUI; safe to resubmit
                    self.queue.put_nowait(t.id)
                elif t.prompt_id and t.status in ("running", "submitting", "cancelling"):
                    self.queue.put_nowait(t.id)  # resume waiting on existing prompt
                else:
                    self.queue.put_nowait(t.id)
            await s.commit()
        self._worker = asyncio.create_task(self._run(), name="task-worker")

    async def stop(self) -> None:
        if self._worker:
            self._worker.cancel()
            try:
                await self._worker
            except asyncio.CancelledError:
                pass

    # ---- public ----------------------------------------------------------
    async def create(self, s: AsyncSession, req: GenerationCreate, upload_id: str) -> GenerationTask:
        seed_mode = "fixed" if req.seed is not None else "random"
        seed = req.seed if req.seed is not None else secrets.randbelow(SEED_MAX + 1)
        task = GenerationTask(
            upload_id=upload_id,
            prompt=req.prompt.strip(),
            negative_prompt=req.negative_prompt,
            model=self.wm.model,
            generation_params={
                "seed": seed,
                "seed_mode": seed_mode,
                "steps": req.steps,
                "cfg": req.cfg,
                "denoise": req.denoise,
                "resolution": req.resolution,
            },
            status="queued",
        )
        s.add(task)
        await s.commit()
        await s.refresh(task)
        self.queue.put_nowait(task.id)
        return task

    async def cancel(self, task_id: str) -> GenerationTask | None:
        async with self.sf() as s:
            task = await s.get(GenerationTask, task_id)
            if task is None or task.status in TERMINAL:
                return task
            if task.status == "queued":
                task.status, task.completed_at = "cancelled", _now()
                await s.commit()
                self._publish(task)
                return task
            task.status = "cancelling"
            await s.commit()
            self._publish(task)
            prompt_id = task.prompt_id
        if prompt_id and self._current == (task_id, prompt_id):
            try:
                await self.client.cancel_prompt(prompt_id)
            except ComfyUIError as e:
                log.warning("cancel failed: %s", e)
        # if prompt_id isn't known yet, the worker checks for "cancelling" right after submitting
        async with self.sf() as s:
            return await s.get(GenerationTask, task_id)

    # ---- internals -------------------------------------------------------
    def _publish(self, task: GenerationTask) -> None:
        payload = task_out(task).model_dump(mode="json")
        self.hub.publish(task.id, {"type": "task", "task": payload})

    async def _update(self, task_id: str, **fields) -> GenerationTask:
        async with self.sf() as s:
            task = await s.get(GenerationTask, task_id)
            for k, v in fields.items():
                setattr(task, k, v)
            await s.commit()
            await s.refresh(task)
            self._publish(task)
            return task

    async def _run(self) -> None:
        while True:
            task_id = await self.queue.get()
            try:
                await self._process(task_id)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                log.exception("task %s crashed", task_id)
                await self._update(task_id, status="failed", error_message=str(e), completed_at=_now())
            finally:
                self._current = None
                self.queue.task_done()

    async def _process(self, task_id: str) -> None:
        async with self.sf() as s:
            task = await s.get(GenerationTask, task_id)
            if task is None or task.status in TERMINAL:
                return
            prompt_id = task.prompt_id
            params = dict(task.generation_params)
            prompt, negative = task.prompt, task.negative_prompt
            comfy_image = task.upload.comfy_filename

        if prompt_id is None:
            await self._update(task_id, status="submitting", started_at=_now(), progress=0.0)
            try:
                workflow = self.wm.build(
                    comfy_image=comfy_image,
                    prompt=prompt,
                    negative_prompt=negative,
                    seed=params["seed"],
                    steps=params["steps"],
                    cfg=params["cfg"],
                    denoise=params["denoise"],
                    resolution=params["resolution"],
                )
                prompt_id = await self.client.queue_prompt(workflow)
            except ComfyUIError as e:
                await self._update(task_id, status="failed", error_message=str(e), completed_at=_now())
                return
            self._current = (task_id, prompt_id)
            task = await self._update(task_id, prompt_id=prompt_id)
            if task.status == "cancelling":  # cancel arrived while submitting
                await self.client.cancel_prompt(prompt_id)
            else:
                await self._update(task_id, status="running")
        else:
            self._current = (task_id, prompt_id)  # resumed after restart

        async def on_progress(value: int, maximum: int, _node: str | None) -> None:
            frac = round(min(value / max(maximum, 1), 0.99), 3)
            async with self.sf() as s:
                t = await s.get(GenerationTask, task_id)
                if t and t.status in ("running", "cancelling") and frac > t.progress:
                    t.progress = frac
                    await s.commit()
                    self._publish(t)

        try:
            result = await self.client.wait_for_prompt(prompt_id, on_progress, self.task_timeout)
        except ComfyUIError as e:
            result = PromptResult("error", error=str(e))
        await self._finish(task_id, prompt_id, result)

    async def _finish(self, task_id: str, prompt_id: str, result: PromptResult) -> None:
        async with self.sf() as s:
            current = await s.get(GenerationTask, task_id)
            was_cancelling = current.status == "cancelling"
        if result.status == "interrupted" or (was_cancelling and result.status in ("lost", "error")):
            await self._update(task_id, status="cancelled", completed_at=_now())
            return
        if result.status != "success":
            await self._update(
                task_id, status="failed", error_message=result.error or result.status, completed_at=_now()
            )
            return
        try:
            await self._save_outputs(task_id, result)
        except Exception as e:  # noqa: BLE001
            log.exception("saving outputs failed")
            await self._update(task_id, status="failed", error_message=f"保存图片失败: {e}", completed_at=_now())

    async def _save_outputs(self, task_id: str, result: PromptResult) -> None:
        outputs = result.outputs
        images = list((outputs.get(self.wm.save_node_id) or {}).get("images", []))
        if not images:  # fall back to any non-temp image output
            for out in outputs.values():
                images += [i for i in out.get("images", []) if i.get("type") != "temp"]
        if not images:
            await self._update(
                task_id, status="failed", error_message="ComfyUI 未返回输出图片", completed_at=_now()
            )
            return
        saved: list[dict] = []
        try:
            for img in images:
                data = await self.client.view(img["filename"], img.get("subfolder", ""), img.get("type", "output"))
                saved.append(await asyncio.to_thread(self.storage.save_generated, data))
        except Exception:
            for m in saved:
                self.storage.delete(m["storage_key"], m["thumbnail_key"])
            raise
        async with self.sf() as s:
            task = await s.get(GenerationTask, task_id)
            for m in saved:
                s.add(ImageAsset(task_id=task_id, **m))
            task.status, task.progress, task.completed_at = "succeeded", 1.0, _now()
            await s.commit()
        async with self.sf() as s:
            self._publish(await s.get(GenerationTask, task_id))
