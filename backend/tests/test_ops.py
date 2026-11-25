"""Phase 4: backup/restore, static frontend, restart recovery, housekeeping, ComfyUI client."""
import asyncio
import os
import sqlite3
import tarfile
import time
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from app import main as app_main
from app.backup import BackupError, create_backup, prune, restore_backup
from app.config import Settings
from app.models import GenerationTask, UploadAsset
from app.services.comfyui_client import ComfyUIClient, ComfyUIError, ComfyUIUnavailable
from app.services.maintenance import cleanup_orphan_files, cleanup_orphan_uploads
from tests.test_api import FakeComfy, finish, png_bytes, upload


def make_settings(tmp_path, **kw) -> Settings:
    return Settings(storage_dir=tmp_path / "storage", backup_dir=tmp_path / "backups", **kw)


@pytest.fixture
def fake_comfy(monkeypatch):
    monkeypatch.setattr(app_main, "ComfyUIClient", FakeComfy)


async def run_app(settings):
    app = app_main.create_app(settings)
    return app, app.router.lifespan_context(app)


def client_for(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t/api/v1")


# ---------------------------------------------------------------- backup / restore
async def test_backup_restore_roundtrip(tmp_path, fake_comfy):
    settings = make_settings(tmp_path)
    app, lifespan = await run_app(settings)
    async with lifespan:
        async with client_for(app) as c:
            up = await upload(c)
            tid = (await c.post("/generations", json={"upload_id": up["id"], "prompt": "keep me"})).json()["id"]
            task = await finish(c, tid)
            before = (await c.get(task["images"][0]["url"].removeprefix("/api/v1"))).content
        archive = create_backup(settings)  # service still running: online backup
    assert archive.exists() and not list(archive.parent.glob("*.part"))

    # disaster: wipe data
    import shutil

    shutil.rmtree(settings.storage_dir)
    app2, lifespan2 = await run_app(settings)
    async with lifespan2:  # fresh empty DB
        async with client_for(app2) as c:
            assert (await c.get("/generations")).json()["total"] == 0
    with pytest.raises(BackupError, match="--force"):
        restore_backup(settings, archive)  # refuses to overwrite silently
    restore_backup(settings, archive, force=True)

    app3, lifespan3 = await run_app(settings)
    async with lifespan3:
        async with client_for(app3) as c:
            page = (await c.get("/generations")).json()
            assert page["total"] == 1 and page["items"][0]["prompt"] == "keep me"
            img = page["items"][0]["images"][0]
            assert (await c.get(img["url"].removeprefix("/api/v1"))).content == before


def test_restore_rejects_path_traversal(tmp_path):
    evil = tmp_path / "evil.tar"
    with tarfile.open(evil, "w") as tar:
        data = tmp_path / "x"
        data.write_text("x")
        tar.add(data, arcname="../escape.txt")
    with pytest.raises(BackupError, match="不安全"):
        restore_backup(make_settings(tmp_path / "t"), evil, force=True)


def test_backup_prunes_old_archives(tmp_path):
    for n in range(5):
        (tmp_path / f"qis-backup-2026010{n}-000000.tar").write_text("x")
    (tmp_path / "unrelated.tar").write_text("x")
    removed = prune(tmp_path, keep=2)
    assert len(removed) == 3
    assert sorted(p.name for p in tmp_path.glob("qis-backup-*.tar")) == [
        "qis-backup-20260103-000000.tar",
        "qis-backup-20260104-000000.tar",
    ]
    assert (tmp_path / "unrelated.tar").exists()


def test_backup_requires_existing_db(tmp_path):
    with pytest.raises(BackupError):
        create_backup(make_settings(tmp_path))


# ---------------------------------------------------------------- frontend hosting
async def test_serves_spa_and_keeps_api_404s_as_json(tmp_path, fake_comfy):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>app</html>")
    (dist / "assets" / "a-123.js").write_text("console.log(1)")
    (dist / "favicon.svg").write_text("<svg/>")
    secret = tmp_path / "secret.txt"
    secret.write_text("secret")
    app, lifespan = await run_app(make_settings(tmp_path, frontend_dist=dist))
    async with lifespan:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            assert (await c.get("/")).text == "<html>app</html>"
            r = await c.get("/history")  # client-side route
            assert r.text == "<html>app</html>" and r.headers["cache-control"] == "no-cache"
            assert (await c.get("/favicon.svg")).text == "<svg/>"
            js = await c.get("/assets/a-123.js")
            assert "immutable" in js.headers["cache-control"]
            assert (await c.get("/api/v1/health")).json()["status"] == "ok"
            r = await c.get("/api/v1/does-not-exist")
            assert r.status_code == 404 and r.headers["content-type"].startswith("application/json")
            assert "secret" not in (await c.get("/..%2fsecret.txt")).text  # no traversal


async def test_api_works_without_frontend_build(tmp_path, fake_comfy):
    app, lifespan = await run_app(make_settings(tmp_path, frontend_dist=tmp_path / "missing"))
    async with lifespan:
        async with client_for(app) as c:
            assert (await c.get("/health")).status_code == 200


# ---------------------------------------------------------------- restart recovery
async def test_tasks_resume_after_restart_without_resubmitting(tmp_path, fake_comfy):
    settings = make_settings(tmp_path)
    app, lifespan = await run_app(settings)
    async with lifespan:
        app.state.comfy.block.clear()  # ComfyUI keeps "running" forever
        async with client_for(app) as c:
            up = await upload(c)
            running = (await c.post("/generations", json={"upload_id": up["id"], "prompt": "running"})).json()["id"]
            queued = (await c.post("/generations", json={"upload_id": up["id"], "prompt": "queued"})).json()["id"]
            for _ in range(60):
                t = (await c.get(f"/generations/{running}")).json()
                if t["status"] == "running" and t["prompt_id"]:
                    break
                await asyncio.sleep(0.05)
            assert t["status"] == "running"
            assert (await c.get(f"/generations/{queued}")).json()["status"] == "queued"
    # --- service stopped here (crash / reboot); DB still says running/queued ---

    app2, lifespan2 = await run_app(settings)
    async with lifespan2:
        async with client_for(app2) as c:
            r = await finish(c, running)
            q = await finish(c, queued)
            assert r["images"] and q["images"]
        # the running task was NOT submitted again; only the queued one was
        submitted = app2.state.comfy.submitted
        assert len(submitted) == 1 and submitted[0]["486"]["inputs"]["prompt"] == "queued"


async def test_unsent_cancelling_task_is_cancelled_on_restart(tmp_path, fake_comfy):
    settings = make_settings(tmp_path)
    app, lifespan = await run_app(settings)
    async with lifespan:
        async with client_for(app) as c:
            up = await upload(c)
            tid = (await c.post("/generations", json={"upload_id": up["id"], "prompt": "x"})).json()["id"]
            await finish(c, tid)
    with sqlite3.connect(settings.db_file) as db:
        db.execute("UPDATE generation_tasks SET status='cancelling', prompt_id=NULL, completed_at=NULL")
    app2, lifespan2 = await run_app(settings)
    async with lifespan2:
        async with client_for(app2) as c:
            assert (await c.get(f"/generations/{tid}")).json()["status"] == "cancelled"


# ---------------------------------------------------------------- housekeeping
async def test_orphan_cleanup(tmp_path, fake_comfy):
    settings = make_settings(tmp_path)
    app, lifespan = await run_app(settings)
    async with lifespan:
        st, sf = app.state.storage, app.state.session_factory
        async with client_for(app) as c:
            used = await upload(c)
            await c.post("/generations", json={"upload_id": used["id"], "prompt": "x"})
            unused = await upload(c)  # uploaded but never used
            await finish(c, (await c.get("/generations")).json()["items"][0]["id"])
        # fresh unused upload is kept; once old enough it is removed
        assert await cleanup_orphan_uploads(sf, st, older_than_hours=24) == 0
        async with sf() as s:
            u = await s.get(UploadAsset, unused["id"])
            u.created_at = datetime.now(UTC) - timedelta(hours=48)
            await s.commit()
        assert await cleanup_orphan_uploads(sf, st, older_than_hours=24) == 1
        async with sf() as s:
            assert await s.get(UploadAsset, unused["id"]) is None
            assert await s.get(UploadAsset, used["id"]) is not None

        # stray file with no DB row: protected while young, removed when old
        stray = st.root / "images" / "2020" / "01" / "stray.png"
        stray.parent.mkdir(parents=True)
        stray.write_bytes(png_bytes())
        assert await cleanup_orphan_files(sf, st) == 0 and stray.exists()
        old = time.time() - 7200
        os.utime(stray, (old, old))
        assert await cleanup_orphan_files(sf, st) == 1 and not stray.exists()
        async with sf() as s:  # referenced files were left alone
            assert (await s.scalars(select(GenerationTask))).first() is not None
        assert list(st.root.glob("images/*/*/*.png"))


# ---------------------------------------------------------------- ComfyUI client
def make_client(handler, **kw) -> ComfyUIClient:
    c = ComfyUIClient("http://127.0.0.1:1", poll_interval=0.01, **kw)  # port 1: websocket always refused
    c._http = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://127.0.0.1:1")
    return c


async def test_queue_prompt_and_node_errors():
    def ok(req):
        return httpx.Response(200, json={"prompt_id": "p1", "node_errors": {}})

    assert await make_client(ok).queue_prompt({"1": {}}) == "p1"

    def bad(req):
        return httpx.Response(200, json={"prompt_id": "p2", "node_errors": {"486": {"errors": ["boom"]}}})

    with pytest.raises(ComfyUIError, match="校验失败"):
        await make_client(bad).queue_prompt({})


async def test_upload_returns_subfolder_path():
    c = make_client(lambda req: httpx.Response(200, json={"name": "a.png", "subfolder": "sub", "type": "input"}))
    assert await c.upload_image("a.png", b"x", "image/png") == "sub/a.png"


async def test_cancel_only_touches_the_requested_prompt():
    calls = []

    def handler(req):
        calls.append((req.method, req.url.path, req.content))
        if req.url.path == "/queue" and req.method == "GET":
            return httpx.Response(200, json={"queue_running": [[0, "other-running"]], "queue_pending": [[1, "mine"]]})
        return httpx.Response(200, json={})

    c = make_client(handler)
    assert await c.cancel_prompt("mine") == "deleted"  # pending -> removed from queue, nothing interrupted
    assert not any(p == "/interrupt" for _, p, _ in calls)
    calls.clear()
    assert await c.cancel_prompt("unknown") == "not_found"  # must NOT interrupt the other running prompt
    assert [p for _, p, _ in calls] == ["/queue"]
    calls.clear()
    assert await c.cancel_prompt("other-running") == "interrupted"
    assert any(p == "/interrupt" and b'"other-running"' in body for _, p, body in calls)


async def test_wait_survives_short_comfyui_outage():
    n = {"history": 0}

    def handler(req):
        if req.url.path.startswith("/history"):
            n["history"] += 1
            if n["history"] <= 3:
                raise httpx.ConnectError("down")
            return httpx.Response(200, json={"p": {"status": {"status_str": "success", "completed": True, "messages": []}, "outputs": {"461": {}}}})
        return httpx.Response(200, json={"queue_running": [], "queue_pending": []})

    res = await make_client(handler, outage_grace=5).wait_for_prompt("p", timeout=10)
    assert res.status == "success" and n["history"] == 4


async def test_wait_gives_up_after_long_outage():
    def handler(req):
        raise httpx.ConnectError("down")

    with pytest.raises(ComfyUIUnavailable, match="持续不可用"):
        await make_client(handler, outage_grace=0.1).wait_for_prompt("p", timeout=10)


async def test_wait_detects_prompt_lost_from_queue():
    def handler(req):
        if req.url.path.startswith("/history"):
            return httpx.Response(200, json={})
        return httpx.Response(200, json={"queue_running": [], "queue_pending": []})

    res = await make_client(handler).wait_for_prompt("gone", timeout=10)
    assert res.status == "lost"


async def test_comfyui_client_id_survives_restart(tmp_path, monkeypatch):
    seen = []

    class Recorder(FakeComfy):
        def __init__(self, *a, client_id=None, **kw):
            super().__init__()
            seen.append(client_id)

    monkeypatch.setattr(app_main, "ComfyUIClient", Recorder)
    settings = make_settings(tmp_path)
    for _ in range(2):
        app, lifespan = await run_app(settings)
        async with lifespan:
            pass
    assert seen[0] and seen[0] == seen[1]
