from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.config import get_settings
from app.services.workflow_manager import WorkflowManager

_wm = WorkflowManager(get_settings().mapping_file)
_L = {k: _wm.limits(k) for k in ("resolution", "seed", "steps", "cfg", "denoise")}

TaskStatus = Literal["queued", "submitting", "running", "cancelling", "succeeded", "failed", "cancelled"]
TERMINAL = {"succeeded", "failed", "cancelled"}


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- system ----------------------------------------------------------------
class HealthOut(BaseModel):
    status: str
    version: str


class ComfyStatusOut(BaseModel):
    online: bool
    url: str
    comfyui_version: str | None = None
    detail: str | None = None


class ModelsOut(BaseModel):
    model: str
    files: dict[str, str]
    params: dict[str, dict]


# ---- uploads ---------------------------------------------------------------
class UploadOut(ORM):
    id: str
    original_name: str
    mime_type: str
    size_bytes: int
    width: int
    height: int
    created_at: datetime
    url: str = ""
    thumbnail_url: str = ""


# ---- generations -----------------------------------------------------------
class GenerationParams(BaseModel):
    seed: int = Field(ge=0, le=int(_L["seed"].max))
    steps: int = Field(ge=int(_L["steps"].min), le=int(_L["steps"].max))
    cfg: float = Field(ge=_L["cfg"].min, le=_L["cfg"].max)
    denoise: float = Field(ge=_L["denoise"].min, le=_L["denoise"].max)
    resolution: int = Field(ge=int(_L["resolution"].min), le=int(_L["resolution"].max))
    seed_mode: Literal["random", "fixed"] = "fixed"

    @model_validator(mode="after")
    def _step_multiple(self):
        step = int(_L["resolution"].step or 1)
        if self.resolution % step:
            raise ValueError(f"resolution 必须是 {step} 的倍数")
        return self


class GenerationCreate(BaseModel):
    upload_id: str
    prompt: str = Field(min_length=1, max_length=4000)
    negative_prompt: str = Field(default="", max_length=4000)
    seed: int | None = Field(default=None, ge=0, le=int(_L["seed"].max), description="为空则由后端随机生成")
    steps: int = Field(default=_L["steps"].default, ge=int(_L["steps"].min), le=int(_L["steps"].max))
    cfg: float = Field(default=_L["cfg"].default, ge=_L["cfg"].min, le=_L["cfg"].max)
    denoise: float = Field(default=_L["denoise"].default, ge=_L["denoise"].min, le=_L["denoise"].max)
    resolution: int = Field(
        default=_L["resolution"].default, ge=int(_L["resolution"].min), le=int(_L["resolution"].max)
    )

    @model_validator(mode="after")
    def _check(self):
        if not self.prompt.strip():
            raise ValueError("提示词不能为空")
        step = int(_L["resolution"].step or 1)
        if self.resolution % step:
            raise ValueError(f"resolution 必须是 {step} 的倍数")
        return self


class RetryRequest(BaseModel):
    randomize_seed: bool = False


class ImageAssetOut(ORM):
    id: str
    task_id: str
    width: int
    height: int
    size_bytes: int
    format: str
    created_at: datetime
    url: str = ""
    thumbnail_url: str = ""


class GenerationOut(ORM):
    id: str
    prompt_id: str | None
    upload_id: str
    prompt: str
    negative_prompt: str
    model: str
    generation_params: GenerationParams
    status: TaskStatus
    progress: float
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    upload: UploadOut
    images: list[ImageAssetOut]


class Page[T](BaseModel):
    items: list[T]
    total: int
    limit: int
    offset: int


# ---- settings --------------------------------------------------------------
class DefaultParams(BaseModel):
    steps: int = Field(default=_L["steps"].default, ge=int(_L["steps"].min), le=int(_L["steps"].max))
    cfg: float = Field(default=_L["cfg"].default, ge=_L["cfg"].min, le=_L["cfg"].max)
    denoise: float = Field(default=_L["denoise"].default, ge=_L["denoise"].min, le=_L["denoise"].max)
    resolution: int = Field(
        default=_L["resolution"].default, ge=int(_L["resolution"].min), le=int(_L["resolution"].max)
    )
    seed_mode: Literal["random", "fixed"] = "random"

    @model_validator(mode="after")
    def _step_multiple(self):
        step = int(_L["resolution"].step or 1)
        if self.resolution % step:
            raise ValueError(f"resolution 必须是 {step} 的倍数")
        return self


class SettingsOut(BaseModel):
    theme: Literal["light", "dark", "system"] = "system"
    default_params: DefaultParams = Field(default_factory=DefaultParams)


class SettingsUpdate(BaseModel):
    theme: Literal["light", "dark", "system"] | None = None
    default_params: DefaultParams | None = None
