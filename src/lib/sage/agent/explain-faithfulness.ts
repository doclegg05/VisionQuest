// =============================================================================
// Did `explain_job`'s draft stay inside the posting?
//
// `explain_job` hands a student a plain-language rewrite of one job posting.
// They act on it: they turn up, they arrange childcare, they decide whether the
// pay is worth the bus fare. So a fact the posting never gave is not a quality
// problem, it is a wrong answer with consequences, and the check has to be on
// the OUTPUT — a posting can carry an injected instruction, and a guard that
// only inspected the prompt would be arguing with the attacker's own text.
//
// FOUR CHECKS, one per fact a student acts on hardest. Every one is
// CONTRADICTION-BASED and narrow: it fires only on something the draft SAYS
// that the posting does not support, never on something the draft omits. The
// asymmetry is deliberate — the prompt already tells the model to write "The
// posting doesn't say." for a missing fact, and a check that punished silence
// would push it the other way.
//
//   wage         a dollar figure the posting never states, in numerals or
//                spelled out;
//   hours        an hours-per-week or per-day figure the posting never states;
//   place        a "City, ST" the posting never names;
//   requirement  a credential from a closed vocabulary that the posting never
//                asks for.
//
// The vocabularies are closed on purpose. Open-ended entity extraction over a
// grade-6 rewrite produces false refusals, and a false refusal costs a student
// their explanation and tells them to go ask their instructor — the check has
// to be one nobody has to argue with.
//
// EVERY PATTERN HERE READS ATTACKER-INFLUENCED TEXT. The posting arrives from a
// third-party feed, so a super-linear pattern is a denial of service anybody
// who can publish a job can trigger. Four have been found and fixed that way:
// the whitespace pair in BARE_RATE, the unbounded word run in CITY_STATE, and
// the digit/comma quantifier that BARE_RATE and one MONEY_PATTERNS entry both
// carried (now MONEY_NUMBER, shared). `explain-faithfulness.test.ts` pins their
// growth across a 4x input, driving `matchAll` as production does, and
// `MAX_CHECKED_CHARS` bounds what any of them can be handed.
// =============================================================================

/** What the checker was given to compare against. */
export interface ExplainPosting {
  title?: string;
  company?: string;
  location?: string | null;
  salary: string | null;
  employmentType?: string | null;
  description: string;
}

export type FaithfulnessKind = "wage" | "hours" | "place" | "requirement";

export interface FaithfulnessFinding {
  kind: FaithfulnessKind;
  /** The exact text in the draft that is not supported. */
  detail: string;
}

// ---------------------------------------------------------------------------
// Wage — unchanged from the original guard
// ---------------------------------------------------------------------------

/**
/**
 * One number, written the way money is written, defined ONCE and shared by
 * every pattern below.
 *
 * The shape it replaces was `\d[\d,]*(?:\.\d+)?` — "a digit, then any run of
 * digits and commas". On a posting made of `"1,"` repeated, that run consumes
 * the whole rest of the text at every one of the ~n digit positions `matchAll`
 * restarts from, and then gives it all back one character at a time looking
 * for the suffix that never comes: quadratic, measured at 154 ms for 10 KB and
 * 9.9 s for 80 KB. A posting is third-party text, so that is CPU an attacker
 * chooses the length of.
 *
 * Two alternatives, not one, and the order matters. Comma-GROUPED first, so
 * "1,200" matches whole rather than stopping at "1"; a plain digit run second,
 * because "1200 dollars" is ordinary and a grouped-only pattern would silently
 * stop reading it. Every quantifier is now bounded by a required literal — a
 * comma must be followed by exactly three digits — so no alternative can eat
 * the tail and hand it back.
 *
 * It is one constant because it appeared four times, and the whole failure was
 * one of those four copies being the dangerous one. Sharing it means the next
 * pattern cannot reintroduce the hazard by copying the wrong line.
 */
const MONEY_NUMBER = String.raw`(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;

/**
 * Money in a draft or a posting, in the forms either actually uses:
 * "$15", "15 dollars", "USD 15", "15 usd". A check that understood only the
 * "$" form was bypassed by the model simply writing "15 dollars", and refused
 * a correct explanation whenever the POSTING wrote it that way instead.
 */
export const MONEY_PATTERNS = [
  new RegExp(String.raw`\$\s?(${MONEY_NUMBER})`, "gi"),
  new RegExp(String.raw`\b(${MONEY_NUMBER})\s*(?:dollars|usd)\b`, "gi"),
  new RegExp(String.raw`\busd\s*(${MONEY_NUMBER})`, "gi"),
];

/**
 * The same figure written out in words: "twenty-five dollars an hour".
 *
 * Numerals alone left the check bypassable by spelling the number out, which is
 * the shape an injected instruction would use precisely BECAUSE it reads as
 * prose. Deliberately narrow in two ways: only cardinals up to "ninety-nine
 * hundred", and only when a money word follows immediately. Without that second
 * condition "you work with about twenty other people" becomes a wage, and a
 * student loses a correct explanation over a sentence about their coworkers.
 *
 * Applied to BOTH sides, so a posting that spells its rate out grounds a draft
 * that repeats it.
 */
const SMALL_WORD_NUMBERS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS_WORD_NUMBERS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SMALL_WORDS = Object.keys(SMALL_WORD_NUMBERS).join("|");
const TENS_WORDS = Object.keys(TENS_WORD_NUMBERS).join("|");

/** "twenty-five dollars", "sixteen bucks", "one hundred dollars". */
const WORD_MONEY = new RegExp(
  `\\b(?:(${TENS_WORDS})(?:[\\s-](${SMALL_WORDS}))?|(${SMALL_WORDS}))` +
    `(\\s+hundred)?\\s+(?:dollars?|bucks?)\\b`,
  "gi",
);

function wordMoneyValues(text: string): number[] {
  const values: number[] = [];
  for (const match of text.matchAll(WORD_MONEY)) {
    const [, tens, tensUnit, small, hundred] = match;
    let value = tens
      ? TENS_WORD_NUMBERS[tens.toLowerCase()] + (tensUnit ? SMALL_WORD_NUMBERS[tensUnit.toLowerCase()] : 0)
      : SMALL_WORD_NUMBERS[small.toLowerCase()];
    if (hundred) value *= 100;
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

/**
 * Bare "15/hr" and "15 an hour" count as the posting stating a wage. Only
 * applied to the POSTING side: a draft has to name its unit, and treating any
 * bare number in a draft as money would flag "40 pounds".
 *
 * The unit words are `\b`-terminated rather than followed by `\s+`. The
 * original had `per\s+` immediately followed by `\s*` -- two whitespace
 * quantifiers competing for the same run of spaces -- which is quadratic: on
 * "1 per " plus 10,000 spaces the `\s+` gives back one space at a time and the
 * `\s*` re-consumes the rest each time. Measured at 86 ms for 10 KB and 8.5 s
 * for 80 KB. This one reads a POSTING, i.e. third-party job-feed text of
 * unbounded shape, so it was the reachable one. One quantifier, one pass.
 */
export const BARE_RATE = new RegExp(
  String.raw`\b(${MONEY_NUMBER})\s*(?:\/|per\b|an\b|a\b)\s*(?:hr|hour|h)\b`,
  "gi",
);

/** Rounding a posted rate to whole dollars is not a fabrication. */
const ROUNDING_TOLERANCE = 1;

function numbersMatching(text: string, patterns: RegExp[]): number[] {
  const values: number[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(value)) values.push(value);
    }
  }
  return values;
}

/**
 * Dollar figures in the draft that appear nowhere in the posting.
 *
 * A wage is the single fact a student will act on hardest, and this tool's
 * output is handed to them as written. A number the posting never gave is a
 * fabrication whether the model guessed it, averaged it, or read it out of an
 * injected instruction.
 */
export function ungroundedDollarValues(
  draft: string,
  job: { salary: string | null; description: string },
): number[] {
  const source = clamp(`${job.salary ?? ""} ${job.description}`);
  const grounded = [
    ...numbersMatching(source, MONEY_PATTERNS),
    ...numbersMatching(source, [BARE_RATE]),
    ...wordMoneyValues(source),
  ];
  const stated = [...numbersMatching(draft, MONEY_PATTERNS), ...wordMoneyValues(draft)];
  return stated.filter(
    (value) => !grounded.some((posted) => Math.abs(posted - value) < ROUNDING_TOLERANCE),
  );
}

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

/**
 * "30 hours", "30 hrs", "a 30-hour week", "30 hours a week".
 *
 * Requires the unit word. A bare number in a rewrite is far more often a count
 * of duties or a bus route than a schedule, and flagging those would refuse
 * correct explanations.
 */
const HOUR_PATTERNS = [
  /\b(\d{1,3}(?:\.\d+)?)\s*(?:-|\s)?\s*(?:hours?|hrs?)\b/gi,
  /\b(\d{1,3})\s*(?:to|-|–)\s*(\d{1,3})\s*(?:hours?|hrs?)\b/gi,
];

/** Half an hour of rounding is not a fabricated schedule. */
const HOUR_TOLERANCE = 1;

function hourValues(text: string): number[] {
  const values: number[] = [];
  for (const pattern of HOUR_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      for (const group of match.slice(1)) {
        const value = Number(group);
        if (Number.isFinite(value)) values.push(value);
      }
    }
  }
  return values;
}

function ungroundedHourValues(draft: string, source: string): number[] {
  const grounded = hourValues(source);
  return hourValues(draft).filter(
    (value) => !grounded.some((posted) => Math.abs(posted - value) <= HOUR_TOLERANCE),
  );
}

// ---------------------------------------------------------------------------
// Place
// ---------------------------------------------------------------------------

/**
 * "Beckley, WV" — a town with a state beside it.
 *
 * DELIBERATELY NARROW, and the narrowness is the reason it can be trusted. The
 * grounding block hands the model `Location: Beckley, WV`, so a rewrite that
 * names a town names it in that form; a check that also tried to catch a bare
 * "in Beckley" would have to decide whether every capitalised word after "in"
 * is a place, and would start refusing drafts over "in September" and "at
 * Mountain Metal".
 *
 * KNOWN LIMIT, recorded rather than papered over: a draft that writes a wrong
 * town with no state after it is not caught here. That is a real gap, and the
 * honest place for it is a fixture case somebody can point at, not a looser
 * pattern that produces refusals nobody can explain.
 */
/**
 * Bounded on purpose. The unbounded `(?:[ -][A-Z][a-z]+)*` was quadratic on
 * capitalised prose with no comma after it -- "Aa " repeated measured 49 ms at
 * 10 KB and 3 s at 80 KB -- because every start position walked the whole run
 * of words before failing. No place name in this corpus is five words long,
 * so `{0,4}` costs nothing real and makes the walk bounded.
 */
export const CITY_STATE = /\b([A-Z][a-z]+(?:[ -][A-Z][a-z]+){0,4}),[ \t]{0,3}([A-Z]{2})\b/gu;

/** "Beckley,WV" and "Beckley,  WV" both compare as "beckley, wv". */
function normalizePlace(text: string): string {
  return text.toLowerCase().replace(/,\s*/gu, ", ");
}

function ungroundedPlaces(draft: string, source: string): string[] {
  // The CITY AND THE STATE, together. Comparing the city alone accepted
  // "Beckley, VA" against a "Beckley, WV" posting -- the state was captured and
  // then thrown away, so the one part of the address that decides whether a
  // student can get there was unchecked.
  const normalized = normalizePlace(source);
  const found: string[] = [];
  for (const match of draft.matchAll(CITY_STATE)) {
    const [whole, city, state] = match;
    if (!normalized.includes(normalizePlace(`${city}, ${state}`))) found.push(whole);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

/**
 * The credentials a student can be told they need, as a CLOSED vocabulary.
 *
 * Telling somebody they need a card they do not have is how an explanation
 * stops a job search. Every entry is something a SPOKES student either holds or
 * would have to go and get, so a draft naming one the posting never mentioned
 * is a fabrication with a cost. Aliases sit together because a posting says
 * "forklift certification" and a rewrite says "forklift card".
 */
const CREDENTIAL_VOCABULARY: ReadonlyArray<readonly string[]> = [
  ["cdl", "commercial driver"],
  ["forklift"],
  ["servsafe", "food handler"],
  ["osha"],
  ["cpr", "first aid"],
  ["cna", "nursing assistant"],
  ["flagger"],
  ["nccer"],
  ["high school diploma", "ged"],
  ["driver's license", "drivers license", "driver license"],
  ["background check"],
  ["drug screen", "drug test"],
];

/**
 * A credential named as a requirement in the draft that the posting never
 * mentions.
 *
 * Negations are skipped. "You do not need a CDL" is a true and useful sentence
 * about a posting that never mentioned one, and refusing it would train the
 * model out of the most reassuring thing it can say to a student who is
 * worried about exactly that.
 */
const NEGATION = /\b(?:no|not|don'?t|doesn'?t|without|never|isn'?t|aren'?t)\b/i;
const NEGATION_WINDOW = 40;

/**
 * The clause containing `index` -- from the start of its sentence to the end of
 * it, minus the term itself.
 *
 * TWO fixes live here, and they pull in opposite directions, which is why both
 * are pinned by tests.
 *
 * A fixed-width window backwards was the first cut and it silently broke the
 * check: the sections sit one per line and one of them is "Pay: The posting
 * doesn't say.", so a CDL invented in the NEXT section had "doesn't" forty
 * characters behind it and was read as a negation. Clamping to the last `.`,
 * newline or `:` makes the negation belong to the clause it actually negates.
 *
 * Looking only BACKWARDS was the second bug: "A CDL is not required." puts the
 * negation after the term, and refusing that sentence trains the model out of
 * the most reassuring thing this tool can say to a student worried about a card
 * they do not have. So the clause after the term is read too, clamped the same
 * way.
 */
function clauseAround(haystack: string, index: number, length: number): string {
  const startBoundary = Math.max(
    haystack.lastIndexOf(".", index - 1),
    haystack.lastIndexOf("\n", index - 1),
    haystack.lastIndexOf(":", index - 1),
  );
  const before = haystack.slice(Math.max(startBoundary + 1, index - NEGATION_WINDOW), index);

  const after = index + length;
  const endCandidates = [
    haystack.indexOf(".", after),
    haystack.indexOf("\n", after),
    haystack.indexOf(":", after),
  ].filter((at) => at !== -1);
  const endBoundary = endCandidates.length ? Math.min(...endCandidates) : haystack.length;

  return `${before} ${haystack.slice(after, Math.min(endBoundary, after + NEGATION_WINDOW))}`;
}

/** `\b`-anchored so the alias is a word, with an optional plural. */
function aliasPattern(alias: string): RegExp {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\b${escaped}s?\\b`, "gi");
}

const CREDENTIAL_PATTERNS: ReadonlyArray<ReadonlyArray<{ alias: string; pattern: RegExp }>> =
  CREDENTIAL_VOCABULARY.map((aliases) =>
    aliases.map((alias) => ({ alias, pattern: aliasPattern(alias) })),
  );

function ungroundedRequirements(draft: string, source: string): string[] {
  const found: string[] = [];

  for (const aliases of CREDENTIAL_PATTERNS) {
    // WORD BOUNDARIES, on both sides. A plain substring search read "ged" out
    // of "changed", "managed", "encouraged" -- which broke the check in BOTH
    // directions at once from one bug: a true draft saying "your schedule can
    // be changed" was refused, and a posting saying "you will be managed by a
    // shift lead" GROUNDED a fabricated GED, so the exact thing this check
    // exists to catch went through.
    if (aliases.some(({ pattern }) => new RegExp(pattern.source, "iu").test(source))) continue;

    for (const { alias, pattern } of aliases) {
      pattern.lastIndex = 0;
      let match = pattern.exec(draft);
      let stated = false;
      while (match) {
        if (!NEGATION.test(clauseAround(draft, match.index, match[0].length))) {
          stated = true;
          break;
        }
        match = pattern.exec(draft);
      }
      if (stated) {
        found.push(alias);
        break;
      }
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/**
 * How much of either side these checks will read.
 *
 * Defense in depth, not the fix. The two super-linear patterns are fixed where
 * they live; this is the bound that keeps the NEXT one from mattering. A job
 * description arrives from a third-party feed and nothing upstream limits its
 * length, so an unbounded scan is an unbounded amount of work triggerable by
 * whoever writes the posting.
 *
 * 20,000 characters is roughly ten times the longest description in the
 * benchmark corpus. Truncating the SOURCE can only make the check STRICTER --
 * a wage stated past the cut stops grounding a draft that repeats it, so the
 * draft is refused rather than passed. That is the safe direction, and it is
 * why the cap is not a hole.
 */
export const MAX_CHECKED_CHARS = 20_000;

function clamp(text: string): string {
  return text.length > MAX_CHECKED_CHARS ? text.slice(0, MAX_CHECKED_CHARS) : text;
}

function postingText(job: ExplainPosting): string {
  return clamp(
    [
      job.title ?? "",
      job.company ?? "",
      job.location ?? "",
      job.salary ?? "",
      job.employmentType ?? "",
      job.description,
    ].join("\n"),
  );
}

/**
 * Every fact in `draft` that the posting does not support.
 *
 * An empty array means the draft may be handed to the student. Anything else
 * means it may not, and the caller says which fact was invented rather than
 * refusing generically — the student is told the posting does not say, which
 * is true and actionable, instead of "something went wrong".
 */
export function checkExplanationFaithfulness(
  draft: string,
  job: ExplainPosting,
): FaithfulnessFinding[] {
  const source = postingText(job);
  const checked = clamp(draft);
  const findings: FaithfulnessFinding[] = [];

  for (const value of ungroundedDollarValues(checked, job)) {
    findings.push({ kind: "wage", detail: `$${value}` });
  }
  for (const value of ungroundedHourValues(checked, source)) {
    findings.push({ kind: "hours", detail: `${value} hours` });
  }
  for (const place of ungroundedPlaces(checked, source)) {
    findings.push({ kind: "place", detail: place });
  }
  for (const credential of ungroundedRequirements(checked, source)) {
    findings.push({ kind: "requirement", detail: credential });
  }

  return findings;
}

/** What Sage is told to do when a draft is refused, per fact. */
export const REFUSAL_GUIDANCE: Record<FaithfulnessKind, string> = {
  wage:
    "Tell the student the posting does not say what it pays and that they can ask their " +
    "instructor. Do NOT state a wage for this job.",
  hours:
    "Tell the student the posting does not say how many hours this is. Do NOT state hours " +
    "for this job.",
  place:
    "Tell the student you are not sure where this job is and that they can ask their " +
    "instructor. Do NOT name a town for this job.",
  requirement:
    "Tell the student the posting does not list what you need to have, and that they can ask " +
    "their instructor. Do NOT tell them they need a card or a licence for this job.",
};

/** The `errorCode` on the audit row, per fact. Keeps `ungrounded_wage` stable. */
export const REFUSAL_ERROR_CODE: Record<FaithfulnessKind, string> = {
  wage: "ungrounded_wage",
  hours: "ungrounded_hours",
  place: "ungrounded_place",
  requirement: "ungrounded_requirement",
};
