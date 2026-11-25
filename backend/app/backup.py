"""Backup & restore of the SQLite database and stored images.

    python -m app.backup backup [--dest DIR] [--keep N]
    python -m app.backup restore ARCHIVE [--force]      # stop the service first!

The database is copied with SQLite's online backup API (consistent even while the service runs
in WAL mode); images/inputs are plain files. Everything goes into one .tar archive.
"""
import argparse
import shutil
import sqlite3
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

from app.config import Settings, get_settings

DB_NAME = "qwen_studio.db"
FILE_DIRS = ("input", "images", "thumbnails")
PREFIX = "qis-backup-"


class BackupError(Exception):
    pass


def _db_snapshot(src: Path, dst: Path) -> None:
    with sqlite3.connect(f"file:{src}?mode=ro", uri=True) as source, sqlite3.connect(dst) as target:
        source.backup(target)
    with sqlite3.connect(dst) as check:
        result = check.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        raise BackupError(f"备份数据库完整性检查失败: {result}")


def create_backup(settings: Settings, dest: Path | None = None, keep: int | None = None) -> Path:
    dest = Path(dest or settings.backup_dir)
    dest.mkdir(parents=True, exist_ok=True)
    if not settings.db_file.exists():
        raise BackupError(f"数据库不存在: {settings.db_file}")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    final = dest / f"{PREFIX}{stamp}.tar"
    tmp = final.with_suffix(".tar.part")
    with tempfile.TemporaryDirectory() as td:
        snap = Path(td) / DB_NAME
        _db_snapshot(settings.db_file, snap)
        with tarfile.open(tmp, "w") as tar:
            tar.add(snap, arcname=DB_NAME)
            for sub in FILE_DIRS:
                p = settings.storage_dir / sub
                if p.is_dir():
                    tar.add(p, arcname=f"storage/{sub}")
    tmp.rename(final)  # only a complete archive ever gets the final name
    prune(dest, keep if keep is not None else settings.backup_keep)
    return final


def prune(dest: Path, keep: int) -> list[Path]:
    archives = sorted(dest.glob(f"{PREFIX}*.tar"))
    old = archives[: max(len(archives) - keep, 0)] if keep > 0 else []
    for a in old:
        a.unlink()
    return old


def restore_backup(settings: Settings, archive: Path, force: bool = False) -> None:
    archive = Path(archive)
    if not archive.is_file():
        raise BackupError(f"找不到备份文件: {archive}")
    storage, db = settings.storage_dir, settings.db_file
    existing = [p for p in (db, *(storage / s for s in FILE_DIRS)) if p.exists() and (p.is_file() or any(p.iterdir()))]
    if existing and not force:
        raise BackupError("目标位置已有数据，使用 --force 覆盖（旧数据会被移到 *.before-restore）")
    with tempfile.TemporaryDirectory() as td:
        with tarfile.open(archive) as tar:
            for m in tar.getmembers():  # refuse anything that could escape the temp dir
                if m.name.startswith(("/", "..")) or ".." in Path(m.name).parts or not (m.isfile() or m.isdir()):
                    raise BackupError(f"备份包含不安全的条目: {m.name}")
            tar.extractall(td, filter="data")
        extracted_db = Path(td) / DB_NAME
        if not extracted_db.is_file():
            raise BackupError("备份中缺少数据库文件")
        with sqlite3.connect(extracted_db) as c:
            if c.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise BackupError("备份中的数据库已损坏")
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        storage.mkdir(parents=True, exist_ok=True)
        for target in (db, *(Path(str(db) + s) for s in ("-wal", "-shm")), *(storage / s for s in FILE_DIRS)):
            if target.exists():
                target.rename(target.with_name(target.name + f".before-restore-{stamp}"))
        shutil.copy2(extracted_db, db)
        for sub in FILE_DIRS:
            src = Path(td) / "storage" / sub
            if src.is_dir():
                shutil.copytree(src, storage / sub)
            else:
                (storage / sub).mkdir(parents=True, exist_ok=True)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.backup")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("backup")
    b.add_argument("--dest", type=Path)
    b.add_argument("--keep", type=int)
    r = sub.add_parser("restore")
    r.add_argument("archive", type=Path)
    r.add_argument("--force", action="store_true")
    args = ap.parse_args(argv)
    settings = get_settings()
    try:
        if args.cmd == "backup":
            path = create_backup(settings, args.dest, args.keep)
            print(f"备份完成: {path} ({path.stat().st_size / 1024 / 1024:.1f} MB)")
        else:
            restore_backup(settings, args.archive, args.force)
            print("恢复完成。请重新启动服务。")
    except BackupError as e:
        print(f"错误: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
