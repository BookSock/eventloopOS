from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from test_harness.artifacts import ArtifactWriter
from test_harness.clock import FakeClock
from test_harness.fixtures import FixtureLoader
from test_harness.scenarios import (
    BROWSER_CONTEXT_STORE_ONLY,
    BROWSER_CONTEXT_ATTACH_TASK,
    MCP_POLL_ROUTE_DONE,
    MCP_SOURCE_POLL_ROUTE_DONE,
    SEEDED_QUEUE,
    TASK_SESSION_FOLLOWUP,
    VOICE_TASK_COMMAND,
    WORKSPACE_RESTORE_DISABLED,
    WORKSPACE_SNAPSHOT_CONTEXT,
    WORKSPACE_STATUS_SMOKE,
    BrowserContextAttachTaskScenario,
    BrowserContextStoreOnlyScenario,
    McpPollRouteDoneScenario,
    McpSourcePollRouteDoneScenario,
    SeededQueueScenario,
    TaskSessionFollowupScenario,
    VoiceTaskCommandScenario,
    WorkspaceRestoreDisabledScenario,
    WorkspaceSnapshotContextScenario,
    WorkspaceStatusSmokeScenario,
)


REPO_ROOT = Path(__file__).resolve().parents[3]


class SeededQueueRunnerTests(unittest.TestCase):
    def test_fixture_replay_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = self._run(Path(tmp))

        self.assertTrue(result.passed)
        self.assertEqual(result.scenario, SEEDED_QUEUE)
        self.assertEqual(result.mode, "fixture")
        self.assertEqual(result.details["queue_item_id"], "qit_seed_review")

    def test_artifact_generation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            artifact_dir = Path(tmp)
            self._run(artifact_dir)

            log = json.loads((artifact_dir / "scenario-log.json").read_text(encoding="utf-8"))
            observed = json.loads((artifact_dir / "observed.json").read_text(encoding="utf-8"))
            summary = json.loads((artifact_dir / "summary.json").read_text(encoding="utf-8"))

        self.assertTrue(log["passed"])
        self.assertEqual(log["started_at"], "2026-01-15T09:30:00Z")
        self.assertEqual(observed["final_queue"], {"item": None})
        self.assertEqual(summary["review_packet_id"], "pkt_seed_review")

    def test_runner_self_test_contract(self) -> None:
        loader = FixtureLoader(REPO_ROOT)
        packet = loader.scenario_fixture(SEEDED_QUEUE, "review_packet.json")
        queue_response = loader.scenario_fixture(SEEDED_QUEUE, "queue_response.json")
        golden = loader.golden_expectation(SEEDED_QUEUE)

        self.assertEqual(packet["id"], golden["expected_review_packet"]["id"])
        self.assertEqual(queue_response["item"]["review_packet_id"], packet["id"])
        self.assertEqual(golden["expected_audit_decision"]["action"], "done")

    def _run(self, artifact_dir: Path):
        runner = SeededQueueScenario(
            loader=FixtureLoader(REPO_ROOT),
            writer=ArtifactWriter(artifact_dir),
            clock=FakeClock(),
        )
        return runner.run()


class McpPollRouteDoneRunnerTests(unittest.TestCase):
    def test_fixture_replay_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = self._run(Path(tmp))

        self.assertTrue(result.passed)
        self.assertEqual(result.scenario, MCP_POLL_ROUTE_DONE)
        self.assertEqual(result.mode, "fixture")
        self.assertEqual(result.details["event_id"], "evt_fake_slack_mcp_slack_t123_c456_1715011200_000")
        self.assertEqual(result.details["queue_item_id"], "qit_evt_fake_slack_mcp_slack_t123_c456_1715011200_000")

    def test_artifact_generation_captures_full_flow(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            artifact_dir = Path(tmp)
            self._run(artifact_dir)

            log = json.loads((artifact_dir / "scenario-log.json").read_text(encoding="utf-8"))
            observed = json.loads((artifact_dir / "observed.json").read_text(encoding="utf-8"))
            summary = json.loads((artifact_dir / "summary.json").read_text(encoding="utf-8"))

        self.assertTrue(log["passed"])
        self.assertEqual(
            [step["name"] for step in log["steps"]],
            [
                "fake_mcp_poll",
                "route_event",
                "create_queue_item_review_packet",
                "mark_done",
                "assert_queue_empty",
            ],
        )
        self.assertEqual(observed["route_decision"]["action"], "ask_human_now")
        self.assertEqual(observed["next_queue_item"]["review_packet_id"], observed["review_packet"]["id"])
        self.assertEqual(observed["final_queue"], {"item": None})
        self.assertEqual(summary["audit_decision_id"], "decision_mcp_poll_done_001")

    def test_runner_self_test_contract(self) -> None:
        loader = FixtureLoader(REPO_ROOT)
        poll_result = loader.scenario_fixture(MCP_POLL_ROUTE_DONE, "mcp_poll_result.json")
        golden = loader.golden_expectation(MCP_POLL_ROUTE_DONE)

        self.assertEqual(poll_result["source_id"], "fake-slack-mcp")
        self.assertEqual(golden["expected_route_decision"]["action"], "ask_human_now")
        self.assertEqual(golden["expected_audit_decision"]["action"], "done")

    def _run(self, artifact_dir: Path):
        runner = McpPollRouteDoneScenario(
            loader=FixtureLoader(REPO_ROOT),
            writer=ArtifactWriter(artifact_dir),
            clock=FakeClock(),
        )
        return runner.run()


class McpSourcePollRouteDoneRunnerTests(unittest.TestCase):
    def test_fixture_replay_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = self._run(Path(tmp))

        self.assertTrue(result.passed)
        self.assertEqual(result.scenario, MCP_SOURCE_POLL_ROUTE_DONE)
        self.assertEqual(result.mode, "fixture")
        self.assertEqual(result.details["event_id"], "evt_slack_T123_C123_456_000")
        self.assertEqual(result.details["queue_item_id"], "qit_evt_slack_t123_c123_456_000")

    def test_runner_self_test_contract(self) -> None:
        loader = FixtureLoader(REPO_ROOT)
        poll_result = loader.scenario_fixture(MCP_SOURCE_POLL_ROUTE_DONE, "mcp_source_poll_result.json")
        golden = loader.golden_expectation(MCP_SOURCE_POLL_ROUTE_DONE)

        self.assertEqual(golden["source_id"], "slack_dm_source")
        self.assertEqual(poll_result["items"][0]["ts"], "456.000")
        self.assertEqual(golden["expected_route_decision"]["action"], "ask_human_now")

    def _run(self, artifact_dir: Path):
        runner = McpSourcePollRouteDoneScenario(
            loader=FixtureLoader(REPO_ROOT),
            writer=ArtifactWriter(artifact_dir),
            clock=FakeClock(),
        )
        return runner.run()


class BrowserContextStoreOnlyRunnerTests(unittest.TestCase):
    def test_fixture_replay_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = self._run(Path(tmp))

        self.assertTrue(result.passed)
        self.assertEqual(result.scenario, BROWSER_CONTEXT_STORE_ONLY)
        self.assertEqual(result.mode, "fixture")
        self.assertEqual(result.details["route_action"], "store_only")

    def test_artifact_generation_captures_no_interrupt_flow(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            artifact_dir = Path(tmp)
            self._run(artifact_dir)

            log = json.loads((artifact_dir / "scenario-log.json").read_text(encoding="utf-8"))
            observed = json.loads((artifact_dir / "observed.json").read_text(encoding="utf-8"))
            summary = json.loads((artifact_dir / "summary.json").read_text(encoding="utf-8"))

        self.assertTrue(log["passed"])
        self.assertEqual([step["name"] for step in log["steps"]], ["route_event", "assert_no_queue_item"])
        self.assertEqual(observed["route_decision"]["action"], "store_only")
        self.assertIsNone(observed["review_packet"])
        self.assertIsNone(observed["next_queue_item"])
        self.assertEqual(summary["route_action"], "store_only")

    def test_runner_self_test_contract(self) -> None:
        loader = FixtureLoader(REPO_ROOT)
        event = loader.scenario_fixture(BROWSER_CONTEXT_STORE_ONLY, "browser_context_event.json")
        golden = loader.golden_expectation(BROWSER_CONTEXT_STORE_ONLY)

        self.assertEqual(event["type"], "browser.context_captured")
        self.assertEqual(golden["expected_route_decision"]["action"], "store_only")
        self.assertIsNone(golden["expected_queue_item"])

    def _run(self, artifact_dir: Path):
        runner = BrowserContextStoreOnlyScenario(
            loader=FixtureLoader(REPO_ROOT),
            writer=ArtifactWriter(artifact_dir),
            clock=FakeClock(),
        )
        return runner.run()


class BrowserContextAttachTaskRunnerTests(unittest.TestCase):
    def test_fixture_replay_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = self._run(Path(tmp))

        self.assertTrue(result.passed)
        self.assertEqual(result.scenario, BROWSER_CONTEXT_ATTACH_TASK)
        self.assertEqual(result.mode, "fixture")
        self.assertEqual(result.details["route_action"], "attach_to_task")

    def test_runner_self_test_contract(self) -> None:
        loader = FixtureLoader(REPO_ROOT)
        event = loader.scenario_fixture(BROWSER_CONTEXT_ATTACH_TASK, "browser_context_event.json")
        golden = loader.golden_expectation(BROWSER_CONTEXT_ATTACH_TASK)

        self.assertEqual(event["task_hint"], "blog feedback")
        self.assertEqual(golden["expected_route_decision"]["action"], "attach_to_task")
        self.assertEqual(golden["expected_route_decision"]["target_task_id"], "task_blog_feedback")
        self.assertIsNone(golden["expected_queue_item"])

    def _run(self, artifact_dir: Path):
        runner = BrowserContextAttachTaskScenario(
            loader=FixtureLoader(REPO_ROOT),
            writer=ArtifactWriter(artifact_dir),
            clock=FakeClock(),
        )
        return runner.run()


class TaskSessionFollowupRunnerTests(unittest.TestCase):
    def test_fixture_replay_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = self._run(Path(tmp))

        self.assertTrue(result.passed)
        self.assertEqual(result.scenario, TASK_SESSION_FOLLOWUP)
        self.assertEqual(result.mode, "fixture")
        self.assertEqual(result.details["task_message_id"], "task_msg_idem_task_session_followup_001")

    def test_runner_self_test_contract(self) -> None:
        loader = FixtureLoader(REPO_ROOT)
        golden = loader.golden_expectation(TASK_SESSION_FOLLOWUP)

        self.assertEqual(golden["request"]["task_session_id"], "task_session_blog")
        self.assertEqual(golden["expected_message"]["status"], "sent")

    def _run(self, artifact_dir: Path):
        runner = TaskSessionFollowupScenario(
            loader=FixtureLoader(REPO_ROOT),
            writer=ArtifactWriter(artifact_dir),
            clock=FakeClock(),
        )
        return runner.run()


class WorkspaceStatusSmokeRunnerTests(unittest.TestCase):
    def test_fixture_replay_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = self._run(Path(tmp))

        self.assertTrue(result.passed)
        self.assertEqual(result.scenario, WORKSPACE_STATUS_SMOKE)
        self.assertEqual(result.mode, "fixture")
        self.assertEqual(result.details["backend"], "aerospace")
        self.assertFalse(result.details["execute_supported"])

    def test_artifact_generation_captures_status_shape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            artifact_dir = Path(tmp)
            self._run(artifact_dir)

            log = json.loads((artifact_dir / "scenario-log.json").read_text(encoding="utf-8"))
            observed = json.loads((artifact_dir / "observed.json").read_text(encoding="utf-8"))
            summary = json.loads((artifact_dir / "summary.json").read_text(encoding="utf-8"))

        self.assertTrue(log["passed"])
        self.assertEqual([step["name"] for step in log["steps"]], ["workspace_status"])
        self.assertEqual(observed["status"]["backend"], "aerospace")
        self.assertFalse(observed["execute_supported"])
        self.assertEqual(summary["reason"], "server_unavailable")

    def _run(self, artifact_dir: Path):
        runner = WorkspaceStatusSmokeScenario(
            loader=FixtureLoader(REPO_ROOT),
            writer=ArtifactWriter(artifact_dir),
            clock=FakeClock(),
        )
        return runner.run()


class VoiceTaskCommandRunnerTests(unittest.TestCase):
    def test_fixture_replay_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = self._run(Path(tmp))

        self.assertTrue(result.passed)
        self.assertEqual(result.scenario, VOICE_TASK_COMMAND)
        self.assertEqual(result.mode, "fixture")
        self.assertEqual(result.details["task_session_id"], "task_session_blog")

    def test_artifact_generation_captures_voice_injection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            artifact_dir = Path(tmp)
            self._run(artifact_dir)

            log = json.loads((artifact_dir / "scenario-log.json").read_text(encoding="utf-8"))
            observed = json.loads((artifact_dir / "observed.json").read_text(encoding="utf-8"))
            summary = json.loads((artifact_dir / "summary.json").read_text(encoding="utf-8"))

        self.assertTrue(log["passed"])
        self.assertEqual([step["name"] for step in log["steps"]], ["normalize_voice_command", "inject_task_session"])
        self.assertEqual(observed["event"]["source"], "voice")
        self.assertEqual(observed["route_decision"]["action"], "inject_into_agent_thread")
        self.assertEqual(observed["task_message"]["task_session_id"], "task_session_blog")
        self.assertEqual(summary["task_message_id"], "task_msg_inject_idem_voice_task_command_harness")

    def _run(self, artifact_dir: Path):
        runner = VoiceTaskCommandScenario(
            loader=FixtureLoader(REPO_ROOT),
            writer=ArtifactWriter(artifact_dir),
            clock=FakeClock(),
        )
        return runner.run()


class WorkspaceSnapshotContextRunnerTests(unittest.TestCase):
    def test_fixture_replay_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = self._run(Path(tmp))

        self.assertTrue(result.passed)
        self.assertEqual(result.scenario, WORKSPACE_SNAPSHOT_CONTEXT)
        self.assertEqual(result.mode, "fixture")
        self.assertEqual(result.details["workspace"], "eventloop-blog")

    def test_artifact_generation_captures_snapshot_shape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            artifact_dir = Path(tmp)
            self._run(artifact_dir)

            log = json.loads((artifact_dir / "scenario-log.json").read_text(encoding="utf-8"))
            observed = json.loads((artifact_dir / "observed.json").read_text(encoding="utf-8"))
            summary = json.loads((artifact_dir / "summary.json").read_text(encoding="utf-8"))

        self.assertTrue(log["passed"])
        self.assertEqual([step["name"] for step in log["steps"]], ["build_event", "assert_workspace_snapshot_context"])
        context = observed["review_packet"]["context"][0]
        self.assertEqual(context["kind"], "workspace_snapshot")
        self.assertEqual(context["snapshot"]["backend"], "aerospace")
        self.assertEqual(context["snapshot"]["windows"][0]["workspace"], "eventloop-blog")
        self.assertEqual(summary["review_packet_id"], "pkt_evt_workspace_snapshot_context")

    def _run(self, artifact_dir: Path):
        runner = WorkspaceSnapshotContextScenario(
            loader=FixtureLoader(REPO_ROOT),
            writer=ArtifactWriter(artifact_dir),
            clock=FakeClock(),
        )
        return runner.run()


class WorkspaceRestoreDisabledRunnerTests(unittest.TestCase):
    def test_fixture_replay_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = self._run(Path(tmp))

        self.assertTrue(result.passed)
        self.assertEqual(result.scenario, WORKSPACE_RESTORE_DISABLED)
        self.assertEqual(result.mode, "fixture")
        self.assertEqual(result.details["error_code"], "workspace_execute_disabled")
        self.assertEqual(result.details["status"], 403)

    def _run(self, artifact_dir: Path):
        runner = WorkspaceRestoreDisabledScenario(
            loader=FixtureLoader(REPO_ROOT),
            writer=ArtifactWriter(artifact_dir),
            clock=FakeClock(),
        )
        return runner.run()


if __name__ == "__main__":
    unittest.main()
