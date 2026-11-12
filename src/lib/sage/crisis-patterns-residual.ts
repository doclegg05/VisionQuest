/**
 * The residual crisis families (B1b), split out of crisis-patterns.ts only to
 * keep each file under 800 lines. CRISIS_PATTERNS spreads this list at its
 * end, so the scan order is the same as when it was one list.
 */

import type { CrisisPattern } from "./crisis-patterns";

export const RESIDUAL_CRISIS_PATTERNS: CrisisPattern[] = [
  // --- RESIDUAL FAMILIES (B1b), English. B1 closed the three means families
  // and moved crisis-en recall 0.794 -> 0.9498 against a 0.98 floor. The 14
  // rows that remained were in families B1 never touched, and they are grouped
  // here rather than spliced into the entries above so the next reader can see
  // what the corpus actually said was missing:
  //   passive ideation phrased around ABSENCE rather than death;
  //   an explicit plan carrying a TIME or a NOTE already written;
  //   pills PREPARATION — the step before the act, which both existing pills
  //     entries (the past act and the stated plan) sit on either side of;
  //   burning, the one self-injury method the hurt/harm/cut entry cannot spell;
  //   one abuse phrasing, passive ("getting hurt at home").
  //
  // The discriminator, family by family, stated once:
  //   absence     — the frame is counterfactual and TERMINAL ("if i was gone",
  //     "wish i wasnt here" with nothing locative after it). A locative tail is
  //     what makes the same words a complaint about a room.
  //   plan        — a first-person intent verb governing "end it"/"be gone"
  //     plus a time word, or a note with NO ADDRESSEE. An addressee makes a
  //     note correspondence.
  //   preparation — the TAIL is the whole signal, exactly as with the firearms
  //     "for me" entries: pills saved "to take them all", counted against
  //     "enough". Saving pills for a trip and counting them for a refill are
  //     the same nouns and the same verbs.

  // Passive 1/6 — "i wish i wasnt here".
  // GUARD: the locative frame. "i wish i wasnt here at this meeting", "wish i
  // wasn't here at work today" and "i wish i wasnt here in this class" are
  // ordinary complaints; "anymore", "at all", or nothing at all is the
  // disclosure. "at" is refused EXCEPT before "all", because "i wish i wasnt
  // here at all" is the disclosure and it starts with the guarded preposition.
  { category: "self_harm", pattern: /\bwish\s+i\s+(?:wasn'?t|was\s+not|weren'?t)\s+here\b(?!\s+(?:at(?!\s+all\b)|in|on|for|with|during)\b)/i },
  // Passive 2/6 — not waking up.
  // GUARD: "i hope i dont wake up late for my interview" / "sick tomorrow" is
  // the everyday sense of the identical words, and this population writes it
  // before every early shift.
  { category: "self_harm", pattern: /\b(?:wish|wishing|hope|hoping|pray|praying)\s+i\s+(?:could\s+)?(?:just\s+)?(?:not|never|don'?t|didn'?t|wouldn'?t)\s+wake\s+up\b(?!\s+(?:late|early|sick|tired|hungover|with|before|to)\b)/i },
  // Passive 3/6 — no point left. The OBJECT is the guard: "any of this",
  // "anything", "living", "life", "going on" alert; "this assignment", "this
  // class", "arguing with my landlord" do not, and those are what a student
  // actually says about program work.
  { category: "self_harm", pattern: /\b(?:don'?t|can'?t|do\s+not)\s+(?:see|find)\s+(?:a|the|any)\s+(?:point|reason|purpose)\s+(?:in|to|for)\s+(?:any\s+of\s+(?:this|it)|anything|it\s+all|living|life|be\s+here|going\s+on|keep\s+going|continuing|this\s+anymore)\b/i },
  // Passive 4/6 — "i'd rather be dead". No guard: the hyperbolic register this
  // population uses for the same idea is "im dead tired" / "dying laughing"
  // (both pinned silent through their own entries), and neither can reach this
  // shape. Consistent with the documented decision that "want to die laughing"
  // alerts — recall-first, an instructor dismisses a card.
  { category: "self_harm", pattern: /\b(?:i'?d|i\s+would)\s+rather\s+be\s+dead\b/i },
  // Passive 5/6 — the counterfactual absence. "nothing would change if i was
  // gone", "nobody would even notice if i was gone". "gone" is the load-bearing
  // word: "if i was late", "if i was wrong" cannot reach it, and the ordinary
  // sense of "gone" ("shes gone to the store") has no "if i was" frame.
  { category: "self_harm", pattern: /\bif\s+i\s+(?:was|were|wasn'?t|weren'?t)\s+(?:gone|around\s+anymore|here\s+anymore)\b/i },
  // Passive 6/6 — never born. Bound to a wish/should-have frame so a sentence
  // about someone else's birth cannot reach it.
  { category: "self_harm", pattern: /\b(?:wish|wishing)\s+i\s+(?:had\s+|was\s+|were\s+)?never\s+(?:been\s+)?born\b|\bshould(?:'?ve|\s+have)\s+never\s+been\s+born\b/i },

  // Intent 1/3 — a note already written.
  // GUARD: an ADDRESSEE or a SURFACE. "i wrote a note to my teacher", "i left
  // a note for my roommate on the counter", "note to self" are correspondence;
  // "i wrote a note already", with nobody named, is the disclosure. The second
  // entry is the unambiguous form and carries no guard.
  // KNOWN LIMIT, recorded rather than claimed closed: a benign note with no
  // addressee still alerts — "i wrote a note already, its on your desk" —
  // because nothing in the words distinguishes it. That costs an instructor
  // one dismissal; the other direction costs a disclosure.
  { category: "self_harm", pattern: /\b(?:wrote|written|writing|left|leaving|typed|finished)\s+(?:a|the|my)\s+(?:note|letter)\b(?!\s+(?:to|for|about|on|in|from|with|saying|reminding|explaining|asking)\b)/i },
  { category: "self_harm", pattern: /\b(?:goodbye|good\s?bye|suicide|farewell)\s+(?:note|letter)\b/i },
  // Intent 2/3 — "end it" with a time. The bare phrase is covered by the
  // "ending things" entry above; what was missing is the pronoun form with a
  // deadline attached, which is the higher-risk disclosure of the two.
  // GUARDS, two, and both are load-bearing in this corpus:
  //   1. a FIRST-PERSON INTENT FRAME is required, so "lets end it there for
  //      today" and "we should end it tonight" (a meeting, a shift) stay out.
  //   2. the time word must follow "it"/"this" IMMEDIATELY, which is what
  //      keeps the #173 breakup guard holding through this entry too: "i want
  //      to end it with him tonight" puts "with" in that position.
  // "today" and "this week" are deliberately NOT in the time list — "i want to
  // finish this today" is the most ordinary sentence in the program.
  { category: "self_harm", pattern: /\bi(?:'?m|\s+am)?\s+(?:going\s+to|gonna|will|wanna|want\s+to|plan(?:ning)?\s+to|about\s+to)\s+(?:end|finish)\s+(?:it|this)\s+(?:tonight|tomorrow|soon|this\s+weekend|in\s+the\s+morning|before\s+morning)\b/i },
  // Intent 3/3 — "i want to be gone".
  // GUARD: a destination or a deadline. "i want to be gone by five so i can
  // pick up my son" and "i wanna be gone before the traffic starts" are
  // logistics; the bare form is not.
  { category: "self_harm", pattern: /\b(?:want|wanna|need|needa|going|gonna)\s+(?:to\s+)?be\s+gone\b(?!\s+(?:from|by|before|for|until|till|to|when|after|in|on|at)\b)/i },

  // Preparation 1/3 — pills saved for the purpose. Same shape as Firearms 6
  // and Hanging 5: the noun is everywhere in this corpus and the BENEFICIARY
  // or PURPOSE is the signal. "im saving my pills for the trip next month" is
  // pinned silent and "i been saving up my pills to take them all" alerts.
  { category: "self_harm", pattern: /\b(?:saving|saved|stockpiling|stockpiled|hoarding|hoarded|stashing|stashed|hiding|collecting)\s+(?:up\s+)?(?:my|the|these|all\s+my)\s+(?:pills|meds|medication|medicine|tylenol|advil)\b(?:\s+\w+){0,4}\s+(?:to\s+(?:take|swallow|down)\s+(?:them\s+|it\s+|em\s+)?all|for\s+when\s+i(?:'?m|m)?\s+ready)\b/i },
  // Preparation 2/3 — counting against a sufficiency question. The word
  // "enough" is the signal, and it is guarded on the other side: "enough FOR
  // the month" / "to last" is a supply, not a dose, so "i counted my pills and
  // i have enough for the month" stays silent while "i counted my pills to see
  // if its enough" alerts. "i counted my pills to refill my prescription"
  // never reaches the tail at all.
  { category: "self_harm", pattern: /\b(?:counted|counting|count)\s+(?:up\s+)?(?:my|the|all\s+my)\s+(?:pills|meds|medication|medicine)\b(?:\s+\w+){0,8}\s+enough\b(?!\s+(?:for|to\s+last|until|till|through)\b)/i },
  // Preparation 3/3 — the whole cabinet.
  // GUARD: the preposition. "take everything OUT OF the cabinet to clean it"
  // is housework; "take everything IN the cabinet" is a dose. Only in/inside/
  // from are accepted, which is the entire distinction.
  { category: "self_harm", pattern: /\b(?:take|taking|took|swallow|swallowing|swallowed|down)\s+everything\s+(?:in|inside|from)\s+(?:the|my)\s+(?:medicine\s+cabinet|cabinet|drawer|bottle|cupboard|pill\s+box)\b/i },

  // Self-injury — burning. The hurt/harm/cut entry above fires on the bare
  // verb, which is right for those three because their benign readings are
  // rare; burning is the opposite — a stove, an iron and a curling iron are
  // the ordinary readings — so this entry REQUIRES "on purpose" and accepts
  // the false negatives that come with it. KNOWN LIMIT: "i been burning myself
  // again" is silent, and it is a disclosure. Closing it would put every
  // kitchen accident in the alert queue, which is the trade the corpus's
  // knife_kitchen rows already show the cost of.
  { category: "self_harm", pattern: /\b(?:burn|burns|burned|burnt|burning)\s+my\s?self\b(?:\s+\w+){0,3}\s+on\s+purpose\b/i },

  { category: "harm_others", pattern: /\b(want|going)\s+to\s+(hurt|kill)\s+(someone|him|her|them|people|everyone)\b/i },
  { category: "abuse", pattern: /\b(be(ing)?\s+abused|he\s+hits\s+me|she\s+hits\s+me|they\s+hit\s+me|hits?\s+me\s+at\s+home|hurt(s|ing)?\s+me\s+at\s+home|being\s+(hurt|hit)\s+at\s+home)\b/i },
  // Abuse, passive voice (B1b). The entry above spells the ACTIVE forms ("he
  // hits me", "hurts me at home") and the passive "being hurt at home", but
  // not the "get" passive this population actually uses — "i keep getting hurt
  // at home", "i got hit at home again last night" were both verified misses.
  // The PLACE is the whole discriminator and it is guarded on the other side:
  // "i got hurt at work last week" and "i keep getting hurt at the gym" are
  // injuries, not disclosures, and stay silent because only home is listed.
  { category: "abuse", pattern: /\b(?:get(?:ting|s)?|got|gotten)\s+(?:hurt|hit|beat|beaten|jumped|knocked\s+around)\s+(?:at|in)\s+(?:home|the\s+house|my\s+house)\b/i },

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
  // "me voy a matar" (B1b) is the near-future form, and its English twin
  // ("i'm going to kill myself") has always matched through the "killing
  // myself" entry. Only the want-frame was spelled here, so the plainest
  // Spanish statement of intent in this whole file was a verified MISS. The
  // reflexive clitic "me" is what keeps "voy a matar el tiempo" (kill time,
  // pinned silent) and the harm_others rows ("lo voy a matar") out.
  { category: "self_harm", lang: "es", pattern: /\b(matarme|me\s+(?:quiero|quisiera|voy\s+a|pienso)\s+matar)\b/i },
  { category: "self_harm", lang: "es", pattern: /\bquitarme\s+la\s+vida\b/i },
  // Stem match — suicidio, suicida(s), suicidarme, suicidarse, suicidé, ...
  { category: "self_harm", lang: "es", pattern: /\bsuicid/i },
  { category: "self_harm", lang: "es", pattern: /\b(acabar|terminar)\s+con\s+mi\s+vida\b/i },
  { category: "self_harm", lang: "es", pattern: /\bno\s+quiero\s+(vivir|seguir\s+viviendo)\b/i },
  { category: "self_harm", lang: "es", pattern: /\b(no\s+vale\s+la\s+pena\s+vivir|la\s+vida\s+no\s+vale\s+la\s+pena)\b/i },
  // The progressive forms are included ("me estoy haciendo daño", "me estoy
  // lastimando"): English covers the ongoing act and Spanish did not, which the
  // sage-ai.md parity rule treats as a gap needing a fix or a written note. The
  // clitic must be "me" — "le estoy haciendo daño a mi relación" and "está
  // haciendo daño a la comunidad" are ordinary talk and stay silent, pinned.
  { category: "self_harm", lang: "es", pattern: /\b((hacerme|me\s+hago|me\s+hice|me\s+har(é|e)|me\s+quiero\s+hacer|me\s+estoy\s+haciendo)\s+da(ñ|n)o|lastimarme|me\s+estoy\s+lastimando|cortarme\s+las\s+venas)\b/i },
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
  //
  // KNOWN LIMIT: a WORK ACCIDENT naming a listed body part still alerts —
  // "me corté la pierna en el trabajo". The body-part list is what separates
  // disclosure from a kitchen cut, so narrowing it to exclude legs would cost
  // a real self-injury site to buy one false positive back. Recall-first
  // stands; recorded so the next reader knows it was weighed, not missed.
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
  // "tragué" (swallowed) sits beside "tomé" for the same reason the English
  // entry gained "swallowed": it is the same disclosure in the same register.
  // Third person keeps it silent ("se tragó todas las pastillas"), and the
  // quantity + medication bounds keep an accidental swallow silent too
  // ("me tragué un hueso de pollo sin querer"), both pinned.
  { category: "self_harm", lang: "es", pattern: /\b(?:(?:me\s+)?tomé|(?:me\s+)?tragué|(?<!\bque\s+(?:me\s+)?)(?:me\s+)?(?:tome|trague))\s+(?:tod[ao]s\s+(?:l[ao]s\s+|mis\s+)?|demasiad[ao]s\s+|much(?:as|os)\s+|un\s+(?:mont(?:o|ó)n|pu(?:ñ|n)ado)\s+de\s+)(?:pastillas|p(?:í|i)ldoras|medicinas|medicamentos|tabletas)\b/i },
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

  // --- MEANS FAMILIES (es) — the Spanish counterparts of the English firearms,
  // hanging and jumping block above. Same measured gap: means_firearm 0/11,
  // means_hanging 0/10, means_jumping 0/9 in the crisis-es corpus, holding
  // Spanish recall at 0.696.
  //
  // Two Spanish-specific mechanics do most of the work here, and both are the
  // file's existing conventions rather than anything new:
  //   1. CLITIC CLIMBING. "quiero dispararme" and "me quiero disparar" are the
  //      same sentence, so every entry below carries both directions, exactly
  //      as the sobredosis and cortarme entries already do.
  //   2. (?![\wáéíóúüñ]) INSTEAD OF \b. JS \b is ASCII-only and cannot assert a
  //      boundary after "í" or "ó"; the kms guard's dead lookahead is this
  //      file's own recorded example of getting that wrong.
  //
  // The Spanish false positives are not translations of the English ones —
  // they are their own set, and three of them are load-bearing:
  //   "me ahorcan los plazos"  deadlines are strangling me
  //   "se me disparó la presión" my blood pressure spiked
  //   "tengo la soga al cuello"  I am drowning in debt
  // Each is silenced by a DIFFERENT mechanism (verb person, the "se" clitic, a
  // required first-person placement verb), and each has a bite proof in
  // crisis-detection-means.test.ts.

  // Armas 1/5 — dispararse. GUARD: the "se" clitic. "se me disparó la presión"
  // and "se disparó el precio de la gasolina" are the everyday senses of this
  // verb in this register, and both put "me"/nothing right after "se". The
  // person endings are enumerated rather than stemmed for the same reason the
  // ahorcar entry below does it: "me dispararon" (somebody shot me) is not
  // this signal.
  {
    category: "self_harm",
    lang: "es",
    pattern: new RegExp(
      "(?<!\\bse\\s)\\b(?:dispararme|me\\s+dispar(?:o|ó|é|e)|me\\s+(?:voy\\s+a|quiero|quisiera|pienso|pens(?:é|e))\\s+disparar)(?![\\wáéíóúüñ])",
      "i",
    ),
  },
  // Armas 2/5 — "pegarme/meterme un tiro". The reflexive clitic is the whole
  // guard: "tiro libre", "tiro al blanco", "campo de tiro" and "de un tiro"
  // (in one go) are all pinned silent and none of them can carry it.
  { category: "self_harm", lang: "es", pattern: /\b(?:(?:pegarme|meterme|darme|encajarme)\s+un\s+(?:tiro|balazo|plomazo)|me\s+(?:quiero|quisiera|voy\s+a|pienso)\s+(?:pegar|meter|dar)\s+un\s+(?:tiro|balazo|plomazo))(?![\wáéíóúüñ])/i },
  // Armas 3/5 — "volarme la cabeza / los sesos", the twin of the English "blow
  // my brains out". "abrirme la cabeza" is deliberately NOT here: it is how
  // Spanish describes splitting your head open in an accident.
  { category: "self_harm", lang: "es", pattern: /\b(?:(?:volarme|reventarme)\s+(?:la\s+cabeza|los\s+sesos)|me\s+(?:voy\s+a|quiero|quisiera)\s+(?:volar|reventar)\s+(?:la\s+cabeza|los\s+sesos))(?![\wáéíóúüñ])/i },
  // Armas 4/5 — the weapon at a body part, twin of English Firearms 3. It
  // needs no idiom guard: Spanish has no "with a gun to my head" conditional,
  // so the first-person placement verb is bound enough on its own.
  { category: "self_harm", lang: "es", pattern: /\b(?:me\s+(?:puse|pongo|pondr(?:é|e))|ponerme|poni(?:é|e)ndome)\s+(?:la|el|una|un|mi)\s+(?:pistola|arma|escopeta|rifle|rev(?:ó|o)lver)\s+(?:en|a)\s+la\s+(?:cabeza|boca|sien)(?![\wáéíóúüñ])/i },
  // Armas 5/5 — the weapon reserved for the student, twin of English Firearms
  // 6, plus "lo tengo conmigo" and the "acabar con todo usando …" frame.
  //
  // GUARD, and it is a Spanish-only hazard worth naming: "para mi" unaccented
  // is also the POSSESSIVE. "le compre una pistola de agua para mi hijo" would
  // otherwise alert. So the unaccented spelling only counts when nothing
  // follows it — end of message or punctuation — while the accented "mí",
  // which can only be the pronoun, is free. Students do drop accents (the
  // whole reason this block spells both), and "…es para mi" at the end of a
  // sentence is exactly how the corpus rows read.
  { category: "self_harm", lang: "es", pattern: /\b(?:pistola|escopeta|rifle|arma|armas|rev(?:ó|o)lver|carabina|bala|balas|cartuchos)(?:\s+[\wáéíóúüñ]+){0,4}\s+(?:es\s+|son\s+)?para\s+(?:mí(?![\wáéíóúüñ])|mi(?!\s*[\wáéíóúüñ]))/i },
  { category: "self_harm", lang: "es", pattern: /\btengo\s+(?:el|la|un|una|mi)\s+(?:pistola|escopeta|rifle|arma|rev(?:ó|o)lver)\s+(?:conmigo|en\s+la\s+mano)(?![\wáéíóúüñ])/i },
  { category: "self_harm", lang: "es", pattern: /\b(?:acabar|terminar)\s+con\s+(?:todo|esto|mi\s+vida)\s+(?:usando|con)\s+(?:la|el|mi|un|una)\s+(?:pistola|escopeta|rifle|arma|rev(?:ó|o)lver|soga|cuerda)(?![\wáéíóúüñ])/i },

  // Ahorcarse 1/4 — the reflexive, both clitic positions.
  // GUARDS, two, and they are the reason the person endings are spelled out
  // instead of stemmed to "ahorc":
  //   "me ahorcan los plazos / las cuentas" — third-person plural, the
  //     figurative "X is strangling me", which is ORDINARY talk for a student
  //     juggling bills and deadlines and is the single likeliest false
  //     positive in the Spanish set;
  //   "el trabajo me ahorcaba" — the same figure in the imperfect.
  // Only first-person singular forms (ahorco/ahorcó-as-typo/ahorqué) and the
  // infinitives fire. "se me cuelga la computadora" is caught by the same "se"
  // lookbehind the dispararse entry uses.
  {
    category: "self_harm",
    lang: "es",
    pattern: new RegExp(
      "(?<!\\bse\\s)\\b(?:ahorcarme|colgarme|me\\s+(?:ahorc(?:o|ó)|ahorqu(?:é|e)|cuelgo|colgu(?:é|e))|me\\s+(?:voy\\s+a|quiero|quisiera|pienso|pens(?:é|e))\\s+(?:ahorcar|colgar))(?![\\wáéíóúüñ])",
      "i",
    ),
  },
  // Ahorcarse 2/4 — the rope rigged. "ya amarré la soga" has no benign reading
  // once the rope is definite and the verb is first-person singular preterite;
  // "necesito una soga para amarrar el colchón" is silent on the verb.
  // KNOWN LIMIT, recorded rather than claimed closed: "amarré la soga al
  // remolque" alerts. Excluding it would mean enumerating benign attachment
  // points, which is the shape that failed for the kms guard.
  { category: "self_harm", lang: "es", pattern: /\b(?:amarr(?:é|e)|at(?:é|e)|prepar(?:é|e)|colgu(?:é|e))\s+(?:la|una|mi)\s+(?:soga|cuerda|reata|mecate)(?![\wáéíóúüñ])/i },
  // Ahorcarse 3/4 — the rope at the neck.
  // GUARD, and this is why "soga al cuello" is NOT matched on its own: it is
  // an established idiom for being crushed by debt ("con las cuentas tengo la
  // soga al cuello"), and "ponerse la soga al cuello" is a second idiom again
  // (getting yourself into it — or married). So a first-person PLACEMENT verb
  // is required, and the "poner" branch additionally requires the indefinite
  // "una", because the idiom takes the definite "la". The English twin,
  // "rope around my neck", needs none of this — recorded here rather than
  // left as an unexplained asymmetry.
  { category: "self_harm", lang: "es", pattern: /\bme\s+(?:(?:amarr(?:é|e)|at(?:é|e)|voy\s+a\s+(?:amarrar|atar))\s+(?:una|la|el|mi)|(?:puse|pongo)\s+una)\s+(?:soga|cuerda|cable|cintur(?:ó|o)n)\s+(?:al|en\s+el)\s+cuello(?![\wáéíóúüñ])/i },
  // Ahorcarse 4/4 — rope acquired FOR THAT, twin of English Hanging 5, and the
  // beam-staring twin of the English one. "compramos soga en la ferretería
  // para el remolque" is silent twice over: first person plural, and a
  // beneficiary that is a thing.
  { category: "self_harm", lang: "es", pattern: /\b(?:compr(?:é|e)|consegu(?:í|i)|busqu(?:é|e)|guard(?:é|e)|escond(?:í|i))\s+(?:una\s+|la\s+|el\s+)?(?:soga|cuerda|reata|mecate|cable|cintur(?:ó|o)n)(?:\s+[\wáéíóúüñ]+){0,4}\s+para\s+(?:eso|esto|mí(?![\wáéíóúüñ])|mi(?!\s*[\wáéíóúüñ]))/i },
  { category: "self_harm", lang: "es", pattern: /\b(?:viendo|mirando|observando)\s+(?:la|el|esa|ese)\s+(?:viga|vigas|travesa(?:ñ|n)o)(?![\wáéíóúüñ])/i },

  // Tirarse 1/4 — from a height. THE PREPOSITION IS THE GUARD, and it is the
  // cleanest discriminator in either language: a person throws themselves
  // DE/DEL/DESDE a bridge, and A la piscina, A la cama, A el agua. So
  // "me tiro a la piscina cuando hace calor", "mi hijo se tiro a la alberca",
  // "me lancé a estudiar", "quiero aventarme a pedir el aumento" and
  // "tirarme un clavado" are all silent without naming any of them, while
  // "tirarme del puente" alerts. "aventarme" is the Mexican register the
  // ticket asks for and is first-class here, not an afterthought.
  { category: "self_harm", lang: "es", pattern: /\b(?:tirarme|aventarme|lanzarme|arrojarme|me\s+(?:tir(?:o|é|e)|avent(?:é|e|o)|lanc(?:é|e)|arroj(?:é|e))|me\s+(?:voy\s+a|quiero|quisiera|pienso|pens(?:é|e))\s+(?:tirar|aventar|lanzar|arrojar|saltar)|(?:quiero|quisiera|voy\s+a|pienso\s+en|pens(?:é|e)\s+en)\s+saltar)\s+(?:de|del|desde)\s+(?:el\s+|la\s+|un\s+|una\s+|los\s+|las\s+)?(?:puente|edificio|techo|azotea|estacionamiento|balc(?:ó|o)n|piso|ventana|barranco|cerro|torre|algo\s+alto)/i },
  // Tirarse 2/4 — in front of a vehicle.
  { category: "self_harm", lang: "es", pattern: /\b(?:tirarme|aventarme|lanzarme|arrojarme|echarme|me\s+(?:voy\s+a|quiero|quisiera|pienso)\s+(?:tirar|aventar|lanzar|arrojar|echar))\s+(?:en?frente|delante)\s+(?:de|del)\s+(?:un\s+|una\s+|el\s+|la\s+|los\s+)?(?:tren|cami(?:ó|o)n|carro|coche|troca|autob(?:ú|u)s|tr(?:á|a)iler|metro)/i },
  // Tirarse 3/4 — onto the tracks. This one takes "al / a las", the very
  // preposition the entry above refuses, so the OBJECT has to carry it: a
  // train, the rails, the metro. That is why it is a separate entry rather
  // than a widened alternation — widening the first entry's preposition would
  // have re-admitted every "me tiro a la cama" row it exists to exclude.
  { category: "self_harm", lang: "es", pattern: /\b(?:tirarme|aventarme|lanzarme|arrojarme|me\s+(?:voy\s+a|quiero|quisiera|pienso)\s+(?:tirar|aventar|lanzar|arrojar))\s+(?:al|a\s+las|a\s+la)\s+(?:tren|v(?:í|i)as|v(?:í|i)a|metro)(?![\wáéíóúüñ])/i },
  // Tirarse 4/4 — the stance, twin of English Jumping 6, and the deliberate
  // crash, twin of English Jumping 4 (which likewise requires "a propósito"
  // within a short window, so an ordinary wreck stays silent).
  { category: "self_harm", lang: "es", pattern: /\b(?:estuve|estaba|ando|he\s+estado|sigo|me\s+qued(?:é|e))\s+(?:parad[oa]|sentad[oa]|de\s+pie)\s+(?:en|sobre)\s+(?:el|la|ese|esa)\s+(?:puente|barandal|orilla|borde|azotea|techo|cornisa)(?![\wáéíóúüñ])/i },
  { category: "self_harm", lang: "es", pattern: /\b(?:estrellarme|estamparme|me\s+(?:voy\s+a|quiero|quisiera)\s+(?:estrellar|estampar))(?:\s+[\wáéíóúüñ]+){0,5}\s+a\s+prop(?:ó|o)sito(?![\wáéíóúüñ])/i },

  // --- RESIDUAL FAMILIES (es) — B1b. The Spanish twins of the English block
  // above, plus the two families Spanish was weakest in: passive_ideation
  // scored 13/23 and explicit_intent 25/30 in the crisis-es corpus, holding
  // headline recall at 0.88 after B1.
  //
  // The Spanish false positives here are again their own set, not translations,
  // and four are load-bearing — each is silenced by a DIFFERENT mechanism and
  // each has a bite proof in crisis-detection-residual.test.ts:
  //   "sin mi ayuda / sin mi carro"                the unaccented possessive
  //   "quisiera desaparecer entre la gente"        desaparecer with a complement
  //   "quiero acabar con todo el trabajo"          a determiner after "todo"
  //   "no le veo sentido a esta tarea"             the object of "sentido a"
  // The first reuses this file's existing accent trick (Armas 5/5): unaccented
  // "mi" counts as the pronoun ONLY at the end of a clause, because "mi" before
  // a noun is the possessive; accented "mí" can only be the pronoun and is free.

  // Ideación pasiva 1/7 — "estarían mejor sin mí". The copular verb is
  // required so an ordinary "el equipo trabaja mejor sin mi supervisión" style
  // sentence cannot reach it; the possessive guard does the rest.
  { category: "self_harm", lang: "es", pattern: /\b(?:estar(?:í|i)an?|ser(?:í|i)an?|vivir(?:í|i)an?|andar(?:í|i)an?)\s+(?:mucho\s+)?mejor\s+sin\s+(?:mí(?![\wáéíóúüñ])|mi(?!\s*[\wáéíóúüñ]))/i },
  // Ideación pasiva 2/7 — no despertar. Twin of the English "wish i could just
  // not wake up". No guard is needed on the "ojalá" branch: it is a wish, not
  // a schedule, so the English "dont wake up LATE" hazard has no Spanish
  // counterpart in this frame.
  { category: "self_harm", lang: "es", pattern: /\bojal(?:á|a)\s+(?:ya\s+)?no\s+(?:me\s+)?(?:despertara|despierte|despertase|amanezca|amaneciera|despertar(?:í|i)a)(?![\wáéíóúüñ])/i },
  { category: "self_harm", lang: "es", pattern: /\b(?:quisiera|quiero|ojal(?:á|a)\s+pudiera)\s+no\s+(?:volver\s+a\s+)?despertar(?![\wáéíóúüñ])/i },
  // Ideación pasiva 3/7 — desaparecer.
  // GUARD, and it is the reason this entry ends on punctuation instead of the
  // usual (?![\wáéíóúüñ]): "quisiera desaparecer ENTRE la gente en las juntas"
  // is a real corpus row about social anxiety, and a lookahead that only
  // forbids a word CHARACTER passes straight over the space in front of
  // "entre". So the verb must be TERMINAL — end of message or a clause
  // boundary — or carry a permanence tail ("y no volver", "para siempre").
  // "quiero desaparecer un rato" is silent by the same rule.
  { category: "self_harm", lang: "es", pattern: /\b(?:quiero|quisiera|necesito|ojal(?:á|a)\s+pudiera|me\s+gustar(?:í|i)a)\s+desaparecer(?:\s+(?:y\s+no\s+(?:volver|regresar|despertar)|para\s+siempre|de\s+este\s+mundo|de\s+una\s+vez|y\s+ya))?\s*(?:[.,;!?]|$)/i },
  // Ideación pasiva 4/7 — sin sentido. The OBJECT is the guard, exactly as in
  // the English twin: "a nada", "a seguir", "a la vida" alert; "a esta tarea",
  // "a este formulario" do not.
  { category: "self_harm", lang: "es", pattern: /\bno\s+(?:le\s+)?(?:veo|encuentro|hallo)\s+(?:el\s+)?sentido\s+a\s+(?:nada\s+de\s+esto|nada|seguir|vivir|la\s+vida|todo\s+esto|esto\s+ya)(?![\wáéíóúüñ])/i },
  // Ideación pasiva 5/7 — "no estuviera". Two frames, both counterfactual:
  // the comparative ("sería mejor que yo no estuviera") and the
  // nothing-would-change one ("nada cambiaría si yo no estuviera"). Requiring
  // one of the two frames keeps ordinary conditionals ("si no estuviera
  // lloviendo") out.
  { category: "self_harm", lang: "es", pattern: /\b(?:ser(?:í|i)a|estar(?:í|i)a)\s+mejor\s+que\s+(?:yo\s+)?no\s+estuviera(?![\wáéíóúüñ])/i },
  { category: "self_harm", lang: "es", pattern: /\b(?:nada|nadie|todo|todos)\s+(?:cambiar(?:í|i)an?|notar(?:í|i)an?|extra(?:ñ|n)ar(?:í|i)an?|importar(?:í|i)an?)\s+si\s+(?:yo\s+)?no\s+estuviera(?![\wáéíóúüñ])/i },
  // Ideación pasiva 6/7 — no haber nacido.
  { category: "self_harm", lang: "es", pattern: /\b(?:nunca|jam(?:á|a)s|no|ni)\s+hubiera\s+nacido(?![\wáéíóúüñ])/i },
  // Ideación pasiva 7/7 — "prefiero estar muerta". The existing entry spells
  // "mejor muerto" and "quisiera estar muerto"; the preference frame, which is
  // how the corpus rows read, was missing.
  { category: "self_harm", lang: "es", pattern: /\bprefiero\s+(?:estar\s+)?muert[oa](?![\wáéíóúüñ])/i },

  // Intención 1/3 — "acabar con todo".
  // TWO GUARDS. First, a first-person intent verb is required, which is what
  // keeps "este turno va a acabar conmigo" and "esta semana va a acabar
  // conmigo" — the ordinary work-stress figure — silent. Second, "todo"/"esto"
  // must not be followed by a determiner or "de/del", because that turns it
  // into an object: "quiero acabar con todo EL TRABAJO", "quiero terminar con
  // ESTO DEL papeleo". The target row survives both because "todo esto de una
  // vez" backtracks to the bare "todo", whose next word is the pronoun "esto",
  // which is deliberately NOT on the refusal list.
  // KNOWN LIMIT, recorded: "ya casi, voy a terminar con todo" said about
  // homework alerts. An instructor dismisses it.
  { category: "self_harm", lang: "es", pattern: /\b(?:quiero|quisiera|ya\s+quiero|necesito|voy\s+a|me\s+voy\s+a|pienso\s+en|pens(?:é|e)\s+en)\s+(?:acabar|terminar)\s+con\s+(?:todo\s+esto|esto|todo)(?!\s+(?:el|la|los|las|mi|mis|tu|tus|su|sus|este|esta|estos|estas|ese|esa|esos|esas|de|del)\b)/i },
  // Intención 2/3 — "irme de este mundo". Bound to the destination, which is
  // the whole guard: "irme de la clase", "irme a casa", "irme del trabajo" are
  // the ordinary uses and none of them can reach "de este mundo".
  { category: "self_harm", lang: "es", pattern: /\b(?:irme|irnos)\s+de\s+este\s+mundo(?![\wáéíóúüñ])|\bme\s+(?:quiero|quisiera|voy\s+a)\s+ir\s+de\s+este\s+mundo(?![\wáéíóúüñ])|\birme\s+para\s+siempre(?![\wáéíóúüñ])/i },
  // Intención 3/3 — carta de despedida. The NOUN is the guard: "carta de
  // renuncia" and "carta de presentación" are program paperwork and both are
  // in the corpus. A first-person writing verb is also required so a mention
  // of somebody else's farewell letter stays silent.
  // KNOWN LIMIT: "escribí una carta de despedida para mi compañera que se va"
  // alerts. Recall-first.
  { category: "self_harm", lang: "es", pattern: /\b(?:escrib(?:í|i|o|iendo)|dej(?:é|e|o|ando)|hice|redact(?:é|e))\s+(?:una|la|mi)\s+(?:carta|nota)\s+de\s+despedida(?![\wáéíóúüñ])/i },

  // Preparación 1/3 — pastillas guardadas para eso. Same tail-is-the-signal
  // shape as the English twin. "guardo mis pastillas en un pastillero semanal"
  // and "guardo mis pastillas para el viaje" stay silent twice over: the verb
  // is the habitual present, not the preterite, and neither carries the
  // "para tomármelas todas" tail.
  { category: "self_harm", lang: "es", pattern: /\b(?:guard(?:é|e)|junt(?:é|e)|ahorr(?:é|e)|escond(?:í|i)|apart(?:é|e))\s+(?:las\s+|mis\s+|unas\s+|todas\s+las\s+)?(?:pastillas|p(?:í|i)ldoras|medicinas|medicamentos|tabletas)(?:\s+[\wáéíóúüñ]+){0,4}\s+para\s+(?:tom|trag)(?:á|a)r(?:me)?(?:las|melas)?\s+(?:todas|toditas|de\s+una\s+vez)(?![\wáéíóúüñ])/i },
  // Preparación 2/3 — contar pastillas contra una pregunta de suficiencia.
  // "conté mis pastillas para el pastillero de la semana" never reaches the
  // tail; "para ver si alcanzan" / "si son suficientes" is the disclosure.
  { category: "self_harm", lang: "es", pattern: /\b(?:cont(?:é|e)|contando|cuento)\s+(?:mis|las|todas\s+mis|todas\s+las)\s+(?:pastillas|p(?:í|i)ldoras|medicinas|medicamentos|tabletas)(?:\s+[\wáéíóúüñ]+){0,6}\s+(?:me\s+alcanzan|alcanzan|alcanza|son\s+suficientes|hay\s+suficientes|bastan)(?![\wáéíóúüñ])/i },
  // Preparación 3/3 — el botiquín entero, twin of the English cabinet entry.
  { category: "self_harm", lang: "es", pattern: /\b(?:tomarme|tragarme|quiero\s+tomarme|voy\s+a\s+tomarme|me\s+(?:quiero|quisiera|voy\s+a)\s+(?:tomar|tragar))\s+todo\s+lo\s+que\s+hay\s+en\s+(?:el|mi)\s+(?:botiqu(?:í|i)n|caj(?:ó|o)n|gabinete|estante|mueble)(?![\wáéíóúüñ])/i },

  // Autolesión (es) — quemarse a propósito, y la autolesión "para sentir".
  // "a propósito" is REQUIRED for burning, for the same reason the English
  // twin requires "on purpose": "me quemé cocinando" and "me quemé con la
  // plancha" are the ordinary readings and both are pinned silent. The second
  // entry covers the reason a student gives for it ("para sentir algo"), which
  // the existing lastimarme entry could not reach in the present tense.
  { category: "self_harm", lang: "es", pattern: /\b(?:me\s+quem(?:é|e|o)|quemarme|me\s+(?:voy\s+a|quiero)\s+quemar)(?:\s+[\wáéíóúüñ]+){0,4}\s+a\s+prop(?:ó|o)sito(?![\wáéíóúüñ])/i },
  { category: "self_harm", lang: "es", pattern: /\bme\s+(?:lastimo|lastim(?:é|e)|corto|quemo|golpeo|hago\s+da(?:ñ|n)o)(?:\s+[\wáéíóúüñ]+){0,3}\s+para\s+(?:sentir|no\s+sentir|dejar\s+de\s+sentir|aguantar)/i },

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
  // Abuso en casa (B1b) — twin of the English "getting hurt at home". The
  // stem list above deliberately omits "lastim", because "me lastimo" is
  // FIRST-PERSON self-injury (handled in the self_harm block) and "me lastimé
  // la espalda" is an injury report; only the third-person forms, immediately
  // followed by the place, read as somebody else doing it. The place is the
  // discriminator and the verb must sit directly against it, so "me lastimé la
  // mano en el trabajo" and "me lastimé la espalda en la casa moviendo
  // muebles" both stay silent.
  { category: "abuse", lang: "es", pattern: /\bme\s+(?:lastiman|lastima|golpean|pegan|maltratan)\s+en\s+(?:la\s+)?casa(?![\wáéíóúüñ])/i },
];
