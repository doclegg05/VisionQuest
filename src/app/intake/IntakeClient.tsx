"use client";

import { useId, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  GraduationCap,
  IdentificationCard,
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

  // Every control on this page needs a label it actually owns: /intake is
  // reached by QR code from a printed flyer, on a phone, by adults with low
  // literacy, and it is the enrollment front door.
  const firstNameId = useId();
  const lastNameId = useId();
  const birthDateId = useId();
  const countyId = useId();
  const phoneId = useId();
  const emailId = useId();
  const educationId = useId();
  const householdId = useId();
  const tanfId = useId();
  const notesId = useId();
  const signatureNameId = useId();
  const signatureHelpId = useId();
  const ferpaConsentId = useId();
  const policyConsentId = useId();
  const signatureConsentId = useId();
  const trackGroupId = useId();

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
  // Three separate, unchecked agreements. This packet authorizes disclosure of
  // a TANF participant's education records to DoHS, WorkForce WV and program
  // staff, so FERPA 34 CFR § 99.30 wants a signed, dated, affirmative consent —
  // never a box that arrives already ticked.
  const [ferpaConsent, setFerpaConsent] = useState(false);
  const [policyConsent, setPolicyConsent] = useState(false);
  const [signatureConsent, setSignatureConsent] = useState(false);

  // Status & Success state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // The public endpoint deliberately returns no account: no name, no username,
  // no password, and no indication of whether a matching record already existed.
  // Anything more would let an anonymous submitter confirm who is enrolled, and
  // the old screen printed a shared temporary password to whoever was standing
  // at the phone. All this screen holds is the acknowledgement text.
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const canSubmitEnrollment =
    signatureName.trim().length > 0 && ferpaConsent && policyConsent && signatureConsent;

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
    if (!ferpaConsent) {
      setErrorMessage("Please check the first box to allow SPOKES to share your records.");
      return;
    }
    if (!policyConsent) {
      setErrorMessage("Please check the second box to agree to the program rules.");
      return;
    }
    if (!signatureConsent) {
      setErrorMessage("Please check the last box to confirm this is your signature.");
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
            ferpaConsentSigned: ferpaConsent,
            policyAcknowledgmentSigned: policyConsent,
            legalAffirmationSigned: signatureConsent,
            signatureName: signatureName.trim(),
            signatureMethod: "typed_affirmation",
            // Signing time and source IP are recorded by the server. A form
            // cannot be trusted to timestamp its own audit trail.
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setErrorMessage(data.error || "Enrollment could not be completed. Please speak with your instructor.");
          return;
        }

        setSuccessMessage(
          typeof data.message === "string" && data.message.length > 0
            ? data.message
            : "Your form was sent. Your instructor will set up your account.",
        );
      } catch {
        setErrorMessage("Network error connecting to VisionQuest. Please try again.");
      }
    });
  };

  // --- Success State ---
  // An acknowledgement, not an account. Submitting this form no longer signs
  // anyone in and mints no password, so there is nothing here to copy down and
  // no portal to enter yet — an instructor sets the account up. The screen also
  // reads the same whether or not a matching record already existed, so it
  // cannot be used to check who is enrolled.
  if (successMessage) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[var(--background)] px-4 py-12">
        <div className="w-full max-w-xl rounded-3xl border border-[var(--border)] bg-[var(--surface-card)] p-8 shadow-xl">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
              <CheckCircle size={40} weight="fill" />
            </div>

            <h1 className="mt-4 font-display text-2xl font-bold text-[var(--ink-strong)] sm:text-3xl">
              Your form was sent
            </h1>

            <p className="mt-3 text-base text-[var(--ink-muted)]">{successMessage}</p>
          </div>

          <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-5">
            <p className="text-sm font-semibold text-[var(--ink-strong)]">What happens next</p>
            <ol className="mt-3 space-y-2.5 text-sm text-[var(--ink-muted)]">
              <li className="flex gap-2.5">
                <span className="font-semibold text-[var(--ink-strong)]">1.</span>
                <span>Your instructor checks your form.</span>
              </li>
              <li className="flex gap-2.5">
                <span className="font-semibold text-[var(--ink-strong)]">2.</span>
                <span>They set up your account and give you your sign-in details.</span>
              </li>
              <li className="flex gap-2.5">
                <span className="font-semibold text-[var(--ink-strong)]">3.</span>
                <span>You sign in and meet Sage, your coach.</span>
              </li>
            </ol>
            <p className="mt-4 text-sm text-[var(--ink-muted)]">
              Nothing else to do right now. If you have not heard back in a few days, ask your
              instructor.
            </p>
          </div>

          <div className="mt-6 text-center">
            <Link
              href="/login"
              className="inline-flex min-h-[44px] items-center justify-center px-4 text-sm font-semibold text-[var(--accent)] underline hover:text-[var(--ink-strong)]"
            >
              Already have an account? Sign in
            </Link>
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
        <div
          role="progressbar"
          aria-label={`Enrollment progress: step ${step} of 3`}
          aria-valuemin={1}
          aria-valuemax={3}
          aria-valuenow={step}
          className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]"
        >
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
                  <h1 className="font-display text-xl font-bold text-[var(--ink-strong)]">
                    About You
                  </h1>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Enter your identification details for state enrollment.
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor={firstNameId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Legal First Name *
                    </label>
                    <input
                      id={firstNameId}
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="First name"
                      className="field mt-1.5 w-full px-4 py-2.5 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor={lastNameId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Legal Last Name *
                    </label>
                    <input
                      id={lastNameId}
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
                    <label htmlFor={birthDateId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Date of Birth *
                    </label>
                    <input
                      id={birthDateId}
                      type="date"
                      required
                      value={birthDate}
                      onChange={(e) => setBirthDate(e.target.value)}
                      className="field mt-1.5 w-full px-4 py-2.5 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor={countyId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      West Virginia County *
                    </label>
                    <select
                      id={countyId}
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
                    <label htmlFor={phoneId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Phone Number *
                    </label>
                    <input
                      id={phoneId}
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(304) 555-0123"
                      className="field mt-1.5 w-full px-4 py-2.5 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor={emailId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Email Address (Optional)
                    </label>
                    <input
                      id={emailId}
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
                  <h1 className="font-display text-xl font-bold text-[var(--ink-strong)]">
                    Your Goals & Needs
                  </h1>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Tell us what career path interests you and how we can support you.
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-5">
                <div role="group" aria-labelledby={trackGroupId}>
                  <p id={trackGroupId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                    Career Pathway Interest
                  </p>
                  <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
                    {CAREER_TRACK_OPTIONS.map((track) => (
                      <button
                        key={track.id}
                        type="button"
                        aria-pressed={programTrack === track.id}
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
                    <label htmlFor={educationId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Highest Education Completed
                    </label>
                    <select
                      id={educationId}
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
                    <label htmlFor={householdId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Household Structure
                    </label>
                    <select
                      id={householdId}
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
                  <div className="flex items-center gap-3">
                    <input
                      id={tanfId}
                      type="checkbox"
                      checked={tanfStatus}
                      onChange={(e) => setTanfStatus(e.target.checked)}
                      className="h-4 w-4 shrink-0 rounded border-[var(--border)] text-[var(--accent)]"
                    />
                    <label htmlFor={tanfId} className="cursor-pointer">
                      <span className="block text-sm font-semibold text-[var(--ink-strong)]">
                        Receiving TANF / WV Works / DHHR Assistance
                      </span>
                      <span className="block text-xs text-[var(--ink-muted)]">
                        Check this box if referred through your local DHHR or WV Works office.
                      </span>
                    </label>
                  </div>
                </div>

                <div>
                  <label htmlFor={notesId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                    Schedule, Transportation, or Childcare Notes (Optional)
                  </label>
                  <textarea
                    id={notesId}
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
                  <h1 className="font-display text-xl font-bold text-[var(--ink-strong)]">
                    Agreements & Digital Signature
                  </h1>
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
                  <label
                    htmlFor={signatureNameId}
                    className="block text-xs font-semibold uppercase tracking-wider text-[var(--accent)]"
                  >
                    Official Electronic Signature (34 CFR § 99.30)
                  </label>
                  <p id={signatureHelpId} className="mt-1 text-xs text-[var(--ink-muted)]">
                    Type your full legal name below to sign your state intake packet:
                  </p>
                  <input
                    id={signatureNameId}
                    aria-describedby={signatureHelpId}
                    type="text"
                    required
                    value={signatureName}
                    onChange={(e) => setSignatureName(e.target.value)}
                    placeholder="e.g. Marcus D. Miller"
                    className="field mt-3 w-full px-4 py-3 text-base font-semibold text-[var(--ink-strong)]"
                  />

                  <p className="mt-4 text-xs font-semibold text-[var(--ink-strong)]">
                    Check all three boxes to finish. Nothing is checked for you.
                  </p>

                  <div className="mt-2 flex items-start gap-2.5">
                    <input
                      id={ferpaConsentId}
                      type="checkbox"
                      checked={ferpaConsent}
                      onChange={(e) => setFerpaConsent(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--border)] text-[var(--accent)]"
                    />
                    <label htmlFor={ferpaConsentId} className="cursor-pointer text-xs text-[var(--ink-strong)]">
                      I allow SPOKES to share my school records with the WV Department of Human
                      Services (DoHS / WV Works), WorkForce West Virginia, and my instructors. They
                      may use them to run the program and help me get support services.
                    </label>
                  </div>

                  <div className="mt-3 flex items-start gap-2.5">
                    <input
                      id={policyConsentId}
                      type="checkbox"
                      checked={policyConsent}
                      onChange={(e) => setPolicyConsent(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--border)] text-[var(--accent)]"
                    />
                    <label htmlFor={policyConsentId} className="cursor-pointer text-xs text-[var(--ink-strong)]">
                      I agree to the program rules above: come to class, take part in coaching, and
                      use the computers only for school and job work.
                    </label>
                  </div>

                  <div className="mt-3 flex items-start gap-2.5">
                    <input
                      id={signatureConsentId}
                      type="checkbox"
                      checked={signatureConsent}
                      onChange={(e) => setSignatureConsent(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--border)] text-[var(--accent)]"
                    />
                    <label htmlFor={signatureConsentId} className="cursor-pointer text-xs text-[var(--ink-strong)]">
                      The name I typed above is my legal signature, and everything I entered is
                      true.
                    </label>
                  </div>
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
                  disabled={isPending || !canSubmitEnrollment}
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
