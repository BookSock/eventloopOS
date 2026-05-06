from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FakeClock:
    fixed_now: str = "2026-01-15T09:30:00Z"

    def now_iso(self) -> str:
        return self.fixed_now
