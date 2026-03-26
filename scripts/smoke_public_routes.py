#!/usr/bin/env python

import json
import os
import sys
import time
from urllib.error import HTTPError
from urllib.request import urlopen
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("SMOKE_BASE_URL", "http://localhost:3000").rstrip("/")
ARTIFACT_DIR = Path(os.environ.get("SMOKE_ARTIFACT_DIR", "artifacts"))
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def verify_health() -> None:
    try:
        with urlopen(f"{BASE_URL}/api/health", timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise AssertionError(f"Health check returned {error.code}: {body}") from error

    expect(payload.get("status") == "healthy", f"Health check status was {payload.get('status')}.")
    expect(payload.get("db") == "connected", f"Health check DB state was {payload.get('db')}.")
    expect(payload.get("schema") == "ready", f"Health check schema state was {payload.get('schema')}.")


def goto_with_retry(page, url: str, attempts: int = 6) -> None:
    last_error = None
    for attempt in range(attempts):
        try:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_load_state("networkidle")
            return
        except Exception as error:
            last_error = error
            if attempt == attempts - 1:
                raise
            time.sleep(2)
    raise last_error  # pragma: no cover


def run() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1080})

        try:
            verify_health()
            goto_with_retry(page, f"{BASE_URL}/")

            expect(
                page.get_by_role("heading", name="Build momentum, one brave step at a time.").is_visible(),
                "Landing page hero heading did not render.",
            )
            expect(
                page.get_by_role("button", name="Sign In").first.is_visible(),
                "Sign-in tab is missing on the landing page.",
            )

            page.get_by_role("link", name="Forgot your password?").click()
            page.wait_for_url(f"{BASE_URL}/forgot-password")
            page.wait_for_load_state("networkidle")
            expect(
                page.get_by_role("heading", name="Reset your password").is_visible(),
                "Forgot password page did not load.",
            )

            goto_with_retry(page, f"{BASE_URL}/teacher-register")
            expect(
                page.get_by_role("heading", name="Teacher Registration").is_visible(),
                "Teacher registration page did not load.",
            )

            page.get_by_label("Teacher Key").fill("demo-key")
            page.get_by_label("Full Name").fill("Taylor Teacher")
            page.get_by_label("Email").fill("teacher@example.com")
            page.get_by_label("Password", exact=True).fill("password123")
            page.get_by_label("Confirm Password", exact=True).fill("mismatch123")
            page.get_by_role("button", name="Create Teacher Account").click()

            expect(
                page.get_by_text("Passwords do not match.").is_visible(),
                "Teacher registration mismatch validation did not appear.",
            )
        except (AssertionError, PlaywrightTimeoutError) as error:
            screenshot_path = ARTIFACT_DIR / "smoke-public-routes-failure.png"
            page.screenshot(path=str(screenshot_path), full_page=True)
            raise RuntimeError(f"{error} Screenshot: {screenshot_path}") from error
        finally:
            browser.close()


if __name__ == "__main__":
    try:
        run()
    except Exception as error:  # pragma: no cover - shell-facing error path
        print(str(error), file=sys.stderr)
        sys.exit(1)
