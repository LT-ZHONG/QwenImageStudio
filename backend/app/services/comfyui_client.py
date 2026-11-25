"""The only module that talks to ComfyUI."""
import asyncio
import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import httpx
import websockets

log = logging.getLogger(__name__)


class ComfyUIError(Exception):
    pass


class ComfyUIUnavailable(ComfyUIError):
    pass


@dataclass
class PromptResult:
    status: str  # success | error | interrupted | lost | timeout
    outputs: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


ProgressCb = Callable[[int, int, str | None], Awaitable[None]]


class ComfyUIClient:
    def __init__(self, base_url: str, timeout: float = 30.0, poll_interval: float = 2.0):
        self.base_url = base_url.rstrip("/")
        self.ws_url = self.base_url.replace("http", "ws", 1) + "/ws"
        self.client_id = uuid.uuid4().hex
        self.poll_interval = poll_interval
        self._http = httpx.AsyncClient(base_url=self.base_url, timeout=timeout)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _request(self, method: str, path: str, **kw: Any) -> httpx.Response:
        try:
            resp = await self._http.request(method, path, **kw)
        except httpx.HTTPError as e:
            raise ComfyUIUnavailable(f"无法连接 ComfyUI: {e!r}") from e
        if resp.status_code >= 400:
            raise ComfyUIError(f"ComfyUI {method} {path} -> {resp.status_code}: {resp.text[:500]}")
        return resp

    # ---- health / info ---------------------------------------------------
    async def system_stats(self) -> dict:
        return (await self._request("GET", "/system_stats", timeout=5)).json()

    async def health(self) -> bool:
        try:
            await self.system_stats()
            return True
        except ComfyUIError:
            return False

    async def get_queue(self) -> dict:
        return (await self._request("GET", "/queue")).json()

    # ---- upload / submit -------------------------------------------------
    async def upload_image(self, filename: str, data: bytes, mime: str) -> str:
        resp = await self._request(
            "POST",
            "/upload/image",
            files={"image": (filename, data, mime)},
            data={"type": "input", "overwrite": "true"},
        )
        body = resp.json()
        name, sub = body["name"], body.get("subfolder") or ""
        return f"{sub}/{name}" if sub else name

    async def queue_prompt(self, workflow: dict) -> str:
        resp = await self._request(
            "POST", "/prompt", json={"prompt": workflow, "client_id": self.client_id}
        )
        body = resp.json()
        if body.get("node_errors"):
            raise ComfyUIError(f"Workflow 校验失败: {json.dumps(body['node_errors'], ensure_ascii=False)[:500]}")
        return body["prompt_id"]

    # ---- results ---------------------------------------------------------
    async def get_history(self, prompt_id: str) -> dict:
        return (await self._request("GET", f"/history/{prompt_id}")).json()

    async def view(self, filename: str, subfolder: str = "", type_: str = "output") -> bytes:
        resp = await self._request(
            "GET", "/view", params={"filename": filename, "subfolder": subfolder, "type": type_}, timeout=120
        )
        return resp.content

    # ---- cancel ----------------------------------------------------------
    async def cancel_prompt(self, prompt_id: str) -> str:
        """Cancel one specific prompt. Never interrupts a different running prompt."""
        queue = await self.get_queue()
        running = [item[1] for item in queue.get("queue_running", [])]
        pending = [item[1] for item in queue.get("queue_pending", [])]
        if prompt_id in pending:
            await self._request("POST", "/queue", json={"delete": [prompt_id]})
            return "deleted"
        if prompt_id in running:
            await self._request("POST", "/interrupt", json={"prompt_id": prompt_id})
            return "interrupted"
        return "not_found"

    # ---- waiting ---------------------------------------------------------
    @staticmethod
    def _parse_history(entry: dict) -> PromptResult | None:
        status = entry.get("status") or {}
        messages = status.get("messages") or []
        names = [m[0] for m in messages if isinstance(m, list) and m]
        if "execution_interrupted" in names:
            return PromptResult("interrupted")
        if status.get("status_str") == "error" or "execution_error" in names:
            err = next(
                (m[1].get("exception_message") for m in messages if m and m[0] == "execution_error"),
                None,
            )
            return PromptResult("error", error=(err or "ComfyUI 执行出错").strip())
        if status.get("completed") or status.get("status_str") == "success":
            return PromptResult("success", outputs=entry.get("outputs") or {})
        return None

    async def wait_for_prompt(
        self, prompt_id: str, on_progress: ProgressCb | None = None, timeout: float = 3600.0
    ) -> PromptResult:
        """Follow WebSocket events for progress, but always confirm via /history.

        The WebSocket is best-effort (auto-reconnect); /history polling is the source of truth.
        """
        deadline = time.monotonic() + timeout
        ws = None
        last_poll = 0.0
        misses = 0
        force_poll = True
        try:
            while time.monotonic() < deadline:
                if ws is None:
                    try:
                        ws = await websockets.connect(
                            f"{self.ws_url}?clientId={self.client_id}", max_size=None, open_timeout=5
                        )
                    except Exception as e:  # noqa: BLE001
                        log.debug("ws connect failed: %r", e)
                        ws = None
                if ws is not None:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), self.poll_interval)
                    except TimeoutError:
                        pass
                    except websockets.ConnectionClosed:
                        ws = None
                    else:
                        if isinstance(raw, str):
                            force_poll |= await self._handle_ws(raw, prompt_id, on_progress)
                else:
                    await asyncio.sleep(self.poll_interval)

                if not force_poll and time.monotonic() - last_poll < self.poll_interval:
                    continue
                force_poll = False
                last_poll = time.monotonic()

                entry = (await self.get_history(prompt_id)).get(prompt_id)
                if entry:
                    result = self._parse_history(entry)
                    if result:
                        return result
                    misses = 0
                    continue
                queue = await self.get_queue()
                known = [i[1] for i in queue.get("queue_running", []) + queue.get("queue_pending", [])]
                if prompt_id in known:
                    misses = 0
                else:
                    misses += 1
                    if misses >= 3:
                        return PromptResult("lost", error="任务已不在 ComfyUI 队列中")
            return PromptResult("timeout", error="等待 ComfyUI 超时")
        finally:
            if ws is not None:
                await ws.close()

    async def _handle_ws(self, raw: str, prompt_id: str, on_progress: ProgressCb | None) -> bool:
        """Returns True when the message suggests the prompt finished (poll history now)."""
        try:
            msg = json.loads(raw)
        except ValueError:
            return False
        data = msg.get("data") or {}
        if data.get("prompt_id") not in (None, prompt_id):
            return False
        kind = msg.get("type")
        if kind == "progress" and on_progress:
            await on_progress(int(data.get("value", 0)), int(data.get("max", 1)), data.get("node"))
        elif kind in ("execution_success", "execution_error", "execution_interrupted"):
            return True
        elif kind == "executing" and data.get("node") is None:
            return True
        return False
