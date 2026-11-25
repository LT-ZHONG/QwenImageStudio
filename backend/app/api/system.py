from fastapi import APIRouter, Request

from app.schemas import ComfyStatusOut, HealthOut, ModelsOut
from app.services.comfyui_client import ComfyUIError

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthOut)
async def health() -> HealthOut:
    return HealthOut(status="ok", version="0.1.0")


@router.get("/comfyui/status", response_model=ComfyStatusOut)
async def comfy_status(request: Request) -> ComfyStatusOut:
    client = request.app.state.comfy
    try:
        stats = await client.system_stats()
        return ComfyStatusOut(
            online=True, url=client.base_url, comfyui_version=stats.get("system", {}).get("comfyui_version")
        )
    except ComfyUIError as e:
        return ComfyStatusOut(online=False, url=client.base_url, detail=str(e))


@router.get("/models", response_model=ModelsOut)
async def models(request: Request) -> ModelsOut:
    wm = request.app.state.workflows
    params = {
        name: {k: v for k, v in spec.items() if k in ("default", "min", "max", "step")}
        for name, spec in wm.mapping["params"].items()
        if name in ("resolution", "steps", "cfg", "denoise", "seed")
    }
    return ModelsOut(model=wm.model, files=wm.model_files(), params=params)
