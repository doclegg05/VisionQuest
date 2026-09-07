/**
 * De-identification core: a per-request TokenVault that swaps known student /
 * staff / roster identifiers (and, optionally, contact details found in free
 * text) for loud placeholder tokens before a prompt leaves the process, and
 * puts the real values back into whatever the model returns.
 *
 * Design: docs/audits/2026-09-06-ferpa-pii-review/B-prompt-contents-and-deidentification.md §2,
 * precision rules in the 1C ticket. The decorator that applies a vault to an
 * `AIProvider` lives in ./with-deidentification.ts.
 *
 * Three properties the rest of the design leans on:
 *
 *   1. Tokens are LOUD, never plausible. A re-hydration miss shows up in the
 *      UI as `[STUDENT_NAME]`, not as a fake name nobody would notice. Do not
 *      "improve" this with synthetic names.
 *   2. Re-hydration is ISSUE-SCOPED. Only tokens this vault actually issued are
 *      ever replaced, so a token-shaped string a student typed (or a model
 *      invented) cannot pull a roster name out of the vault. The decorator
 *      additionally neutralises token shapes in user-authored text
 *      (`neutralizeTokenShapes`) so the model never sees a forged one either.
 *   3. Tokens carry no `_START`/`_END` suffix, so `sanitizeForPrompt`
 *      (src/lib/sage/system-prompts.ts) leaves them alone, and no quotes,
 *      so a token inside a JSON string value keeps the JSON valid.
 *
 * Dependency-free apart from the two regexes it shares with log-redaction.ts:
 * no Prisma, no logger. Nothing in here may log a vault value.
 */

import { EMAIL_PATTERN, PHONE_PATTERN } from "../log-redaction";

export interface IdentityInput {
  /** Student.displayName */
  studentName?: string | null;
  studentEmail?: string | null;
  /** Student.studentId — the login username. Treated as an identifier (F12). */
  studentLoginId?: string | null;
  studentPhone?: string | null;
  /** Instructors / case-note authors visible in this request. */
  staffNames?: readonly string[];
  /** Other students whose names may appear (staff chat). */
  rosterNames?: readonly string[];
}

export interface DeidentifyOptions {
  /**
   * Also vault emails, phones, dates of birth and US street addresses found in
   * free text (default true). Each distinct value gets its own numbered token,
   * reused when it recurs, and is reversible within this request.
   */
  freeText?: boolean;
  /**
   * Values that must never be tokenized, wherever they appear: the 988 crisis
   * line and its 1-800 alias, the program office's own contact details, the
   * program's own name. Two reasons they are an allowlist rather than an
   * accident of the patterns:
   *
   *  - The system prompt carries them and the student must be able to read
   *    them back out of Sage's reply. A tokenized crisis number that fails to
   *    re-hydrate is a safety regression, not a privacy win.
   *  - They are not anybody's personal data, so vaulting them buys nothing.
   *
   * Matching is word-boundary anchored and case-insensitive, and a
   * NANP-shaped entry also protects its other common formattings. A DIFFERENT
   * value of the same shape (a student's own phone) is untouched by this and
   * is still tokenized — see the resolver's constant list in
   * ./deidentify-allowlist.ts.
   */
  allowlist?: readonly string[];
}

// ─── Word boundaries ─────────────────────────────────────────────────────────

/**
 * Unicode-aware word characters: letters, digits and combining marks. Used as
 * lookaround boundaries instead of `\b` (which is ASCII-only), so "Art" never
 * matches inside "Arturo", but "María" and "O'Brien" match as whole words.
 * Combining marks are included so a following accent is never read as a
 * boundary on decomposed text.
 */
const WORD_CHAR = "\\p{L}\\p{N}\\p{M}";
const NOT_AFTER_WORD = `(?<![${WORD_CHAR}])`;
const NOT_BEFORE_WORD = `(?![${WORD_CHAR}])`;

/** Separator allowed between the words of a multi-word name in source text. */
const NAME_SEPARATOR = "[\\s.\\-']{1,3}";

const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** Title words that are never matched on their own as a name part. */
const HONORIFICS = new Set([
  "mr", "mrs", "ms", "miss", "mx", "dr", "prof", "professor", "coach", "sr", "jr", "ii", "iii", "iv",
]);

/**
 * Below this length a name part is matched only when the source text has it
 * capitalised — "Will", "Art" and "May" are also ordinary words.
 */
const CASE_INSENSITIVE_MIN_LENGTH = 5;
/** Single-word roster / staff names shorter than this are never matched. */
const OTHER_NAME_MIN_LENGTH = 3;
/** The student's own single-word name may be as short as this (capitalised). */
const STUDENT_NAME_MIN_LENGTH = 2;
/** Name PARTS (of a multi-word name) shorter than this are never matched. */
const NAME_PART_MIN_LENGTH = 3;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCapitalised(text: string): boolean {
  const first = text.charAt(0);
  return first !== "" && first !== first.toLowerCase() && first === first.toUpperCase();
}

function nameWords(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(EDGE_PUNCTUATION, ""))
    .filter((word) => word.length > 0);
}

// ─── Structured entries ──────────────────────────────────────────────────────

interface StructuredEntry {
  token: string;
  /** Regex source for this entry (already escaped). */
  source: string;
  /** Sort key: longer values are tried first. */
  length: number;
  /** Match only when the source text has the value capitalised. */
  requireCapital: boolean;
  /**
   * A literal contact value (email, login id, phone) rather than a person's
   * name. Contact values are substituted BEFORE the free-text families and
   * names AFTER — see `pseudonymizeSegment` for why the order matters.
   */
  contact: boolean;
}

type NameKind = "student" | "other";

type NameCandidate = Omit<StructuredEntry, "token" | "contact"> & {
  key: string;
  /**
   * True for the FIRST word of a multi-word name (skipping honorifics). The
   * student's own first name gets its own token so a first-name-only mention
   * re-hydrates to the first name — see `[STUDENT_FIRST_NAME]` below.
   */
  isGivenName: boolean;
};

/**
 * Candidate entries for one name. A multi-word name matches as a whole (any
 * case) AND each part of 3+ characters under the capitalisation rule; a
 * single-word name matches only itself.
 */
function nameEntries(value: string, kind: NameKind): NameCandidate[] {
  const words = nameWords(value);
  if (words.length === 0) return [];

  const out: NameCandidate[] = [];
  const minSingle = kind === "student" ? STUDENT_NAME_MIN_LENGTH : OTHER_NAME_MIN_LENGTH;

  if (words.length === 1) {
    const word = words[0];
    if (word.length < minSingle) return [];
    return [
      {
        key: word.toLowerCase(),
        source: escapeRegExp(word),
        length: word.length,
        requireCapital: word.length < CASE_INSENSITIVE_MIN_LENGTH,
        // A one-word display name IS the whole name: splitting it would issue
        // two tokens for one value with nothing to distinguish them.
        isGivenName: false,
      },
    ];
  }

  const whole = words.join(" ");
  out.push({
    key: whole.toLowerCase(),
    source: words.map(escapeRegExp).join(NAME_SEPARATOR),
    length: whole.length,
    requireCapital: false,
    isGivenName: false,
  });
  let seenGivenName = false;
  for (const word of words) {
    if (word.length < NAME_PART_MIN_LENGTH) continue;
    if (HONORIFICS.has(word.toLowerCase())) continue;
    const isGivenName = !seenGivenName;
    seenGivenName = true;
    out.push({
      key: word.toLowerCase(),
      source: escapeRegExp(word),
      length: word.length,
      requireCapital: word.length < CASE_INSENSITIVE_MIN_LENGTH,
      isGivenName,
    });
  }
  return out;
}

/**
 * The word `nameEntries` would mark as the given name, in its ORIGINAL casing
 * — the value `[STUDENT_FIRST_NAME]` re-hydrates to. Null when the display
 * name is one word (the whole name already covers it) or when no word
 * qualifies.
 */
function givenNameWord(value: string): string | null {
  const words = nameWords(value);
  if (words.length < 2) return null;
  for (const word of words) {
    if (word.length < NAME_PART_MIN_LENGTH) continue;
    if (HONORIFICS.has(word.toLowerCase())) continue;
    return word;
  }
  return null;
}

function literalEntry(value: string, minLength: number): { key: string; source: string; length: number } | null {
  const trimmed = value.trim();
  if (trimmed.length < minLength) return null;
  return { key: trimmed.toLowerCase(), source: escapeRegExp(trimmed), length: trimmed.length };
}

/**
 * A stored phone is matched in any common formatting: "+13045551234",
 * "(304) 555-1234", "304.555.1234", "1 304 555 1234". Anything that is not a
 * 10-digit North American number falls back to a literal match.
 */
function phoneEntry(value: string): { key: string; source: string; length: number } | null {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return literalEntry(value, 7);
  const sep = "[\\s.\\-]?";
  return {
    key: digits,
    source: `(?:\\+?1[\\s.\\-]?)?\\(?${digits.slice(0, 3)}\\)?${sep}${digits.slice(3, 6)}${sep}${digits.slice(6)}`,
    length: digits.length,
  };
}

/**
 * One regex source protecting every allowlisted value, longest first, word
 * boundary anchored. A NANP-shaped entry reuses `phoneEntry` so
 * "1-800-273-8255" also protects "(800) 273-8255"; everything else is a
 * literal. Returns null for an empty allowlist so the hot path skips the
 * segmentation entirely.
 */
function allowlistPattern(values: readonly string[]): RegExp | null {
  const sources: Array<{ source: string; length: number }> = [];
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    const entry = /\d/.test(value) ? phoneEntry(value) : literalEntry(value, 1);
    if (entry) sources.push({ source: entry.source, length: value.length });
    else sources.push({ source: escapeRegExp(value), length: value.length });
  }
  if (sources.length === 0) return null;
  sources.sort((a, b) => b.length - a.length);
  return new RegExp(
    `${NOT_AFTER_WORD}(?:${sources.map((s) => s.source).join("|")})${NOT_BEFORE_WORD}`,
    "giu",
  );
}

// ─── Free-text families ──────────────────────────────────────────────────────

const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/**
 * Numeric `M/D/YY(YY)` (slash or dash) and month-name forms with a day AND a
 * year ("March 14, 1987", "14 March 1987"). A bare year, a month + year, or
 * `MM/DD` without a year is not a date of birth and is left alone.
 */
const DOB_SOURCE =
  `\\b(?:\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}` +
  `|\\d{1,2}\\s+${MONTH}\\.?,?\\s+\\d{4}` +
  `|${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4})\\b`;

/** US street address: number, 1-3 capitalised words, a street suffix. */
const ADDRESS_SOURCE =
  "\\b\\d{1,6}\\s+(?:[A-Z][a-z]+\\s+){1,3}(?:St|Street|Rd|Road|Ave|Avenue|Ln|Lane|Dr|Drive|Hwy|Highway|Route|Rt|Blvd|Ct|Court)\\b\\.?";

interface FreeTextFamily {
  prefix: "EMAIL" | "PHONE" | "DOB" | "ADDRESS";
  pattern: RegExp;
  /** Normalise a match so the same value in different casing/spacing reuses its token. */
  key: (match: string) => string;
}

function collapsedLower(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Fresh RegExp instances: the exported patterns are global and a global regex
 * carries `lastIndex` between calls, so sharing the instances with
 * log-redaction.ts would couple the two modules' scan state.
 */
function freeTextFamilies(): FreeTextFamily[] {
  return [
    { prefix: "EMAIL", pattern: new RegExp(EMAIL_PATTERN.source, "g"), key: collapsedLower },
    { prefix: "PHONE", pattern: new RegExp(PHONE_PATTERN.source, "g"), key: (m) => m.replace(/\D/g, "") },
    { prefix: "DOB", pattern: new RegExp(DOB_SOURCE, "gi"), key: collapsedLower },
    { prefix: "ADDRESS", pattern: new RegExp(ADDRESS_SOURCE, "g"), key: (m) => collapsedLower(m).replace(/\.$/, "") },
  ];
}

// ─── Forgery ─────────────────────────────────────────────────────────────────

/**
 * Anything shaped like a vault token: bracketed UPPERCASE words joined by
 * underscores with an optional numeric suffix, interior whitespace tolerated.
 * `_START` / `_END` suffixes are excluded on purpose: those are the prompt
 * layer's own fences (some call sites send them in role:"user" messages), they
 * can never be vault tokens, and `sanitizeForPrompt` owns them.
 */
const TOKEN_SHAPE = /\[\s*([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)\s*\]/g;

/**
 * Rewrite token-shaped strings in USER-AUTHORED text into a visibly different,
 * harmless form (`[PERSON_2]` → `(PERSON_2)`) so a student who types a token
 * cannot cause re-hydration to insert someone else's name. Apply to user
 * messages only — never to the system prompt, which the app authors.
 */
export function neutralizeTokenShapes(userText: string): string {
  return userText.replace(TOKEN_SHAPE, (match, name: string) =>
    /_(?:START|END)$/.test(name) ? match : `(${name})`,
  );
}

function buildStructuredPattern(entries: StructuredEntry[]): RegExp | null {
  if (entries.length === 0) return null;
  return new RegExp(
    `${NOT_AFTER_WORD}(?:${entries.map((e) => `(${e.source})`).join("|")})${NOT_BEFORE_WORD}`,
    "giu",
  );
}

// ─── The vault ───────────────────────────────────────────────────────────────

export interface StreamRehydrator {
  /** Append a model chunk; returns the text that is safe to emit now. */
  push(chunk: string): string;
  /** Emit whatever is still held (never a complete token) verbatim. */
  flush(): string;
}

const MAX_WALK_DEPTH = 64;

export class TokenVault {
  /** token → value, for every token this vault has issued. */
  private readonly issued = new Map<string, string>();
  /** Bumped whenever `issued` changes so derived regexes rebuild lazily. */
  private version = 0;

  /** Literal contact values, substituted before the free-text families. */
  private readonly contactEntries: StructuredEntry[];
  private readonly contactPattern: RegExp | null;
  /** Person names, substituted after them. */
  private readonly nameEntriesList: StructuredEntry[];
  private readonly namePattern: RegExp | null;
  private readonly families: FreeTextFamily[];
  /** Values never tokenized; null when the allowlist is empty. */
  private readonly allowlist: RegExp | null;
  /** family prefix + normalised value → token (free-text reuse). */
  private readonly freeTextTokens = new Map<string, string>();
  private readonly freeTextCounters = new Map<string, number>();

  private rehydrateCache: { version: number; pattern: RegExp | null } = { version: -1, pattern: null };
  private prefixCache: { version: number; prefixes: Set<string>; maxLength: number } = {
    version: -1,
    prefixes: new Set(),
    maxLength: 0,
  };

  private constructor(
    entries: StructuredEntry[],
    values: Map<string, string>,
    families: FreeTextFamily[],
    allowlist: RegExp | null,
  ) {
    this.allowlist = allowlist;
    const byLength = (a: StructuredEntry, b: StructuredEntry) => b.length - a.length;
    this.contactEntries = entries.filter((entry) => entry.contact).sort(byLength);
    this.nameEntriesList = entries.filter((entry) => !entry.contact).sort(byLength);
    this.contactPattern = buildStructuredPattern(this.contactEntries);
    this.namePattern = buildStructuredPattern(this.nameEntriesList);
    this.families = families;
    for (const [token, value] of values) this.issued.set(token, value);
  }

  static fromIdentity(input: IdentityInput, options: DeidentifyOptions = {}): TokenVault {
    const freeText = options.freeText ?? true;
    const entries: StructuredEntry[] = [];
    const values = new Map<string, string>();
    /** Lower-cased value keys already claimed, so a shared value keeps its first token. */
    const claimed = new Set<string>();

    const add = (
      token: string,
      candidates: Array<{ key: string; source: string; length: number; requireCapital?: boolean }>,
      value: string,
      contact = false,
    ): boolean => {
      let added = false;
      for (const candidate of candidates) {
        if (claimed.has(candidate.key)) continue;
        claimed.add(candidate.key);
        entries.push({
          token,
          source: candidate.source,
          length: candidate.length,
          requireCapital: candidate.requireCapital ?? false,
          contact,
        });
        added = true;
      }
      if (added) values.set(token, value.trim());
      return added;
    };

    if (input.studentName?.trim()) {
      // [STUDENT_NAME] takes the whole display name and every part except the
      // given name; [STUDENT_FIRST_NAME] takes the given name and re-hydrates
      // to it alone. Without the split, Sage's scripted "Hey [name]" echo came
      // back as "Hey Jordan Lee" — one token cannot carry two values, and the
      // full name is the wrong one for the greeting.
      //
      // Order matters: the full-name entries claim their keys first, so the
      // whole name (longest) is always tried before the given name.
      const candidates = nameEntries(input.studentName, "student");
      add(
        "[STUDENT_NAME]",
        candidates.filter((candidate) => !candidate.isGivenName),
        input.studentName,
      );
      const given = givenNameWord(input.studentName);
      if (given) {
        add(
          "[STUDENT_FIRST_NAME]",
          candidates.filter((candidate) => candidate.isGivenName),
          given,
        );
      }
    }
    if (input.studentEmail?.trim()) {
      const entry = literalEntry(input.studentEmail, 3);
      if (entry) add("[STUDENT_EMAIL]", [entry], input.studentEmail, true);
    }
    if (input.studentLoginId?.trim()) {
      const entry = literalEntry(input.studentLoginId, 3);
      if (entry) add("[STUDENT_LOGIN]", [entry], input.studentLoginId, true);
    }
    if (input.studentPhone?.trim()) {
      const entry = phoneEntry(input.studentPhone);
      if (entry) add("[STUDENT_PHONE]", [entry], input.studentPhone, true);
    }
    let teacherIndex = 0;
    for (const name of input.staffNames ?? []) {
      if (!name?.trim()) continue;
      const token = `[TEACHER_NAME_${teacherIndex + 1}]`;
      if (add(token, nameEntries(name, "other"), name)) teacherIndex += 1;
    }
    let personIndex = 0;
    for (const name of input.rosterNames ?? []) {
      if (!name?.trim()) continue;
      const token = `[PERSON_${personIndex + 1}]`;
      if (add(token, nameEntries(name, "other"), name)) personIndex += 1;
    }

    return new TokenVault(
      entries,
      values,
      freeText ? freeTextFamilies() : [],
      allowlistPattern(options.allowlist ?? []),
    );
  }

  /** True when the vault holds no token at all — callers skip wrapping then. */
  get isEmpty(): boolean {
    return this.issued.size === 0;
  }

  /** Length of the longest issued token; bounds the streaming carry buffer. */
  get maxTokenLength(): number {
    return this.prefixes().maxLength;
  }

  /** Issued token names, sorted. Never values. */
  tokenNames(): string[] {
    return [...this.issued.keys()].sort();
  }

  /**
   * Replace known identifiers (and, with freeText, detected contact details)
   * with tokens. Deterministic per vault: the same input always yields the
   * same output, and a free-text value seen again reuses its token.
   */
  pseudonymize(text: string): string {
    if (!this.allowlist) return this.pseudonymizeSegment(text);
    // Split around allowlisted values and transform only what is between
    // them, so an allowlisted value is returned byte-for-byte and never
    // issues a token. Anchored on the whole text, not per family, so one
    // pass protects structured substitution and free-text detection alike.
    let out = "";
    let last = 0;
    this.allowlist.lastIndex = 0;
    for (const match of text.matchAll(this.allowlist)) {
      const index = match.index ?? 0;
      out += this.pseudonymizeSegment(text.slice(last, index)) + match[0];
      last = index + match[0].length;
    }
    return out + this.pseudonymizeSegment(text.slice(last));
  }

  /**
   * Three passes, in this order, and the order is the whole point:
   *
   *  1. Literal contact values we already know (`[STUDENT_EMAIL]`,
   *     `[STUDENT_LOGIN]`, `[STUDENT_PHONE]`) — the most specific tokens win.
   *  2. The free-text families, so an email or phone we did NOT know still
   *     becomes one token.
   *  3. Person names.
   *
   * Names must come last because a multi-word name pattern matches INSIDE an
   * address: "jordan.lee@example.org" contains `Jordan[.\s-]Lee`, so a
   * names-first pass produced "[STUDENT_NAME]@example.org" — the local part
   * substituted, the domain left behind, and the EMAIL family never fired
   * because its match had already been broken up. Found by the memory
   * write-time pass, which vaults a name without an email.
   */
  private pseudonymizeSegment(text: string): string {
    let out = this.applyStructured(text, this.contactPattern, this.contactEntries);
    for (const family of this.families) {
      out = out.replace(family.pattern, (match: string) => this.issueFreeText(family, match));
    }
    return this.applyStructured(out, this.namePattern, this.nameEntriesList);
  }

  private applyStructured(text: string, pattern: RegExp | null, entries: StructuredEntry[]): string {
    if (!pattern) return text;
    return text.replace(pattern, (match: string, ...rest: unknown[]) => {
      let index = -1;
      for (let i = 0; i < entries.length; i += 1) {
        if (rest[i] !== undefined) {
          index = i;
          break;
        }
      }
      if (index === -1) return match;
      const entry = entries[index];
      if (entry.requireCapital && !isCapitalised(match)) return match;
      return entry.token;
    });
  }

  /**
   * Restore ONLY tokens this vault issued. Unknown token-shaped strings pass
   * through untouched. With `json: true` each value is escaped for a JSON
   * string context, so re-hydrating a structured (JSON) reply keeps it
   * parseable even when a value carries quotes, backslashes or newlines.
   */
  rehydrate(text: string, options: { json?: boolean } = {}): string {
    const pattern = this.rehydratePattern();
    if (!pattern) return text;
    const json = options.json === true;
    return text.replace(pattern, (token: string) => {
      const value = this.issued.get(token);
      if (value === undefined) return token;
      return json ? JSON.stringify(value).slice(1, -1) : value;
    });
  }

  /**
   * Streaming re-hydrator. Holds back the longest suffix of the raw buffer
   * that is a proper prefix of an issued token (`[`, `[ST`, `[STUDENT_NA`) and
   * emits everything before it re-hydrated. The carry is bounded by the
   * longest issued token, so a `[` that never completes delays at most that
   * many characters. `flush()` emits the remainder verbatim — it can never
   * hold a complete token, and it never holds a value, because values only
   * enter through re-hydration of the emitted part. A consumer that abandons
   * the stream without calling `flush()` therefore drops at most a half token.
   */
  createStreamRehydrator(): StreamRehydrator {
    let pending = "";
    return {
      push: (chunk: string): string => {
        pending += chunk;
        const { prefixes, maxLength } = this.prefixes();
        let holdFrom = pending.length;
        if (maxLength > 1) {
          const windowStart = Math.max(0, pending.length - (maxLength - 1));
          for (let i = windowStart; i < pending.length; i += 1) {
            if (pending.charCodeAt(i) === 0x5b /* [ */ && prefixes.has(pending.slice(i))) {
              holdFrom = i;
              break;
            }
          }
        }
        const head = pending.slice(0, holdFrom);
        pending = pending.slice(holdFrom);
        return this.rehydrate(head);
      },
      flush: (): string => {
        const rest = pending;
        pending = "";
        return rest;
      },
    };
  }

  /** Deep-walk a JSON-ish value, pseudonymizing every string leaf. */
  pseudonymizeValue(value: unknown): unknown {
    return this.walk(value, (s) => this.pseudonymize(s), 0);
  }

  /** Deep-walk a JSON-ish value, re-hydrating every string leaf. */
  rehydrateValue(value: unknown): unknown {
    return this.walk(value, (s) => this.rehydrate(s), 0);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private issueFreeText(family: FreeTextFamily, match: string): string {
    const key = `${family.prefix}:${family.key(match)}`;
    const existing = this.freeTextTokens.get(key);
    if (existing) return existing;
    const next = (this.freeTextCounters.get(family.prefix) ?? 0) + 1;
    this.freeTextCounters.set(family.prefix, next);
    const token = `[${family.prefix}_${next}]`;
    this.freeTextTokens.set(key, token);
    this.issued.set(token, match);
    this.version += 1;
    return token;
  }

  private rehydratePattern(): RegExp | null {
    if (this.rehydrateCache.version !== this.version) {
      const tokens = [...this.issued.keys()].sort((a, b) => b.length - a.length);
      this.rehydrateCache = {
        version: this.version,
        pattern: tokens.length === 0 ? null : new RegExp(tokens.map(escapeRegExp).join("|"), "g"),
      };
    }
    return this.rehydrateCache.pattern;
  }

  private prefixes(): { prefixes: Set<string>; maxLength: number } {
    if (this.prefixCache.version !== this.version) {
      const prefixes = new Set<string>();
      let maxLength = 0;
      for (const token of this.issued.keys()) {
        maxLength = Math.max(maxLength, token.length);
        for (let len = 1; len < token.length; len += 1) prefixes.add(token.slice(0, len));
      }
      this.prefixCache = { version: this.version, prefixes, maxLength };
    }
    return this.prefixCache;
  }

  private walk(value: unknown, fn: (s: string) => string, depth: number): unknown {
    if (typeof value === "string") return fn(value);
    if (depth >= MAX_WALK_DEPTH) return value;
    if (Array.isArray(value)) return value.map((item) => this.walk(item, fn, depth + 1));
    if (value !== null && typeof value === "object") {
      const proto = Object.getPrototypeOf(value);
      if (proto === Object.prototype || proto === null) {
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
          out[key] = this.walk(item, fn, depth + 1);
        }
        return out;
      }
    }
    return value;
  }
}
