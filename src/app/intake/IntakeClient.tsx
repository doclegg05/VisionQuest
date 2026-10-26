"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
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
import {
  INTAKE_EDUCATIONAL_LEVELS,
  INTAKE_HOUSEHOLD_TYPES,
  INTAKE_GENDERS,
  INTAKE_RACE_OPTIONS,
  INTAKE_ETHNICITY_OPTIONS,
  INTAKE_PRIMARY_LANGUAGES,
} from "@/lib/intake/schema";
import { demographicsForSubmit, validateIntakeStep1 } from "@/lib/intake/step-validation";

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
  const middleNameId = useId();
  const lastNameId = useId();
  const preferredNameId = useId();
  const birthDateId = useId();
  const countyId = useId();
  const streetAddressId = useId();
  const cityId = useId();
  const zipCodeId = useId();
  const phoneId = useId();
  const emailId = useId();
  const emergencyNameId = useId();
  const emergencyPhoneId = useId();
  const emergencyRelationId = useId();

  const wishNotToIdentifyId = useId();
  const genderId = useId();
  const raceId = useId();
  const ethnicityId = useId();
  const languageId = useId();

  const educationId = useId();
  const householdId = useId();
  const tanfId = useId();
  const caseNumberId = useId();
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
  // Only one step heading is rendered at a time, so one ref serves all three.
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const hasMountedRef = useRef(false);

  // Move focus to the new step's heading after Continue/Back. Skipped on first
  // mount so the page does not jump on load.
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    stepHeadingRef.current?.focus();
  }, [step]);
  const [isPending, startTransition] = useTransition();

  // Form Fields: Identity & Name
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [county, setCounty] = useState(
    WV_COUNTIES.includes(prefilledCounty as (typeof WV_COUNTIES)[number]) ? prefilledCounty : "",
  );

  // Form Fields: Residential Address
  const [streetAddress, setStreetAddress] = useState("");
  const [city, setCity] = useState("");
  const [zipCode, setZipCode] = useState("");

  // Form Fields: Contact & Emergency
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [emergencyContactRelation, setEmergencyContactRelation] = useState("");

  // Form Fields: Voluntary Demographics & Self-Identification
  const [wishNotToIdentify, setWishNotToIdentify] = useState(false);
  const [gender, setGender] = useState<string>("");
  const [race, setRace] = useState<string>("");
  const [ethnicity, setEthnicity] = useState<string>("");
  const [primaryLanguage, setPrimaryLanguage] = useState<string>("English");

  // Form Fields: Program & Assistance
  const [programTrack, setProgramTrack] = useState("Healthcare / CNA");
  const [educationalLevel, setEducationalLevel] = useState<string>(INTAKE_EDUCATIONAL_LEVELS[2]);
  const [householdType, setHouseholdType] = useState<string>(INTAKE_HOUSEHOLD_TYPES[0]);
  const [tanfStatus, setTanfStatus] = useState(true);
  const [caseNumber, setCaseNumber] = useState("");
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
    const message = validateIntakeStep1({ firstName, lastName, birthDate, county, phone, email });
    setErrorMessage(message);
    return message === null;
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
            middleName: middleName.trim() || null,
            lastName: lastName.trim(),
            preferredName: preferredName.trim() || null,
            birthDate,
            county,
            streetAddress: streetAddress.trim() || null,
            city: city.trim() || null,
            zipCode: zipCode.trim() || null,
            phone: phone.trim(),
            email: email.trim() || null,
            emergencyContactName: emergencyContactName.trim() || null,
            emergencyContactPhone: emergencyContactPhone.trim() || null,
            emergencyContactRelation: emergencyContactRelation.trim() || null,
            ...demographicsForSubmit({
              skip: wishNotToIdentify,
              gender,
              race,
              ethnicity,
              primaryLanguage,
            }),
            caseNumber: caseNumber.trim() || null,
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
          {/* STEP 1: Personal, Address & Contact Details */}
          {step === 1 && (
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-card)] p-6 shadow-sm sm:p-8">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-[var(--accent)]">
                  <IdentificationCard size={24} weight="bold" />
                </div>
                <div>
                  <h1
                    ref={stepHeadingRef}
                    tabIndex={-1}
                    className="font-display text-xl font-bold text-[var(--ink-strong)]"
                  >
                    About You & Your Location
                  </h1>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Enter your legal identity, residential address, and contact details for official state enrollment.
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                {/* Legal Name Section */}
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="sm:col-span-2">
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
                    <label htmlFor={middleNameId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Middle Initial
                    </label>
                    <input
                      id={middleNameId}
                      type="text"
                      value={middleName}
                      onChange={(e) => setMiddleName(e.target.value)}
                      placeholder="M.I."
                      className="field mt-1.5 w-full px-4 py-2.5 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor={preferredNameId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Preferred Name
                    </label>
                    <input
                      id={preferredNameId}
                      type="text"
                      value={preferredName}
                      onChange={(e) => setPreferredName(e.target.value)}
                      placeholder="Nickname"
                      className="field mt-1.5 w-full px-4 py-2.5 text-sm"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
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
                </div>

                {/* Residential Address Block */}
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 space-y-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-strong)]">
                    Residential Address (West Virginia)
                  </p>
                  <div>
                    <label htmlFor={streetAddressId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Street Address (Physical or Mailing)
                    </label>
                    <input
                      id={streetAddressId}
                      type="text"
                      value={streetAddress}
                      onChange={(e) => setStreetAddress(e.target.value)}
                      placeholder="e.g. 124 Main Street, Apt 3B"
                      className="field mt-1.5 w-full px-4 py-2.5 text-sm bg-[var(--surface-card)]"
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label htmlFor={cityId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                        City / Town
                      </label>
                      <input
                        id={cityId}
                        type="text"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="e.g. Summersville"
                        className="field mt-1.5 w-full px-4 py-2.5 text-sm bg-[var(--surface-card)]"
                      />
                    </div>
                    <div>
                      <label htmlFor={countyId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                        WV County *
                      </label>
                      <select
                        id={countyId}
                        required
                        value={county}
                        onChange={(e) => setCounty(e.target.value)}
                        className="field mt-1.5 w-full px-4 py-2.5 text-sm bg-[var(--surface-card)]"
                      >
                        <option value="">Select county</option>
                        {WV_COUNTIES.map((c) => (
                          <option key={c} value={c}>
                            {c} County
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={zipCodeId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                        ZIP Code
                      </label>
                      <input
                        id={zipCodeId}
                        type="text"
                        value={zipCode}
                        onChange={(e) => setZipCode(e.target.value)}
                        placeholder="26651"
                        maxLength={10}
                        className="field mt-1.5 w-full px-4 py-2.5 text-sm bg-[var(--surface-card)]"
                      />
                    </div>
                  </div>
                </div>

                {/* Primary Contact Details */}
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

                {/* Emergency Contact */}
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 space-y-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-strong)]">
                    Emergency Contact (Optional)
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label htmlFor={emergencyNameId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                        Contact Name
                      </label>
                      <input
                        id={emergencyNameId}
                        type="text"
                        value={emergencyContactName}
                        onChange={(e) => setEmergencyContactName(e.target.value)}
                        placeholder="Name of contact"
                        className="field mt-1.5 w-full px-4 py-2.5 text-sm bg-[var(--surface-card)]"
                      />
                    </div>
                    <div>
                      <label htmlFor={emergencyPhoneId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                        Phone Number
                      </label>
                      <input
                        id={emergencyPhoneId}
                        type="tel"
                        value={emergencyContactPhone}
                        onChange={(e) => setEmergencyContactPhone(e.target.value)}
                        placeholder="(304) 555-0199"
                        className="field mt-1.5 w-full px-4 py-2.5 text-sm bg-[var(--surface-card)]"
                      />
                    </div>
                    <div>
                      <label htmlFor={emergencyRelationId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                        Relationship
                      </label>
                      <input
                        id={emergencyRelationId}
                        type="text"
                        value={emergencyContactRelation}
                        onChange={(e) => setEmergencyContactRelation(e.target.value)}
                        placeholder="e.g. Spouse, Parent"
                        className="field mt-1.5 w-full px-4 py-2.5 text-sm bg-[var(--surface-card)]"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-8 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (validateStep1()) setStep(2);
                  }}
                  className="primary-button flex items-center gap-2 px-6 py-3 text-sm font-semibold cursor-pointer"
                >
                  Continue to Demographics & Goals <ArrowRight size={16} weight="bold" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Demographics, Program & Career Goals */}
          {step === 2 && (
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-card)] p-6 shadow-sm sm:p-8">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-[var(--accent)]">
                  <GraduationCap size={24} weight="bold" />
                </div>
                <div>
                  <h1
                    ref={stepHeadingRef}
                    tabIndex={-1}
                    className="font-display text-xl font-bold text-[var(--ink-strong)]"
                  >
                    Demographics & Goals
                  </h1>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Voluntary self-identification, household background, and career pathway options.
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-5">
                {/* Voluntary Self-Identification Card */}
                <div className="rounded-2xl border-2 border-[var(--border)] bg-[var(--surface-soft)] p-4">
                  <div className="flex items-start gap-3">
                    <input
                      id={wishNotToIdentifyId}
                      type="checkbox"
                      checked={wishNotToIdentify}
                      onChange={(e) => setWishNotToIdentify(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--border)] text-[var(--accent)]"
                    />
                    <div>
                      <label htmlFor={wishNotToIdentifyId} className="cursor-pointer text-sm font-bold text-[var(--ink-strong)]">
                        I wish not to identify (Skip demographic questions)
                      </label>
                      <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                        Federal workforce development (WIOA Title II) encourages voluntary self-identification to evaluate program equity. Checking this records &quot;Prefer not to say&quot; for official reporting.
                      </p>
                    </div>
                  </div>

                  {!wishNotToIdentify && (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2 pt-3 border-t border-[var(--border)]">
                      <div>
                        <label htmlFor={genderId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                          Self-Identified Gender
                        </label>
                        <select
                          id={genderId}
                          value={gender}
                          onChange={(e) => setGender(e.target.value)}
                          className="field mt-1.5 w-full px-4 py-2.5 text-sm bg-[var(--surface-card)]"
                        >
                          <option value="">Select gender...</option>
                          {INTAKE_GENDERS.map((g) => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label htmlFor={raceId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                          Race Self-Identification
                        </label>
                        <select
                          id={raceId}
                          value={race}
                          onChange={(e) => setRace(e.target.value)}
                          className="field mt-1.5 w-full px-4 py-2.5 text-sm bg-[var(--surface-card)]"
                        >
                          <option value="">Select race...</option>
                          {INTAKE_RACE_OPTIONS.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label htmlFor={ethnicityId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                          Ethnicity
                        </label>
                        <select
                          id={ethnicityId}
                          value={ethnicity}
                          onChange={(e) => setEthnicity(e.target.value)}
                          className="field mt-1.5 w-full px-4 py-2.5 text-sm bg-[var(--surface-card)]"
                        >
                          <option value="">Select ethnicity...</option>
                          {INTAKE_ETHNICITY_OPTIONS.map((eth) => (
                            <option key={eth} value={eth}>{eth}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label htmlFor={languageId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                          Primary Language
                        </label>
                        <select
                          id={languageId}
                          value={primaryLanguage}
                          onChange={(e) => setPrimaryLanguage(e.target.value)}
                          className="field mt-1.5 w-full px-4 py-2.5 text-sm bg-[var(--surface-card)]"
                        >
                          {INTAKE_PRIMARY_LANGUAGES.map((lang) => (
                            <option key={lang} value={lang}>{lang}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

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
                      {INTAKE_HOUSEHOLD_TYPES.map((hh) => (
                        <option key={hh} value={hh}>
                          {hh}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <input
                      id={tanfId}
                      type="checkbox"
                      checked={tanfStatus}
                      onChange={(e) => setTanfStatus(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--border)] text-[var(--accent)]"
                    />
                    <div>
                      <label htmlFor={tanfId} className="cursor-pointer text-sm font-semibold text-[var(--ink-strong)]">
                        Receiving TANF / WV Works / DHHR Assistance
                      </label>
                      <span className="block text-xs text-[var(--ink-muted)]">
                        Check this box if referred through your local DHHR or WV Works office.
                      </span>
                    </div>
                  </div>

                  {tanfStatus && (
                    <div className="pt-2">
                      <label htmlFor={caseNumberId} className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                        TANF / DHHR Case # (Optional)
                      </label>
                      <input
                        id={caseNumberId}
                        type="text"
                        value={caseNumber}
                        onChange={(e) => setCaseNumber(e.target.value)}
                        placeholder="e.g. 10293847"
                        className="field mt-1.5 w-full px-4 py-2.5 text-sm bg-[var(--surface-card)]"
                      />
                    </div>
                  )}
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
                  <h1
                    ref={stepHeadingRef}
                    tabIndex={-1}
                    className="font-display text-xl font-bold text-[var(--ink-strong)]"
                  >
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
