#!/usr/bin/env node
// =============================================================================
// Generate the synthetic benchmark cohort.
//
// Writes `config/benchmarks/synthetic-cohort/*.json`. The OUTPUT is the
// fixture — it is committed, reviewed and checksummed — and this script is the
// record of how it was made. Regenerating on any machine reproduces the
// committed bytes: every draw comes from a named, seeded stream
// (scripts/bench/lib/prng.mjs) and every timestamp is derived from one fixed
// epoch, never from `Date.now()`.
//
//   node scripts/bench/generate-cohort.mjs           # write the files
//   node scripts/bench/generate-cohort.mjs --check   # fail if they would change
//
// Why a cohort at all: matching quality, hard blocks, packet privacy, report
// parity, the Connect journey, the nudge invariants, the performance suites
// and the journey timings all need the same 50 students, or their numbers
// cannot be compared with each other. See the README this script writes.
//
// Three properties are load-bearing and are asserted before anything is
// written, because a fixture that quietly loses one turns a real regression
// into a passing benchmark:
//
//   1. Exactly as many connections reach `hired` or beyond as there are
//      SpokesRecords carrying `unsubsidizedEmploymentAt`, and they are the same
//      students — that identity IS the report-parity benchmark.
//   2. The three walk shapes the funnel is measured on all exist: a
//      sent→viewed→hired skip, a sent→hired direct hire, and a rolled-back send.
//   3. The fixture contains the rows every hard-block code needs to fire on (a
//      non-open lead, a do_not_contact employer), so `hard-blocks` measures all
//      seven codes rather than the four that happen to be easy.
//
// The one property this file cannot check — that every student has at least
// three unblocked, visible leads, so precision@3 has three slots to fill —
// lives in `scripts/bench/generate-matching-labels.mjs`, which is where the
// blocks are actually derived.
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRng } from "./lib/prng.mjs";
import {
  CERT_IDS,
  CLUSTERS,
  PROGRAM_CLUSTERS,
  CONTACT_ROLES,
  EMPLOYER_NAMES,
  EMPLOYER_SECTORS,
  FIRST_NAMES,
  HOLLAND_CODES,
  JOB_TITLES,
  LAST_NAMES,
  SKILLS,
  WV_PLACES,
  fictionalPhone,
} from "./lib/cohort-vocab.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const OUT_DIR = path.join(REPO, "config", "benchmarks", "synthetic-cohort");

/** Every generated id starts with this, so a seeded row is identifiable in any database. */
export const BENCH_ID_PREFIX = "bench_";

/**
 * The cohort's "now".
 *
 * Fixed, and every other instant in the fixture is an offset from it. A
 * relative-to-today cohort would make "hired 40 days ago" mean something
 * different on every run, so the retention checkpoints, the funnel medians and
 * the DoHS follow-up dates would all drift while nothing in the code changed.
 */
export const COHORT_EPOCH = "2026-09-01T12:00:00.000Z";

const EPOCH_MS = Date.parse(COHORT_EPOCH);
const DAY_MS = 24 * 60 * 60 * 1000;

/** An ISO instant `days` before the epoch (negative days = after). */
function daysBefore(days) {
  return new Date(EPOCH_MS - days * DAY_MS).toISOString();
}

/** The plain YYYY-MM-DD of an instant `days` before the epoch. */
function dateBefore(days) {
  return daysBefore(days).slice(0, 10);
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const SLOTS = ["morning", "afternoon", "evening", "overnight"];

function emptyGrid() {
  const grid = {};
  for (const day of DAYS) {
    grid[day] = {};
    for (const slot of SLOTS) grid[day][slot] = false;
  }
  return grid;
}

/**
 * The five availability shapes a real intake produces, named so a fixture row
 * says what kind of student it represents rather than showing 28 booleans.
 *
 * `none` is the one that matters most: an all-false grid is what
 * `upsertWorkProfile` writes the moment a student answers only their pay
 * floor, and it must never block anything.
 */
const AVAILABILITY_SHAPES = {
  none: () => emptyGrid(),
  weekdayDays: () => {
    const grid = emptyGrid();
    for (const day of DAYS.slice(0, 5)) {
      grid[day].morning = true;
      grid[day].afternoon = true;
    }
    return grid;
  },
  weekdayEvenings: () => {
    const grid = emptyGrid();
    for (const day of DAYS.slice(0, 5)) grid[day].evening = true;
    return grid;
  },
  weekendsOnly: () => {
    const grid = emptyGrid();
    for (const day of ["saturday", "sunday"]) {
      for (const slot of SLOTS) grid[day][slot] = true;
    }
    return grid;
  },
  anytime: () => {
    const grid = emptyGrid();
    for (const day of DAYS) {
      for (const slot of SLOTS) grid[day][slot] = true;
    }
    return grid;
  },
  /** Weekday mornings plus every weekend slot — a common childcare pattern. */
  morningsAndWeekends: () => {
    const grid = emptyGrid();
    for (const day of DAYS.slice(0, 5)) grid[day].morning = true;
    for (const day of ["saturday", "sunday"]) {
      for (const slot of SLOTS) grid[day][slot] = true;
    }
    return grid;
  },
};

// ---------------------------------------------------------------------------
// Instructors and classes
// ---------------------------------------------------------------------------

function buildStaff() {
  const instructors = [
    { id: "bench_instr_1", login: "bench-instructor-1", displayName: "Marlow Denbrook" },
    { id: "bench_instr_2", login: "bench-instructor-2", displayName: "Sela Hartsell" },
    { id: "bench_instr_3", login: "bench-instructor-3", displayName: "Odell Ridgelow" },
  ].map((instructor) => ({
    ...instructor,
    email: `${instructor.login}@test.local`,
    role: "teacher",
  }));

  const classes = [
    { id: "bench_class_1", code: "bench-spokes-beckley", name: "Bench SPOKES Beckley", region: "Raleigh County, WV" },
    { id: "bench_class_2", code: "bench-spokes-charleston", name: "Bench SPOKES Charleston", region: "Kanawha County, WV" },
    { id: "bench_class_3", code: "bench-spokes-huntington", name: "Bench SPOKES Huntington", region: "Cabell County, WV" },
  ].map((entry, index) => ({
    ...entry,
    instructorId: instructors[index].id,
    // prefer_local everywhere: it is the JobClassConfig default, so the
    // benchmark measures the ranking students actually get.
    localJobPriority: "prefer_local",
  }));

  return { instructors, classes };
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

const STUDENT_COUNT = 50;

function buildStudents(classes) {
  const rng = createRng("cohort/students/v1");
  const students = [];

  for (let index = 0; index < STUDENT_COUNT; index += 1) {
    const first = FIRST_NAMES[index % FIRST_NAMES.length];
    const last = LAST_NAMES[index % LAST_NAMES.length];
    const cls = classes[index % classes.length];
    const seq = String(index + 1).padStart(2, "0");

    students.push({
      id: `bench_stu_${seq}`,
      login: `bench-student-${seq}`,
      displayName: `${first} ${last}`,
      firstName: first,
      lastName: last,
      email: `bench-student-${seq}@test.local`,
      classId: cls.id,
      classRegion: cls.region,
      /** The public SPOKES id — what the DoHS export's identifier column carries. */
      spokesId: `bench-student-${seq}`,
      // Three, because that is what production stores: the discovery
      // extractor takes `.slice(0, 3)` of the ranked clusters. Two would also
      // have left several students with no lead in work they said they wanted,
      // which is a fixture artifact rather than a fact about the program.
      topClusters: rng.sample(PROGRAM_CLUSTERS, 3),
      hollandCode: rng.pick(HOLLAND_CODES),
      resumeSkills: rng.sample(SKILLS, rng.int(2, 5)),
      // Verified certifications only — a self-reported card never clears a
      // must-have requirement, so the fixture carries only the verified list.
      verifiedCertIds: rng.chance(0.25) ? [] : rng.sample(CERT_IDS, rng.int(1, 3)),
      enrolledDaysAgo: rng.int(120, 300),
    });
  }

  return students;
}

// ---------------------------------------------------------------------------
// Work profiles
// ---------------------------------------------------------------------------

/**
 * One profile per student, mixing the real intake outcomes: some students
 * answer everything, some answer only their pay floor, some never open the
 * form at all (an all-false grid and a null transport).
 */
function buildWorkProfiles(students) {
  const rng = createRng("cohort/work-profiles/v1");
  const shapes = Object.keys(AVAILABILITY_SHAPES);
  const transports = ["car", "car", "car", "ride", "bus", "bus", "walk", "none", null];

  return students.map((student, index) => {
    // Deterministic rotation rather than a draw, so every shape and every
    // transport mode is represented at a known count instead of by luck.
    const shape = shapes[index % shapes.length];
    const transport = transports[index % transports.length];
    const place = WV_PLACES[index % WV_PLACES.length];
    const payFloor = [null, null, 11, 12, 13, 14, 15, 16, 18][index % 9];

    return {
      studentId: student.id,
      availabilityShape: shape,
      availability: AVAILABILITY_SHAPES[shape](),
      transport,
      homeZip: place.zip,
      county: place.county,
      maxCommuteMinutes: rng.chance(0.6) ? rng.int(15, 45) : null,
      payFloorHourly: payFloor,
      childcareHours: rng.chance(0.25)
        ? { note: "Kids are at school 8 to 3 on weekdays." }
        : null,
      earliestStart: rng.chance(0.5) ? dateBefore(-rng.int(3, 45)) : null,
      shiftLimits: rng.chance(0.2) ? { maxHoursPerWeek: rng.int(20, 35) } : null,
      updatedVia: rng.chance(0.4) ? "sage" : "student",
    };
  });
}

// ---------------------------------------------------------------------------
// Employers and contacts
// ---------------------------------------------------------------------------

function buildEmployers() {
  const rng = createRng("cohort/employers/v1");

  return EMPLOYER_NAMES.map((name, index) => {
    const place = WV_PLACES[index % WV_PLACES.length];
    const seq = String(index + 1).padStart(2, "0");
    // One do_not_contact and one paused employer, at fixed positions: the
    // hard-block suite needs `employer_do_not_contact` to fire, and a random
    // draw could leave the code untested on a future reseed.
    const status = index === 10 ? "do_not_contact" : index === 11 ? "paused" : "active";

    return {
      id: `bench_emp_${seq}`,
      name,
      nameKey: name.toLowerCase().replace(/\s+/gu, " ").trim(),
      legalName: `${name} LLC`,
      sector: EMPLOYER_SECTORS[index % EMPLOYER_SECTORS.length],
      clusters: rng.sample(CLUSTERS, rng.int(1, 2)),
      county: place.county,
      city: place.city,
      zip: place.zip,
      website: `https://${name.toLowerCase().replace(/[^a-z]+/gu, "-")}.example.invalid`,
      notes: null,
      hiredSpokesGradBefore: index % 3 === 0,
      lastHiredAt: index % 3 === 0 ? daysBefore(rng.int(30, 400)) : null,
      subsidyFlags: index % 4 === 0 ? { eip: "known", wotc: "unknown" } : {},
      status,
    };
  });
}

function buildContacts(employers) {
  const rng = createRng("cohort/contacts/v1");

  return employers.map((employer, index) => {
    const first = FIRST_NAMES[(index * 7 + 3) % FIRST_NAMES.length];
    const last = LAST_NAMES[(index * 5 + 11) % LAST_NAMES.length];
    const seq = String(index + 1).padStart(2, "0");

    return {
      id: `bench_contact_${seq}`,
      employerId: employer.id,
      name: `${first} ${last}`,
      role: rng.pick(CONTACT_ROLES),
      // `.invalid` is reserved by RFC 2606 and resolves nowhere, so a
      // misconfigured run cannot email a real person.
      email: `${first}.${last}@${employer.nameKey.replace(/\s+/gu, "")}.invalid`.toLowerCase(),
      phone: fictionalPhone(index),
      preferredChannel: "email",
      contactConsentAt: daysBefore(rng.int(60, 400)),
      // Fixed position again: the send path must have a contact it refuses.
      doNotContactAt: index === 10 ? daysBefore(20) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Job leads
// ---------------------------------------------------------------------------

const LEAD_COUNT = 40;

/**
 * The shift patterns a lead can carry, including the two that must never
 * block: an empty list (nothing was asked) and an all-shift list.
 */
const SHIFT_SETS = [
  ["day"],
  ["day"],
  ["evening"],
  ["night"],
  ["weekend"],
  ["day", "evening"],
  ["evening", "night"],
  [],
  ["day", "evening", "night", "weekend"],
  ["day", "weekend"],
];

function buildLeads(employers, contacts, classes) {
  const rng = createRng("cohort/leads/v1");
  const leads = [];

  for (let index = 0; index < LEAD_COUNT; index += 1) {
    const employer = employers[index % employers.length];
    const contact = contacts.find((entry) => entry.employerId === employer.id);
    const place = WV_PLACES.find((entry) => entry.city === employer.city) ?? WV_PLACES[0];
    const seq = String(index + 1).padStart(2, "0");

    // Statuses at fixed positions so `lead_not_open` always has pairs to fire
    // on: 4 of the 40 are not open.
    const status =
      index === 36 ? "filled" : index === 37 ? "paused" : index === 38 ? "closed" : index === 39 ? "filled" : "open";

    // Sources at fixed positions too. `joblisting` is the one source that
    // keeps the scraped location heuristic (matching-shared.ts
    // `locationScoreForLead`), so the fixture must contain some.
    const source =
      index % 10 === 3 ? "joborder" : index % 10 === 7 ? "opportunity" : index % 10 === 9 ? "joblisting" : "manual";

    // Ten program-wide leads (classId null), the rest split across the three
    // classes — the same mix `job_lead_read` has to reason about.
    const classId = index % 4 === 0 ? null : classes[index % classes.length].id;

    const shifts = SHIFT_SETS[index % SHIFT_SETS.length];
    const payMin = [10, 11, 12, 13, 14, 15, 16, 17, 18, 20][index % 10];
    // Two leads state no pay at all, which is "unknown", never "too little".
    const statesPay = index !== 12 && index !== 25;
    // One weekly and one yearly lead, so `leadHourlyRange`'s normalization is
    // exercised by the fixture rather than only by its own unit test.
    const payPeriod = index === 5 ? "week" : index === 17 ? "year" : "hour";
    const scale = payPeriod === "week" ? 40 : payPeriod === "year" ? 2080 : 1;

    const mustHaveCerts =
      index % 5 === 1 ? [CERT_IDS[index % CERT_IDS.length]] : [];
    const niceToHave = index % 3 === 0 ? [CERT_IDS[(index + 3) % CERT_IDS.length]] : [];

    // A named transit route settles transport for everyone, so it is placed on
    // a known third of the leads rather than drawn.
    const transitNotes = index % 3 === 1 ? "The number 7 bus stops at the front gate." : null;
    const distanceMiles = index % 3 === 2 ? rng.int(1, 30) : null;

    leads.push({
      id: `bench_lead_${seq}`,
      employerId: employer.id,
      employerName: employer.name,
      employerStatus: employer.status,
      employerHiredSpokesGradBefore: employer.hiredSpokesGradBefore,
      contactId: contact.id,
      classId,
      title: JOB_TITLES[index % JOB_TITLES.length],
      description:
        `${employer.name} is hiring a ${JOB_TITLES[index % JOB_TITLES.length].toLowerCase()} in ` +
        `${place.city}. The team trains on the job. Steady hours.`,
      requirements: { mustHaveCerts, niceToHave, physical: [], licenses: [] },
      schedule: {
        shifts,
        ...(shifts.length > 0 ? { hoursPerWeekMin: 20, hoursPerWeekMax: 40 } : {}),
      },
      payMin: statesPay ? Math.round(payMin * scale) : null,
      payMax: statesPay ? Math.round((payMin + 3) * scale) : null,
      payPeriod,
      location: `${place.city}, WV`,
      transitNotes,
      distanceMiles,
      // Two clusters per lead, from the same seven-cluster program pool the
      // students pick from — a real opening spans more than one label, and
      // this is what gives every student leads in work they said they wanted.
      clusters: [
        PROGRAM_CLUSTERS[index % PROGRAM_CLUSTERS.length],
        PROGRAM_CLUSTERS[(index + 3) % PROGRAM_CLUSTERS.length],
      ],
      source,
      sourceRef: source === "manual" ? null : `bench_src_${seq}`,
      status,
      openings: rng.int(1, 3),
      postedAt: daysBefore(rng.int(2, 90)),
      createdById: classes[index % classes.length].instructorId,
    });
  }

  return leads;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/**
 * The twenty connections, written as WALKS rather than as end states.
 *
 * Each entry names the path its events took, so the fixture says what happened
 * instead of leaving a reader to infer it from a status. Three are deliberate
 * edge cases the funnel and the state machine both have to get right:
 *
 *   - `hired-skip`: sent → viewed → hired, with no interested/interview/offer.
 *     Employers talk to people; the pipeline allows it and the fixture proves
 *     the reports survive it.
 *   - `hired-direct`: sent → hired, skipping `viewed` as well — the employer
 *     who rang the instructor and never opened the link.
 *   - `rolled-back-send`: a `sent` event exists but `sentAt` is null and the
 *     row is back at `student_approved`. `funnelStageIndexForConnection` must
 *     count it as approved, not as sent; a fixture without one would let that
 *     rule rot.
 */
const CONNECTION_WALKS = [
  { key: "proposed-a", path: ["proposed"], status: "proposed" },
  { key: "proposed-b", path: ["proposed"], status: "proposed" },
  { key: "approved", path: ["proposed", "student_approved"], status: "student_approved" },
  {
    key: "rolled-back-send",
    path: ["proposed", "student_approved", "sent"],
    status: "student_approved",
    rolledBackSend: true,
  },
  { key: "sent-a", path: ["proposed", "student_approved", "sent"], status: "sent" },
  { key: "sent-b", path: ["proposed", "student_approved", "sent"], status: "sent" },
  { key: "viewed", path: ["proposed", "student_approved", "sent", "viewed"], status: "viewed" },
  {
    key: "interested-a",
    path: ["proposed", "student_approved", "sent", "viewed", "interested"],
    status: "interested",
  },
  {
    key: "interested-b",
    path: ["proposed", "student_approved", "sent", "interested"],
    status: "interested",
  },
  {
    key: "not-now",
    path: ["proposed", "student_approved", "sent", "viewed", "not_now"],
    status: "not_now",
  },
  {
    key: "interview",
    path: ["proposed", "student_approved", "sent", "viewed", "interested", "interview_scheduled"],
    status: "interview_scheduled",
  },
  {
    key: "offered",
    path: ["proposed", "student_approved", "sent", "viewed", "interested", "interview_scheduled", "offered"],
    status: "offered",
  },
  {
    key: "withdrawn",
    path: ["proposed", "student_approved", "sent", "withdrawn"],
    status: "withdrawn",
  },
  {
    key: "closed",
    path: ["proposed", "student_approved", "sent", "viewed", "closed"],
    status: "closed",
  },
  {
    key: "hired-skip",
    path: ["proposed", "student_approved", "sent", "viewed", "hired"],
    status: "hired",
    placement: true,
  },
  {
    key: "hired-direct",
    path: ["proposed", "student_approved", "sent", "hired"],
    status: "hired",
    placement: true,
  },
  {
    key: "started",
    path: ["proposed", "student_approved", "sent", "viewed", "interested", "offered", "hired", "started"],
    status: "started",
    placement: true,
  },
  {
    key: "retained-30",
    path: ["proposed", "student_approved", "sent", "viewed", "interested", "interview_scheduled", "offered", "hired", "started", "retained_30"],
    status: "retained_30",
    placement: true,
  },
  {
    key: "retained-60",
    path: ["proposed", "student_approved", "sent", "viewed", "interested", "offered", "hired", "started", "retained_30", "retained_60"],
    status: "retained_60",
    placement: true,
  },
  {
    key: "retained-90",
    path: ["proposed", "student_approved", "sent", "viewed", "interested", "interview_scheduled", "offered", "hired", "started", "retained_30", "retained_60", "retained_90"],
    status: "retained_90",
    placement: true,
  },
];

/** Who drives each transition, so the event log names a plausible actor. */
const ACTOR_FOR_STATUS = {
  proposed: "teacher",
  student_approved: "student",
  sent: "teacher",
  viewed: "employer",
  interested: "employer",
  not_now: "employer",
  interview_scheduled: "employer",
  offered: "teacher",
  hired: "employer",
  started: "teacher",
  retained_30: "system",
  retained_60: "system",
  retained_90: "system",
  withdrawn: "student",
  closed: "teacher",
};

function buildConnections(students, leads, classes) {
  const rng = createRng("cohort/connections/v1");
  const openLeads = leads.filter((lead) => lead.status === "open");
  const connections = [];

  CONNECTION_WALKS.forEach((walk, index) => {
    // A connection per student, taken from the front of the roster: the
    // downstream suites index by walk key, not by which student happened to
    // get it, and a fixed assignment keeps the mapping readable in a diff.
    const student = students[index];
    const lead = openLeads[(index * 3) % openLeads.length];
    const seq = String(index + 1).padStart(2, "0");
    const cls = classes.find((entry) => entry.id === (lead.classId ?? student.classId));

    // The walk is laid out backwards from the epoch, one step every few days,
    // so `createdAt` sits furthest in the past and the last event is recent.
    const stepDays = 4;
    const startDaysAgo = 10 + walk.path.length * stepDays;
    const events = walk.path.map((toStatus, step) => ({
      id: `bench_conn_${seq}_ev_${String(step + 1).padStart(2, "0")}`,
      connectionId: `bench_conn_${seq}`,
      fromStatus: step === 0 ? null : walk.path[step - 1],
      toStatus,
      actorType: ACTOR_FOR_STATUS[toStatus],
      at: daysBefore(startDaysAgo - step * stepDays),
      note: null,
    }));

    const eventAt = (status) => events.find((event) => event.toStatus === status)?.at ?? null;
    const sentEventAt = eventAt("sent");
    const hiredAt = eventAt("hired");

    const packetFields = [
      "candidate_name",
      "resume",
      "verified_certifications",
      "availability",
      "earliest_start",
      "endorsement",
      // Half the packets carry the subsidy line, so the funnel's subsidy split
      // is a real split rather than all-or-nothing.
      ...(index % 2 === 0 ? ["subsidy_line"] : []),
    ];

    // `proposed` connections have not been approved, so they have no frozen
    // packet — the same as production, where the packet is written at approval.
    const approved = walk.path.includes("student_approved");

    connections.push({
      id: `bench_conn_${seq}`,
      key: walk.key,
      studentId: student.id,
      jobLeadId: lead.id,
      employerId: lead.employerId,
      employerName: lead.employerName,
      classId: cls?.id ?? null,
      className: cls?.name ?? null,
      proposedById: cls ? cls.instructorId : classes[0].instructorId,
      proposedVia: "teacher",
      status: walk.status,
      statusChangedAt: events[events.length - 1].at,
      createdAt: events[0].at,
      // The rolled-back send: the event stays (the claim genuinely happened)
      // and the column is nulled. Everything downstream must read the column.
      sentAt: walk.rolledBackSend ? null : sentEventAt,
      sentById: walk.rolledBackSend ? null : sentEventAt ? cls?.instructorId ?? null : null,
      employerViewedAt: eventAt("viewed"),
      employerRespondedAt:
        eventAt("hired") ?? eventAt("interested") ?? eventAt("not_now") ?? null,
      employerResponse: walk.path.includes("hired")
        ? "hired"
        : walk.path.includes("interested")
          ? "interested"
          : walk.path.includes("not_now")
            ? "not_now"
            : null,
      hiredAt,
      startDate: hiredAt ? dateBefore(Date.parse(hiredAt) < EPOCH_MS ? 3 : 0) : null,
      hourlyWage: hiredAt ? [14, 15, 16, 17, 18, 19][index % 6] : null,
      closedReason: walk.status === "closed" ? "Student took a different job." : null,
      isPlacement: Boolean(walk.placement),
      rolledBackSend: Boolean(walk.rolledBackSend),
      events,
      packet: approved
        ? {
            resumeVersionId: `bench_resume_${seq}`,
            coverLetterId: null,
            resumeFileUploadId: null,
            endorsement:
              `${student.firstName} came to every class on time and finished the work. ` +
              "They ask good questions.",
            includedCertIds: student.verifiedCertIds.map((certId) => `bench_cert_${seq}_${certId}`),
            includedFields: packetFields,
            candidateName: `${student.firstName} ${student.lastName.charAt(0)}.`,
            certifications: [...student.verifiedCertIds],
            availabilitySummary: "Weekdays, mornings and afternoons",
            earliestStart: dateBefore(-rng.int(3, 20)),
            subsidyLine: packetFields.includes("subsidy_line")
              ? "Ask us about money for hiring."
              : null,
          }
        : null,
    });
  });

  return connections;
}

// ---------------------------------------------------------------------------
// SPOKES records, applications, follow-ups
// ---------------------------------------------------------------------------

/**
 * One SpokesRecord per student. Exactly the six students whose connection
 * reached `hired` or beyond carry `unsubsidizedEmploymentAt` — that identity
 * is the report-parity benchmark, and `assertInvariants` refuses to write a
 * cohort where it does not hold.
 */
function buildSpokesRecords(students, connections, classes) {
  const rng = createRng("cohort/spokes/v1");
  const placementByStudent = new Map(
    connections.filter((connection) => connection.isPlacement).map((c) => [c.studentId, c]),
  );

  return students.map((student, index) => {
    const seq = String(index + 1).padStart(2, "0");
    const placement = placementByStudent.get(student.id) ?? null;
    const cls = classes.find((entry) => entry.id === student.classId);
    const place = WV_PLACES[index % WV_PLACES.length];

    /**
     * Retention follow-ups, on the SpokesRecord's own 1/3/6-MONTH clock.
     *
     * Deliberately not derived from the connection's 30/60/90-DAY retention
     * statuses: the two records use different anchors and different scales,
     * and the 2026-09-05 decision was that an SMS retention answer never
     * writes this table directly. The fixture models them as the separate
     * records they are.
     */
    const followUps = [];
    if (placement) {
      const monthsSinceHire = Math.floor(
        (EPOCH_MS - Date.parse(placement.hiredAt)) / (30 * DAY_MS),
      );
      for (const checkpoint of [1, 3, 6]) {
        if (monthsSinceHire >= checkpoint) {
          followUps.push({
            checkpointMonths: checkpoint,
            status: "employed",
            checkedAt: dateBefore(
              Math.max(0, Math.floor((EPOCH_MS - Date.parse(placement.hiredAt)) / DAY_MS) - checkpoint * 30),
            ),
          });
        }
      }
    }

    return {
      id: `bench_spokes_${seq}`,
      studentId: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      county: place.county,
      className: cls?.name ?? null,
      status: placement ? "employed" : rng.chance(0.15) ? "referred" : "enrolled",
      referralDate: dateBefore(student.enrolledDaysAgo + 21),
      enrolledAt: dateBefore(student.enrolledDaysAgo),
      exitDate: placement ? dateBefore(Math.floor((EPOCH_MS - Date.parse(placement.hiredAt)) / DAY_MS) + 7) : null,
      unsubsidizedEmploymentAt: placement ? placement.hiredAt.slice(0, 10) : null,
      employerName: placement ? placement.employerName : null,
      hourlyWage: placement ? placement.hourlyWage : null,
      postSecondaryEnteredAt: !placement && rng.chance(0.08) ? dateBefore(rng.int(20, 120)) : null,
      placementApplicationId: placement ? `bench_app_${placement.id.slice(-2)}` : null,
      employmentFollowUps: followUps,
    };
  });
}

/**
 * The Applications that back the six placements, plus three self-directed rows
 * that deliberately do NOT qualify as placements.
 *
 * The self-directed rows exist so the funnel's comparison line is non-zero
 * while report parity still holds: `qualifiesForPlacement` needs
 * `status === "accepted"` AND `verificationStatus === "verified"`, and none of
 * these three has both. A fixture where they did would make the three
 * placement counts legitimately disagree, and the parity benchmark would be
 * measuring the fixture rather than the code.
 */
function buildApplications(students, connections) {
  const applications = [];

  for (const connection of connections.filter((entry) => entry.isPlacement)) {
    const suffix = connection.id.slice(-2);
    applications.push({
      id: `bench_app_${suffix}`,
      studentId: connection.studentId,
      opportunityId: `bench_opp_${suffix}`,
      connectionId: connection.id,
      jobLeadId: connection.jobLeadId,
      status: "accepted",
      verificationStatus: "verified",
      appliedAt: connection.sentAt,
      createdAt: connection.sentAt,
      selfDirected: false,
    });
  }

  const selfDirected = [
    { studentId: students[30].id, status: "applied", verificationStatus: null },
    { studentId: students[31].id, status: "applied", verificationStatus: "self_reported" },
    // Accepted but NOT verified — the near miss that proves the bar is both
    // conditions, not either one.
    { studentId: students[32].id, status: "accepted", verificationStatus: "self_reported" },
  ];

  selfDirected.forEach((entry, index) => {
    const seq = String(index + 1).padStart(2, "0");
    applications.push({
      id: `bench_selfapp_${seq}`,
      studentId: entry.studentId,
      opportunityId: `bench_selfopp_${seq}`,
      connectionId: null,
      jobLeadId: null,
      status: entry.status,
      verificationStatus: entry.verificationStatus,
      appliedAt: daysBefore(30 + index * 5),
      createdAt: daysBefore(32 + index * 5),
      selfDirected: true,
    });
  });

  return applications;
}

// ---------------------------------------------------------------------------
// Saved jobs and appointments
// ---------------------------------------------------------------------------

function buildJobListings(classes) {
  const rng = createRng("cohort/listings/v1");

  return Array.from({ length: 12 }, (_, index) => {
    const place = WV_PLACES[index % WV_PLACES.length];
    const seq = String(index + 1).padStart(2, "0");
    return {
      id: `bench_listing_${seq}`,
      classId: classes[index % classes.length].id,
      sourceId: `bench-listing-source-${seq}`,
      title: JOB_TITLES[(index + 5) % JOB_TITLES.length],
      company: EMPLOYER_NAMES[(index + 2) % EMPLOYER_NAMES.length],
      location: `${place.city}, WV`,
      description: "Entry level. Training provided. Apply in person or online.",
      salaryMin: 12 + index,
      salaryMax: 16 + index,
      clusters: [CLUSTERS[(index + 4) % CLUSTERS.length]],
      source: rng.pick(["jsearch", "usajobs", "adzuna"]),
      postedAt: daysBefore(rng.int(1, 40)),
    };
  });
}

function buildSavedJobs(students, listings) {
  const rng = createRng("cohort/saved-jobs/v1");
  const saved = [];
  let seq = 0;

  // The first eighteen students each save one to three listings from their own
  // class — enough for the job-board surfaces to have content without making
  // every student's page identical.
  for (const student of students.slice(0, 18)) {
    const mine = listings.filter((listing) => listing.classId === student.classId);
    for (const listing of rng.sample(mine, rng.int(1, Math.min(3, mine.length)))) {
      seq += 1;
      const applied = rng.chance(0.35);
      saved.push({
        id: `bench_saved_${String(seq).padStart(2, "0")}`,
        studentId: student.id,
        jobListingId: listing.id,
        status: applied ? "applied" : "saved",
        savedAt: daysBefore(rng.int(3, 60)),
        appliedAt: applied ? daysBefore(rng.int(1, 3)) : null,
      });
    }
  }

  return saved;
}

/**
 * A handful of appointments, including the interview one the
 * `interview_scheduled` connection points at — the console's booking flow
 * writes exactly that link and a fixture without it cannot exercise it.
 */
function buildAppointments(students, connections, classes) {
  const rng = createRng("cohort/appointments/v1");
  const appointments = [];

  const interview = connections.find((connection) => connection.key === "interview");
  if (interview) {
    appointments.push({
      id: "bench_appt_01",
      studentId: interview.studentId,
      advisorId: classes[0].instructorId,
      connectionId: interview.id,
      kind: "interview",
      scheduledAt: daysBefore(-4),
      durationMinutes: 45,
      status: "scheduled",
      location: interview.employerName,
    });
  }

  students.slice(20, 24).forEach((student, index) => {
    appointments.push({
      id: `bench_appt_${String(index + 2).padStart(2, "0")}`,
      studentId: student.id,
      advisorId: classes[index % classes.length].instructorId,
      connectionId: null,
      kind: "advising",
      scheduledAt: daysBefore(-rng.int(1, 14)),
      durationMinutes: 30,
      status: "scheduled",
      location: "Room 2",
    });
  });

  return appointments;
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * Refuse to write a cohort that has stopped being usable as a fixture.
 *
 * Each of these is a property some benchmark's meaning depends on, so a
 * generator edit that breaks one must fail here — loudly, at generation time —
 * rather than at the far end where it would read as a code regression.
 */
function assertInvariants(cohort) {
  const problems = [];

  const placements = cohort.connections.filter((connection) => connection.isPlacement);
  const placedRecords = cohort.spokesRecords.filter(
    (record) => record.unsubsidizedEmploymentAt !== null,
  );
  if (placements.length !== placedRecords.length) {
    problems.push(
      `report parity: ${placements.length} placement connections vs ` +
        `${placedRecords.length} placed SpokesRecords`,
    );
  }
  const placementStudents = new Set(placements.map((connection) => connection.studentId));
  for (const record of placedRecords) {
    if (!placementStudents.has(record.studentId)) {
      problems.push(`report parity: ${record.studentId} is placed with no placement connection`);
    }
  }

  // Every walk must be a legal path through the pipeline. The table lives in
  // TypeScript, so it is re-stated here as data and pinned against the real
  // one by src/lib/benchmarks/synthetic-cohort.test.ts.
  for (const connection of cohort.connections) {
    if (connection.events.length === 0) problems.push(`${connection.id} has no events`);
    if (connection.events[connection.events.length - 1].toStatus !== connection.status) {
      if (!connection.rolledBackSend) {
        problems.push(`${connection.id} status does not match its last event`);
      }
    }
  }

  if (cohort.students.length !== STUDENT_COUNT) {
    problems.push(`expected ${STUDENT_COUNT} students, got ${cohort.students.length}`);
  }
  if (cohort.leads.length !== LEAD_COUNT) {
    problems.push(`expected ${LEAD_COUNT} leads, got ${cohort.leads.length}`);
  }
  if (cohort.workProfiles.length !== cohort.students.length) {
    problems.push("every student needs a work profile row");
  }

  // The three edge cases the funnel and the state machine are measured on.
  for (const key of ["hired-skip", "hired-direct", "rolled-back-send"]) {
    if (!cohort.connections.some((connection) => connection.key === key)) {
      problems.push(`the "${key}" connection is missing`);
    }
  }

  if (!cohort.leads.some((lead) => lead.status !== "open")) {
    problems.push("no closed/filled/paused lead — `lead_not_open` would never fire");
  }
  if (!cohort.employers.some((employer) => employer.status === "do_not_contact")) {
    problems.push("no do_not_contact employer — that hard block would never fire");
  }

  if (problems.length > 0) {
    throw new Error(`The generated cohort violates its own invariants:\n  - ${problems.join("\n  - ")}`);
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function generateCohort() {
  const { instructors, classes } = buildStaff();
  const students = buildStudents(classes);
  const workProfiles = buildWorkProfiles(students);
  const employers = buildEmployers();
  const contacts = buildContacts(employers);
  const leads = buildLeads(employers, contacts, classes);
  const connections = buildConnections(students, leads, classes);

  const spokesRecords = buildSpokesRecords(students, connections, classes);
  const applications = buildApplications(students, connections);
  const jobListings = buildJobListings(classes);
  const savedJobs = buildSavedJobs(students, jobListings);
  const appointments = buildAppointments(students, connections, classes);

  const cohort = {
    meta: {
      version: 1,
      epoch: COHORT_EPOCH,
      idPrefix: BENCH_ID_PREFIX,
      generator: "scripts/bench/generate-cohort.mjs",
      note: "Entirely synthetic. No real person, employer, phone number or address.",
    },
    instructors,
    classes,
    students,
    workProfiles,
    employers,
    contacts,
    leads,
    connections,
    spokesRecords,
    applications,
    jobListings,
    savedJobs,
    appointments,
  };

  assertInvariants(cohort);
  return cohort;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** filename -> the cohort key it holds. `meta` gets its own file too. */
export const COHORT_FILES = {
  "meta.json": "meta",
  "instructors.json": "instructors",
  "classes.json": "classes",
  "students.json": "students",
  "work-profiles.json": "workProfiles",
  "employers.json": "employers",
  "contacts.json": "contacts",
  "leads.json": "leads",
  "connections.json": "connections",
  "spokes-records.json": "spokesRecords",
  "applications.json": "applications",
  "job-listings.json": "jobListings",
  "saved-jobs.json": "savedJobs",
  "appointments.json": "appointments",
};

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function main() {
  const check = process.argv.includes("--check");
  const cohort = generateCohort();
  mkdirSync(OUT_DIR, { recursive: true });

  let changed = 0;
  for (const [filename, key] of Object.entries(COHORT_FILES)) {
    const target = path.join(OUT_DIR, filename);
    const next = serialize(cohort[key]);
    let current = null;
    try {
      current = readFileSync(target, "utf8");
    } catch {
      current = null;
    }
    if (current === next) continue;
    changed += 1;
    if (check) {
      console.error(`would change: config/benchmarks/synthetic-cohort/${filename}`);
    } else {
      writeFileSync(target, next);
      console.log(`wrote config/benchmarks/synthetic-cohort/${filename}`);
    }
  }

  if (check && changed > 0) {
    console.error(
      `\n${changed} cohort file(s) differ from the generator. Run ` +
        "`node scripts/bench/generate-cohort.mjs` and commit the result.",
    );
    process.exit(1);
  }
  if (!check) {
    console.log(
      `\nCohort: ${cohort.students.length} students, ${cohort.leads.length} leads, ` +
        `${cohort.connections.length} connections, ` +
        `${cohort.spokesRecords.filter((r) => r.unsubsidizedEmploymentAt).length} placements.`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
