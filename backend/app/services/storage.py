"""Local file storage addressed by relative storage keys."""
import io
import uuid
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image, ImageOps

FORMAT_EXT = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}
EXT_MIME = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}


class StorageError(Exception):
    pass


class Storage:
    def __init__(self, root: Path, thumbnail_edge: int = 512):
        self.root = Path(root).resolve()
        self.thumbnail_edge = thumbnail_edge
        for sub in ("input", "images", "thumbnails"):
            (self.root / sub).mkdir(parents=True, exist_ok=True)

    def resolve(self, key: str) -> Path:
        """Map a storage key to an absolute path, refusing anything outside root."""
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise StorageError("非法存储路径")
        return path

    def _write(self, key: str, data: bytes) -> None:
        path = self.resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def delete(self, *keys: str) -> None:
        for key in keys:
            try:
                self.resolve(key).unlink(missing_ok=True)
            except StorageError:
                pass

    def save_input(self, data: bytes, ext: str) -> str:
        key = f"input/{uuid.uuid4().hex}.{ext}"
        self._write(key, data)
        return key

    @staticmethod
    def input_thumbnail_key(input_key: str) -> str:
        return f"thumbnails/input/{Path(input_key).stem}.webp"

    def input_thumbnail(self, input_key: str) -> str:
        """Return the key of the (lazily created, cached) thumbnail for an input image."""
        key = self.input_thumbnail_key(input_key)
        if not self.resolve(key).exists():
            with Image.open(self.resolve(input_key)) as img:
                thumb = ImageOps.exif_transpose(img).convert("RGB")
                thumb.thumbnail((self.thumbnail_edge, self.thumbnail_edge))
                buf = io.BytesIO()
                thumb.save(buf, "WEBP", quality=82)
            self._write(key, buf.getvalue())
        return key

    def save_generated(self, data: bytes) -> dict:
        """Persist a generated image and its thumbnail; returns metadata."""
        with Image.open(io.BytesIO(data)) as img:
            fmt = img.format or "PNG"
            width, height = img.size
            ext = FORMAT_EXT.get(fmt, "png")
            thumb = ImageOps.exif_transpose(img).convert("RGB")
            thumb.thumbnail((self.thumbnail_edge, self.thumbnail_edge))
            buf = io.BytesIO()
            thumb.save(buf, "WEBP", quality=82)
        now = datetime.now(UTC)
        name = uuid.uuid4().hex
        key = f"images/{now:%Y}/{now:%m}/{name}.{ext}"
        thumb_key = f"thumbnails/{now:%Y}/{now:%m}/{name}.webp"
        self._write(key, data)
        self._write(thumb_key, buf.getvalue())
        return {
            "storage_key": key,
            "thumbnail_key": thumb_key,
            "width": width,
            "height": height,
            "size_bytes": len(data),
            "format": ext,
        }
