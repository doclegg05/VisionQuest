"use client";

import { useEffect, useState } from "react";
import PageIntro from "@/components/ui/PageIntro";
import StaffMfaPanel from "@/components/auth/StaffMfaPanel";
import SecurityQuestionAnswerFields from "@/components/auth/SecurityQuestionAnswerFields";
import { createEmptySecurityQuestionAnswers } from "@/lib/security-questions";
import { ConsentSection } from "@/components/settings/ConsentSection";
import { WorkAvailabilitySection } from "@/components/settings/WorkAvailabilitySection";
import {
  SMS_CONSENT_CHECKBOX_LABEL,
  SMS_CONSENT_CONFIRM_HEADING,
  SMS_CONSENT_CONFIRM_NOTICE,
  SMS_CONSENT_HEADING,
  SMS_CONSENT_POINTS,
} from "@/lib/nudges/sms-policy-shared";

const PHONE_REGEX = /^\+?[1-9]\d{1,14}$/;

interface SettingsViewProps {
  /**
   * Role known on the server at render time. The (teacher) route passes it so
   * staff see the MFA panel on first paint instead of a flash of student-only
   * sections; the (student) route omits it and lets the session fetch below
   * resolve the role after mount, exactly as this page behaved before it was
   * shared between two route groups.
   */
  initialRole?: string | null;
}

/**
 * The settings surface, shared by /settings (the (student) route group) and
 * /teacher/settings (the (teacher) group). It must live outside both groups:
 * the (student) layout redirects every non-student role away, so a staff-only
 * section mounted there — StaffMfaPanel — is unreachable for the very roles
 * it exists for.
 */
/**
 * Is the "Text Messages" switch unavailable?
 *
 * Extracted so the rule is testable rather than buried in JSX, because getting
 * it wrong is invisible: the earlier version also admitted `consentChecked`,
 * so ticking the consent box made the switch look available while the API
 * still refused it — the student flipped it and got a server error. Ticking
 * the box is not the gate. Only a code that came back from the handset is
 * (`smsConsented`), and "Text me a code" is the one forward path.
 *
 * Turning the channel OFF is always allowed, whatever the state of consent.
 */
export function smsToggleDisabled(input: {
  smsEnabled: boolean;
  isStudentSurface: boolean;
  smsConsented: boolean;
}): boolean {
  if (input.smsEnabled) return false;
  return input.isStudentSurface && !input.smsConsented;
}

export function SettingsView({ initialRole = null }: SettingsViewProps = {}) {
  const [sessionRole, setSessionRole] = useState<string | null>(initialRole);
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [platformKeyConfigured, setPlatformKeyConfigured] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [showTutorial, setShowTutorial] = useState(true);

  const [securityQuestions, setSecurityQuestions] = useState(createEmptySecurityQuestionAnswers());
  const [recoveryConfigured, setRecoveryConfigured] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [recoveryError, setRecoveryError] = useState("");

  // Notification preferences state
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneError, setPhoneError] = useState("");
  // SMS consent is separate from the toggle: `smsEnabled` is a preference,
  // `smsConsented` is permission (see the SMS policy in src/lib/nudges).
  const [smsConsented, setSmsConsented] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  // The verify-by-code flow: send a 6-digit code to the number on file, then
  // confirm it. Consent is stamped by the server on confirm and nowhere else.
  const [verifyStep, setVerifyStep] = useState<"idle" | "sent">("idle");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  /**
   * The same predicate the other student-only sections use, so the consent
   * copy appears wherever ConsentSection and the work-availability intake do.
   * It defaults to true before the session resolves, which is the safe
   * direction here: showing the consent step to someone who turns out to be
   * staff costs a paragraph, hiding it from a student would let the toggle
   * sit permanently disabled with nothing explaining why.
   */
  const isStudentSurface = sessionRole !== "teacher" && sessionRole !== "admin";
  const [notifStatus, setNotifStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [notifError, setNotifError] = useState("");

  // Profile state (student-only)
  const [birthDate, setBirthDate] = useState("");
  const [savedBirthDate, setSavedBirthDate] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    async function loadSettings() {
      try {
        const [sessionRes, apiKeyRes, notifRes] = await Promise.all([
          fetch("/api/auth/session"),
          fetch("/api/settings/api-key"),
          fetch("/api/notifications/preferences"),
        ]);

        const [sessionData, apiKeyData, notifData] = await Promise.all([
          sessionRes.json(),
          apiKeyRes.json(),
          notifRes.json(),
        ]);

        const role = sessionData?.student?.role ?? initialRole ?? "student";
        setSessionRole(role);

        setHasKey(apiKeyData.hasKey);
        setKeyHint(apiKeyData.keyHint);
        setPlatformKeyConfigured(Boolean(apiKeyData.platformKeyConfigured));
        if (apiKeyData.hasKey || apiKeyData.platformKeyConfigured) setShowTutorial(false);

        if (notifData) {
          setEmailEnabled(Boolean(notifData.email?.enabled));
          setSmsEnabled(Boolean(notifData.sms?.enabled));
          setPhoneNumber(notifData.sms?.destination ?? "");
          setSmsConsented(Boolean(notifData.sms?.consented));
        }

        if (role !== "teacher" && role !== "admin") {
          const [recoveryRes, profileRes] = await Promise.all([
            fetch("/api/settings/security-questions"),
            fetch("/api/settings/profile"),
          ]);
          const recoveryData = await recoveryRes.json();
          if (recoveryRes.ok) {
            setRecoveryConfigured(Boolean(recoveryData.configured));
          }
          if (profileRes.ok) {
            const profileData = (await profileRes.json()) as { birthDate: string | null };
            setBirthDate(profileData.birthDate ?? "");
            setSavedBirthDate(profileData.birthDate);
          }
        }
      } catch {
        setErrorMsg("We could not load your current settings.");
      }
    }

    void loadSettings();
  }, [initialRole]);

  /**
   * Step 1 of consent: text a code to the number on file.
   *
   * The number is saved first, because the server sends to the row's
   * destination rather than to anything this request supplies — that is what
   * stops the endpoint being a way to text an arbitrary phone.
   */
  const sendPhoneCode = async () => {
    if (!PHONE_REGEX.test(phoneNumber)) {
      setPhoneError("Enter a valid phone number, e.g. +12125551234");
      return;
    }
    setVerifyBusy(true);
    setVerifyError("");
    try {
      await saveNotificationPreferences({ phone: phoneNumber });
      const res = await fetch("/api/notifications/preferences/verify-phone", {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setVerifyError(data.error ?? "We could not send a code. Try again.");
        return;
      }
      setVerifyStep("sent");
      setVerifyCode("");
    } catch {
      setVerifyError("We could not reach the server. Try again.");
    } finally {
      setVerifyBusy(false);
    }
  };

  /** Step 2: the code comes back, and the SERVER stamps consent. */
  const confirmPhoneCode = async () => {
    setVerifyBusy(true);
    setVerifyError("");
    try {
      const res = await fetch("/api/notifications/preferences/verify-phone/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: verifyCode }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setVerifyError(data.error ?? "That code is not right. Try again.");
        return;
      }
      setSmsConsented(true);
      setSmsEnabled(true);
      setConsentChecked(false);
      setVerifyStep("idle");
      setVerifyCode("");
    } catch {
      setVerifyError("We could not reach the server. Try again.");
    } finally {
      setVerifyBusy(false);
    }
  };

  const saveNotificationPreferences = async (
    overrides: { email?: boolean; sms?: boolean; phone?: string } = {},
  ) => {
    const resolvedEmail = overrides.email ?? emailEnabled;
    const resolvedSms = overrides.sms ?? smsEnabled;
    const resolvedPhone = overrides.phone ?? phoneNumber;

    // Every failure branch below puts the toggles back the way they were.
    // The switches are updated optimistically so they feel instant; leaving
    // one showing "on" after a save that failed tells the student they are
    // signed up for texts they will never get.
    const revert = () => {
      setEmailEnabled(emailEnabled);
      setSmsEnabled(smsEnabled);
    };

    if (resolvedSms && resolvedPhone && !PHONE_REGEX.test(resolvedPhone)) {
      setPhoneError("Enter a valid phone number, e.g. +12125551234");
      revert();
      return;
    }
    setPhoneError("");
    setNotifStatus("saving");
    setNotifError("");

    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: { enabled: resolvedEmail },
          sms: {
            enabled: resolvedSms,
            ...(resolvedPhone ? { phoneNumber: resolvedPhone } : {}),
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        revert();
        setNotifStatus("error");
        setNotifError(data.error ?? "Could not save notification preferences.");
        return;
      }

      // Consent is stamped only by the verify-code confirm, so turning the
      // channel OFF is the only thing this save can change about it.
      if (!resolvedSms) setSmsConsented(false);
      setNotifStatus("success");
      setTimeout(() => setNotifStatus("idle"), 3000);
    } catch {
      revert();
      setNotifStatus("error");
      setNotifError("Could not contact the server. Please try again.");
    }
  };

  const handleSave = async () => {
    setStatus("saving");
    setErrorMsg("");

    const res = await fetch("/api/settings/api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });

    const data = await res.json();
    if (res.ok) {
      setStatus("success");
      setTimeout(() => setStatus("idle"), 3000);
      setHasKey(true);
      setKeyHint("..." + apiKey.slice(-4));
      setApiKey("");
    } else {
      setStatus("error");
      setErrorMsg(data.error);
    }
  };

  const handleRemove = async () => {
    const res = await fetch("/api/settings/api-key", { method: "DELETE" });
    if (res.ok) {
      setHasKey(false);
      setKeyHint(null);
      setStatus("idle");
    }
  };

  const handleSaveBirthdate = async () => {
    setProfileStatus("saving");
    setProfileError("");

    try {
      const res = await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ birthDate: birthDate || null }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setProfileStatus("error");
        setProfileError(data.error || "We could not save your birthdate.");
        return;
      }

      const data = (await res.json()) as { birthDate: string | null };
      setSavedBirthDate(data.birthDate);
      setProfileStatus("success");
      setTimeout(() => setProfileStatus("idle"), 3000);
    } catch {
      setProfileStatus("error");
      setProfileError("We could not contact the server. Please try again.");
    }
  };

  const handleSaveRecovery = async () => {
    setRecoveryStatus("saving");
    setRecoveryError("");

    try {
      const res = await fetch("/api/settings/security-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ securityQuestions }),
      });

      const data = await res.json();
      if (!res.ok) {
        setRecoveryStatus("error");
        setRecoveryError(data.error || "We could not save your classroom recovery questions.");
        return;
      }

      setRecoveryConfigured(true);
      setRecoveryStatus("success");
      setSecurityQuestions(createEmptySecurityQuestionAnswers());
      setTimeout(() => setRecoveryStatus("idle"), 3000);
    } catch {
      setRecoveryStatus("error");
      setRecoveryError("We could not contact the server. Please try again.");
    }
  };

  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Configuration"
        title="Settings"
        description={
          sessionRole === "teacher" || sessionRole === "admin"
            ? "Manage staff account security and your personal Sage access."
            : "Manage Sage access and your classroom recovery questions for password resets."
        }
      />

      {(sessionRole === "teacher" || sessionRole === "admin") && (
        <div className="mb-6">
          <StaffMfaPanel />
        </div>
      )}

      {sessionRole !== "teacher" && sessionRole !== "admin" && (
        <div className="surface-section mb-6 p-6">
          <div className="mb-4">
            <p className="page-eyebrow text-[var(--ink-muted)]">Profile</p>
            <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">Personal info</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
              Your birthdate helps your teacher report your enrollment to DoHS.
              We only share it with SPOKES staff.
            </p>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <label
                htmlFor="birthdate-input"
                className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]"
              >
                Birthdate
              </label>
              <input
                id="birthdate-input"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="field w-full px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
            </div>
            <button
              type="button"
              onClick={handleSaveBirthdate}
              disabled={
                profileStatus === "saving" ||
                // Disable when there's nothing to save (empty + nothing stored,
                // or value equals what's already on file).
                (!birthDate && !savedBirthDate) ||
                birthDate === (savedBirthDate ?? "")
              }
              className="primary-button px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {profileStatus === "saving" ? "Saving..." : "Save"}
            </button>
          </div>

          <div className="mt-3 flex items-center gap-3">
            {profileStatus === "success" && (
              <p className="text-sm text-[var(--success)]">Birthdate saved.</p>
            )}
            {profileStatus === "error" && (
              <p className="text-sm text-[var(--error)]">{profileError}</p>
            )}
          </div>
        </div>
      )}

      {/* Match & Connect Phase 2: the form fallback for Sage's five-question
          work intake. Gated on the student role specifically, not on
          "not staff": /api/work-profile refuses every non-student, so a
          coordinator would have been shown a form whose Save button 403s. */}
      {sessionRole === "student" && <WorkAvailabilitySection />}

      {sessionRole !== "teacher" && sessionRole !== "admin" && (
      <div className="surface-section mb-6 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="page-eyebrow text-[var(--ink-muted)]">Classroom recovery</p>
            <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">
              Recovery questions
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
              This reset option is only for your classroom account. If you forget your password, answer these questions to choose a new one — no email needed.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
              recoveryConfigured
                ? "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]"
                : "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]"
            }`}
          >
            {recoveryConfigured ? "Configured" : "Not set up yet"}
          </span>
        </div>

        {recoveryConfigured && (
          <p className="mt-4 text-sm text-[var(--ink-muted)]">
            Updating these questions replaces your old answers. You will need to enter all three again to save.
          </p>
        )}

        <div className="mt-6">
          <SecurityQuestionAnswerFields
            answers={securityQuestions}
            onChange={setSecurityQuestions}
            idPrefix="settings-security-question"
            title="Save your three recovery answers"
            description="Keep the answers memorable but not obvious. Answers are stored as hashes, not plain text."
          />
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            onClick={handleSaveRecovery}
            disabled={recoveryStatus === "saving"}
            type="button"
            className="primary-button px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {recoveryStatus === "saving"
              ? "Saving..."
              : recoveryConfigured
                ? "Update recovery questions"
                : "Save recovery questions"}
          </button>

          {recoveryStatus === "success" && (
            <p className="text-sm text-[var(--success)]">Recovery questions saved.</p>
          )}
          {recoveryStatus === "error" && (
            <p className="text-sm text-[var(--error)]">{recoveryError}</p>
          )}
        </div>
      </div>
      )}

      {(hasKey || platformKeyConfigured) && (
        <div className="surface-section mb-6 flex items-center justify-between gap-4 p-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--success)]">Sage is active</p>
            <p className="mt-2 text-lg font-semibold text-[var(--ink-strong)]">
              {hasKey ? "Personal API key connected" : "Platform API key connected"}
            </p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {hasKey
                ? `Stored key ending in ${keyHint}`
                : "Students can chat with Sage without adding their own API key."}
            </p>
          </div>
          {hasKey && (
            <button
              onClick={handleRemove}
              type="button"
              className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
            >
              Remove key
            </button>
          )}
        </div>
      )}

      {/* Student-only: the consent copy describes chat-upload cloud processing,
          which `api/chat/upload` gates on role === "student". Staff flipping it
          would change nothing there while still affecting classify_attachment,
          so the control would promise more than it delivers. */}
      {sessionRole !== "teacher" && sessionRole !== "admin" && <ConsentSection />}

      {/* Student-only for the same reason, and student-owned in a stronger
          sense: this is the student's blanket permission to be introduced to
          employers. Turning it OFF withdraws every introduction that has not
          already ended (src/lib/consent.ts), which is why the copy says so
          rather than leaving them to find out. */}
      {sessionRole !== "teacher" && sessionRole !== "admin" && (
        <ConsentSection
          scope="employer_referral"
          eyebrow="Job introductions"
          title="Let your teacher introduce you to employers"
          description="When this is on, your teacher can ask you about sending your résumé to a real job."
          points={[
            "You see exactly what would be sent.",
            "Nothing goes out until you tap OK on that card.",
            "Turn it off and we take back any introduction that has not finished.",
            "You can change this any time.",
          ]}
        />
      )}

      <div className="surface-section p-6">
        <div className="mb-6">
          <button
            onClick={() => setShowTutorial(!showTutorial)}
            type="button"
            className="flex items-center gap-3 text-left"
          >
            <span
              className={[
                "grid h-9 w-9 place-items-center rounded-2xl",
                "bg-[var(--surface-muted)]",
                "text-[var(--ink-strong)]",
                "transition-transform",
                showTutorial ? "rotate-90" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              ▶
            </span>
            <div>
              <p className="page-eyebrow text-[var(--ink-muted)]">Quick guide</p>
              <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">How to get your API key</h2>
            </div>
          </button>
        </div>

        {showTutorial && (
          <div className="mb-8 grid gap-4 md:grid-cols-2">
            {[
              {
                step: "1",
                title: "Check the default setup",
                body: platformKeyConfigured
                  ? "Your program already configured Sage for everyone. You only need a personal key if you want to override it."
                  : "If your program has not set up Sage yet, add your own Gemini API key here.",
              },
              {
                step: "2",
                title: "Open Google AI Studio",
                body: "Go to aistudio.google.com/apikey and sign in with your Google account.",
              },
              {
                step: "3",
                title: "Create a key",
                body: "Choose “Create API key”. If prompted, create it in a new project.",
              },
              {
                step: "4",
                title: "Copy and save it",
                body: "Gemini keys usually start with AIza. Paste yours below, and we will check it before saving.",
              },
            ].map((item) => (
              <div key={item.step} className="rounded-[1.4rem] border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <div className="mb-3 flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-2xl bg-[var(--accent-strong)] text-sm font-bold text-white">
                    {item.step}
                  </span>
                  <h3 className="font-semibold text-[var(--ink-strong)]">{item.title}</h3>
                </div>
                <p className="text-sm leading-6 text-[var(--ink-muted)]">{item.body}</p>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-[1.4rem] border border-[var(--border)] bg-[var(--surface-raised)] p-5">
          {platformKeyConfigured && (
            <p className="mb-3 text-sm text-[var(--ink-muted)]">
              Your program already set up a Gemini key. Adding your own key here is optional, and it will replace the shared key for your account.
            </p>
          )}

          <label htmlFor="api-key" className="mb-2 block text-sm font-medium text-[var(--ink-strong)]">
            {hasKey
              ? "Update your personal API key"
              : platformKeyConfigured
                ? "Add a personal Gemini key (optional)"
                : "Enter your Gemini API key"}
          </label>
          <div className="flex flex-col gap-3 md:flex-row">
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setStatus("idle");
                setErrorMsg("");
              }}
              placeholder="AIza..."
              className="field flex-1 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
            />
            <button
              onClick={handleSave}
              disabled={!apiKey || status === "saving"}
              type="button"
              className="primary-button px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "saving" ? "Testing..." : hasKey ? "Update key" : "Save key"}
            </button>
          </div>

          {status === "success" && (
            <p className="mt-3 text-sm text-[var(--success)]">
              Key saved successfully. Sage is ready to chat.
            </p>
          )}
          {status === "error" && (
            <p className="mt-3 text-sm text-[var(--error)]">{errorMsg}</p>
          )}
        </div>
      </div>

      {/* Notification Preferences */}
      <div className="surface-section mt-6 p-6">
        <div className="mb-6">
          <p className="page-eyebrow text-[var(--ink-muted)]">Alerts &amp; reminders</p>
          <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">
            Notification Preferences
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
            Choose how you want to receive daily coaching prompts and reminders from Sage.
          </p>
        </div>

        <div className="divide-y divide-[var(--border)]">
          {/* Email toggle */}
          <div className="flex items-start justify-between gap-4 py-4">
            <div>
              <p className="text-sm font-semibold text-[var(--ink-strong)]">Email Notifications</p>
              <p className="mt-0.5 text-sm text-[var(--ink-muted)]">
                Receive daily coaching prompts and reminders by email
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={emailEnabled}
              onClick={() => {
                const next = !emailEnabled;
                setEmailEnabled(next);
                void saveNotificationPreferences({ email: next });
              }}
              // The visible track is 28x48; the BUTTON is the touch target, so
              // it carries the 44px minimum (the repo's touch-target rule) as
              // padding around an unchanged track.
              className="-m-2 inline-flex min-h-11 min-w-11 flex-shrink-0 cursor-pointer items-center justify-center rounded-full p-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)] focus:ring-offset-2"
            >
              <span
                className={`relative inline-flex h-7 w-12 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ${
                  emailEnabled ? "bg-[var(--accent-strong,#6d28d9)]" : "bg-[var(--surface-muted)]"
                }`}
              >
                <span
                  className={`inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    emailEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </span>
            </button>
          </div>

          {/* SMS toggle + phone field */}
          <div className="py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[var(--ink-strong)]">Text Messages</p>
                <p className="mt-0.5 text-sm text-[var(--ink-muted)]">
                  Get reminders and job news by text
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={smsEnabled}
                disabled={smsToggleDisabled({ smsEnabled, isStudentSurface, smsConsented })}
                onClick={() => {
                  const next = !smsEnabled;
                  setSmsEnabled(next);
                  void saveNotificationPreferences({ sms: next });
                }}
                className="-m-2 inline-flex min-h-11 min-w-11 flex-shrink-0 cursor-pointer items-center justify-center rounded-full p-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span
                  className={`relative inline-flex h-7 w-12 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ${
                    smsEnabled ? "bg-[var(--accent-strong,#6d28d9)]" : "bg-[var(--surface-muted)]"
                  }`}
                >
                  <span
                    className={`inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      smsEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </span>
              </button>
            </div>

            {isStudentSurface && !smsConsented && (
              <div className="mt-4 rounded-xl border border-[var(--border)] p-4">
                <p className="text-sm font-semibold text-[var(--ink-strong)]">
                  {smsEnabled ? SMS_CONSENT_CONFIRM_HEADING : SMS_CONSENT_HEADING}
                </p>
                {smsEnabled && (
                  // Nobody's consent was backfilled — a checkbox nobody ticked
                  // is not consent — so anyone who opted in before this shipped
                  // lands here and is asked once.
                  <p className="mt-2 text-sm text-[var(--ink-muted)]">
                    {SMS_CONSENT_CONFIRM_NOTICE}
                  </p>
                )}
                <ul className="mt-2 space-y-1.5 text-sm text-[var(--ink-muted)]">
                  {SMS_CONSENT_POINTS.map((point) => (
                    <li key={point} className="flex gap-2">
                      <span aria-hidden="true">&bull;</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                <label className="mt-4 flex min-h-11 items-center gap-3 text-sm text-[var(--ink-strong)]">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(event) => setConsentChecked(event.target.checked)}
                    className="h-5 w-5 flex-shrink-0"
                  />
                  <span>{SMS_CONSENT_CHECKBOX_LABEL}</span>
                </label>

                {/* Consent has its OWN save, separate from the toggles: a code
                    that comes back from the handset is what proves the number
                    belongs to the person ticking the box. */}
                {verifyStep === "idle" ? (
                  <button
                    type="button"
                    onClick={() => void sendPhoneCode()}
                    disabled={!consentChecked || !phoneNumber || verifyBusy}
                    className="primary-button mt-4 min-h-11 px-5 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {verifyBusy ? "Sending..." : "Text me a code"}
                  </button>
                ) : (
                  <div className="mt-4">
                    <label
                      htmlFor="sms-verify-code"
                      className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]"
                    >
                      Enter the 6-digit code we texted you
                    </label>
                    <div className="flex flex-col gap-3 md:flex-row">
                      <input
                        id="sms-verify-code"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={verifyCode}
                        onChange={(event) => {
                          setVerifyCode(event.target.value.replace(/\D/g, ""));
                          setVerifyError("");
                        }}
                        className="field min-h-11 flex-1 px-4 py-3 text-sm tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                      />
                      <button
                        type="button"
                        onClick={() => void confirmPhoneCode()}
                        disabled={verifyCode.length !== 6 || verifyBusy}
                        className="primary-button min-h-11 px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {verifyBusy ? "Checking..." : "Turn on texts"}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => void sendPhoneCode()}
                      disabled={verifyBusy}
                      className="mt-2 min-h-11 text-sm underline"
                    >
                      Send a new code
                    </button>
                  </div>
                )}
                {verifyError && (
                  <p className="mt-2 text-sm text-[var(--error)]">{verifyError}</p>
                )}
              </div>
            )}

            {smsEnabled && (
              <div className="mt-4">
                <label
                  htmlFor="phone-number"
                  className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]"
                >
                  Phone number
                </label>
                <div className="flex flex-col gap-3 md:flex-row">
                  <input
                    id="phone-number"
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => {
                      setPhoneNumber(e.target.value);
                      setPhoneError("");
                    }}
                    placeholder="+12125551234"
                    className="field flex-1 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                  />
                  <button
                    type="button"
                    onClick={() => void saveNotificationPreferences()}
                    disabled={!phoneNumber || notifStatus === "saving"}
                    className="primary-button px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {notifStatus === "saving" ? "Saving..." : "Save number"}
                  </button>
                </div>
                {phoneError && (
                  <p className="mt-1.5 text-xs text-[var(--error)]">{phoneError}</p>
                )}
                <p className="mt-1.5 text-xs text-[var(--ink-muted)]">
                  Standard messaging rates may apply. Use international format, e.g. +12125551234.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          {notifStatus === "success" && (
            <p className="text-sm text-[var(--success)]">Notification preferences saved.</p>
          )}
          {notifStatus === "error" && (
            <p className="text-sm text-[var(--error)]">{notifError}</p>
          )}
        </div>
      </div>

    </div>
  );
}
