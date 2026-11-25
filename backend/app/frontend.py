"""Serve the built React app (frontend/dist) from FastAPI, with SPA fallback."""
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


class ImmutableStatic(StaticFiles):
    """Vite emits content-hashed filenames under /assets, so they can be cached forever."""

    def file_response(self, *args, **kwargs):  # noqa: ANN002, ANN003
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp


def mount_frontend(app: FastAPI, dist: Path) -> bool:
    dist = dist.resolve()
    index = dist / "index.html"
    if not index.is_file():
        return False
    if (dist / "assets").is_dir():
        app.mount("/assets", ImmutableStatic(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not Found")
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(dist):
            return FileResponse(candidate)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})  # client-side routes

    return True
