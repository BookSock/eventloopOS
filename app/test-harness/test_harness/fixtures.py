from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class FixtureLoader:
    repo_root: Path

    def scenario_fixture(self, scenario: str, name: str) -> dict[str, Any]:
        return self._read_json(self.repo_root / "tests" / "fixtures" / "scenarios" / scenario / name)

    def golden_expectation(self, scenario: str) -> dict[str, Any]:
        return self._read_json(self.repo_root / "tests" / "golden" / "scenarios" / scenario / "expectation.json")

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any]:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise FixtureError(f"missing fixture: {path}") from exc
        except json.JSONDecodeError as exc:
            raise FixtureError(f"invalid JSON fixture: {path}: {exc}") from exc


class FixtureError(RuntimeError):
    pass
