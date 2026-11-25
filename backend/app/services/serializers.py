from app.models import GenerationTask, ImageAsset, UploadAsset
from app.schemas import GenerationOut, ImageAssetOut, UploadOut

API = "/api/v1"


def upload_out(u: UploadAsset) -> UploadOut:
    out = UploadOut.model_validate(u)
    out.url = f"{API}/uploads/{u.id}/file"
    return out


def image_out(a: ImageAsset) -> ImageAssetOut:
    out = ImageAssetOut.model_validate(a)
    out.url = f"{API}/assets/{a.id}/file"
    out.thumbnail_url = f"{API}/assets/{a.id}/thumbnail"
    return out


def task_out(t: GenerationTask) -> GenerationOut:
    data = {c: getattr(t, c) for c in GenerationOut.model_fields if c not in ("upload", "images")}
    data["upload"] = upload_out(t.upload)
    data["images"] = [image_out(i) for i in t.images]
    return GenerationOut(**data)
