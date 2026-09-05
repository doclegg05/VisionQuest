/**
 * The pinned crisis-detector fixtures — the single source of truth.
 *
 * These arrays used to live inside the two crisis test files. They were moved
 * here, verbatim, when the safety benchmark suite landed, because the
 * benchmark corpus (config/benchmarks/fixtures/crisis-{en,es}.json) carries
 * rows tagged `source: "pinned-test"` that MUST agree with what the unit
 * tests pin. A corpus that quietly disagreed with a pinned case would be a
 * benchmark certifying the opposite of a test — the exact failure mode the
 * 2026-08-21 crisis review named ("a fixture that passes for the wrong reason
 * is worse than none"). With one home, the benchmark's --self-test can prove
 * agreement instead of assuming it.
 *
 * Nothing here is a detector behaviour change: the tests import these arrays
 * and assert exactly what they asserted before. Adding a row here adds it to
 * the unit suite AND to the benchmark's pinned cross-check at once, which is
 * the point.
 *
 * Consumed by:
 *   - src/lib/sage/crisis-detection.test.ts
 *   - src/lib/sage/crisis-detection-informal.test.ts
 *   - src/lib/benchmarks/crisis-corpus.test.ts
 *   - scripts/bench/suites/crisis-corpus.mjs (via the benchmark fixtures)
 */

export interface PinnedCrisisCase {
  text: string;
  category: string;
}

/** English phrases that MUST alert (favor recall for safety). */
export const EN_SHOULD_MATCH: PinnedCrisisCase[] = [
  { text: "honestly I just want to kill myself", category: "self_harm" },
  { text: "sometimes I think about killing myself", category: "self_harm" },
  { text: "I want to end my life", category: "self_harm" },
  { text: "I'm done, I want to end it all", category: "self_harm" },
  { text: "I've been having suicidal thoughts", category: "self_harm" },
  { text: "maybe suicide is the only way out", category: "self_harm" },
  { text: "I just want to die", category: "self_harm" },
  { text: "I wish I was dead", category: "self_harm" },
  { text: "everyone would be better off dead without me", category: "self_harm" },
  { text: "there's no reason to live anymore", category: "self_harm" },
  { text: "I don't want to live like this", category: "self_harm" },
  { text: "I can't go on", category: "self_harm" },
  { text: "I've been cutting myself again", category: "self_harm" },
  { text: "I want to hurt myself", category: "self_harm" },
  { text: "I keep thinking about self-harm", category: "self_harm" },
  { text: "Everyone in my life would honestly be better off if I just disappeared.", category: "self_harm" },
  { text: "everyone would be better off without me", category: "self_harm" },
  { text: "some days I just want to disappear", category: "self_harm" },
  { text: "I want to hurt someone", category: "harm_others" },
  { text: "I'm going to kill him", category: "harm_others" },
  { text: "my boyfriend hits me at home", category: "abuse" },
  { text: "I think I'm being abused", category: "abuse" },
];

/** English phrases that must NOT false-positive on common idioms. */
export const EN_SHOULD_NOT_MATCH: string[] = [
  "I'm dying to see my certificate results",
  "this is a killer deal on the course",
  "I'm dead tired after that shift",
  "my goal is to live a better life",
  "I want to live in a bigger city someday",
  "that test almost killed me lol",
  "I need to cut my spending this month",
  "I want to hurt my chances? no, I want to improve them",
  "the error message disappeared after I logged back in",
  "my nerves disappeared once the interview started",
  "",
  "I'm feeling great today, ready to go",
];

/**
 * Spanish coverage (P2-7) — positive cases, accented AND unaccented spellings.
 * Students often type without accents ("dano", "mi", "esta", "mas"), so both
 * forms must be caught. Favor recall, same as the English set.
 */
export const ES_SHOULD_MATCH: PinnedCrisisCase[] = [
  // self_harm — accented / standard spelling
  { text: "ya no aguanto, me quiero morir", category: "self_harm" },
  { text: "quiero morirme", category: "self_harm" },
  { text: "quisiera morir", category: "self_harm" },
  { text: "a veces pienso en matarme", category: "self_harm" },
  { text: "me quiero matar", category: "self_harm" },
  { text: "quiero quitarme la vida", category: "self_harm" },
  { text: "he pensado en suicidarme", category: "self_harm" },
  { text: "tengo pensamientos suicidas", category: "self_harm" },
  { text: "quiero acabar con mi vida", category: "self_harm" },
  { text: "voy a terminar con mi vida", category: "self_harm" },
  { text: "no quiero vivir así", category: "self_harm" },
  { text: "no quiero seguir viviendo", category: "self_harm" },
  { text: "ya no vale la pena vivir", category: "self_harm" },
  { text: "la vida no vale la pena", category: "self_harm" },
  { text: "quiero hacerme daño", category: "self_harm" },
  { text: "me quiero hacer daño otra vez", category: "self_harm" },
  { text: "voy a lastimarme", category: "self_harm" },
  { text: "quisiera estar muerta", category: "self_harm" },
  { text: "estaría mejor muerto", category: "self_harm" },
  // Ambiguous-but-alerting: sensitivity deliberately matched to the English
  // "can't go on", which is equally ambiguous and included.
  { text: "ya no puedo más", category: "self_harm" },
  // self_harm — unaccented typing
  { text: "quiero hacerme dano", category: "self_harm" },
  { text: "ya no puedo mas con todo esto", category: "self_harm" },
  { text: "estaria mejor muerta", category: "self_harm" },
  // self_harm — method-adjacent disclosure (es). Mirrors the English VQ-R-004
  // entries: a stated plan or a past act outranks ideation. Every phrase below
  // passed the detector silently while the English equivalents ("took all my
  // pills", "gonna od") matched.
  { text: "esta noche me tomo todas las pastillas", category: "self_harm" },
  { text: "quiero tomarme todas las pastillas", category: "self_harm" },
  { text: "me tomé todas las pastillas", category: "self_harm" },
  { text: "me tome todas mis pastillas", category: "self_harm" },
  { text: "voy a tomarme todas las pastillas", category: "self_harm" },
  { text: "me voy a tomar todas las pastillas", category: "self_harm" },
  { text: "me tomaré todas las pastillas mañana", category: "self_harm" },
  { text: "tomé demasiadas pastillas anoche", category: "self_harm" },
  { text: "me tomé un montón de pastillas", category: "self_harm" },
  { text: "me tome un monton de pastillas", category: "self_harm" },
  { text: "me tomé todos los medicamentos", category: "self_harm" },
  { text: "quiero darme una sobredosis", category: "self_harm" },
  // self_harm — the cutting register (es). PARITY with the English
  // hurt/harm/cutting fix: English covers the past and ongoing act
  // ("i hurt myself yesterday", "i been hurting myself"), Spanish covered only
  // the fixed phrase "cortarme las venas" and the "hacerme daño" family, so a
  // student writing the most ordinary Spanish form of the same disclosure was
  // silent. Discriminated by BODY PART rather than by the verb alone, because
  // the same verb is how you describe a kitchen accident — see the guard rows
  // in ES_SHOULD_NOT_MATCH, which carry the verb and stay silent.
  { text: "me corte los brazos otra vez", category: "self_harm" },
  { text: "me corté los brazos otra vez", category: "self_harm" },
  { text: "me hice cortes donde nadie ve", category: "self_harm" },
  { text: "me corté las muñecas anoche", category: "self_harm" },
  { text: "quiero cortarme los brazos", category: "self_harm" },
  // "cortarme las venas" was already covered; "me corté las venas" — the same
  // disclosure with the clitic on the finite verb — was not, the same
  // clitic-climbing gap the sobredosis entry closed.
  { text: "me corté las venas", category: "self_harm" },
  // Clitic climbing — Spanish allows the pronoun to raise onto the finite verb
  // ("me quiero dar" == "quiero darme"), and every other Spanish pair in the
  // detector handles both directions ("me quiero morir" / "quiero morirme").
  { text: "me quiero dar una sobredosis", category: "self_harm" },
  { text: "me voy a dar una sobredosis", category: "self_harm" },
  { text: "pensando en tomarme una sobredosis", category: "self_harm" },
  { text: "he pensado en una sobredosis", category: "self_harm" },
  // harm_others — accented / standard spelling
  { text: "quiero hacerle daño a mi supervisor", category: "harm_others" },
  { text: "quiero matar a mi jefe", category: "harm_others" },
  { text: "lo voy a matar", category: "harm_others" },
  { text: "quiero matarlo", category: "harm_others" },
  { text: "voy a lastimar a alguien", category: "harm_others" },
  { text: "quiero lastimar a alguien si no paran", category: "harm_others" },
  // harm_others — unaccented
  { text: "voy a hacerles dano a todos", category: "harm_others" },
  // abuse — accented / standard spelling
  { text: "mi esposo me pega", category: "abuse" },
  { text: "me golpea cuando llega a casa", category: "abuse" },
  { text: "mi pareja me maltrata", category: "abuse" },
  // Trailing accented letter before punctuation — exercises the lookahead
  // guard that replaces the (ASCII-only) \b after "mí".
  { text: "mi padrastro abusa de mí.", category: "abuse" },
  { text: "mi novio me amenaza si salgo", category: "abuse" },
  { text: "tengo miedo de mi esposo", category: "abuse" },
  { text: "le tengo miedo a mi pareja", category: "abuse" },
  { text: "me está golpeando otra vez", category: "abuse" },
  // abuse — unaccented
  { text: "abusa de mi y no se que hacer", category: "abuse" },
  { text: "abusaron de mi cuando era nina", category: "abuse" },
  { text: "mi novio me pego anoche", category: "abuse" },
  { text: "me esta pegando de nuevo", category: "abuse" },
];

/** Spanish negative cases — benign everyday phrasing must NOT alert. */
export const ES_SHOULD_NOT_MATCH: string[] = [
  "quiero vivir en una ciudad más grande algún día",
  "estoy muerta de cansancio después del turno",
  "me muero de hambre, ¿cuándo es el descanso?",
  // "matar el tiempo" (kill time): the harm_others patterns require a person
  // object (clitic or personal "a"), mirroring the English object list.
  "voy a matar el tiempo antes de la clase",
  // Haircut, not self-injury — the cutting pattern requires a body part from
  // the self-injury list, and hair is not on it.
  "voy a cortarme el pelo este fin de semana",
  // KITCHEN-KNIFE PARITY. These carry the same verb as the disclosures above
  // and must stay silent, so the pattern cannot be passing on the verb alone.
  // Note this is deliberately STRICTER than the English side, where
  // "i cut myself chopping onions" does alert — that is a pre-existing,
  // recorded English false positive, not a standard to copy into Spanish.
  "me corté con el cuchillo cocinando",
  "me corté afeitándome",
  "me corte el dedo picando cebolla",
  "no hay que abusar del café",
  // "tengo miedo de mi ..." is bounded to partner nouns.
  "tengo miedo de mi examen final",
  "quiero terminar el curso este mes",
  // Method-adjacent guards (es) — ordinary medication adherence and
  // third-person overdose mentions must stay silent, mirroring the English
  // informal-corpus guards ("i took my medication this morning", "that
  // overdose documentary was sad"). A quantifier ("todas las", "demasiadas")
  // or a first-person frame is what separates disclosure from adherence.
  "me tomé la pastilla de la presión esta mañana",
  "ya me tomé mis pastillas hoy",
  "tengo que tomarme las pastillas con comida",
  "el doctor me dijo que tome las pastillas por la noche",
  "las pastillas que me recetaron me ayudan",
  "mi primo murió de una sobredosis",
  "vi un documental sobre las sobredosis de fentanilo",
  // VERB-REGISTER PARITY (the guards above dodge the branch by omitting the
  // quantifier, which is test rot — they prove nothing about the register).
  // These carry the quantifier AND the medication noun, exactly like the
  // disclosures, so the only thing that may keep them quiet is the verb: a
  // bare habitual present, an obligation modal, or a subjunctive after "que"
  // is adherence talk, not disclosure. English pins the identical set ("i take
  // all my pills every morning", "i need to take all my meds before bed").
  "me tomo todas las pastillas cada mañana con el desayuno",
  "me tomo todas las pastillas todos los dias con el desayuno",
  "necesito tomarme todas las pastillas antes de dormir",
  "tengo que tomarme todas las pastillas con comida",
  "el doctor me dijo que me tome todas las pastillas",
  "el doctor me dijo que debo tomarme todas las pastillas",
];

/**
 * VQ-R-004 informal register. Phrases that MUST alert; each was a verified
 * miss before VQ-R-004. Tuples are [phrase, label].
 */
export const INFORMAL_MUST_DETECT: ReadonlyArray<readonly [string, string]> = [
  // Contractions — the single biggest gap: every "want to" pattern missed these.
  ["i wanna die", "wanna contraction"],
  ["I wanna die", "wanna, capitalized"],
  ["i dont wanna be here anymore", "dont wanna be here"],
  ["i don't wanna be here anymore", "apostrophe variant"],
  ["im gonna die tonight", "gonna"],
  ["i just wanna disappear", "wanna disappear"],
  ["i needa die", "needa"],

  // Euphemism used to evade filters — common in online/text register.
  ["i want to unalive myself", "unalive"],
  ["thinking about unaliving myself", "unaliving"],

  // Abbreviations. "kys" is the real abbreviation ("kill yourself"); the
  // original entry pinned "ksy", a transposition of it, so the abbreviation
  // students actually type was a verified MISS while a typo was guarded.
  ["kms", "kms alone"],
  ["i might kms tonight", "kms in a sentence"],
  ["kys", "kys alone"],
  ["kys tonight", "kys in a sentence"],
  ["gonna kms", "kms after an intent verb"],

  // Method-adjacent disclosure — a concrete plan is higher risk than ideation.
  ["im gonna od tonight", "od"],
  ["i think i want to overdose", "overdose"],
  ["i took all my pills", "took all my pills"],
  ["i took a bunch of pills", "bunch of pills"],

  // Future-intent overdose by pills. The original VQ-R-004 entries covered the
  // PAST act ("took all my pills") and intent only toward the bare verb
  // ("gonna od"), so a stated plan naming the method fell through the gap —
  // found while closing the Spanish parity gaps, where "esta noche me tomo
  // todas las pastillas" already alerts. Stated plan > ideation, so an English
  // student must not be detected later than a Spanish one.
  ["i wanna take all my pills", "wanna take all my pills"],
  ["im gonna take all my pills tonight", "gonna take all my pills"],
  ["i'm going to take all my pills tonight", "going to take, apostrophe form"],
  ["i want to take a bunch of pills", "want to take a bunch of pills"],
  ["i tried to take too many pills last night", "tried to take too many pills"],
  ["i wanna take all my meds", "meds noun variant"],

  // "ending things" — the existing pattern only covered "my life" / "it all".
  ["thinking about ending things", "ending things"],
  ["i want to end things", "end things"],

  // First-person overdose disclosure. The "on" branch now requires an "i"
  // frame (see the third-person guards below); these pin that the frame is
  // tolerant of contractions and a short adverbial gap.
  ["i overdosed on my meds", "i + overdosed on"],
  ["i'm overdosing on these pills", "i'm contraction"],
  ["i nearly overdosed on tylenol last night", "one adverb between i and the verb"],

  // The hurt/harm/cut family in its PROGRESSIVE form. The alternation spelled
  // "cut" + an optional "ting", so "cutting myself" matched while "hurting
  // myself" and "harming myself" did not — the two most ordinary ways a
  // student describes an ongoing act rather than a single one. Found by the
  // crisis-en corpus, where all three of these rows were misses.
  ["i keep hurting myself when i get like this", "hurting — progressive"],
  ["i think about hurting myself when class is over", "hurting after a think-about frame"],
  ["i been hurting myself so i can feel something", "hurting — past progressive"],
  ["i been harming myself for a while now", "harming — progressive"],

  // FIGURATIVE USES OF THE SAME PHRASE, pinned as ALERTING so the accepted cost
  // of the progressive-form widening is on the record rather than discovered
  // later. This is the same recall-first trade the file already makes for
  // "i want to die laughing"; a coach dismissing "hurting myself financially"
  // is cheap, and no wording rule reliably separates the two. The reflexive is
  // what carries the risk — "hurting YOURSELF" stays silent, pinned below.
  ["i'm hurting myself financially", "figurative — accepted false positive"],
  ["harming myself by procrastinating", "figurative — accepted false positive"],
  ["i keep hurting myself by staying up so late", "figurative — accepted false positive"],

  // First-person overdose frame WITHOUT the apostrophe. This population texts
  // "im"/"ive"/"id", and the frame accepted only the punctuated forms, so
  // "im overdosing on these pills right now" — a disclosure in progress —
  // passed silently while "i'm overdosing on these pills" alerted.
  ["im overdosing on these pills right now", "im, no apostrophe"],
  ["ive overdosed on my meds before", "ive, no apostrophe"],
  ["id overdose on my meds if i could", "id, no apostrophe"],

  // Past participle in the pills means family. The sibling past-act entry
  // spelled only "took", so "ive taken too many pills" — the same disclosure
  // in the same register as the pinned "i took all my pills" — was silent.
  // "swallowed" is the same one-word class and was silent for the same reason.
  ["ive taken too many pills", "taken, past participle"],
  ["i have taken all my pills tonight", "have taken"],
  ["i swallowed all my medication", "swallowed"],

  // "die my hair" is exempted as the dye homophone, but the exemption must end
  // at a word boundary — "my hairbrush" is a different word, so the disclosure
  // in front of it must still alert.
  ["i wanna die my hairbrush is broken", "hair* is not hair"],

  // Passive phrasing without "want".
  ["everyone would be better off if i wasnt here", "wasnt here"],
];

/**
 * Phrases that must NOT alert. A recall-first detector still has to survive
 * ordinary program conversation, or instructors learn to ignore the alerts —
 * which is how a safety net dies. Tuples are [phrase, label].
 */
export const INFORMAL_MUST_NOT_DETECT: ReadonlyArray<readonly [string, string]> = [
  ["i wanna get my ged", "wanna + benign goal"],
  ["im gonna be late to class", "gonna + benign"],
  ["i wanna die my hair", "die my hair — homophone of dye"],
  ["this class is killing me", "idiom"],
  ["im dying to start the cna program", "dying to idiom"],
  ["i need to end my shift early", "end my shift"],
  ["i took my medication this morning", "took medication, no quantity"],
  ["i want to take all my certifications", "take all my …, not pills"],
  ["the pills the doctor gave me help", "pills mentioned benignly"],
  // Adherence talk. These carry the quantity word AND the medication noun, so
  // the ONLY thing keeping them quiet is that the intent verb must come from
  // the crisis register — a bare present tense or an obligation modal must not
  // alert, or every student managing a prescription trips the safety net daily.
  ["i take all my pills every morning with breakfast", "adherence, no intent verb"],
  ["i need to take all my meds before bed", "need to — obligation, not intent"],
  ["i have to take all my medication with food", "have to — obligation, not intent"],
  ["i wanna work in healthcare", "wanna + career"],
  // The reflexive is the whole signal. Second person is advice a student gives
  // or receives, not a disclosure, and must not alert — it is also the most
  // common way these exact words appear in a coaching conversation.
  ["you're only hurting yourself", "second person, not reflexive"],
  ["stop hurting yourself over this", "second person, imperative"],
  ["that overdose documentary was sad", "overdose in third person"],
  // Third-person overdose disclosure — someone else's, usually grief, and the
  // most common way this noun shows up in coaching conversation. The module
  // comment already claimed third person stayed quiet; only "overdose" with no
  // object was actually guarded, so "overdosed on X" fired on both of these.
  ["my brother overdosed on fentanyl last year", "brother's overdose, not the student's"],
  ["my mom overdosed on pills when i was little", "trailing 'i' must not supply the frame"],
  // The two-word gap in the first-person frame is wide enough for a
  // third-person SUBJECT to slip into it: "i" + "worried he" + "overdosed on"
  // matched, so a student expressing concern about someone else raised a
  // CRITICAL alert on themselves and named their instructors. The gap now
  // refuses third-person pronouns and possessives — the frame is about the
  // student, so nothing inside it may name anybody else.
  ["im worried he overdosed on pills", "third-person subject inside the gap"],
  ["im scared she overdosed on something", "third-person subject, she"],
  ["ive heard he overdosed on heroin", "hearsay about someone else"],
  ["id say she overdosed on pills", "speculation about someone else"],
  ["i think my cousin overdosed on something", "possessive inside the gap"],

  // "kms" is also kilometres. The pattern is unanchored, so it fired on
  // distances — and, because it carries no lang tag, a Spanish speaker writing
  // about distance got the ENGLISH 988 block. That was the file's only
  // cross-language leak.
  ["i walked 5 kms today", "kms as kilometres, digit before"],
  ["caminé 5 kms hoy", "kilometres in Spanish — must not serve the English block"],
  ["the office is a few kms from here", "kilometres without a digit, distance frame"],
  // LANGUAGE PARITY on that guard. The English distance frame is guarded by
  // "away"/"from"; its Spanish equivalent ("a unos … de aquí", "a pocos … de
  // distancia") had no counterpart, so a Spanish speaker writing about a
  // commute got a CRITICAL alert AND the English 988 block — the same
  // cross-language leak the "caminé 5 kms hoy" row was written to close, one
  // frame over.
  ["la oficina esta a unos kms de aqui", "Spanish distance frame, unaccented"],
  ["la oficina está a unos kms de aquí", "Spanish distance frame, accented"],
  ["el centro está a pocos kms de distancia", "a pocos … de distancia"],
  // These ISOLATE the "kms de …" lookahead: no quantity word precedes them, so
  // the quantity lookbehind cannot be what keeps them silent. The first pass at
  // this guard ended its lookahead with \b, which JS cannot assert after "í",
  // so the lookahead was dead code and the two rows above were passing on the
  // lookbehind alone — a fixture passing for the wrong reason. Delete the
  // lookahead and these three go red; delete the lookbehind and they do not.
  ["queda a kms de aquí", "de aquí with no quantity word"],
  ["eso está a kms de aquí, más o menos", "de aquí followed by a comma"],
  ["la escuela está a dos kms de mi casa", "de + possessive destination"],
  ["queda a varios kms de aquí", "varios — quantity word the first list omitted"],
  ["el trabajo está a diez kms del centro", "del centro"],
  // English parity for the same frame: "a few kms" with a direction word the
  // away/from list did not carry.
  ["the office is a few kms down the road", "a few kms down the road"],

  // Relationship talk is what students bring to a coach; "end things with X" is
  // the dominant benign sense of the phrase and the single highest-frequency
  // false positive both reviews found.
  ["i want to end things with my boyfriend", "breakup, not ideation"],
  ["im ending things with my ex this weekend", "breakup, progressive"],
  ["i need to end things with my landlord", "ending an arrangement"],

  // The dye homophone stays exempt — the guard above narrows it, it must not
  // remove it.
  ["i wanna die my hair blue", "die my hair + modifier"],
];
