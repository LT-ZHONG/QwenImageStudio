import asyncio
from collections import defaultdict


class EventHub:
    """In-process pub/sub keyed by task_id."""

    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue]] = defaultdict(set)

    def subscribe(self, task_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._subs[task_id].add(q)
        return q

    def unsubscribe(self, task_id: str, q: asyncio.Queue) -> None:
        self._subs[task_id].discard(q)
        if not self._subs[task_id]:
            self._subs.pop(task_id, None)

    def publish(self, task_id: str, event: dict) -> None:
        for q in list(self._subs.get(task_id, ())):
            if q.full():  # drop the oldest; the latest snapshot is what matters
                q.get_nowait()
            q.put_nowait(event)
