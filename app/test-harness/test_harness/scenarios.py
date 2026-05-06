from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .artifacts import ArtifactWriter
from .clock import FakeClock
from .fixtures import FixtureLoader
from .orchestrator import OrchestratorClient


SEEDED_QUEUE = "seeded_queue"
MCP_POLL_ROUTE_DONE = "mcp_poll_route_done"
MCP_SOURCE_POLL_ROUTE_DONE = "mcp_source_poll_route_done"
BROWSER_CONTEXT_STORE_ONLY = "browser_context_store_only"
BROWSER_CONTEXT_ATTACH_TASK = "browser_context_attach_task"
TASK_SESSION_FOLLOWUP = "task_session_followup"
WORKSPACE_SNAPSHOT_CONTEXT = "workspace_snapshot_context"
WORKSPACE_STATUS_SMOKE = "workspace_status_smoke"
WORKSPACE_RESTORE_DISABLED = "workspace_restore_disabled"
SCENARIOS = (
    SEEDED_QUEUE,
    MCP_POLL_ROUTE_DONE,
    MCP_SOURCE_POLL_ROUTE_DONE,
    BROWSER_CONTEXT_STORE_ONLY,
    BROWSER_CONTEXT_ATTACH_TASK,
    TASK_SESSION_FOLLOWUP,
    WORKSPACE_SNAPSHOT_CONTEXT,
    WORKSPACE_STATUS_SMOKE,
    WORKSPACE_RESTORE_DISABLED,
)


@dataclass(frozen=True)
class ScenarioResult:
    scenario: str
    mode: str
    passed: bool
    artifact_dir: Path
    details: dict[str, Any]


class ScenarioFailure(AssertionError):
    pass


class SeededQueueScenario:
    def __init__(
        self,
        loader: FixtureLoader,
        writer: ArtifactWriter,
        clock: FakeClock,
        orchestrator_url: str | None = None,
    ) -> None:
        self.loader = loader
        self.writer = writer
        self.clock = clock
        self.orchestrator_url = orchestrator_url

    def run(self) -> ScenarioResult:
        mode = "orchestrator" if self.orchestrator_url else "fixture"
        log: dict[str, Any] = {
            "scenario": SEEDED_QUEUE,
            "mode": mode,
            "started_at": self.clock.now_iso(),
            "steps": [],
        }
        try:
            result = self._run_orchestrator(log) if self.orchestrator_url else self._run_fixture(log)
            log["passed"] = True
            log["finished_at"] = self.clock.now_iso()
            self.writer.write_json("scenario-log.json", log)
            self.writer.write_json("summary.json", result.details)
            return result
        except Exception as exc:
            log["passed"] = False
            log["error"] = str(exc)
            log["finished_at"] = self.clock.now_iso()
            self.writer.write_json("scenario-log.json", log)
            raise

    def _run_fixture(self, log: dict[str, Any]) -> ScenarioResult:
        packet = self.loader.scenario_fixture(SEEDED_QUEUE, "review_packet.json")
        queue_response = self.loader.scenario_fixture(SEEDED_QUEUE, "queue_response.json")
        golden = self.loader.golden_expectation(SEEDED_QUEUE)

        queue_item = self._extract_queue_item(queue_response)
        log["steps"].append({"name": "load_fixture_queue", "queue_item_id": queue_item.get("id")})

        decision = self._decision_for(queue_item)
        audit_record = {
            "id": golden["expected_audit_decision"]["id"],
            "queue_item_id": queue_item["id"],
            "review_packet_id": queue_item["review_packet_id"],
            "action": decision["action"],
            "actor_id": decision["actor_id"],
            "decided_at": self.clock.now_iso(),
        }
        empty_queue = {"item": None}
        log["steps"].append({"name": "mark_done", "audit_decision_id": audit_record["id"]})
        log["steps"].append({"name": "assert_queue_empty"})

        observed = {
            "next_queue_item": queue_item,
            "review_packet": packet,
            "audit_decision": audit_record,
            "final_queue": empty_queue,
        }
        self._assert_golden(observed, golden)
        self.writer.write_json("observed.json", observed)

        return ScenarioResult(
            scenario=SEEDED_QUEUE,
            mode="fixture",
            passed=True,
            artifact_dir=self.writer.root,
            details={
                "queue_item_id": queue_item["id"],
                "review_packet_id": queue_item["review_packet_id"],
                "audit_decision_id": audit_record["id"],
            },
        )

    def _run_orchestrator(self, log: dict[str, Any]) -> ScenarioResult:
        assert self.orchestrator_url is not None
        client = OrchestratorClient(self.orchestrator_url)
        golden = self.loader.golden_expectation(SEEDED_QUEUE)

        queue_item = client.next_queue_item()
        if queue_item is None:
            raise ScenarioFailure("expected one queue item, got empty queue")
        log["steps"].append({"name": "fetch_queue_next", "queue_item_id": queue_item.get("id")})

        decision = self._decision_for(queue_item)
        done_response = client.mark_done(queue_item["id"], decision)
        log["steps"].append({"name": "mark_done", "response": done_response})

        final_queue_item = client.next_queue_item()
        log["steps"].append({"name": "assert_queue_empty"})
        if final_queue_item is not None:
            raise ScenarioFailure(f"expected empty queue after done, got {final_queue_item!r}")

        self._assert_queue_shape(queue_item, golden)
        observed = {
            "next_queue_item": queue_item,
            "done_response": done_response,
            "final_queue": {"item": None},
        }
        self.writer.write_json("observed.json", observed)

        return ScenarioResult(
            scenario=SEEDED_QUEUE,
            mode="orchestrator",
            passed=True,
            artifact_dir=self.writer.root,
            details={
                "queue_item_id": queue_item["id"],
                "review_packet_id": queue_item["review_packet_id"],
            },
        )

    @staticmethod
    def _extract_queue_item(queue_response: dict[str, Any]) -> dict[str, Any]:
        item = queue_response.get("item")
        if not isinstance(item, dict):
            raise ScenarioFailure("queue_response.item must be object")
        return item

    @staticmethod
    def _decision_for(queue_item: dict[str, Any]) -> dict[str, Any]:
        return {
            "action": "done",
            "actor_id": "user_jason",
            "queue_item_id": queue_item["id"],
            "review_packet_id": queue_item["review_packet_id"],
        }

    def _assert_golden(self, observed: dict[str, Any], golden: dict[str, Any]) -> None:
        packet = observed["review_packet"]
        queue_item = observed["next_queue_item"]
        audit_decision = observed["audit_decision"]

        self._assert_queue_shape(queue_item, golden)
        self._assert_packet_shape(packet, golden)
        expected_audit = golden["expected_audit_decision"]
        for key, value in expected_audit.items():
            if audit_decision.get(key) != value:
                raise ScenarioFailure(f"audit decision {key} mismatch: expected {value!r}, got {audit_decision.get(key)!r}")
        if observed["final_queue"] != {"item": None}:
            raise ScenarioFailure(f"expected final empty queue, got {observed['final_queue']!r}")

    @staticmethod
    def _assert_queue_shape(queue_item: dict[str, Any], golden: dict[str, Any]) -> None:
        expected = golden["expected_queue_item"]
        for key, value in expected.items():
            if queue_item.get(key) != value:
                raise ScenarioFailure(f"queue item {key} mismatch: expected {value!r}, got {queue_item.get(key)!r}")
        for required in ("id", "review_packet_id", "priority_score", "priority_reasons"):
            if required not in queue_item:
                raise ScenarioFailure(f"queue item missing {required}")

    @staticmethod
    def _assert_packet_shape(packet: dict[str, Any], golden: dict[str, Any]) -> None:
        expected = golden["expected_review_packet"]
        for key, value in expected.items():
            if packet.get(key) != value:
                raise ScenarioFailure(f"review packet {key} mismatch: expected {value!r}, got {packet.get(key)!r}")
        if not packet.get("source_links"):
            raise ScenarioFailure("review packet missing source_links")
        if not packet.get("evidence"):
            raise ScenarioFailure("review packet missing evidence")


class McpPollRouteDoneScenario:
    def __init__(
        self,
        loader: FixtureLoader,
        writer: ArtifactWriter,
        clock: FakeClock,
        orchestrator_url: str | None = None,
    ) -> None:
        self.loader = loader
        self.writer = writer
        self.clock = clock
        self.orchestrator_url = orchestrator_url

    def run(self) -> ScenarioResult:
        mode = "orchestrator" if self.orchestrator_url else "fixture"
        log: dict[str, Any] = {
            "scenario": MCP_POLL_ROUTE_DONE,
            "mode": mode,
            "started_at": self.clock.now_iso(),
            "steps": [],
        }
        try:
            result = self._run_orchestrator(log) if self.orchestrator_url else self._run_fixture(log)
            log["passed"] = True
            log["finished_at"] = self.clock.now_iso()
            self.writer.write_json("scenario-log.json", log)
            self.writer.write_json("summary.json", result.details)
            return result
        except Exception as exc:
            log["passed"] = False
            log["error"] = str(exc)
            log["finished_at"] = self.clock.now_iso()
            self.writer.write_json("scenario-log.json", log)
            raise

    def _run_fixture(self, log: dict[str, Any]) -> ScenarioResult:
        poll_result = self.loader.scenario_fixture(MCP_POLL_ROUTE_DONE, "mcp_poll_result.json")
        golden = self.loader.golden_expectation(MCP_POLL_ROUTE_DONE)

        event = self._event_from_poll(poll_result)
        log["steps"].append({"name": "fake_mcp_poll", "event_id": event["id"]})

        route_decision = self._route_event(event)
        log["steps"].append({"name": "route_event", "route_decision_id": route_decision["id"]})

        review_packet = self._review_packet_for(event, route_decision)
        queue_item = self._queue_item_for(review_packet)
        log["steps"].append(
            {
                "name": "create_queue_item_review_packet",
                "queue_item_id": queue_item["id"],
                "review_packet_id": review_packet["id"],
            }
        )

        audit_decision = self._audit_decision_for(queue_item, golden)
        final_queue = {"item": None}
        log["steps"].append({"name": "mark_done", "audit_decision_id": audit_decision["id"]})
        log["steps"].append({"name": "assert_queue_empty"})

        observed = {
            "mcp_poll": {
                "source_id": poll_result["source_id"],
                "items_seen": len(poll_result["items"]),
                "duplicates_ignored": 0,
                "cursor": poll_result.get("next_cursor"),
            },
            "event": event,
            "route_decision": route_decision,
            "review_packet": review_packet,
            "next_queue_item": queue_item,
            "audit_decision": audit_decision,
            "final_queue": final_queue,
        }
        self._assert_golden(observed, golden)
        self.writer.write_json("observed.json", observed)

        return ScenarioResult(
            scenario=MCP_POLL_ROUTE_DONE,
            mode="fixture",
            passed=True,
            artifact_dir=self.writer.root,
            details={
                "event_id": event["id"],
                "route_decision_id": route_decision["id"],
                "queue_item_id": queue_item["id"],
                "review_packet_id": review_packet["id"],
                "audit_decision_id": audit_decision["id"],
            },
        )

    def _run_orchestrator(self, log: dict[str, Any]) -> ScenarioResult:
        assert self.orchestrator_url is not None
        client = OrchestratorClient(self.orchestrator_url)
        poll_result = self.loader.scenario_fixture(MCP_POLL_ROUTE_DONE, "mcp_poll_result.json")
        golden = self.loader.golden_expectation(MCP_POLL_ROUTE_DONE)

        self._drain_existing_queue(client, log)
        source_response = client.list_mcp_sources()
        sources = source_response.get("sources")
        if not isinstance(sources, list):
            raise ScenarioFailure("expected GET /mcp-sources response with sources list")
        if not any(isinstance(source, dict) and source.get("id") == "slack_dm_source" for source in sources):
            raise ScenarioFailure("expected slack_dm_source in MCP source registry")
        log["steps"].append({"name": "list_mcp_sources", "count": source_response.get("count")})

        poll_response = client.poll_mcp_source(poll_result)
        events = poll_response.get("events") if isinstance(poll_response, dict) else None
        if not isinstance(events, list) or not events or not isinstance(events[0], dict):
            raise ScenarioFailure("expected POST /mcp/poll response with events[0]")
        event = events[0]
        log["steps"].append({"name": "fake_mcp_poll", "event_id": event.get("id")})

        route_response = client.route_event(event)
        queue_item = self._extract_queue_item(route_response)
        review_packet = queue_item.get("review_packet")
        route_decision = route_response.get("route_decision")
        if not isinstance(review_packet, dict):
            raise ScenarioFailure("route response queue item missing review_packet")
        if not isinstance(route_decision, dict):
            raise ScenarioFailure("route response missing route_decision")
        log["steps"].append({"name": "route_event", "route_decision_id": route_decision.get("id")})
        log["steps"].append(
            {
                "name": "create_queue_item_review_packet",
                "queue_item_id": queue_item.get("id"),
                "review_packet_id": review_packet.get("id"),
            }
        )

        done_response = client.mark_done(queue_item["id"], self._decision_for(queue_item))
        log["steps"].append({"name": "mark_done", "response": done_response})

        final_queue_item = client.next_queue_item()
        log["steps"].append({"name": "assert_queue_empty"})
        if final_queue_item is not None:
            raise ScenarioFailure(f"expected empty queue after done, got {final_queue_item!r}")

        observed = {
            "mcp_poll": poll_response,
            "event": event,
            "route_decision": route_decision,
            "review_packet": review_packet,
            "next_queue_item": queue_item,
            "done_response": done_response,
            "final_queue": {"item": None},
        }
        self._assert_core_shapes(observed, golden)
        self.writer.write_json("observed.json", observed)

        return ScenarioResult(
            scenario=MCP_POLL_ROUTE_DONE,
            mode="orchestrator",
            passed=True,
            artifact_dir=self.writer.root,
            details={
                "event_id": event["id"],
                "route_decision_id": route_decision["id"],
                "queue_item_id": queue_item["id"],
                "review_packet_id": review_packet["id"],
            },
        )

    def _event_from_poll(self, poll_result: dict[str, Any]) -> dict[str, Any]:
        items = poll_result.get("items")
        if not isinstance(items, list) or not items or not isinstance(items[0], dict):
            raise ScenarioFailure("mcp_poll_result.items[0] must be object")
        item = items[0]
        source_id = self._require_str(poll_result, "source_id")
        item_id = self._require_str(item, "id")
        thread_url = self._require_str(item, "thread_url")
        received_at = self.clock.now_iso()

        source_key = f"{source_id}:{item_id}"
        stable_source_key = self._stable_id(source_key)

        return {
            "id": f"evt_{stable_source_key}",
            "source": "mcp_poll",
            "source_id": source_key,
            "idempotency_key": source_key,
            "occurred_at": self._require_str(item, "occurred_at"),
            "received_at": received_at,
            "actor": {
                "id": self._require_str(item, "actor_id"),
                "type": "human",
                "name": self._require_str(item, "actor_name"),
            },
            "project_hint": self._require_str(item, "project_hint"),
            "task_hint": self._require_str(item, "task_hint"),
            "type": self._require_str(item, "type"),
            "title": self._require_str(item, "title"),
            "summary": self._require_str(item, "summary"),
            "raw_ref": {
                "id": f"raw_{stable_source_key}",
                "uri": f"artifact://raw/{source_key}.json",
                "media_type": "application/json",
            },
            "links": [{"label": "Slack thread", "url": thread_url}],
            "resources": [
                {
                    "id": f"ctx_{stable_source_key}",
                    "kind": "slack_thread",
                    "title": "MCP source thread",
                    "url": thread_url,
                    "source": "slack",
                    "captured_at": received_at,
                    "restore_confidence": "high",
                    "workspace_id": self._require_str(item, "workspace_id"),
                    "channel_id": self._require_str(item, "channel_id"),
                    "thread_ts": self._require_str(item, "thread_ts"),
                }
            ],
        }

    def _route_event(self, event: dict[str, Any]) -> dict[str, Any]:
        task_hint = self._require_str(event, "task_hint")
        return {
            "id": f"rte_{self._stable_id(event['id'])}",
            "event_id": event["id"],
            "action": "ask_human_now",
            "target_task_id": f"task_{self._stable_id(task_hint)}",
            "confidence": "medium",
            "evidence": [
                {
                    "id": "ev_route_mcp_request",
                    "kind": "source",
                    "title": "MCP poll event requested human review",
                    "ref": event["raw_ref"]["uri"],
                }
            ],
            "created_at": self.clock.now_iso(),
        }

    def _review_packet_for(self, event: dict[str, Any], route_decision: dict[str, Any]) -> dict[str, Any]:
        source_link = event["links"][0]
        context = event["resources"][0]
        return {
            "id": f"pkt_{self._stable_id(event['id'])}",
            "task_id": route_decision["target_task_id"],
            "agent_run_id": "run_mcp_router",
            "title": f"Review {event['title']}",
            "summary": event["summary"],
            "decision_needed": "Decide whether to route this new event into a task agent now.",
            "risk_level": "medium",
            "confidence": route_decision["confidence"],
            "risk_tags": ["external_send"],
            "evidence": [
                {
                    "id": f"ev_{self._stable_id(event['id'])}_raw",
                    "kind": "raw",
                    "title": "Source event",
                    "url": event["raw_ref"]["uri"],
                }
            ],
            "context": [context],
            "source_links": [source_link],
            "recommended_action": {
                "id": f"act_{self._stable_id(event['id'])}_review",
                "type": "resume_agent",
                "label": "Route to task agent",
                "requires_confirmation": True,
                "side_effect": "local",
                "payload": {
                    "event_id": event["id"],
                    "task_hint": event.get("task_hint"),
                    "project_hint": event.get("project_hint"),
                },
            },
            "alternate_actions": [
                {
                    "id": f"act_{self._stable_id(event['id'])}_done",
                    "type": "mark_done",
                    "label": "Ignore for now",
                    "requires_confirmation": False,
                    "side_effect": "none",
                    "payload": {"event_id": event["id"]},
                }
            ],
            "created_at": self.clock.now_iso(),
            "updated_at": self.clock.now_iso(),
        }

    def _queue_item_for(self, review_packet: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": f"qit_{review_packet['id'].removeprefix('pkt_')}",
            "review_packet_id": review_packet["id"],
            "task_id": review_packet["task_id"],
            "state": "ready",
            "priority_score": 800,
            "priority_reasons": ["new_background_event", "mcp_poll_event", "task_hint_present"],
            "created_at": self.clock.now_iso(),
            "updated_at": self.clock.now_iso(),
        }

    @staticmethod
    def _decision_for(queue_item: dict[str, Any]) -> dict[str, Any]:
        return {
            "action": "done",
            "actor_id": "user_jason",
            "queue_item_id": queue_item["id"],
            "review_packet_id": queue_item["review_packet_id"],
        }

    def _audit_decision_for(self, queue_item: dict[str, Any], golden: dict[str, Any]) -> dict[str, Any]:
        expected = golden["expected_audit_decision"]
        return {
            "id": expected["id"],
            "queue_item_id": queue_item["id"],
            "review_packet_id": queue_item["review_packet_id"],
            "action": "done",
            "actor_id": "user_jason",
            "decided_at": self.clock.now_iso(),
        }

    def _assert_golden(self, observed: dict[str, Any], golden: dict[str, Any]) -> None:
        self._assert_core_shapes(observed, golden)
        expected_audit = golden["expected_audit_decision"]
        audit_decision = observed["audit_decision"]
        for key, value in expected_audit.items():
            if audit_decision.get(key) != value:
                raise ScenarioFailure(f"audit decision {key} mismatch: expected {value!r}, got {audit_decision.get(key)!r}")
        if observed["final_queue"] != {"item": None}:
            raise ScenarioFailure(f"expected final empty queue, got {observed['final_queue']!r}")

    def _assert_core_shapes(self, observed: dict[str, Any], golden: dict[str, Any]) -> None:
        for name, observed_key, golden_key in (
            ("event", "event", "expected_event"),
            ("route decision", "route_decision", "expected_route_decision"),
            ("review packet", "review_packet", "expected_review_packet"),
            ("queue item", "next_queue_item", "expected_queue_item"),
        ):
            actual = observed[observed_key]
            for field, value in golden[golden_key].items():
                if actual.get(field) != value:
                    raise ScenarioFailure(f"{name} {field} mismatch: expected {value!r}, got {actual.get(field)!r}")

        queue_item = observed["next_queue_item"]
        review_packet = observed["review_packet"]
        if queue_item.get("review_packet_id") != review_packet.get("id"):
            raise ScenarioFailure("queue item review_packet_id must match review packet id")
        if not review_packet.get("context"):
            raise ScenarioFailure("review packet missing context")
        if not review_packet.get("evidence"):
            raise ScenarioFailure("review packet missing evidence")

    @staticmethod
    def _extract_queue_item(response: dict[str, Any]) -> dict[str, Any]:
        item = None
        if isinstance(response, dict):
            item = response.get("queue_item") or response.get("item")
        if not isinstance(item, dict):
            raise ScenarioFailure("route response.item must be object")
        return item

    def _drain_existing_queue(self, client: OrchestratorClient, log: dict[str, Any]) -> None:
        drained = 0
        for _ in range(10):
            item = client.next_queue_item()
            if item is None:
                break
            client.mark_done(item["id"], self._decision_for(item))
            drained += 1
        if drained:
            log["steps"].append({"name": "drain_existing_queue", "count": drained})
        if drained == 10:
            raise ScenarioFailure("existing queue drain hit safety limit")

    @staticmethod
    def _require_str(source: dict[str, Any], key: str) -> str:
        value = source.get(key)
        if not isinstance(value, str) or not value:
            raise ScenarioFailure(f"{key} must be non-empty string")
        return value

    @staticmethod
    def _stable_id(value: str) -> str:
        normalized = "".join(character.lower() if character.isalnum() else "_" for character in value)
        collapsed = "_".join(part for part in normalized.split("_") if part)
        return collapsed or "unknown"


class McpSourcePollRouteDoneScenario(McpPollRouteDoneScenario):
    def run(self) -> ScenarioResult:
        mode = "orchestrator" if self.orchestrator_url else "fixture"
        log: dict[str, Any] = {
            "scenario": MCP_SOURCE_POLL_ROUTE_DONE,
            "mode": mode,
            "started_at": self.clock.now_iso(),
            "steps": [],
        }
        try:
            result = self._run_orchestrator(log) if self.orchestrator_url else self._run_fixture(log)
            log["passed"] = True
            log["finished_at"] = self.clock.now_iso()
            self.writer.write_json("scenario-log.json", log)
            self.writer.write_json("summary.json", result.details)
            return result
        except Exception as exc:
            log["passed"] = False
            log["error"] = str(exc)
            log["finished_at"] = self.clock.now_iso()
            self.writer.write_json("scenario-log.json", log)
            raise

    def _run_fixture(self, log: dict[str, Any]) -> ScenarioResult:
        poll_result = self.loader.scenario_fixture(MCP_SOURCE_POLL_ROUTE_DONE, "mcp_source_poll_result.json")
        golden = self.loader.golden_expectation(MCP_SOURCE_POLL_ROUTE_DONE)

        event = self._event_from_source_poll(poll_result)
        route_decision = self._route_event(event)
        review_packet = self._review_packet_for(event, route_decision)
        queue_item = self._queue_item_for(review_packet)
        audit_decision = self._audit_decision_for(queue_item, golden)
        log["steps"].append({"name": "mcp_source_poll_and_route", "event_id": event["id"]})
        log["steps"].append({"name": "mark_done", "audit_decision_id": audit_decision["id"]})
        log["steps"].append({"name": "assert_queue_empty"})

        observed = {
            "mcp_poll": {
                "source_id": golden["source_id"],
                "items_seen": len(poll_result["items"]),
                "duplicates_ignored": 1,
                "cursor": poll_result.get("nextCursor"),
            },
            "event": event,
            "route_decision": route_decision,
            "review_packet": review_packet,
            "next_queue_item": queue_item,
            "audit_decision": audit_decision,
            "final_queue": {"item": None},
        }
        self._assert_golden(observed, golden)
        self.writer.write_json("observed.json", observed)

        return ScenarioResult(
            scenario=MCP_SOURCE_POLL_ROUTE_DONE,
            mode="fixture",
            passed=True,
            artifact_dir=self.writer.root,
            details={
                "event_id": event["id"],
                "route_decision_id": route_decision["id"],
                "queue_item_id": queue_item["id"],
                "review_packet_id": review_packet["id"],
                "audit_decision_id": audit_decision["id"],
            },
        )

    def _run_orchestrator(self, log: dict[str, Any]) -> ScenarioResult:
        assert self.orchestrator_url is not None
        client = OrchestratorClient(self.orchestrator_url)
        poll_result = self.loader.scenario_fixture(MCP_SOURCE_POLL_ROUTE_DONE, "mcp_source_poll_result.json")
        golden = self.loader.golden_expectation(MCP_SOURCE_POLL_ROUTE_DONE)

        self._drain_existing_queue(client, log)
        poll_response = client.poll_and_route_mcp_source(golden["source_id"], poll_result)
        routed = poll_response.get("routed")
        if not isinstance(routed, list) or not routed or not isinstance(routed[0], dict):
            raise ScenarioFailure("expected POST /mcp-sources/:id/poll-and-route response with routed[0]")

        first = routed[0]
        event = first.get("event")
        route_decision = first.get("route_decision")
        review_packet = first.get("review_packet")
        queue_item = first.get("queue_item")
        task_message = first.get("task_message")
        if not isinstance(event, dict) or not isinstance(route_decision, dict):
            raise ScenarioFailure("poll-and-route response missing routed event or route_decision")

        log["steps"].append({"name": "mcp_source_poll_and_route", "event_id": event.get("id")})

        if isinstance(task_message, dict):
            if route_decision.get("action") != "inject_into_agent_thread":
                raise ScenarioFailure(f"expected inject route for task message, got {route_decision.get('action')!r}")
            if task_message.get("task_session_id") != "task_session_blog":
                raise ScenarioFailure(f"expected task_session_blog, got {task_message.get('task_session_id')!r}")
            if task_message.get("event_ids") != [event.get("id")]:
                raise ScenarioFailure(f"task message event_ids mismatch: {task_message.get('event_ids')!r}")

            final_queue_item = client.next_queue_item()
            log["steps"].append({"name": "assert_queue_empty"})
            if final_queue_item is not None:
                raise ScenarioFailure(f"expected empty queue after task injection, got {final_queue_item!r}")

            observed = {
                "mcp_poll": poll_response,
                "event": event,
                "route_decision": route_decision,
                "task_message": task_message,
                "final_queue": {"item": None},
            }
            self.writer.write_json("observed.json", observed)

            return ScenarioResult(
                scenario=MCP_SOURCE_POLL_ROUTE_DONE,
                mode="orchestrator",
                passed=True,
                artifact_dir=self.writer.root,
                details={
                    "event_id": event["id"],
                    "route_decision_id": route_decision["id"],
                    "task_message_id": task_message["id"],
                },
            )

        if not isinstance(review_packet, dict) or not isinstance(queue_item, dict):
            raise ScenarioFailure("poll-and-route response missing routed review artifacts")

        done_response = client.mark_done(queue_item["id"], self._decision_for(queue_item))
        log["steps"].append({"name": "mark_done", "response": done_response})

        final_queue_item = client.next_queue_item()
        log["steps"].append({"name": "assert_queue_empty"})
        if final_queue_item is not None:
            raise ScenarioFailure(f"expected empty queue after done, got {final_queue_item!r}")

        observed = {
            "mcp_poll": poll_response,
            "event": event,
            "route_decision": route_decision,
            "review_packet": review_packet,
            "next_queue_item": queue_item,
            "done_response": done_response,
            "final_queue": {"item": None},
        }
        self._assert_core_shapes(observed, golden)
        self.writer.write_json("observed.json", observed)

        return ScenarioResult(
            scenario=MCP_SOURCE_POLL_ROUTE_DONE,
            mode="orchestrator",
            passed=True,
            artifact_dir=self.writer.root,
            details={
                "event_id": event["id"],
                "route_decision_id": route_decision["id"],
                "queue_item_id": queue_item["id"],
                "review_packet_id": review_packet["id"],
            },
        )

    def _event_from_source_poll(self, poll_result: dict[str, Any]) -> dict[str, Any]:
        items = poll_result.get("items")
        if not isinstance(items, list) or not items or not isinstance(items[0], dict):
            raise ScenarioFailure("mcp_source_poll_result.items[0] must be object")
        item = items[0]
        workspace_id = self._require_str(item, "team_id")
        channel_id = self._require_str(item, "channel_id")
        ts = self._require_str(item, "ts")
        text = self._require_str(item, "text")
        permalink = self._require_str(item, "permalink")
        user_id = self._require_str(item, "user_id")
        user_name = self._require_str(item, "user_name")
        source_id = f"slack:{workspace_id}:{channel_id}:{ts}"
        received_at = self.clock.now_iso()

        return {
            "id": f"evt_slack_{workspace_id}_{channel_id}_{ts.replace('.', '_')}",
            "source": "slack",
            "source_id": source_id,
            "idempotency_key": source_id,
            "occurred_at": self._require_str(item, "occurred_at"),
            "received_at": received_at,
            "actor": {
                "id": f"actor_slack_{user_id}",
                "type": "human",
                "name": user_name,
            },
            "project_hint": self._require_str(item, "project_hint"),
            "task_hint": self._require_str(item, "task_hint"),
            "type": "slack.message",
            "title": f"Slack message from {user_name}",
            "summary": text,
            "raw_ref": {
                "id": f"raw_slack_{workspace_id}_{channel_id}_{ts}",
                "uri": f"artifact://raw/{source_id}.json",
                "media_type": "application/json",
            },
            "links": [{"label": "Slack thread", "url": permalink}],
            "resources": [
                {
                    "id": f"ctx_slack_{workspace_id}_{channel_id}_{ts}",
                    "kind": "slack_thread",
                    "title": "Slack thread",
                    "url": permalink,
                    "source": "slack",
                    "captured_at": received_at,
                    "restore_confidence": "high",
                    "workspace_id": workspace_id,
                    "channel_id": channel_id,
                    "thread_ts": self._require_str(item, "thread_ts"),
                }
            ],
        }

    def _queue_item_for(self, review_packet: dict[str, Any]) -> dict[str, Any]:
        queue_item = super()._queue_item_for(review_packet)
        queue_item["priority_score"] = 900
        queue_item["priority_reasons"] = ["new_background_event", "slack_message", "task_hint_present"]
        return queue_item


class BrowserContextStoreOnlyScenario:
    scenario_name = BROWSER_CONTEXT_STORE_ONLY
    route_action = "store_only"
    route_confidence = "high"
    context_query = {"source": "browser", "q": "pricing note"}

    def __init__(
        self,
        loader: FixtureLoader,
        writer: ArtifactWriter,
        clock: FakeClock,
        orchestrator_url: str | None = None,
    ) -> None:
        self.loader = loader
        self.writer = writer
        self.clock = clock
        self.orchestrator_url = orchestrator_url

    def run(self) -> ScenarioResult:
        mode = "orchestrator" if self.orchestrator_url else "fixture"
        log: dict[str, Any] = {
            "scenario": self.scenario_name,
            "mode": mode,
            "started_at": self.clock.now_iso(),
            "steps": [],
        }
        try:
            result = self._run_orchestrator(log) if self.orchestrator_url else self._run_fixture(log)
            log["passed"] = True
            log["finished_at"] = self.clock.now_iso()
            self.writer.write_json("scenario-log.json", log)
            self.writer.write_json("summary.json", result.details)
            return result
        except Exception as exc:
            log["passed"] = False
            log["error"] = str(exc)
            log["finished_at"] = self.clock.now_iso()
            self.writer.write_json("scenario-log.json", log)
            raise

    def _run_fixture(self, log: dict[str, Any]) -> ScenarioResult:
        event = self.loader.scenario_fixture(self.scenario_name, "browser_context_event.json")
        golden = self.loader.golden_expectation(self.scenario_name)

        route_decision = self._route_event(event)
        log["steps"].append({"name": "route_event", "route_decision_id": route_decision["id"]})
        log["steps"].append({"name": "assert_no_queue_item"})

        observed = {
            "event": event,
            "route_decision": route_decision,
            "review_packet": None,
            "next_queue_item": None,
            "final_queue": {"item": None},
        }
        self._assert_golden(observed, golden)
        self.writer.write_json("observed.json", observed)

        return ScenarioResult(
            scenario=self.scenario_name,
            mode="fixture",
            passed=True,
            artifact_dir=self.writer.root,
            details={
                "event_id": event["id"],
                "route_decision_id": route_decision["id"],
                "route_action": route_decision["action"],
            },
        )

    def _run_orchestrator(self, log: dict[str, Any]) -> ScenarioResult:
        assert self.orchestrator_url is not None
        client = OrchestratorClient(self.orchestrator_url)
        event = self.loader.scenario_fixture(self.scenario_name, "browser_context_event.json")
        golden = self.loader.golden_expectation(self.scenario_name)

        self._drain_existing_queue(client, log)
        route_response = client.route_event(event)
        route_decision = route_response.get("route_decision") if isinstance(route_response, dict) else None
        if not isinstance(route_decision, dict):
            raise ScenarioFailure("route response missing route_decision")

        log["steps"].append({"name": "route_event", "route_decision_id": route_decision.get("id")})
        if route_response.get("queue_item") is not None or route_response.get("review_packet") is not None:
            raise ScenarioFailure("browser context store-only route must not create queue item or review packet")
        log["steps"].append({"name": "assert_no_queue_item"})

        stored_event = client.get_event(event["id"])
        stored_route_decision = stored_event.get("route_decision") if isinstance(stored_event, dict) else None
        if not isinstance(stored_route_decision, dict) or stored_route_decision.get("action") != self.route_action:
            raise ScenarioFailure(f"stored event route decision mismatch: {stored_event!r}")
        log["steps"].append({"name": "fetch_stored_event", "event_id": event["id"]})

        contexts = client.list_contexts(**self.context_query)
        entries = contexts.get("entries") if isinstance(contexts, dict) else None
        if not isinstance(entries, list) or not any(entry.get("event_id") == event["id"] for entry in entries if isinstance(entry, dict)):
            raise ScenarioFailure(f"context list missing stored browser event: {contexts!r}")
        log["steps"].append({"name": "list_contexts", "count": contexts.get("count")})

        final_queue_item = client.next_queue_item()
        log["steps"].append({"name": "assert_queue_empty"})
        if final_queue_item is not None:
            raise ScenarioFailure(f"expected empty queue after store-only event, got {final_queue_item!r}")

        observed = {
            "event": event,
            "route_decision": route_decision,
            "review_packet": None,
            "next_queue_item": None,
            "final_queue": {"item": None},
        }
        self._assert_golden(observed, golden)
        self.writer.write_json("observed.json", observed)

        return ScenarioResult(
            scenario=self.scenario_name,
            mode="orchestrator",
            passed=True,
            artifact_dir=self.writer.root,
            details={
                "event_id": event["id"],
                "route_decision_id": route_decision["id"],
                "route_action": route_decision["action"],
            },
        )

    def _route_event(self, event: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": f"rte_{self._stable_id(event['id'])}",
            "event_id": event["id"],
            "action": self.route_action,
            "target_task_id": self._target_task_id(event),
            "confidence": self.route_confidence,
            "evidence": [
                {
                    "id": f"ev_{self._stable_id(event['id'])}_raw",
                    "kind": "raw",
                    "title": "Source event",
                    "url": event["raw_ref"]["uri"],
                }
            ],
            "created_at": self.clock.now_iso(),
        }

    def _assert_golden(self, observed: dict[str, Any], golden: dict[str, Any]) -> None:
        route_decision = observed["route_decision"]
        for field, value in golden["expected_route_decision"].items():
            if route_decision.get(field) != value:
                raise ScenarioFailure(f"route decision {field} mismatch: expected {value!r}, got {route_decision.get(field)!r}")
        if observed["review_packet"] is not None:
            raise ScenarioFailure("expected no review packet")
        if observed["next_queue_item"] is not None:
            raise ScenarioFailure("expected no queue item")
        if observed["final_queue"] != {"item": None}:
            raise ScenarioFailure(f"expected final empty queue, got {observed['final_queue']!r}")

    def _drain_existing_queue(self, client: OrchestratorClient, log: dict[str, Any]) -> None:
        drained = 0
        for _ in range(10):
            item = client.next_queue_item()
            if item is None:
                break
            client.mark_done(item["id"], {
                "action": "done",
                "actor_id": "user_jason",
                "queue_item_id": item["id"],
                "review_packet_id": item["review_packet_id"],
            })
            drained += 1
        if drained:
            log["steps"].append({"name": "drain_existing_queue", "count": drained})
        if drained == 10:
            raise ScenarioFailure("existing queue drain hit safety limit")

    @staticmethod
    def _stable_id(value: str) -> str:
        normalized = "".join(character.lower() if character.isalnum() else "_" for character in value)
        collapsed = "_".join(part for part in normalized.split("_") if part)
        return collapsed or "unknown"

    def _target_task_id(self, event: dict[str, Any]) -> str | None:
        task_hint = event.get("task_hint")
        if not isinstance(task_hint, str) or not task_hint:
            return None
        return f"task_{self._stable_id(task_hint)}"


class BrowserContextAttachTaskScenario(BrowserContextStoreOnlyScenario):
    scenario_name = BROWSER_CONTEXT_ATTACH_TASK
    route_action = "attach_to_task"
    route_confidence = "medium"
    context_query = {"source": "browser", "task_id": "task_blog_feedback", "q": "launch"}


class TaskSessionFollowupScenario:
    def __init__(
        self,
        loader: FixtureLoader,
        writer: ArtifactWriter,
        clock: FakeClock,
        orchestrator_url: str | None = None,
    ) -> None:
        self.loader = loader
        self.writer = writer
        self.clock = clock
        self.orchestrator_url = orchestrator_url

    def run(self) -> ScenarioResult:
        mode = "orchestrator" if self.orchestrator_url else "fixture"
        log: dict[str, Any] = {
            "scenario": TASK_SESSION_FOLLOWUP,
            "mode": mode,
            "started_at": self.clock.now_iso(),
            "steps": [],
        }
        try:
            result = self._run_orchestrator(log) if self.orchestrator_url else self._run_fixture(log)
            log["passed"] = True
            log["finished_at"] = self.clock.now_iso()
            self.writer.write_json("scenario-log.json", log)
            self.writer.write_json("summary.json", result.details)
            return result
        except Exception as exc:
            log["passed"] = False
            log["error"] = str(exc)
            log["finished_at"] = self.clock.now_iso()
            self.writer.write_json("scenario-log.json", log)
            raise

    def _run_fixture(self, log: dict[str, Any]) -> ScenarioResult:
        golden = self.loader.golden_expectation(TASK_SESSION_FOLLOWUP)
        message = self._expected_message(golden)
        log["steps"].append({"name": "send_followup", "task_message_id": message["id"]})
        log["steps"].append({"name": "dedupe_followup", "task_message_id": message["id"]})
        observed = {"message": message, "duplicate_message": message}
        self._assert_golden(observed, golden)
        self.writer.write_json("observed.json", observed)
        return ScenarioResult(
            scenario=TASK_SESSION_FOLLOWUP,
            mode="fixture",
            passed=True,
            artifact_dir=self.writer.root,
            details={
                "task_message_id": message["id"],
                "task_session_id": message["task_session_id"],
            },
        )

    def _run_orchestrator(self, log: dict[str, Any]) -> ScenarioResult:
        assert self.orchestrator_url is not None
        client = OrchestratorClient(self.orchestrator_url)
        golden = self.loader.golden_expectation(TASK_SESSION_FOLLOWUP)
        sessions_response = client.list_task_sessions()
        sessions = sessions_response.get("sessions")
        if not isinstance(sessions, list):
            raise ScenarioFailure("expected GET /task-sessions response with sessions list")
        matching_sessions = [
            session for session in sessions
            if isinstance(session, dict) and session.get("id") == golden["request"]["task_session_id"]
        ]
        if not matching_sessions:
            raise ScenarioFailure(f"task session {golden['request']['task_session_id']!r} not discoverable")
        log["steps"].append({"name": "list_task_sessions", "count": sessions_response.get("count")})

        session_response = client.get_task_session(golden["request"]["task_session_id"])
        session = session_response.get("session")
        if not isinstance(session, dict) or session.get("id") != golden["request"]["task_session_id"]:
            raise ScenarioFailure("expected GET /task-sessions/:id to return target session")
        log["steps"].append({"name": "get_task_session", "task_session_id": session.get("id")})

        payload = {
            "text": golden["request"]["text"],
            "event_ids": golden["request"]["event_ids"],
        }
        first = client.send_task_followup(
            golden["request"]["task_session_id"],
            payload,
            golden["request"]["idempotency_key"],
        )
        log["steps"].append({"name": "send_followup", "task_message_id": first.get("message", {}).get("id")})
        duplicate = client.send_task_followup(
            golden["request"]["task_session_id"],
            payload,
            golden["request"]["idempotency_key"],
        )
        log["steps"].append({"name": "dedupe_followup", "task_message_id": duplicate.get("message", {}).get("id")})
        observed = {
            "session": session,
            "message": first.get("message"),
            "duplicate_message": duplicate.get("message"),
        }
        self._assert_golden(observed, golden)
        self.writer.write_json("observed.json", observed)
        return ScenarioResult(
            scenario=TASK_SESSION_FOLLOWUP,
            mode="orchestrator",
            passed=True,
            artifact_dir=self.writer.root,
            details={
                "task_message_id": observed["message"]["id"],
                "task_session_id": observed["message"]["task_session_id"],
            },
        )

    @staticmethod
    def _expected_message(golden: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": golden["expected_message"]["id"],
            "task_session_id": golden["request"]["task_session_id"],
            "mode": "followup",
            "text": golden["request"]["text"],
            "event_ids": golden["request"]["event_ids"],
            "idempotency_key": golden["request"]["idempotency_key"],
            "status": "sent",
        }

    @staticmethod
    def _assert_golden(observed: dict[str, Any], golden: dict[str, Any]) -> None:
        message = observed["message"]
        duplicate = observed["duplicate_message"]
        if not isinstance(message, dict) or not isinstance(duplicate, dict):
            raise ScenarioFailure("task followup response missing message")
        for field, value in golden["expected_message"].items():
            if message.get(field) != value:
                raise ScenarioFailure(f"message {field} mismatch: expected {value!r}, got {message.get(field)!r}")
        if duplicate.get("id") != message.get("id"):
            raise ScenarioFailure("duplicate followup must return same task message id")


class WorkspaceSnapshotContextScenario:
    def __init__(
        self,
        loader: FixtureLoader,
        writer: ArtifactWriter,
        clock: FakeClock,
        orchestrator_url: str | None = None,
    ) -> None:
        self.loader = loader
        self.writer = writer
        self.clock = clock
        self.orchestrator_url = orchestrator_url

    def run(self) -> ScenarioResult:
        mode = "orchestrator" if self.orchestrator_url else "fixture"
        log: dict[str, Any] = {
            "scenario": WORKSPACE_SNAPSHOT_CONTEXT,
            "mode": mode,
            "started_at": self.clock.now_iso(),
            "steps": [],
        }
        try:
            result = self._run_orchestrator(log) if self.orchestrator_url else self._run_fixture(log)
            log["passed"] = True
            log["finished_at"] = self.clock.now_iso()
            self.writer.write_json("scenario-log.json", log)
            self.writer.write_json("summary.json", result.details)
            return result
        except Exception as exc:
            log["passed"] = False
            log["error"] = str(exc)
            log["finished_at"] = self.clock.now_iso()
            self.writer.write_json("scenario-log.json", log)
            raise

    def _run_fixture(self, log: dict[str, Any]) -> ScenarioResult:
        event = self._event()
        packet = self._packet_from_event(event)
        log["steps"].append({"name": "build_event", "event_id": event["id"]})
        log["steps"].append({"name": "assert_workspace_snapshot_context"})
        self._assert_packet_has_workspace_snapshot(packet)

        observed = {
            "event": event,
            "review_packet": packet,
        }
        self.writer.write_json("observed.json", observed)

        return ScenarioResult(
            scenario=WORKSPACE_SNAPSHOT_CONTEXT,
            mode="fixture",
            passed=True,
            artifact_dir=self.writer.root,
            details={
                "event_id": event["id"],
                "review_packet_id": packet["id"],
                "workspace": "eventloop-blog",
            },
        )

    def _run_orchestrator(self, log: dict[str, Any]) -> ScenarioResult:
        if self.orchestrator_url is None:
            raise ScenarioFailure("orchestrator_url required")
        client = OrchestratorClient(self.orchestrator_url)
        event = self._event()

        response = client.route_event(event)
        log["steps"].append({"name": "route_event", "event_id": event["id"]})
        packet = response.get("review_packet")
        queue_item = response.get("queue_item")
        if not isinstance(packet, dict):
            raise ScenarioFailure(f"expected review_packet object, got {packet!r}")
        if not isinstance(queue_item, dict):
            raise ScenarioFailure(f"expected queue_item object, got {queue_item!r}")

        self._assert_packet_has_workspace_snapshot(packet)
        log["steps"].append({"name": "assert_workspace_snapshot_context", "queue_item_id": queue_item.get("id")})

        observed = {
            "event": event,
            "response": response,
        }
        self.writer.write_json("observed.json", observed)

        return ScenarioResult(
            scenario=WORKSPACE_SNAPSHOT_CONTEXT,
            mode="orchestrator",
            passed=True,
            artifact_dir=self.writer.root,
            details={
                "event_id": event["id"],
                "review_packet_id": packet["id"],
                "queue_item_id": queue_item["id"],
                "workspace": "eventloop-blog",
            },
        )

    def _event(self) -> dict[str, Any]:
        return {
            "id": "evt_workspace_snapshot_context",
            "source": "manual",
            "source_id": "manual:workspace-snapshot-context",
            "idempotency_key": "idem_workspace_snapshot_context",
            "occurred_at": self.clock.now_iso(),
            "received_at": self.clock.now_iso(),
            "actor": {
                "id": "user_jason",
                "type": "human",
            },
            "task_hint": "blog review",
            "type": "manual.review_requested",
            "title": "Review blog workspace restore",
            "summary": "Packet should carry a workspace snapshot into the queue.",
            "raw_ref": {
                "id": "raw_workspace_snapshot_context",
                "uri": "manual://workspace-snapshot-context",
                "media_type": "application/json",
            },
            "links": [],
            "resources": [
                {
                    "id": "ctx_workspace_snapshot_context",
                    "kind": "workspace_snapshot",
                    "title": "Blog review workspace",
                    "source": "harness",
                    "captured_at": self.clock.now_iso(),
                    "restore_confidence": "medium",
                    "snapshot": {
                        "backend": "aerospace",
                        "windows": [
                            {
                                "id": 9,
                                "app": "Ghostty",
                                "title": "codex",
                                "workspace": "eventloop-blog",
                            }
                        ],
                        "activeWorkspace": "eventloop-blog",
                        "focusedWindowId": 9,
                    },
                }
            ],
        }

    @staticmethod
    def _packet_from_event(event: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": "pkt_evt_workspace_snapshot_context",
            "title": event["title"],
            "summary": event["summary"],
            "context": event["resources"],
        }

    @staticmethod
    def _assert_packet_has_workspace_snapshot(packet: dict[str, Any]) -> None:
        contexts = packet.get("context")
        if not isinstance(contexts, list):
            raise ScenarioFailure("review packet missing context list")
        workspace_contexts = [context for context in contexts if isinstance(context, dict) and context.get("kind") == "workspace_snapshot"]
        if len(workspace_contexts) != 1:
            raise ScenarioFailure(f"expected one workspace_snapshot context, got {len(workspace_contexts)}")
        snapshot = workspace_contexts[0].get("snapshot")
        if not isinstance(snapshot, dict):
            raise ScenarioFailure("workspace_snapshot context missing snapshot")
        if snapshot.get("backend") != "aerospace":
            raise ScenarioFailure(f"snapshot backend mismatch: {snapshot.get('backend')!r}")
        if snapshot.get("activeWorkspace") != "eventloop-blog":
            raise ScenarioFailure(f"activeWorkspace mismatch: {snapshot.get('activeWorkspace')!r}")
        windows = snapshot.get("windows")
        if not isinstance(windows, list) or not windows:
            raise ScenarioFailure("workspace snapshot missing windows")
        if windows[0].get("workspace") != "eventloop-blog":
            raise ScenarioFailure(f"window workspace mismatch: {windows[0].get('workspace')!r}")


class WorkspaceStatusSmokeScenario:
    def __init__(
        self,
        loader: FixtureLoader,
        writer: ArtifactWriter,
        clock: FakeClock,
        orchestrator_url: str | None = None,
    ) -> None:
        self.loader = loader
        self.writer = writer
        self.clock = clock
        self.orchestrator_url = orchestrator_url

    def run(self) -> ScenarioResult:
        mode = "orchestrator" if self.orchestrator_url else "fixture"
        log: dict[str, Any] = {
            "scenario": WORKSPACE_STATUS_SMOKE,
            "mode": mode,
            "started_at": self.clock.now_iso(),
            "steps": [],
        }
        try:
            result = self._run_orchestrator(log) if self.orchestrator_url else self._run_fixture(log)
            log["passed"] = True
            log["finished_at"] = self.clock.now_iso()
            self.writer.write_json("scenario-log.json", log)
            self.writer.write_json("summary.json", result.details)
            return result
        except Exception as exc:
            log["passed"] = False
            log["error"] = str(exc)
            log["finished_at"] = self.clock.now_iso()
            self.writer.write_json("scenario-log.json", log)
            raise

    def _run_fixture(self, log: dict[str, Any]) -> ScenarioResult:
        observed = {
            "status": {
                "available": False,
                "backend": "aerospace",
                "reason": "server_unavailable",
            },
            "execute_supported": False,
        }
        log["steps"].append({"name": "workspace_status", "available": False, "reason": "server_unavailable"})
        self._assert_status_shape(observed)
        self.writer.write_json("observed.json", observed)
        return ScenarioResult(
            scenario=WORKSPACE_STATUS_SMOKE,
            mode="fixture",
            passed=True,
            artifact_dir=self.writer.root,
            details={
                "available": False,
                "backend": "aerospace",
                "reason": "server_unavailable",
                "execute_supported": False,
            },
        )

    def _run_orchestrator(self, log: dict[str, Any]) -> ScenarioResult:
        if self.orchestrator_url is None:
            raise ScenarioFailure("orchestrator_url required")
        client = OrchestratorClient(self.orchestrator_url)
        observed = client.workspace_status()
        self._assert_status_shape(observed)
        status = observed["status"]
        log["steps"].append(
            {
                "name": "workspace_status",
                "available": status.get("available"),
                "reason": status.get("reason"),
            }
        )
        self.writer.write_json("observed.json", observed)
        return ScenarioResult(
            scenario=WORKSPACE_STATUS_SMOKE,
            mode="orchestrator",
            passed=True,
            artifact_dir=self.writer.root,
            details={
                "available": status["available"],
                "backend": status["backend"],
                "reason": status.get("reason"),
                "execute_supported": observed["execute_supported"],
            },
        )

    @staticmethod
    def _assert_status_shape(observed: dict[str, Any]) -> None:
        status = observed.get("status")
        if not isinstance(status, dict):
            raise ScenarioFailure("workspace status response missing status object")
        if status.get("backend") != "aerospace":
            raise ScenarioFailure(f"workspace status backend mismatch: {status!r}")
        if not isinstance(status.get("available"), bool):
            raise ScenarioFailure("workspace status available must be boolean")
        if observed.get("execute_supported") is not False:
            raise ScenarioFailure("workspace status must report execute_supported false")
        if status["available"] is False:
            allowed = {"binary_missing", "permission_denied", "server_unavailable", "invalid_response", "unknown_error"}
            if status.get("reason") not in allowed:
                raise ScenarioFailure(f"workspace status reason mismatch: {status!r}")


class WorkspaceRestoreDisabledScenario:
    def __init__(
        self,
        loader: FixtureLoader,
        writer: ArtifactWriter,
        clock: FakeClock,
        orchestrator_url: str | None = None,
    ) -> None:
        self.loader = loader
        self.writer = writer
        self.clock = clock
        self.orchestrator_url = orchestrator_url

    def run(self) -> ScenarioResult:
        mode = "orchestrator" if self.orchestrator_url else "fixture"
        log: dict[str, Any] = {
            "scenario": WORKSPACE_RESTORE_DISABLED,
            "mode": mode,
            "started_at": self.clock.now_iso(),
            "steps": [],
        }
        try:
            result = self._run_orchestrator(log) if self.orchestrator_url else self._run_fixture(log)
            log["passed"] = True
            log["finished_at"] = self.clock.now_iso()
            self.writer.write_json("scenario-log.json", log)
            self.writer.write_json("summary.json", result.details)
            return result
        except Exception as exc:
            log["passed"] = False
            log["error"] = str(exc)
            log["finished_at"] = self.clock.now_iso()
            self.writer.write_json("scenario-log.json", log)
            raise

    def _run_fixture(self, log: dict[str, Any]) -> ScenarioResult:
        observed = {
            "error": {
                "code": "workspace_execute_disabled",
                "status": 403,
            }
        }
        log["steps"].append({"name": "assert_restore_disabled", "status": 403})
        self.writer.write_json("observed.json", observed)
        return ScenarioResult(
            scenario=WORKSPACE_RESTORE_DISABLED,
            mode="fixture",
            passed=True,
            artifact_dir=self.writer.root,
            details={
                "error_code": "workspace_execute_disabled",
                "status": 403,
            },
        )

    def _run_orchestrator(self, log: dict[str, Any]) -> ScenarioResult:
        if self.orchestrator_url is None:
            raise ScenarioFailure("orchestrator_url required")
        client = OrchestratorClient(self.orchestrator_url)
        try:
            client.restore_workspace(
                {
                    "confirm_execute": True,
                    "snapshot": {
                        "backend": "aerospace",
                        "windows": [],
                    },
                },
                idempotency_key="idem_workspace_restore_disabled_harness",
            )
        except Exception as exc:
            message = str(exc)
            if "HTTP 403" not in message or "workspace_execute_disabled" not in message:
                raise ScenarioFailure(f"expected disabled workspace restore error, got {message}") from exc
            log["steps"].append({"name": "assert_restore_disabled", "status": 403})
            observed = {
                "error": {
                    "code": "workspace_execute_disabled",
                    "status": 403,
                    "message": message,
                }
            }
            self.writer.write_json("observed.json", observed)
            return ScenarioResult(
                scenario=WORKSPACE_RESTORE_DISABLED,
                mode="orchestrator",
                passed=True,
                artifact_dir=self.writer.root,
                details={
                    "error_code": "workspace_execute_disabled",
                    "status": 403,
                },
            )

        raise ScenarioFailure("expected workspace restore to be disabled")
