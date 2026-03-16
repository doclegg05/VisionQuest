from __future__ import annotations

import os
import random
import string
import sys
import time

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import expect, sync_playwright


BASE_URL = os.environ.get("SMOKE_BASE_URL", "http://localhost:3000").rstrip("/")


def unique_suffix() -> str:
    stamp = int(time.time())
    token = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return f"{stamp}-{token}"


def log(message: str) -> None:
    print(message, flush=True)


def main() -> int:
    suffix = unique_suffix()
    student_id = f"reset-{suffix}"
    display_name = f"Reset {suffix}"
    email = f"reset+{suffix}@example.com"
    original_password = f"VisionQuest!{suffix}"
    new_password = f"VisionQuestReset!{suffix}"
    recovery_answers = {
        "What city were you born in?": "Cleveland",
        "What was the name of your elementary school?": "Lincoln",
        "What is the first name of a favorite teacher?": "Jones",
    }

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_default_timeout(60_000)

        try:
            log("reset-uat: register user")
            page.goto(BASE_URL, wait_until="domcontentloaded")
            page.wait_for_load_state("networkidle")
            page.get_by_role("button", name="Register").click()
            page.get_by_label("Student ID").fill(student_id)
            page.get_by_label("Your Name").fill(display_name)
            page.get_by_label("Email").fill(email)
            for label, answer in recovery_answers.items():
                page.get_by_label(label).fill(answer)
            page.get_by_label("Password").fill(original_password)
            page.get_by_role("button", name="Create Account").click()
            page.wait_for_url(f"{BASE_URL}/chat", wait_until="domcontentloaded")

            log("reset-uat: log out")
            page.locator("[aria-label=\"Log out\"]:visible").click()
            page.wait_for_url(BASE_URL + "/", wait_until="domcontentloaded")

            log("reset-uat: reset via classroom questions")
            page.goto(f"{BASE_URL}/forgot-password", wait_until="domcontentloaded")
            page.wait_for_load_state("networkidle")
            page.get_by_label("Email or Student ID").fill(student_id)
            for label, answer in recovery_answers.items():
                page.get_by_label(label).fill(answer)
            page.locator("#new-password").fill(new_password)
            page.locator("#confirm-password").fill(new_password)
            page.get_by_role("button", name="Reset with classroom questions").click()
            page.wait_for_url(f"{BASE_URL}/chat", wait_until="domcontentloaded")

            log("reset-uat: log out again")
            page.locator("[aria-label=\"Log out\"]:visible").click()
            page.wait_for_url(BASE_URL + "/", wait_until="domcontentloaded")

            log("reset-uat: log in with new password")
            page.get_by_label("Student ID").fill(student_id)
            page.get_by_label("Password").fill(new_password)
            page.locator("form[aria-label='Sign in'] button[type='submit']").click()
            page.wait_for_url(f"{BASE_URL}/chat", wait_until="domcontentloaded")
            expect(page.get_by_text("Welcome to VisionQuest")).to_be_visible()

            log("reset-uat: success")
            print(f"uat_security_question_reset_ok student_id={student_id}")
            return 0
        except (AssertionError, PlaywrightTimeoutError) as error:
            try:
                page.screenshot(
                    path="artifacts/uat-security-question-reset-failure.png",
                    full_page=True,
                    timeout=5_000,
                )
            except PlaywrightTimeoutError:
                pass
            print(f"uat_security_question_reset_failed: {error}", file=sys.stderr)
            return 1
        finally:
            browser.close()


if __name__ == "__main__":
    raise SystemExit(main())
