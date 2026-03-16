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
    student_id = f"uat-{suffix}"
    display_name = f"UAT {suffix}"
    email = f"uat+{suffix}@example.com"
    password = f"VisionQuest!{suffix}"
    prompt = "Say hello and give me one short encouragement sentence."
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
            log("uat: open auth page")
            page.goto(BASE_URL, wait_until="domcontentloaded")
            page.wait_for_load_state("networkidle")

            log("uat: register user")
            page.get_by_role("button", name="Register").click()
            page.get_by_label("Student ID").fill(student_id)
            page.get_by_label("Your Name").fill(display_name)
            page.get_by_label("Email").fill(email)
            for label, answer in recovery_answers.items():
                page.get_by_label(label).fill(answer)
            page.get_by_label("Password").fill(password)
            page.get_by_role("button", name="Create Account").click()

            page.wait_for_url(f"{BASE_URL}/chat", wait_until="domcontentloaded")
            page.wait_for_load_state("networkidle")
            expect(page.get_by_text("Welcome to VisionQuest")).to_be_visible()

            log("uat: send chat message")
            page.get_by_label("Message to Sage").fill(prompt)
            page.get_by_role("button", name="Send message").click()

            assistant_messages = page.locator("[aria-label=\"Sage's message\"]")
            assistant_messages.first.wait_for(state="visible")
            page.wait_for_timeout(5_000)
            expect(assistant_messages.last).not_to_contain_text("Sage needs a Gemini API key")
            expect(assistant_messages.last).not_to_contain_text("Failed to send message")
            expect(assistant_messages.last).not_to_contain_text("Sorry, I had trouble responding")

            assistant_text = assistant_messages.last.inner_text().strip()
            if len(assistant_text) < 5:
                raise AssertionError("Assistant response was unexpectedly short.")

            log("uat: log out")
            page.locator("[aria-label=\"Log out\"]:visible").click()
            page.wait_for_url(BASE_URL + "/", wait_until="domcontentloaded")
            page.wait_for_load_state("networkidle")

            log("uat: log back in")
            page.get_by_label("Student ID").fill(student_id)
            page.get_by_label("Password").fill(password)
            page.locator("form[aria-label='Sign in'] button[type='submit']").click()

            page.wait_for_url(f"{BASE_URL}/chat", wait_until="domcontentloaded")
            page.wait_for_load_state("networkidle")
            expect(page.get_by_text(prompt)).to_be_visible()

            log("uat: success")
            print(f"uat_auth_chat_ok student_id={student_id}")
            print(f"assistant_response={assistant_text[:160]}")
            return 0
        except (AssertionError, PlaywrightTimeoutError) as error:
            try:
                page.screenshot(path="artifacts/uat-auth-chat-failure.png", full_page=True, timeout=5_000)
            except PlaywrightTimeoutError:
                pass
            print(f"uat_auth_chat_failed: {error}", file=sys.stderr)
            return 1
        finally:
            browser.close()


if __name__ == "__main__":
    raise SystemExit(main())
