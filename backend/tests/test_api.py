"""Offline API tests: the real app with a fake ComfyUI client."""
import asyncio
import io

import httpx
import pytest
from PIL import Image

from app import main as app_main
from app.config import Settings
from app.services.comfyui_client import PromptResult


def png_bytes(size=(128, 96), color=(10, 120, 200)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


class FakeComfy:
    def __init__(self, *a, **kw):
        self.base_url = "http://fake"
        self.submitted: list[dict] = []
        self.block = asyncio.Event()
        self.block.set()

    async def aclose(self): ...
    async def system_stats(self): return {"system": {"comfyui_version": "fake"}}
    async def upload_image(self, filename, data, mime): return f"comfy_{filename}"

    async def queue_prompt(self, workflow):
        self.submitted.append(workflow)
        return f"prompt-{len(self.submitted)}"

    async def wait_for_prompt(self, prompt_id, on_progress=None, timeout=0):
        if on_progress:
            await on_progress(5, 10, "483")
        await self.block.wait()
        if self.cancelled:
            return PromptResult("interrupted")
        return PromptResult("success", outputs={"461": {"images": [{"filename": "o.png", "subfolder": "", "type": "output"}]}})

    cancelled = False

    async def view(self, filename, subfolder="", type_="output"): return png_bytes((256, 192))

    async def cancel_prompt(self, prompt_id):
        self.cancelled = True
        self.block.set()
        return "interrupted"


@pytest.fixture
async def ctx(tmp_path, monkeypatch):
    monkeypatch.setattr(app_main, "ComfyUIClient", FakeComfy)
    app = app_main.create_app(Settings(storage_dir=tmp_path / "storage"))
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t/api/v1") as c:
            yield c, app


async def upload(c) -> dict:
    r = await c.post("/uploads", files={"file": ("a.png", png_bytes(), "image/png")})
    assert r.status_code == 201, r.text
    return r.json()


async def finish(c, task_id, want="succeeded") -> dict:
    for _ in range(100):
        t = (await c.get(f"/generations/{task_id}")).json()
        if t["status"] == want:
            return t
        await asyncio.sleep(0.05)
    raise AssertionError(f"task stuck in {t['status']}")


async def test_full_flow_and_workflow_injection(ctx):
    c, app = ctx
    up = await upload(c)
    assert up["width"] == 128
    assert (await c.get(up["thumbnail_url"].removeprefix("/api/v1"))).headers["content-type"] == "image/webp"
    r = await c.post("/generations", json={"upload_id": up["id"], "prompt": "hello", "seed": 42, "steps": 10})
    assert r.status_code == 202
    task = await finish(c, r.json()["id"])
    assert task["generation_params"]["seed"] == 42 and len(task["images"]) == 1
    wf = app.state.comfy.submitted[0]
    assert wf["486"]["inputs"]["prompt"] == "hello" and wf["483"]["inputs"]["steps"] == 10
    assert wf["470"]["inputs"]["image"].startswith("comfy_qis_")  # server-generated name
    img = task["images"][0]
    assert (await c.get(img["url"].removeprefix("/api/v1"))).status_code == 200
    assert (await c.get(img["thumbnail_url"].removeprefix("/api/v1"))).headers["content-type"] == "image/webp"


async def test_upload_validation(ctx):
    c, _ = ctx
    assert (await c.post("/uploads", files={"file": ("a.png", b"not an image", "image/png")})).status_code == 400
    tiny = io.BytesIO()
    Image.new("RGB", (16, 16)).save(tiny, "PNG")
    assert (await c.post("/uploads", files={"file": ("a.png", tiny.getvalue(), "image/png")})).status_code == 422
    gif = io.BytesIO()
    Image.new("RGB", (128, 128)).save(gif, "GIF")
    assert (await c.post("/uploads", files={"file": ("a.gif", gif.getvalue(), "image/gif")})).status_code == 415


async def test_search_filter_and_delete(ctx):
    c, app = ctx
    up = await upload(c)
    ids = []
    for prompt in ("remove the cat", "make it night"):
        r = await c.post("/generations", json={"upload_id": up["id"], "prompt": prompt})
        ids.append(r.json()["id"])
        await finish(c, ids[-1])
    page = (await c.get("/generations", params={"q": "cat"})).json()
    assert page["total"] == 1 and page["items"][0]["id"] == ids[0]
    assert (await c.get("/generations", params={"status": "failed"})).json()["total"] == 0
    assert (await c.get("/generations")).json()["total"] == 2

    storage = app.state.storage
    img_path = next(storage.root.glob("images/*/*/*.png"))
    assert img_path.exists()
    assert (await c.delete(f"/generations/{ids[0]}")).status_code == 204
    assert (await c.get(f"/generations/{ids[0]}")).status_code == 404
    assert (await c.get(f"/uploads/{up['id']}")).status_code == 200  # still used by the other task
    assert (await c.delete(f"/generations/{ids[1]}")).status_code == 204
    assert (await c.get(f"/uploads/{up['id']}")).status_code == 404  # orphan input removed
    assert not list(storage.root.glob("images/*/*/*")) and not list(storage.root.glob("input/*"))
    assert not list(storage.root.glob("thumbnails/*/*/*"))


async def test_cannot_delete_running_task_but_can_cancel(ctx):
    c, app = ctx
    app.state.comfy.block.clear()
    up = await upload(c)
    tid = (await c.post("/generations", json={"upload_id": up["id"], "prompt": "x"})).json()["id"]
    await asyncio.sleep(0.3)
    assert (await c.delete(f"/generations/{tid}")).status_code == 409
    await c.post(f"/generations/{tid}/cancel")
    assert (await finish(c, tid, "cancelled"))["status"] == "cancelled"
    assert (await c.delete(f"/generations/{tid}")).status_code == 204


async def test_settings_roundtrip_and_validation(ctx):
    c, _ = ctx
    assert (await c.get("/settings")).json()["theme"] == "system"
    r = await c.put("/settings", json={"theme": "dark", "default_params": {"steps": 30, "resolution": 1280}})
    assert r.status_code == 200
    got = (await c.get("/settings")).json()
    assert got["theme"] == "dark" and got["default_params"]["steps"] == 30
    assert (await c.put("/settings", json={"theme": "light"})).json()["default_params"]["steps"] == 30  # partial update
    assert (await c.put("/settings", json={"default_params": {"steps": 999}})).status_code == 422


async def test_queue_limit_returns_429_and_frees_up(tmp_path, monkeypatch):
    monkeypatch.setattr(app_main, "ComfyUIClient", FakeComfy)
    app = app_main.create_app(Settings(storage_dir=tmp_path / "storage", max_active_tasks=2))
    async with app.router.lifespan_context(app):
        app.state.comfy.block.clear()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t/api/v1") as c:
            up = await upload(c)
            body = {"upload_id": up["id"], "prompt": "x"}
            ids = [(await c.post("/generations", json=body)).json()["id"] for _ in range(2)]
            r = await c.post("/generations", json=body)
            assert r.status_code == 429 and r.headers["retry-after"] == "30" and "上限" in r.json()["detail"]
            await asyncio.sleep(0.2)
            await c.post(f"/generations/{ids[0]}/cancel")
            await finish(c, ids[0], "cancelled")
            app.state.comfy.block.clear()  # the fake's cancel releases every waiter; hold new ones again
            app.state.comfy.cancelled = False
            await asyncio.sleep(0.3)
            assert (await c.post("/generations", json=body)).status_code == 202  # slot freed
            while (await c.post("/generations", json=body)).status_code == 202:
                pass  # fill every remaining slot
            assert (await c.post(f"/generations/{ids[0]}/retry")).status_code == 429  # retry is limited too
            n = (await c.get("/generations")).json()["total"]
            assert (await c.post("/generations", json=body)).status_code == 429
            assert (await c.get("/generations")).json()["total"] == n  # rejected request left no row


async def test_queue_status_counts(ctx):
    c, app = ctx
    assert (await c.get("/generations/queue")).json() == {"waiting": 0, "running": 0, "limit": 5}
    app.state.comfy.block.clear()
    up = await upload(c)
    for _ in range(3):
        await c.post("/generations", json={"upload_id": up["id"], "prompt": "x"})
    await asyncio.sleep(0.3)
    assert (await c.get("/generations/queue")).json() == {"waiting": 2, "running": 1, "limit": 5}
