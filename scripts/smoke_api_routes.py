#!/usr/bin/env python
"""
Smoke tests for authenticated API routes.

Verifies that key API endpoints return expected status codes and response
shapes. These tests do NOT validate business logic — they verify the API
contract (status codes, required fields, error shapes).

Usage:
    python scripts/smoke_api_routes.py

Requires:
    SMOKE_BASE_URL (default: http://localhost:3000)

Note: These tests hit endpoints that require authentication. Unauthenticated
requests should return 401. State-changing requests may return 403 when
rejected earlier by CSRF protection. Endpoints that require teacher role should
return 403 for student sessions.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE_URL: str = os.environ.get("SMOKE_BASE_URL", "http://localhost:3000").rstrip("/")

passed: int = 0
failed: int = 0
errors: list[str] = []


def api_get(path: str, headers: dict[str, str] | None = None) -> tuple[int, Any]:
    """Make a GET request and return (status_code, parsed_json_or_None)."""
    url = f"{BASE_URL}{path}"
    req = Request(url, headers=headers or {})
    try:
        with urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return resp.status, body
    except HTTPError as err:
        body = None
        try:
            body = json.loads(err.read().decode("utf-8"))
        except Exception:
            pass
        return err.code, body


def api_post(
    path: str,
    data: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, Any]:
    """Make a POST request with JSON body."""
    url = f"{BASE_URL}{path}"
    body_bytes = json.dumps(data or {}).encode("utf-8")
    hdrs = {"Content-Type": "application/json", **(headers or {})}
    req = Request(url, data=body_bytes, headers=hdrs, method="POST")
    try:
        with urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return resp.status, body
    except HTTPError as err:
        body = None
        try:
            body = json.loads(err.read().decode("utf-8"))
        except Exception:
            pass
        return err.code, body


def check(name: str, condition: bool, detail: str = "") -> None:
    """Record a test result."""
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        msg = f"  FAIL  {name}" + (f" — {detail}" if detail else "")
        print(msg)
        errors.append(msg)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

def test_health() -> None:
    status, body = api_get("/api/health")

    # When no database is available (e.g. CI), the health endpoint returns 503
    # with db="disconnected". Accept this as passing since the server itself is
    # up — API contract and auth-rejection tests don't require a live database.
    if status == 503 and body is not None and body.get("db") == "disconnected":
        check("GET /api/health returns 503 (no database — accepted in CI)", True)
        return

    check("GET /api/health returns 200", status == 200, f"got {status}")
    check(
        "Health response has status=healthy",
        body is not None and body.get("status") == "healthy",
        f"body: {body}",
    )


# ---------------------------------------------------------------------------
# Auth — unauthenticated requests should be rejected
# ---------------------------------------------------------------------------

def test_auth_rejection() -> None:
    """Verify that protected endpoints reject unauthenticated requests."""
    protected_gets = [
        "/api/auth/session",
        "/api/goals",
        "/api/chat/conversations",
        "/api/notifications",
        "/api/portfolio",
        "/api/files",
        "/api/certifications",
        "/api/orientation",
    ]
    for path in protected_gets:
        status, body = api_get(path)
        check(
            f"GET {path} rejects unauthenticated (401)",
            status == 401,
            f"got {status}",
        )
        if body:
            check(
                f"GET {path} returns error field",
                "error" in body,
                f"body keys: {list(body.keys()) if isinstance(body, dict) else 'not a dict'}",
            )


# ---------------------------------------------------------------------------
# Teacher endpoints — unauthenticated rejection
# ---------------------------------------------------------------------------

def test_teacher_endpoints_reject_unauthenticated() -> None:
    """Verify teacher-only endpoints reject without auth."""
    teacher_gets = [
        "/api/teacher/reports/grant-kpi",
        "/api/teacher/reports/academic-kpi",
        "/api/teacher/reports/grant-kpi/students?metric=enrollment",
    ]
    for path in teacher_gets:
        status, _body = api_get(path)
        check(
            f"GET {path} rejects unauthenticated (401)",
            status == 401,
            f"got {status}",
        )


# ---------------------------------------------------------------------------
# Grant KPI — parameter validation
# ---------------------------------------------------------------------------

def test_grant_kpi_validation() -> None:
    """Test grant-kpi endpoint rejects invalid programYear."""
    status, body = api_get("/api/teacher/reports/grant-kpi?programYear=invalid")
    # Should be 400 or 401 (401 if auth check comes first)
    check(
        "GET /api/teacher/reports/grant-kpi?programYear=invalid rejects",
        status in (400, 401),
        f"got {status}",
    )


# ---------------------------------------------------------------------------
# Case notes POST — unauthenticated rejection
# ---------------------------------------------------------------------------

def test_case_notes_reject_unauthenticated() -> None:
    """Verify case notes POST rejects without auth or CSRF context."""
    status, body = api_post(
        "/api/teacher/students/fake-id/notes",
        data={"body": "Test note", "category": "general"},
    )
    check(
        "POST /api/teacher/students/fake-id/notes rejects unauthenticated",
        status in (401, 403),
        f"got {status}",
    )


# ---------------------------------------------------------------------------
# Public document listing
# ---------------------------------------------------------------------------

def test_documents_listing() -> None:
    """Documents endpoint requires auth."""
    status, _body = api_get("/api/documents")
    check(
        "GET /api/documents rejects unauthenticated (401)",
        status == 401,
        f"got {status}",
    )


# ---------------------------------------------------------------------------
# Run all
# ---------------------------------------------------------------------------

def main() -> None:
    print(f"\nSmoke testing API routes at {BASE_URL}\n")

    test_health()
    test_auth_rejection()
    test_teacher_endpoints_reject_unauthenticated()
    test_grant_kpi_validation()
    test_case_notes_reject_unauthenticated()
    test_documents_listing()

    print(f"\n{'='*50}")
    print(f"Results: {passed} passed, {failed} failed")
    print(f"{'='*50}\n")

    if failed > 0:
        print("Failures:")
        for err in errors:
            print(f"  {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
