"use client";

import { useState, useTransition } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle,
  Sparkle,
  Copy,
  ArrowRight,
  ArrowLeft,
  FilePdf,
  ShieldCheck,
  GraduationCap,
  IdentificationCard,
  LockKey,
} from "@phosphor-icons/react";
import BrandLockup from "@/components/ui/BrandLockup";
import { WV_COUNTIES } from "@/lib/spokes/student-profile-form";
import { INTAKE_EDUCATIONAL_LEVELS, INTAKE_HOUSEHOLD_TYPES } from "@/lib/intake/schema";

const CAREER_TRACK_OPTIONS = [
  { id: "Healthcare / CNA", label: "Healthcare & CNA", icon: "🏥", desc: "Nursing assistant, phlebotomy, CPR certification" },
  { id: "Culinary / ServSafe", label: "Culinary Arts & Hospitality", icon: "🍳", desc: "Food preparation, ServSafe manager credentials" },
  { id: "Customer Service / IC3", label: "Customer Service & Digital Office", icon: "💻", desc: "IC3 digital literacy, office administration, retail" },
  { id: "Automotive & Logistics", label: "Automotive & Transportation", icon: "🚗", desc: "Vehicle maintenance, warehouse logistics, CDL pathway" },
  { id: "Building Trades & OSHA", label: "Building Trades & Construction", icon: "🔨", desc: "OSHA 10, safety compliance, carpentry & maintenance" },
  { id: "Career Discovery", label: "Exploring All Pathways", icon: "🌟", desc: "Work with Sage to discover the best career fit for you" },
];

export default function IntakeClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const prefilledClassId = searchParams.get("classId") || "";
  const prefilledCounty = searchParams.get("county") || "";

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isPending, startTransition] = useTransition();

  // Form Fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [county, setCounty] = useState(
    WV_COUNTIES.includes(prefilledCounty as (typeof WV_COUNTIES)[number]) ? prefilledCounty : "",
  );
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [programTrack, setProgramTrack] = useState("Healthcare / CNA");
  const [educationalLevel, setEducationalLevel] = useState<string>(INTAKE_EDUCATIONAL_LEVELS[2]);
  const [householdType, setHouseholdType] = useState<string>(INTAKE_HOUSEHOLD_TYPES[0]);
  const [tanfStatus, setTanfStatus] = useState(true);
  const [notes, setNotes] = useState("");

  const [signatureName, setSignatureName] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(true);

  // Status & Success state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<{
    displayName: string;
    studentId: string;
    temporaryPassword: string;
    className: string | null;
    pdfStorageKey: string | null;
  } | null>(null);

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2500);
    } catch {
      // Fallback
    }
  };

  const validateStep1 = () => {
    if (!firstName.trim() || !lastName.trim()) {
      setErrorMessage("Please enter your legal first and last name.");
      return false;
    }
    if (!birthDate) {
      setErrorMessage("Please provide your date of birth.");
      return false;
    }
    if (!county) {
      setErrorMessage("Please select your West Virginia county.");
      return false;
    }
    if (!phone.trim()) {
      setErrorMessage("Please provide a phone number where instructors can reach you.");
      return false;
    }
    setErrorMessage(null);
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signatureName.trim()) {
      setErrorMessage("Please type your full legal name in the signature box to complete enrollment.");
      return;
    }
    if (!consentConfirmed) {
      setErrorMessage("Please check the agreement box to acknowledge program policies.");
      return;
    }

    setErrorMessage(null);

    startTransition(async () => {
      try {
        const res = await fetch("/api/intake/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            birthDate,
            county,
            phone: phone.trim(),
            email: email.trim() || null,
            programTrack,
            educationalLevel,
            householdType,
            tanfStatus,
            notes: notes.trim() || null,
            classId: prefilledClassId || null,
            ferpaConsentSigned: true,
            policyAcknowledgmentSigned: true,
            signatureName: signatureName.trim(),
            signatureTimestamp: new Date().toISOString(),
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setErrorMessage(data.error || "Enrollment could not be completed. Please speak with your instructor.");
          return;
        }

        setSuccessResult({
          displayName: data.student.displayName,
          studentId: data.credentials.username,
          temporaryPassword: data.credentials.temporaryPassword,
          className: data.enrollment?.className || `${county} County SPOKES`,
          pdfStorageKey: data.orientation?.packetStorageKey || null,
        });
      } catch {
        setErrorMessage("Network error connecting to VisionQuest. Please try again.");
      }
    });
  };

  // --- Success State ---
  if (successResult) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[var(--background)] px-4 py-12">
        <div className="w-full max-w-xl rounded-3xl border border-[var(--border)] bg-[var(--surface-card)] p-8 shadow-xl">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
              <CheckCircle size={40} weight="fill" />
            </div>

            <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-700">
              <Sparkle size={14} weight="fill" /> Official Enrollment Confirmed
            </span>

            <h1 className="mt-2 font-display text-2xl font-bold text-[var(--ink-strong)] sm:text-3xl">
              Welcome to SPOKES, {successResult.displayName}!
            </h1>

            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Your account has been created, your state intake packet has been digitally signed and stamped, and your instructor has been notified.
            </p>
          </div>

          <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Your Day-One Sign-In Credentials
            </p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Save these details for logging into your VisionQuest portal on any device:
            </p>

            <div className="mt-4 space-y-3 font-mono text-sm">
              <div className="flex items-center justify-between rounded-xl bg-[var(--surface-card)] px-4 py-2.5 border border-[var(--border)]">
                <div>
                  <span className="text-xs font-sans text-[var(--ink-muted)]">Username: </span>
                  <span className="font-bold text-[var(--ink-strong)]">{successResult.studentId}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(successResult.studentId, "user")}
                  className="flex items-center gap-1 text-xs font-sans font-semibold text-[var(--accent)] hover:underline"
                >
                  <Copy size={14} /> {copiedKey === "user" ? "Copied!" : "Copy"}
                </button>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-[var(--surface-card)] px-4 py-2.5 border border-[var(--border)]">
                <div>
                  <span className="text-xs font-sans text-[var(--ink-muted)]">Initial Password: </span>
                  <span className="font-bold text-[var(--ink-strong)]">{successResult.temporaryPassword}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(successResult.temporaryPassword, "pass")}
                  className="flex items-center gap-1 text-xs font-sans font-semibold text-[var(--accent)] hover:underline"
                >
                  <Copy size={14} /> {copiedKey === "pass" ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="primary-button flex w-full items-center justify-center gap-2 py-3.5 text-base font-semibold"
            >
              Enter VisionQuest & Meet Sage <ArrowRight size={18} weight="bold" />
            </button>

            <div className="text-center">
              <Link
                href="/login"
                className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink-strong)] underline"
              >
                Go to standard sign-in page
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-6">
          <BrandLockup subtitle="SPOKES Workforce Portal" />
          <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--ink-muted)]">
            Step {step} of 3
          </span>
        </div>

        {/* Progress Bar */}
        <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]">
          <div
            className="h-full bg-[var(--accent)] transition-all duration-300"
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>

        {/* Error Alert */}
        {errorMessage ? (
          <div
            role="alert"
            className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
          >
            {errorMessage}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-6">
          {/* STEP 1: Personal & Contact */}
          {step === 1 && (
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-card)] p-6 shadow-sm sm:p-8">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-[var(--accent)]">
                  <IdentificationCard size={24} weight="bold" />
                </div>
                <div>
                  <h2 className="font-display text-xl font-bold text-[var(--ink-strong)]">
                    About You
                  </h2>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Enter your identification details for state enrollment.
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Legal First Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="First name"
                      className="field mt-1.5 w-full px-4 py-2.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Legal Last Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Last name"
                      className="field mt-1.5 w-full px-4 py-2.5 text-sm"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Date of Birth *
                    </label>
                    <input
                      type="date"
                      required
                      value={birthDate}
                      onChange={(e) => setBirthDate(e.target.value)}
                      className="field mt-1.5 w-full px-4 py-2.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      West Virginia County *
                    </label>
                    <select
                      required
                      value={county}
                      onChange={(e) => setCounty(e.target.value)}
                      className="field mt-1.5 w-full px-4 py-2.5 text-sm"
                    >
                      <option value="">Select your county</option>
                      {WV_COUNTIES.map((c) => (
                        <option key={c} value={c}>
                          {c} County
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Phone Number *
                    </label>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(304) 555-0123"
                      className="field mt-1.5 w-full px-4 py-2.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Email Address (Optional)
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="field mt-1.5 w-full px-4 py-2.5 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-8 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (validateStep1()) setStep(2);
                  }}
                  className="primary-button flex items-center gap-2 px-6 py-3 text-sm font-semibold"
                >
                  Continue to Goals <ArrowRight size={16} weight="bold" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Program & Career Goals */}
          {step === 2 && (
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-card)] p-6 shadow-sm sm:p-8">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-[var(--accent)]">
                  <GraduationCap size={24} weight="bold" />
                </div>
                <div>
                  <h2 className="font-display text-xl font-bold text-[var(--ink-strong)]">
                    Your Goals & Needs
                  </h2>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Tell us what career path interests you and how we can support you.
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-5">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                    Career Pathway Interest
                  </label>
                  <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
                    {CAREER_TRACK_OPTIONS.map((track) => (
                      <button
                        key={track.id}
                        type="button"
                        onClick={() => setProgramTrack(track.id)}
                        className={`flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-all ${
                          programTrack === track.id
                            ? "border-[var(--accent)] bg-[var(--surface-soft)] ring-2 ring-[var(--accent)]"
                            : "border-[var(--border)] hover:border-[var(--ink-muted)]"
                        }`}
                      >
                        <span className="text-2xl">{track.icon}</span>
                        <div>
                          <p className="text-sm font-bold text-[var(--ink-strong)]">
                            {track.label}
                          </p>
                          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                            {track.desc}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Highest Education Completed
                    </label>
                    <select
                      value={educationalLevel}
                      onChange={(e) => setEducationalLevel(e.target.value as (typeof INTAKE_EDUCATIONAL_LEVELS)[number])}
                      className="field mt-1.5 w-full px-4 py-2.5 text-sm"
                    >
                      {INTAKE_EDUCATIONAL_LEVELS.map((ed) => (
                        <option key={ed} value={ed}>
                          {ed}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Household Structure
                    </label>
                    <select
                      value={householdType}
                      onChange={(e) => setHouseholdType(e.target.value as (typeof INTAKE_HOUSEHOLD_TYPES)[number])}
                      className="field mt-1.5 w-full px-4 py-2.5 text-sm"
                    >
                      {INTAKE_HOUSEHOLD_TYPES.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tanfStatus}
                      onChange={(e) => setTanfStatus(e.target.checked)}
                      className="h-4 w-4 rounded border-[var(--border)] text-[var(--accent)]"
                    />
                    <div>
                      <p className="text-sm font-semibold text-[var(--ink-strong)]">
                        Receiving TANF / WV Works / DHHR Assistance
                      </p>
                      <p className="text-xs text-[var(--ink-muted)]">
                        Check this box if referred through your local DHHR or WV Works office.
                      </p>
                    </div>
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                    Schedule, Transportation, or Childcare Notes (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="E.g., Morning classes preferred, need bus pass info..."
                    className="field mt-1.5 w-full px-4 py-2.5 text-sm"
                  />
                </div>
              </div>

              <div className="mt-8 flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-muted)]"
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="primary-button flex items-center gap-2 px-6 py-3 text-sm font-semibold"
                >
                  Continue to Agreements <ArrowRight size={16} weight="bold" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Agreements & Electronic Signature */}
          {step === 3 && (
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-card)] p-6 shadow-sm sm:p-8">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-[var(--accent)]">
                  <ShieldCheck size={24} weight="bold" />
                </div>
                <div>
                  <h2 className="font-display text-xl font-bold text-[var(--ink-strong)]">
                    Agreements & Digital Signature
                  </h2>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Review statutory notices and electronically sign your state intake packet.
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-4 text-xs text-[var(--ink-muted)]">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                  <p className="font-bold text-[var(--ink-strong)] text-sm">
                    1. FERPA Disclosure & Release of Information
                  </p>
                  <p className="mt-1 leading-relaxed">
                    Under the Family Educational Rights and Privacy Act (FERPA, 34 CFR Part 99), you authorize the SPOKES program, West Virginia Department of Human Services (DoHS / WV Works), and WorkForce West Virginia to share your attendance, milestones, and credential progress solely for program administration and supportive services.
                  </p>
                </div>

                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                  <p className="font-bold text-[var(--ink-strong)] text-sm">
                    2. Program Attendance & Code of Conduct
                  </p>
                  <p className="mt-1 leading-relaxed">
                    You agree to attend scheduled classroom sessions, participate in goal coaching, maintain workplace readiness standards, and comply with computer and internet acceptable use policies.
                  </p>
                </div>

                {/* Electronic Signature Box */}
                <div className="rounded-2xl border-2 border-[var(--accent)] bg-[var(--surface-card)] p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                    Official Electronic Signature (34 CFR § 99.30)
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    Type your full legal name below to sign your state intake packet:
                  </p>
                  <input
                    type="text"
                    required
                    value={signatureName}
                    onChange={(e) => setSignatureName(e.target.value)}
                    placeholder="e.g. Marcus D. Miller"
                    className="field mt-3 w-full px-4 py-3 text-base font-semibold text-[var(--ink-strong)]"
                  />

                  <label className="mt-4 flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={consentConfirmed}
                      onChange={(e) => setConsentConfirmed(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-[var(--border)] text-[var(--accent)]"
                    />
                    <span className="text-xs text-[var(--ink-strong)]">
                      I verify that the information provided is accurate and that I agree to enroll in the SPOKES workforce development program.
                    </span>
                  </label>
                </div>
              </div>

              <div className="mt-8 flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-muted)]"
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="primary-button flex items-center gap-2 px-8 py-3.5 text-base font-semibold disabled:opacity-60"
                >
                  {isPending ? "Submitting Enrollment..." : "Complete Official Enrollment"}
                  <ArrowRight size={18} weight="bold" />
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </main>
  );
}
