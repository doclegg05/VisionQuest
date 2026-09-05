import { createHash } from "node:crypto";
import { prisma, prismaAdmin } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendNotificationWithCooldown } from "@/lib/notifications";
import { enqueueJobWithCooldown } from "@/lib/jobs";
import {
  WELLBEING_ALERT_TYPE,
  WELLBEING_MOOD_LOOKBACK_DAYS,
  WELLBEING_RESPONSE_CHECKLIST,
  formatWellbeingCardSummary,
  type WellbeingMoodSnapshot,
} from "./wellbeing-card";
import { studentLogKey } from "@/lib/log-keys";

/**
 * Wellbeing / crisis safety-net.
 *
 * The product has no human-in-the-loop for student distress: Sage's prompt
 * tells a student in crisis to call 988, but until now NOTHING alerted the
 * instructor. For an adult TANF/SNAP population that is the highest day-1
 * liability. This module closes that gap with a deterministic detector (no AI
 * call, runs on every chat turn) plus a low-mood hook, that raise a CRITICAL
 * StudentAlert and actively notify staff.
 *
 * Privacy (locked product decision): NO message text is ever stored on the
 * alert or in the notification, and teachers have NO transcript access. So the
 * alert must be actionable on its own: it carries a structured crisis-context
 * card (trigger category, detection time, recent mood if any, and a
 * recommended-response checklist — see src/lib/sage/wellbeing-card.ts). The
 * detector errs toward alerting (favor recall); the instructor reviews and
 * dismisses false positives, which is cheap and safe.
 */

export type CrisisCategory = "self_harm" | "harm_others" | "abuse";
export type CrisisLang = "en" | "es";
export type WellbeingReason = "message_signal" | "low_mood";

interface CrisisPattern {
  category: CrisisCategory;
  pattern: RegExp;
  /**
   * Language of the phrase family. Used ONLY to localize the student-facing
   * 988 resource block (src/lib/chat/crisis-safety-net.ts) — staff alerting
   * and routing are language-independent. Omitted = English.
   */
  lang?: CrisisLang;
}

// Phrase-level, word-boundary matched, case-insensitive. Phrases (not bare
// words) keep false positives down — e.g. we match "want to die" but not the
// idiom "dying to", and "kill myself" but not "killer deal". Tunable.
const CRISIS_PATTERNS: CrisisPattern[] = [
  { category: "self_harm", pattern: /\b(kill(ing)?\s+myself|killed\s+myself)\b/i },
  { category: "self_harm", pattern: /\b(end(ing)?\s+(my\s+life|it\s+all)|take\s+my\s+(own\s+)?life)\b/i },
  { category: "self_harm", pattern: /\bsuicid(e|al)\b/i },
  { category: "self_harm", pattern: /\b(want|going|need)\s+to\s+die\b/i },
  { category: "self_harm", pattern: /\b(wish\s+i\s+(was|were)\s+dead|better\s+off\s+dead|no\s+reason\s+to\s+(live|be\s+here)|don'?t\s+want\s+to\s+(live|be\s+here)|can'?t\s+go\s+on)\b/i },
  // Passive ideation phrased around absence rather than death — "better off
  // without me" / "if I just disappeared". Surfaced by the sage-redteam-eval
  // crisis-paraphrase scenario, which this detector previously missed.
  { category: "self_harm", pattern: /\b(better\s+off\s+(without\s+me|if\s+i\s+(just\s+)?disappeared)|want\s+to\s+(just\s+)?disappear)\b/i },
  // The verb list is spelled out rather than suffixed, so the PROGRESSIVE form
  // of every member is covered. The old alternation offered only "ting" or "t"
  // after the stem, which happens to spell "cutting" and nothing else: "hurting
  // myself" and "harming myself" were both verified misses, and they are the
  // ordinary way a student describes an act that is still going on ("i keep
  // hurting myself", "i been harming myself"). "cuting" is accepted as the
  // predictable single-t typo of the one member whose progressive doubles.
  { category: "self_harm", pattern: /\b((?:hurt|harm|cut)(?:t?ing|t)?\s+myself|self[-\s]?harm(ing)?)\b/i },

  // --- Informal register (VQ-R-004). The patterns above all require formal
  // "want to" constructions, but the product targets adults at a ~6th-grade
  // reading level who text in contractions and euphemism. Every phrase in
  // crisis-detection-informal.test.ts was a verified MISS before these entries.
  // Same recall-first policy as the rest of this list; the companion test also
  // pins the false-positive guards ("wanna die my hair", "took my medication"),
  // because an alert stream staff learn to ignore is a dead safety net.
  // Contractions of the die/disappear family.
  // The "die my hair" exemption is the dye homophone and must end at a word
  // boundary: without the trailing \b it also swallowed "die my hairbrush …",
  // suppressing a real disclosure because the next word merely starts with
  // "hair".
  { category: "self_harm", pattern: /\b(wanna|gonna|needa)\s+die\b(?!\s+my\s+hair\b)/i },
  { category: "self_harm", pattern: /\bdon'?t\s+wanna\s+(live|be\s+here)\b/i },
  { category: "self_harm", pattern: /\bwanna\s+(just\s+)?disappear\b/i },
  // Filter-evading euphemism, common in online/text register.
  { category: "self_harm", pattern: /\bunaliv(e|ed|ing)\b/i },
  // Abbreviations. "kys" ("kill yourself") is the abbreviation students
  // actually type; the entry here previously pinned "ksy", a transposition of
  // it, so the real form was a verified MISS while a typo was guarded.
  //
  // "kms" is also kilometres, and this entry carries no lang tag — so
  // "caminé 5 kms hoy" served a Spanish speaker the ENGLISH 988 block, the
  // file's only cross-language leak. Two narrow guards, both on senses that
  // are unambiguously distance: a digit immediately before (with or without a
  // space), and a following "away"/"from". Recall is otherwise untouched —
  // bare "kms", "gonna kms" and "i might kms tonight" all still alert.
  //
  // THE DISTANCE GUARDS MUST HOLD IN BOTH LANGUAGES, and the first attempt at
  // that failed for a reason worth writing down: it ended its Spanish lookahead
  // with \b, and JS \b is ASCII-only, so it cannot assert a boundary after "í".
  // "a unos kms de aquí" only stayed silent because the QUANTITY lookbehind
  // caught it — the lookahead was dead code, and "queda a kms de aquí" (no
  // quantity word) still alerted, with lang "en", serving a Spanish speaker the
  // ENGLISH 988 block. That is a fixture passing for the wrong reason, the exact
  // hazard the 2026-08-21 review named. The remedy is this file's own,
  // documented 200 lines down for the Spanish block: end on
  // (?![\wáéíóúüñ]) instead of \b.
  //
  // Three guards now, each on a sense that is unambiguously distance:
  //
  //   1. QUANTITY BEFORE. "a unos/unas/pocos/pocas/varios/varias kms" and the
  //      Spanish number words, plus the English "a few / a couple of / about /
  //      around / roughly / some / several" — the last of which closes
  //      "the office is a few kms down the road", an ENGLISH row that the
  //      away/from lookahead alone did not cover.
  //   2. SPANISH "de" AFTER. "kms de …" is a distance phrase in Spanish
  //      whatever follows it — "de aquí", "de distancia", "de mi casa",
  //      "del centro". Guarding on the preposition rather than an enumerated
  //      list of destinations means the next destination nobody thought of is
  //      covered too, and there is no Spanish sentence where "kms de" reads as
  //      an English self-harm abbreviation.
  //   3. ENGLISH direction word AFTER, widened from away/from to include
  //      down/up/apart.
  //
  // Recall is untouched: bare "kms", "gonna kms", "i might kms tonight" and
  // every "kys" form still alert, in either language, because none of them
  // carries a quantity frame or a distance preposition.
  {
    category: "self_harm",
    pattern: new RegExp(
      "(?<!\\d)(?<!\\d\\s)" +
        "(?<!\\b(?:a\\s+(?:few|couple\\s+of|unos|unas|pocos|pocas|varios|varias|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)|about|around|roughly|some|several)\\s)" +
        "\\b(?:kms|kys)\\b" +
        "(?!\\s+(?:away|from|down|up|apart)\\b)" +
        "(?!\\s+del?(?![\\wáéíóúüñ]))",
      "i",
    ),
  },
  // "ending things" — the formal pattern only covered "my life" / "it all".
  // PRECISION EXCEPTION to this module's recall-first policy, written down so
  // the owner can veto it in review: "end things WITH <someone>" is a breakup,
  // and relationship talk is precisely what students bring to a coach, so both
  // 2026-08-21 reviews scored the unguarded form the highest-frequency false
  // positive in the file. The exemption is only the "with" frame; "thinking
  // about ending things" and "i want to end things" still alert.
  { category: "self_harm", pattern: /\bend(?:ing)?\s+things\b(?!\s+with\b)/i },
  { category: "self_harm", pattern: /\bbetter\s+off\s+if\s+i\s+(wasn'?t|was\s+not|weren'?t)\s+here\b/i },
  // Method-adjacent disclosure: a stated plan or a past act outranks ideation.
  // Both are bounded so third-person mentions ("that overdose documentary")
  // and ordinary adherence ("took my medication this morning") stay silent.
  { category: "self_harm", pattern: /\b(wanna|gonna|going\s+to|want\s+to|tried\s+to)\s+(od|overdose)\b/i },
  // "overdose myself" is inherently first-person, so it fires on its own.
  // "overdose ON <thing>" is not: the object phrase is at least as natural
  // about someone else, and "my brother overdosed on fentanyl last year" is
  // grief, not disclosure — yet it alerted, contradicting the comment above.
  // The frame is an "i", tolerating contractions and a bounded two-word gap
  // ("i'm overdosing on", "i nearly overdosed on", "i think i overdosed on"),
  // so a distant "i" elsewhere in the sentence cannot supply it — "my mom
  // overdosed on pills when i was little" stays silent. The Spanish
  // "sobredosis" twin below has required a first-person frame all along; this
  // restores the parity.
  { category: "self_harm", pattern: /\boverdos(?:e|ed|ing)\s+myself\b/i },
  // The frame accepts the UNPUNCTUATED contractions too ("im", "ive", "id").
  // This population writes without apostrophes — the informal-register set
  // exists because of it — so "im overdosing on these pills right now" was a
  // miss while "i'm overdosing on these pills" alerted, and a disclosure in
  // progress is the worst possible place for that gap. Widening the pronoun
  // costs no precision here: the frame still demands the overdose verb and its
  // "on" object within two words, so a bare "im" or a stray "id" elsewhere in
  // a sentence cannot reach it, and the third-person guards below
  // ("my mom overdosed on pills when i was little") are unaffected because
  // their "i" sits AFTER the verb.
  // The bounded two-word gap is what makes this frame first-person, and it was
  // wide enough to let a third-person SUBJECT stand inside it: "i" + "worried
  // he" + "overdosed on" matched, so a student expressing concern about
  // somebody else raised a CRITICAL alert on themselves and named their own
  // instructors. Measured, not theorised — four such sentences were silent
  // before the unpunctuated pronouns were added and alerting after, which is
  // why the earlier claim that widening the pronoun "costs no precision" was
  // wrong. The gap now refuses third-person pronouns and possessives: this
  // frame is about the student, so nothing inside it may name anyone else.
  // "i nearly overdosed on tylenol" and "i think i overdosed on" still match,
  // because "nearly" and "i" are not on the refusal list.
  {
    category: "self_harm",
    pattern:
      /\bi(?:'?m|'?ve|'?d)?(?:\s+(?!(?:he|she|they|him|her|his|hers|them|their|theirs|my|your|our|its|someone|somebody|everyone|people|folks)\b)\w+){0,2}\s+overdos(?:e|ed|ing)\s+on\b/i,
  },
  // Past act. The verb list is "took|taken|swallowed", not a bare "take":
  // "ive taken too many pills" and "i swallowed all my medication" are the
  // same disclosure in the same register as the pinned "i took all my pills"
  // and were both silent, while a bare present "take" is exactly how adherence
  // talk reads ("i take all my pills every morning", pinned silent) and must
  // stay out. The quantity + medication bounds are unchanged, so nothing that
  // used to alert on the NOUN side stops alerting.
  { category: "self_harm", pattern: /\b(?:took|taken|swallowed)\s+(all|a\s+bunch\s+of|a\s+lot\s+of|too\s+many)\s+(of\s+)?(my\s+|the\s+)?(pills|meds|medication|tylenol|advil)\b/i },
  // Same disclosure stated as a PLAN rather than a past act ("i'm going to take
  // all my pills tonight"). The two entries above between them only covered
  // intent toward the bare verb ("gonna od") and the completed act ("took all
  // my pills"), so intent naming the method fell through — while the Spanish
  // entry below already matched its equivalent. Doubly bounded, same as the
  // past-act entry: the verb must come from the crisis-intent list (so the bare
  // present "i take all my pills every morning" and obligation modals like
  // "i need to take all my meds before bed" stay silent) AND a quantity word
  // must precede a medication noun (so "i want to take all my certifications"
  // stays silent). Verb list is deliberately identical to the od/overdose entry.
  { category: "self_harm", pattern: /\b(wanna|gonna|going\s+to|want\s+to|tried\s+to)\s+take\s+(all|a\s+bunch\s+of|a\s+lot\s+of|too\s+many)\s+(of\s+)?(my\s+|the\s+)?(pills|meds|medication|tylenol|advil)\b/i },
  { category: "harm_others", pattern: /\b(want|going)\s+to\s+(hurt|kill)\s+(someone|him|her|them|people|everyone)\b/i },
  { category: "abuse", pattern: /\b(be(ing)?\s+abused|he\s+hits\s+me|she\s+hits\s+me|they\s+hit\s+me|hits?\s+me\s+at\s+home|hurt(s|ing)?\s+me\s+at\s+home|being\s+(hurt|hit)\s+at\s+home)\b/i },

  // --- Spanish (es) — P2-7. Same phrase-level, case-insensitive, word-boundary
  // style as the English set above; English entries are untouched and tested
  // first. Accented and unaccented spellings are both matched via explicit
  // alternations ("daño"/"dano", "mí"/"mi", "más"/"mas") because students often
  // type without accents; no Unicode-insensitive flags are used, so existing
  // behavior cannot shift. NOTE: JS \b is ASCII-only and fails AFTER a final
  // accented letter ("mí", "pegó"), so those entries end with a
  // (?![\wáéíóúüñ]) guard instead of \b. Sensitivity mirrors English — err
  // toward alerting: idioms like "quiero morir de risa" match, exactly as
  // "want to die" matches "I want to die laughing".
  // self_harm (es)
  { category: "self_harm", lang: "es", pattern: /\b(me\s+quiero\s+morir|(quiero|quisiera)\s+morir(me)?)\b/i },
  { category: "self_harm", lang: "es", pattern: /\b(matarme|me\s+quiero\s+matar)\b/i },
  { category: "self_harm", lang: "es", pattern: /\bquitarme\s+la\s+vida\b/i },
  // Stem match — suicidio, suicida(s), suicidarme, suicidarse, suicidé, ...
  { category: "self_harm", lang: "es", pattern: /\bsuicid/i },
  { category: "self_harm", lang: "es", pattern: /\b(acabar|terminar)\s+con\s+mi\s+vida\b/i },
  { category: "self_harm", lang: "es", pattern: /\bno\s+quiero\s+(vivir|seguir\s+viviendo)\b/i },
  { category: "self_harm", lang: "es", pattern: /\b(no\s+vale\s+la\s+pena\s+vivir|la\s+vida\s+no\s+vale\s+la\s+pena)\b/i },
  { category: "self_harm", lang: "es", pattern: /\b((hacerme|me\s+hago|me\s+hice|me\s+har(é|e)|me\s+quiero\s+hacer)\s+da(ñ|n)o|lastimarme|cortarme\s+las\s+venas)\b/i },
  // CUTTING REGISTER (es) — parity with the English hurt/harm/cutting family.
  // English covers the act in every tense ("i hurt myself yesterday", "i been
  // hurting myself"); Spanish covered only the fixed phrase "cortarme las
  // venas" plus the "hacerme daño" family, so the most ordinary Spanish form of
  // the same disclosure — "me corté los brazos" — was silent, and so was
  // "me hice cortes", which has no benign reading at all.
  //
  // Discriminated by BODY PART, not by the verb: "me corté" is also exactly how
  // a kitchen accident is described, and unlike English (where
  // "i cut myself chopping onions" is a recorded, accepted false positive) the
  // Spanish side can separate the two cheaply, because the disclosure names
  // where. So "me corté con el cuchillo cocinando", "me corté afeitándome" and
  // "me corte el dedo picando cebolla" all stay silent — pinned — while the
  // arms/wrists/thighs/veins list alerts. "el pelo" is not on the list, which
  // is what keeps the existing haircut guard working.
  //
  // "me hice cortes" needs no body part: making cuts on oneself has no
  // everyday sense. Both clitic positions are handled ("cortarme los brazos" /
  // "me corté los brazos"), the same climbing the sobredosis entry handles.
  { category: "self_harm", lang: "es", pattern: /\b(?:me\s+(?:hice|hago|voy\s+a\s+hacer|quiero\s+hacer)\s+cortes|(?:cortarme|me\s+cort(?:o|é|e|aba|aré|are)|me\s+(?:voy\s+a|quiero)\s+cortar)\s+(?:l[oa]s|el|la|mis?)\s+(?:brazos?|mu(?:ñ|n)ecas?|piernas?|muslos?|venas|cuerpo))/i },
  { category: "self_harm", lang: "es", pattern: /\b(mejor\s+muert[oa]|quisiera\s+estar\s+muert[oa])\b/i },
  // Ambiguous like the English "can't go on" — included per err-toward-alerting.
  { category: "self_harm", lang: "es", pattern: /\b(ya\s+)?no\s+puedo\s+m(á|a)s\b/i },
  // Method-adjacent disclosure (es) — mirrors the English VQ-R-004 entries
  // above: a stated plan or a past act outranks ideation. Bounded the same
  // way: a quantity word ("todas las", "demasiadas", "un montón de") is
  // required so ordinary adherence ("me tomé la pastilla de la presión",
  // "ya me tomé mis pastillas") stays silent, and "sobredosis" requires a
  // first-person frame so third-person mentions ("mi primo murió de una
  // sobredosis") stay silent — the same bounds that keep "took my medication"
  // and "that overdose documentary" quiet in English.
  //
  // VERB REGISTER (es) — the adherence invariant, mirrored from English.
  // A quantity word plus a medication noun is NOT sufficient evidence of
  // disclosure: that is also exactly how a student describes a prescription.
  // What separates the two is the VERB. English pins this with two entries — a
  // past act (L88, "took all my pills") and a stated intent (L99, "gonna take
  // all my pills") — and pins the silence of bare present and obligation
  // modals ("i take all my pills every morning", "i need to take all my meds
  // before bed"). The single Spanish entry that stood here accepted bare
  // present ("me tomo") and bare infinitive ("tomarme"), so ordinary Spanish
  // adherence talk alerted while its English equivalent was pinned silent —
  // a real cross-language asymmetry, not a style difference.
  //
  // The two entries below are therefore an ALLOWLIST of crisis-register verbs.
  // Everything outside it falls through silent by construction: bare habitual
  // present ("me tomo todas las pastillas cada mañana"), obligation modals
  // ("necesito / tengo que / debo tomarme todas las pastillas") and the
  // subjunctive after "que" ("el doctor me dijo que me tome todas las
  // pastillas"). Quantifier + noun groups are unchanged, so nothing that used
  // to alert on the NOUN side stops alerting.
  //
  // 1. Past act. Accented "tomé" is unambiguously the preterite and fires
  //    freely. Unaccented "tome" is also the present subjunctive, so it takes
  //    a "que" guard — that is the whole difference between "me tome todas mis
  //    pastillas" (fires) and "…dijo que me tome todas las pastillas"
  //    (silent). The guard spans the optional clitic so the bare-verb
  //    alternative cannot re-enter the match after "que me".
  { category: "self_harm", lang: "es", pattern: /\b(?:(?:me\s+)?tomé|(?<!\bque\s+(?:me\s+)?)(?:me\s+)?tome)\s+(?:tod[ao]s\s+(?:l[ao]s\s+|mis\s+)?|demasiad[ao]s\s+|much(?:as|os)\s+|un\s+(?:mont(?:o|ó)n|pu(?:ñ|n)ado)\s+de\s+)(?:pastillas|p(?:í|i)ldoras|medicinas|medicamentos|tabletas)\b/i },
  // 2. Stated intent: an intent verb ("quiero/quisiera", "voy a"/"me voy a",
  //    "pienso en", "pensé en") governing the take-verb, the synthetic future
  //    ("me tomaré"), or a time-of-intent marker framing the bare present
  //    ("esta noche me tomo …"). The marker is prefix-only and refuses a
  //    preceding "cada"/"la"/"las", because "cada mañana" and "por la mañana"
  //    are habitual, not a time of intent.
  { category: "self_harm", lang: "es", pattern: /\b(?:(?:quiero|quisiera|pienso(?:\s+en)?|pens(?:é|e|ado|ando)\s+en|(?:me\s+)?voy\s+a)\s+tomar(?:me)?|(?:me\s+)?tomar(?:é|e)|(?<!\b(?:cada|la|las)\s+)(?:esta\s+noche|hoy|ma(?:ñ|n)ana)\s+(?:me\s+)?tomo)\s+(?:tod[ao]s\s+(?:l[ao]s\s+|mis\s+)?|demasiad[ao]s\s+|much(?:as|os)\s+|un\s+(?:mont(?:o|ó)n|pu(?:ñ|n)ado)\s+de\s+)(?:pastillas|p(?:í|i)ldoras|medicinas|medicamentos|tabletas)\b/i },
  // "sobredosis" — clitic climbing is grammatical in Spanish and every other
  // pair in this file handles both directions ("me quiero morir" /
  // "quiero morirme"), so "me quiero dar una sobredosis" must match exactly as
  // "quiero darme una sobredosis" already did.
  { category: "self_harm", lang: "es", pattern: /\b(?:darme|tomarme|meterme|me\s+(?:di|doy|dar(?:e|é)|tom(?:o|e|é)|voy\s+a\s+(?:dar|tomar|meter)|(?:quiero|quisiera)\s+(?:dar|tomar|meter))|(?:pienso|pens(?:e|é|ado|ando))\s+en)\s+una\s+sobredosis\b/i },
  // harm_others (es) — a person object (attached clitic or personal "a") is
  // required, mirroring the English object list; that keeps "matar el tiempo"
  // ("kill time") from false-positive while catching "quiero matar a mi jefe".
  { category: "harm_others", lang: "es", pattern: /\bhacerles?\s+da(ñ|n)o\s+a\b/i },
  { category: "harm_others", lang: "es", pattern: /\b((quiero|quisiera|voy\s+a)\s+matar(l[oa]s?|te|les?|\s+a)|(l[oa]s?|te|les?)\s+(quiero|voy\s+a)\s+matar)\b/i },
  { category: "harm_others", lang: "es", pattern: /\b((quiero|voy\s+a)\s+lastimar(l[oa]s?|te|les?)?|lastimar\s+a\s+alguien)\b/i },
  // abuse (es) — Spanish is pro-drop ("me pega" = "[he] hits me"), so unlike
  // the English "he/she hits me" no subject pronoun is required: the
  // subjectless form IS the natural disclosure and requiring one would miss
  // real cases. "tengo miedo de mi ..." is bounded to partner nouns to keep
  // precision ("tengo miedo de mi examen" must not alert).
  { category: "abuse", lang: "es", pattern: /\bme\s+(peg|golpe|maltrat|amenaz)(a|an|aba|aban|aron|ó|o)(?![\wáéíóúüñ])/i },
  { category: "abuse", lang: "es", pattern: /\bme\s+est(á|a)n?\s+(pegando|golpeando|maltratando|amenazando|abusando)\b/i },
  { category: "abuse", lang: "es", pattern: /\babus(a|an|ó|o|aba|aban|aron|ando)\s+de\s+m[ií](?![\wáéíóúüñ])/i },
  { category: "abuse", lang: "es", pattern: /\b(tengo\s+miedo\s+de|le\s+tengo\s+miedo\s+a)\s+mi\s+(pareja|esposo|esposa|marido|mujer|novio|novia)\b/i },
];

export interface CrisisDetection {
  matched: boolean;
  category: CrisisCategory | null;
  /** Language of the matched pattern family; null when nothing matched. */
  lang: CrisisLang | null;
}

/**
 * Deterministic scan of a single message for self-harm, harm-to-others, or
 * abuse signals. Pure + synchronous + no AI — safe to call on every turn.
 * The first matching pattern wins; English families are scanned first, so a
 * mixed-language message that trips an English phrase reports lang "en".
 */
export function detectCrisisSignal(text: string): CrisisDetection {
  if (!text || typeof text !== "string") return { matched: false, category: null, lang: null };
  for (const { category, pattern, lang } of CRISIS_PATTERNS) {
    if (pattern.test(text)) return { matched: true, category, lang: lang ?? "en" };
  }
  return { matched: false, category: null, lang: null };
}

const ALERT_TYPE = WELLBEING_ALERT_TYPE;
const NOTIFY_TYPE = "wellbeing.concern";
// One open concern per student per UTC day so repeated signals in a session
// update a single alert instead of spamming. A new day — or a staff-resolved
// alert — produces a fresh one. (UTC is fine here; this is only a dedup key,
// not a grant metric.)
function dayBucket(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function reasonText(reason: WellbeingReason): string {
  return reason === "low_mood" ? "a very low mood score" : "something they said in chat";
}

interface StaffRecipient {
  id: string;
  email: string | null;
}

// Enrollment statuses under which a class instructor still "manages" the
// student. Mirrors NON_ARCHIVED_ENROLLMENT_STATUSES in src/lib/classroom.ts —
// kept local so this safety-critical module stays dependency-light. If the two
// ever drift, the failure mode is resolving fewer (possibly zero) instructors,
// which falls back to notifying ALL active teachers: the safe direction.
const MANAGED_ENROLLMENT_STATUSES = ["active", "inactive", "completed", "withdrawn"] as const;

/**
 * Resolve the unique, active instructor accounts assigned to the classes the
 * student is (non-archived) enrolled in. Returns [] when none resolve; any
 * thrown error is handled by the caller, which falls back to all active
 * teachers.
 *
 * RLS: this runs inside the STUDENT's context (chat and mood routes). Under
 * vq_app the student branch of `student_self_access` hides every teacher row,
 * so the instructor join through the app client is always empty. Staff
 * recipient reads therefore use prismaAdmin, which never injects RLS context.
 * Only staff identities are read here; the student's own rows stay on `prisma`.
 */
async function findAssignedInstructors(studentId: string): Promise<StaffRecipient[]> {
  const enrollments = await prismaAdmin.studentClassEnrollment.findMany({
    where: {
      studentId,
      status: { in: [...MANAGED_ENROLLMENT_STATUSES] },
    },
    select: {
      class: {
        select: {
          instructors: {
            select: {
              instructor: { select: { id: true, email: true, isActive: true } },
            },
          },
        },
      },
    },
  });

  const activeInstructors = enrollments
    .flatMap((enrollment) => enrollment.class.instructors)
    .map((link) => link.instructor)
    .filter((instructor) => instructor.isActive);

  return [
    ...new Map(
      activeInstructors.map((instructor): [string, StaffRecipient] => [
        instructor.id,
        { id: instructor.id, email: instructor.email },
      ]),
    ).values(),
  ];
}

/**
 * Who gets actively notified about a wellbeing concern.
 *
 * SAFETY: the audience must NEVER be narrower than the pre-scoping behavior
 * (all active teachers). Assigned class instructors are preferred so the most
 * sensitive signal in the system isn't over-disclosed program-wide, but zero
 * resolved instructors OR any resolution failure falls back to every active
 * teacher — over-notifying is the safe failure mode.
 */
async function resolveWellbeingRecipients(studentId: string): Promise<StaffRecipient[]> {
  let assigned: StaffRecipient[] = [];
  try {
    assigned = await findAssignedInstructors(studentId);
  } catch (err) {
    logger.error("Wellbeing: instructor resolution failed; falling back to all active teachers", {
      student: studentLogKey(studentId),
      alert: "wellbeing_instructor_resolution_failed",
      error: String(err),
    });
  }

  if (assigned.length > 0) return assigned;

  // prismaAdmin for the same reason as findAssignedInstructors: through the
  // app client this query returns zero rows under the student's context, and
  // a silent empty fallback is exactly the failure the fallback exists to stop.
  const everyone = await prismaAdmin.student.findMany({
    where: { role: "teacher", isActive: true },
    select: { id: true, email: true },
  });

  if (everyone.length === 0) {
    // A CRITICAL alert with nobody to notify must never be quiet. This is the
    // signal that would have exposed F2 in production, and it is what fires
    // if ADMIN_DATABASE_URL is unset: prismaAdmin then falls back to vq_app
    // with empty GUCs and every staff read returns [] (src/lib/db.ts).
    logger.error("Wellbeing: no staff recipients resolved; nobody was notified", {
      student: studentLogKey(studentId),
      alert: "wellbeing_no_recipients",
    });
  }

  return everyone;
}

/**
 * Most recent self-reported mood within the card lookback window. Best-effort:
 * a failed lookup only costs the mood line on the card, never the alert.
 */
async function findRecentMood(studentId: string, now: Date): Promise<WellbeingMoodSnapshot | null> {
  try {
    const lookbackStart = new Date(
      now.getTime() - WELLBEING_MOOD_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    const entry = await prisma.moodEntry.findFirst({
      where: { studentId, extractedAt: { gte: lookbackStart } },
      orderBy: { extractedAt: "desc" },
      select: { score: true, extractedAt: true },
    });
    if (!entry) return null;
    return { score: entry.score, recordedAt: entry.extractedAt };
  } catch (err) {
    logger.error("Wellbeing: mood lookup for crisis card failed", {
      student: studentLogKey(studentId),
      alert: "wellbeing_mood_lookup_failed",
      error: String(err),
    });
    return null;
  }
}

/**
 * Raise a CRITICAL wellbeing alert for a student and actively notify staff.
 * Idempotent within a day via the alertKey. Best-effort: never throws (callers
 * are fire-and-forget on the chat path) — failures are logged loudly.
 */
export async function recordWellbeingConcern({
  studentId,
  conversationId,
  reason,
  category = null,
  now = new Date(),
}: {
  studentId: string;
  conversationId: string | null;
  reason: WellbeingReason;
  /**
   * Trigger category from detectCrisisSignal for message_signal reasons.
   * Category ONLY — never message text.
   */
  category?: CrisisCategory | null;
  now?: Date;
}): Promise<void> {
  const alertKey = `wellbeing:${studentId}:${dayBucket(now)}`;

  // 1. CRITICAL StudentAlert — surfaces at the top of the teacher dashboard.
  //    The dashboard query already scopes alerts to the teacher's managed
  //    students (RLS + studentId filter), so only the right staff see it.
  try {
    // Structured crisis-context card (category + time + recent mood + response
    // checklist) encoded as plain text: StudentAlert has no JSON column, and
    // teachers have no transcript access, so the summary itself must make the
    // alert actionable. NEVER any message text. The update branch refreshes
    // the card too, so a repeated same-day signal keeps category/time/mood
    // current (latest signal wins for the daily alert row).
    const summary = formatWellbeingCardSummary({
      category: reason === "low_mood" ? "low_mood" : category,
      detectedAt: now,
      mood: await findRecentMood(studentId, now),
    });

    await prisma.studentAlert.upsert({
      where: { alertKey },
      update: {
        status: "open",
        severity: "critical",
        detectedAt: now,
        summary,
        resolvedAt: null,
        snoozedUntil: null,
        snoozedBy: null,
        dismissedAt: null,
      },
      create: {
        studentId,
        alertKey,
        type: ALERT_TYPE,
        severity: "critical",
        status: "open",
        title: "Wellbeing check-in needed",
        summary,
        sourceType: "conversation",
        sourceId: conversationId,
      },
    });
  } catch (err) {
    logger.error("Wellbeing: failed to upsert StudentAlert", {
      student: studentLogKey(studentId),
      reason,
      alert: "wellbeing_alert_failed",
      error: String(err),
    });
  }

  // 2. Actively notify staff (in-app always; email best-effort). Prefer the
  //    student's assigned class instructors; if none resolve (unenrolled
  //    student, data gap, or a failed lookup) fall back to ALL active teachers.
  //    The audience is never narrower than the pre-scoping behavior — for a
  //    crisis signal, over-notifying is the safe failure mode.
  //    Staff Notification rows are written with `client: "admin"`: under the
  //    student's RLS context `notification_access` WITH CHECK rejects a row
  //    whose studentId is a teacher, and allSettled would swallow it. The
  //    email job path already runs on prismaAdmin (src/lib/jobs.ts).
  try {
    const [student, recipients] = await Promise.all([
      prisma.student.findUnique({
        where: { id: studentId },
        select: { displayName: true, studentId: true },
      }),
      resolveWellbeingRecipients(studentId),
    ]);

    const studentName = student?.displayName || student?.studentId || "A student";
    const title = "Wellbeing check-in needed";
    const body = `${studentName} may need support based on ${reasonText(reason)}. Please check in with them directly.`;
    const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "") || "";
    // Static checklist only — no category and no message text in email, which
    // is the least-protected channel.
    const checklistText = WELLBEING_RESPONSE_CHECKLIST.map(
      (item, index) => `${index + 1}. ${item}`,
    ).join("\n");

    await Promise.allSettled(
      recipients.map((recipient) =>
        // 12h cooldown so repeated signals in a day don't re-ping, but the
        // alert itself stays open and visible on the dashboard.
        sendNotificationWithCooldown(recipient.id, { type: NOTIFY_TYPE, title, body }, 12, {
          client: "admin",
        }),
      ),
    );

    await Promise.allSettled(
      recipients.flatMap((recipient) => {
        if (!recipient.email) return [];
        const dedupeHash = createHash("sha1")
          .update(`${recipient.id}:${studentId}:${NOTIFY_TYPE}:${dayBucket(now)}`)
          .digest("hex");
        return [
          enqueueJobWithCooldown({
            type: "send_email",
            dedupeKey: `wellbeing:${dedupeHash}`,
            cooldownHours: 12,
            payload: {
              to: recipient.email,
              subject: `VisionQuest: ${title}`,
              text:
                `${body}\n\n` +
                `Recommended response:\n${checklistText}\n\n` +
                `${baseUrl ? `Open VisionQuest: ${baseUrl}\n\n` : ""}` +
                "This is an automated wellbeing alert. No student message text is included for privacy — " +
                "review the crisis card in VisionQuest and reach out to the student directly.",
            },
          }),
        ];
      }),
    );
  } catch (err) {
    logger.error("Wellbeing: failed to notify staff", {
      student: studentLogKey(studentId),
      reason,
      alert: "wellbeing_notify_failed",
      error: String(err),
    });
  }
}
