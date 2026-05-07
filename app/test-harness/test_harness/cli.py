from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .artifacts import ArtifactWriter
from .clock import FakeClock
from .fixtures import FixtureLoader
from .scenarios import (
    BROWSER_CONTEXT_ATTACH_TASK,
    AMBIENT_CONTEXT_ROUTE,
    BROWSER_CONTEXT_RANKED_SEARCH,
    BROWSER_CONTEXT_STORE_ONLY,
    GENERIC_MCP_SOURCE_POLL_ROUTE_DONE,
    MCP_POLL_ALL_ROUTE_DONE,
    MCP_POLL_ROUTE_DONE,
    MCP_SOURCE_POLL_ROUTE_DONE,
    QUEUE_BIND_THEN_RECOMMENDED_ACTION,
    QUEUE_RECOMMENDED_ACTION,
    SCENARIOS,
    SEEDED_QUEUE,
    TASK_SESSION_BINDING,
    TASK_SESSION_FOLLOWUP,
    VOICE_TASK_COMMAND,
    WORKSPACE_RESTORE_DISABLED,
    WORKSPACE_SNAPSHOT_CONTEXT,
    WORKSPACE_STATUS_SMOKE,
    BrowserContextAttachTaskScenario,
    AmbientContextRouteScenario,
    BrowserContextRankedSearchScenario,
    BrowserContextStoreOnlyScenario,
    GenericMcpSourcePollRouteDoneScenario,
    McpPollAllRouteDoneScenario,
    McpPollRouteDoneScenario,
    McpSourcePollRouteDoneScenario,
    QueueBindThenRecommendedActionScenario,
    QueueRecommendedActionScenario,
    SeededQueueScenario,
    TaskSessionBindingScenario,
    TaskSessionFollowupScenario,
    VoiceTaskCommandScenario,
    WorkspaceRestoreDisabledScenario,
    WorkspaceSnapshotContextScenario,
    WorkspaceStatusSmokeScenario,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run deterministic eventloopOS scenarios.")
    parser.add_argument("scenario", nargs="?", default=SEEDED_QUEUE, choices=SCENARIOS)
    parser.add_argument("--repo-root", default=_default_repo_root(), help="Repository root path.")
    parser.add_argument("--artifact-dir", default=None, help="Directory for scenario artifacts.")
    parser.add_argument("--orchestrator-url", default=None, help="Use real orchestrator instead of fixture mode.")
    parser.add_argument("--clock", default="2026-01-15T09:30:00Z", help="Fixed ISO timestamp for deterministic runs.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    artifact_dir = Path(args.artifact_dir).resolve() if args.artifact_dir else repo_root / "artifacts" / "test-harness" / args.scenario

    runner_class = {
        SEEDED_QUEUE: SeededQueueScenario,
        MCP_POLL_ROUTE_DONE: McpPollRouteDoneScenario,
        MCP_SOURCE_POLL_ROUTE_DONE: McpSourcePollRouteDoneScenario,
        GENERIC_MCP_SOURCE_POLL_ROUTE_DONE: GenericMcpSourcePollRouteDoneScenario,
        MCP_POLL_ALL_ROUTE_DONE: McpPollAllRouteDoneScenario,
        BROWSER_CONTEXT_STORE_ONLY: BrowserContextStoreOnlyScenario,
        BROWSER_CONTEXT_RANKED_SEARCH: BrowserContextRankedSearchScenario,
        BROWSER_CONTEXT_ATTACH_TASK: BrowserContextAttachTaskScenario,
        AMBIENT_CONTEXT_ROUTE: AmbientContextRouteScenario,
        TASK_SESSION_FOLLOWUP: TaskSessionFollowupScenario,
        QUEUE_RECOMMENDED_ACTION: QueueRecommendedActionScenario,
        TASK_SESSION_BINDING: TaskSessionBindingScenario,
        QUEUE_BIND_THEN_RECOMMENDED_ACTION: QueueBindThenRecommendedActionScenario,
        VOICE_TASK_COMMAND: VoiceTaskCommandScenario,
        WORKSPACE_SNAPSHOT_CONTEXT: WorkspaceSnapshotContextScenario,
        WORKSPACE_STATUS_SMOKE: WorkspaceStatusSmokeScenario,
        WORKSPACE_RESTORE_DISABLED: WorkspaceRestoreDisabledScenario,
    }[args.scenario]
    runner = runner_class(
        loader=FixtureLoader(repo_root),
        writer=ArtifactWriter(artifact_dir),
        clock=FakeClock(args.clock),
        orchestrator_url=args.orchestrator_url,
    )

    try:
        result = runner.run()
    except Exception as exc:
        print(f"scenario {args.scenario} failed: {exc}", file=sys.stderr)
        print(f"artifacts: {artifact_dir}", file=sys.stderr)
        return 1

    print(f"scenario {result.scenario} passed")
    print(f"mode: {result.mode}")
    print(f"artifacts: {result.artifact_dir}")
    return 0


def _default_repo_root() -> str:
    return str(Path(__file__).resolve().parents[3])


if __name__ == "__main__":
    raise SystemExit(main())
