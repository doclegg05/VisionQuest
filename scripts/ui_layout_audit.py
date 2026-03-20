#!/usr/bin/env python

import json
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("SMOKE_BASE_URL", "http://localhost:3000").rstrip("/")
ARTIFACT_DIR = Path(os.environ.get("SMOKE_ARTIFACT_DIR", "artifacts/ui-audit"))
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

VIEWPORTS = {
    "mobile": {"width": 390, "height": 844},
    "desktop": {"width": 1440, "height": 1100},
}

PUBLIC_SWEEP = [
    ("public_home", "/", ("mobile", "desktop")),
    ("forgot_password", "/forgot-password", ("mobile",)),
    ("teacher_register", "/teacher-register", ("mobile", "desktop")),
]

STUDENT_SWEEP = [
    ("student_dashboard", "/dashboard", ("mobile", "desktop")),
    ("student_goals", "/goals", ("mobile", "desktop")),
    ("student_resources", "/resources", ("desktop",)),
    ("student_courses", "/courses", ("desktop",)),
    ("student_appointments", "/appointments", ("desktop",)),
    ("student_opportunities", "/opportunities", ("desktop",)),
    ("student_orientation", "/orientation", ("desktop",)),
    ("student_vision_board", "/vision-board", ("desktop",)),
]

TEACHER_SWEEP = [
    ("teacher_dashboard", "/teacher", ("desktop",)),
    ("teacher_manage", "/teacher/manage", ("desktop",)),
]

WAIT_SELECTORS = {
    "student_dashboard": "text=Choose your next step",
    "student_goals": "text=Big Hairy Audacious Goal",
    "student_resources": "text=Recommended for your active goals",
    "student_courses": "text=Recommended for your active goals",
    "student_appointments": "text=Book Advising Time",
    "student_opportunities": "text=Open now",
    "student_orientation": "text=Orientation status",
    "student_vision_board": "text=Creative workspace",
    "teacher_dashboard": "text=Search students",
    "teacher_manage": "text=Orientation content",
}


def unique_suffix() -> str:
    return str(int(time.time() * 1000))[-8:]


def goto(page, path: str) -> None:
    page.goto(f"{BASE_URL}{path}", wait_until="domcontentloaded")
    page.wait_for_load_state("load")
    page.wait_for_timeout(1200)


def fetch_json(page, path: str, payload: dict) -> dict:
    return page.evaluate(
        """async ({ path, payload }) => {
            const response = await fetch(path, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            const body = await response.json().catch(() => null);
            return { status: response.status, body };
        }""",
        {"path": path, "payload": payload},
    )


def create_student(context, suffix: str) -> None:
    page = context.new_page()
    goto(page, "/")
    payload = {
        "studentId": f"layout.audit.{suffix}",
        "displayName": "Alexandria Montgomery-Santiago",
        "email": f"layout-audit-student-{suffix}@example.com",
        "password": "password123",
        "securityQuestions": {
            "birth_city": "Charleston",
            "elementary_school": "Mountain View",
            "favorite_teacher": "Rivera",
        },
    }
    result = fetch_json(page, "/api/auth/register", payload)
    if result["status"] != 200:
        raise RuntimeError(f"Student registration failed: {result}")

    for goal in [
        {
            "level": "bhag",
            "content": "Launch a stable healthcare administration career while building long-term financial independence for my family.",
            "status": "active",
        },
        {
            "level": "monthly",
            "content": "Finish onboarding paperwork, book advising, and complete my first certification plan without losing momentum.",
            "status": "active",
        },
        {
            "level": "weekly",
            "content": "Submit every required SPOKES form and confirm my next advising appointment before Friday afternoon.",
            "status": "in_progress",
        },
    ]:
        goal_result = fetch_json(page, "/api/goals", goal)
        if goal_result["status"] not in (200, 201):
            raise RuntimeError(f"Goal creation failed: {goal_result}")

    page.close()


def create_teacher(context, suffix: str) -> None:
    teacher_key = (os.environ.get("TEACHER_KEY") or "").strip().strip("'\"")
    if not teacher_key:
        raise RuntimeError("TEACHER_KEY is not available for the layout audit.")

    page = context.new_page()
    goto(page, "/teacher-register")
    payload = {
        "teacherKey": teacher_key,
        "displayName": "Maribel Thompson-Henderson",
        "email": f"layout-audit-teacher-{suffix}@example.com",
        "password": "password123",
    }
    result = fetch_json(page, "/api/auth/register-teacher", payload)
    if result["status"] != 200:
        raise RuntimeError(f"Teacher registration failed: {result}")
    page.close()


def analyze_layout(page) -> dict:
    return page.evaluate(
        """() => {
          const pageOverflowX = Math.max(
            0,
            document.documentElement.scrollWidth - window.innerWidth,
          );

          const selectors = [];
          const offenders = [];
          const elements = Array.from(document.body.querySelectorAll("*"));

          for (const element of elements) {
            const style = window.getComputedStyle(element);
            if (style.display === "none" || style.visibility === "hidden") continue;
            if (element.closest(".overflow-x-auto")) continue;
            if (element.closest("[data-allow-layout-overflow]")) continue;
            if (element.closest(".page-hero")) continue;

            const rect = element.getBoundingClientRect();
            if (rect.width < 40 || rect.height < 18) continue;

            const text = (element.textContent || "").replace(/\\s+/g, " ").trim();
            if (text.length < 16) continue;

            const overflowsViewport =
              rect.right > window.innerWidth + 3 || rect.left < -3;

            const clipsText =
              !element.className.toString().includes("line-clamp")
              && !element.className.toString().includes("truncate")
              && (
                element.scrollWidth - element.clientWidth > 12
                || element.scrollHeight - element.clientHeight > 12
              )
              && (
                ["hidden", "clip"].includes(style.overflowX)
                || ["hidden", "clip"].includes(style.overflowY)
              );

            if (!overflowsViewport && !clipsText) continue;

            const className = typeof element.className === "string" ? element.className : "";
            const selector = [element.tagName.toLowerCase(), className.split(" ").filter(Boolean).slice(0, 2).join(".")]
              .filter(Boolean)
              .join(".");

            if (selectors.includes(selector)) continue;
            selectors.push(selector);

            offenders.push({
              selector,
              text: text.slice(0, 140),
              overflowsViewport,
              clipsText,
            });
          }

          return {
            title: document.title,
            viewportWidth: window.innerWidth,
            pageOverflowX,
            offenders: offenders.slice(0, 12),
          };
        }"""
    )


def capture_page(browser, storage_state: Path | None, slug: str, path: str, viewport_name: str) -> dict:
    context_kwargs = {
        "viewport": VIEWPORTS[viewport_name],
        "ignore_https_errors": True,
    }
    if storage_state:
        context_kwargs["storage_state"] = str(storage_state)

    context = browser.new_context(**context_kwargs)
    context.add_init_script(
        """() => {
          class AuditEventSource {
            readyState = 0;
            url = "";
            withCredentials = false;
            onopen = null;
            onmessage = null;
            onerror = null;

            constructor(url) {
              this.url = String(url || "");
            }

            addEventListener() {}
            removeEventListener() {}
            dispatchEvent() { return false; }
            close() {
              this.readyState = 2;
            }
          }

          window.EventSource = AuditEventSource;
        }"""
    )
    page = context.new_page()
    console_messages = []

    def on_console(msg) -> None:
        if msg.type in ("error", "warning"):
            console_messages.append({"type": msg.type, "text": msg.text})

    page.on("console", on_console)
    page.on("pageerror", lambda error: console_messages.append({"type": "pageerror", "text": str(error)}))

    goto(page, path)
    wait_selector = WAIT_SELECTORS.get(slug)
    if wait_selector:
        page.wait_for_selector(wait_selector, timeout=30_000)
        page.wait_for_timeout(400)
    analysis = analyze_layout(page)
    screenshot_path = ARTIFACT_DIR / f"{slug}_{viewport_name}.png"
    page.screenshot(path=str(screenshot_path), full_page=True)
    context.close()

    return {
        "slug": slug,
        "path": path,
        "viewport": viewport_name,
        "screenshot": str(screenshot_path),
        "analysis": analysis,
        "console": console_messages[:20],
    }


def run() -> None:
    suffix = unique_suffix()
    report = {
        "baseUrl": BASE_URL,
        "artifacts": str(ARTIFACT_DIR),
        "runs": [],
    }

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            public_context = browser.new_context(viewport=VIEWPORTS["desktop"], ignore_https_errors=True)
            public_page = public_context.new_page()
            goto(public_page, "/")
            public_context.close()

            student_context = browser.new_context(viewport=VIEWPORTS["desktop"], ignore_https_errors=True)
            create_student(student_context, suffix)
            student_state = ARTIFACT_DIR / f"student_state_{suffix}.json"
            student_context.storage_state(path=str(student_state))
            student_context.close()

            teacher_context = browser.new_context(viewport=VIEWPORTS["desktop"], ignore_https_errors=True)
            create_teacher(teacher_context, suffix)
            teacher_state = ARTIFACT_DIR / f"teacher_state_{suffix}.json"
            teacher_context.storage_state(path=str(teacher_state))
            teacher_context.close()

            for slug, path, viewports in PUBLIC_SWEEP:
                for viewport_name in viewports:
                    report["runs"].append(capture_page(browser, None, slug, path, viewport_name))

            for slug, path, viewports in STUDENT_SWEEP:
                for viewport_name in viewports:
                    report["runs"].append(capture_page(browser, student_state, slug, path, viewport_name))

            for slug, path, viewports in TEACHER_SWEEP:
                for viewport_name in viewports:
                    report["runs"].append(capture_page(browser, teacher_state, slug, path, viewport_name))
        except (AssertionError, PlaywrightTimeoutError) as error:
            raise RuntimeError(str(error)) from error
        finally:
            browser.close()

    report_path = ARTIFACT_DIR / "layout_audit_report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(str(report_path))


if __name__ == "__main__":
    try:
        run()
    except Exception as error:  # pragma: no cover - shell-facing error path
        print(str(error), file=sys.stderr)
        sys.exit(1)
