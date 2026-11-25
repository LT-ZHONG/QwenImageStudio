import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

_MARK = "qis-managed"
FMT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


def setup_logging(log_dir: Path, level: str = "INFO") -> None:
    """Console (journald) + rotating file logs. Safe to call repeatedly."""
    root = logging.getLogger()
    root.setLevel(level.upper())
    for h in list(root.handlers):
        if getattr(h, "name", None) == _MARK:
            root.removeHandler(h)
            h.close()
    log_dir.mkdir(parents=True, exist_ok=True)
    handlers: list[logging.Handler] = [
        logging.StreamHandler(sys.stderr),
        RotatingFileHandler(log_dir / "app.log", maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"),
    ]
    for h in handlers:
        h.set_name(_MARK)
        h.setFormatter(logging.Formatter(FMT))
        root.addHandler(h)
    # uvicorn keeps its own handlers for the console; mirror them into the file as well
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.propagate = True
        lg.handlers.clear()
    logging.getLogger("httpx").setLevel(logging.WARNING)
