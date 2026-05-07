from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class OrchestratorClient:
    base_url: str
    timeout_seconds: float = 5.0

    def next_queue_item(self) -> dict[str, Any] | None:
        payload = self._request("GET", "/queue/next")
        if payload in ({}, None):
            return None
        if isinstance(payload, dict) and payload.get("item") is None:
            return None
        if isinstance(payload, dict) and "item" in payload:
            item = payload["item"]
            return item if isinstance(item, dict) else None
        return payload if isinstance(payload, dict) else None

    def mark_done(self, queue_item_id: str, decision: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/queue/{queue_item_id}/done", decision)

    def poll_mcp_source(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/mcp/poll", payload) or {}

    def poll_and_route_mcp_source(self, source_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/mcp-sources/{source_id}/poll-and-route", payload) or {}

    def poll_all_and_route_mcp_sources(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/mcp-sources/poll-all-and-route", payload) or {}

    def list_mcp_sources(self) -> dict[str, Any]:
        return self._request("GET", "/mcp-sources") or {}

    def route_event(self, event: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/events", {"event": event}) or {}

    def route_voice_command(self, payload: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
        return self._request(
            "POST",
            "/voice/commands",
            payload,
            headers={"Idempotency-Key": idempotency_key},
        ) or {}

    def get_event(self, event_id: str) -> dict[str, Any]:
        return self._request("GET", f"/events/{event_id}") or {}

    def list_contexts(self, **params: str) -> dict[str, Any]:
        query = urlencode({key: value for key, value in params.items() if value})
        path = f"/contexts?{query}" if query else "/contexts"
        return self._request("GET", path) or {}

    def context_restore_plan(self, resource: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/contexts/restore-plan", {"resource": resource}) or {}

    def request_context_restore(self, resource: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
        return self._request(
            "POST",
            "/contexts/restore-requests",
            {"resource": resource},
            headers={"Idempotency-Key": idempotency_key},
        ) or {}

    def next_context_restore_request(self) -> dict[str, Any] | None:
        payload = self._request("GET", "/contexts/restore-requests/next")
        if not isinstance(payload, dict):
            return None
        restore_request = payload.get("restore_request")
        return restore_request if isinstance(restore_request, dict) else None

    def mark_context_restore_done(self, restore_request_id: str, result: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/contexts/restore-requests/{restore_request_id}/done", {"result": result}) or {}

    def list_task_sessions(self) -> dict[str, Any]:
        return self._request("GET", "/task-sessions") or {}

    def get_task_session(self, task_session_id: str) -> dict[str, Any]:
        return self._request("GET", f"/task-sessions/{task_session_id}") or {}

    def send_task_followup(self, task_session_id: str, payload: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/task-sessions/{task_session_id}/followup",
            payload,
            headers={"Idempotency-Key": idempotency_key},
        ) or {}

    def bind_task_session(self, task_session_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("PUT", f"/task-sessions/{task_session_id}/task-binding", payload) or {}

    def workspace_status(self) -> dict[str, Any]:
        return self._request("GET", "/workspace/status") or {}

    def restore_workspace(self, payload: dict[str, Any], idempotency_key: str | None = None) -> dict[str, Any]:
        headers = {"Idempotency-Key": idempotency_key} if idempotency_key else None
        return self._request("POST", "/workspace/restore", payload, headers=headers) or {}

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any] | None:
        url = urljoin(self.base_url.rstrip("/") + "/", path.lstrip("/"))
        data = None if body is None else json.dumps(body).encode("utf-8")
        request_headers = {"Content-Type": "application/json", **(headers or {})}
        request = Request(url, data=data, method=method, headers=request_headers)
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            raw_error = exc.read().decode("utf-8", errors="replace")
            raise OrchestratorError(f"{method} {url} failed: HTTP {exc.code}: {raw_error}") from exc
        except URLError as exc:
            raise OrchestratorError(f"{method} {url} failed: {exc.reason}") from exc

        if not raw.strip():
            return None
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise OrchestratorError(f"{method} {url} returned invalid JSON: {exc}") from exc
        return parsed


class OrchestratorError(RuntimeError):
    pass
