import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectCrisisSignal } from "./crisis-detection";

// ---------------------------------------------------------------------------
// B1 — the three MEANS families: firearms, hanging, jumping, in both languages.
//
// `.claude/MEMORY.md` named this the largest remaining crisis-coverage gap, and
// the crisis-en / crisis-es benchmarks put a number on it: means_firearm,
// means_hanging and means_jumping all scored 0/n before this change (16/13/12
// English rows, 11/10/9 Spanish). Every MUST_DETECT phrase below was a verified
// MISS on the unfixed tree; the red run is in the PR body.
//
// The module's policy is recall-first, but an alert stream staff learn to
// ignore is a dead safety net — so every family ships its guards in the same
// change, and every guard below is proven to BITE (see the GUARD_BITES table):
// a guard that could never fire is the fixture hazard this file's own comments
// describe, and it is how the "ksy"/"kys" transposition survived for months.
//
// These arrays are deliberately LOCAL to this file rather than added to
// crisis-fixtures.ts: the benchmark corpora carry the same utterances as
// `source: "authored"` rows, and crisis-fixtures.ts is outside this change's
// file fence. The cross-check in scripts/bench/suites/crisis-corpus.mjs only
// binds `source: "pinned-test"` rows, so the two stay consistent.
// ---------------------------------------------------------------------------

type Case = readonly [phrase: string, label: string];

/** English firearms — every one a verified miss before this change. */
const EN_FIREARM_MUST_DETECT: readonly Case[] = [
  ["im going to shoot myself", "shoot myself, near-future"],
  ["i want to shoot myself", "shoot myself, want-to"],
  ["im going to shoot myself when everyone leaves", "shoot myself + a time frame"],
  ["i thought about shooting myself in the truck", "progressive + place"],
  ["i almost shot myself last night", "past act"],
  ["i been thinking about putting a gun to my head", "gun to my head"],
  ["i had the gun in my mouth last night", "gun in my mouth"],
  ["i want to put a bullet in my head", "bullet in my head"],
  ["im gonna blow my brains out", "blow my brains out"],
  ["i want to eat a bullet", "eat a bullet"],
  ["i have my dads gun and im going to use it on myself", "use it on myself"],
  ["i want to use my gun on myself tonight", "use my gun on myself"],
  ["i want to end it with my gun", "end it with my gun"],
  ["i bought a gun so i can finish it", "purchase + so i can finish it"],
  ["i keep the pistol loaded for when im ready", "loaded for when im ready"],
  ["the gun in the closet is for me", "firearm reserved for the student"],
  ["i bought bullets for myself", "ammunition bought for the student"],
  ["im gonna load the gun tonight", "loading tonight"],
  ["i been holding the gun tonight", "holding tonight"],
  ["i been sitting with the rifle thinking about it", "sitting with the rifle"],
];

/** English hanging. */
const EN_HANGING_MUST_DETECT: readonly Case[] = [
  ["im going to hang myself", "hang myself, near-future"],
  ["i want to hang myself in the garage", "hang myself + place"],
  ["i been thinking about hanging myself", "hanging myself, progressive"],
  ["i want to hang myself tonight when the kids are asleep", "hang myself + time"],
  ["i almost hung myself last week", "hung myself, past act"],
  ["im gonna hang myself and get it over with", "hang myself + intent tail"],
  ["i thought about hanging myself with my belt", "hanging myself with an object"],
  ["i want to hang myself in the shed", "hang myself + second place"],
  ["i keep picturing myself hanging from the rafters", "myself hanging from"],
  ["i already made the noose", "made the noose"],
  ["i tied a noose in the garage", "tied a noose"],
  ["i put a rope around my neck last night", "rope around my neck"],
  ["i tied a rope in the basement for me", "rope tied for the student"],
  ["i bought rope for it", "rope bought for it"],
  ["i been looking at the beam in the basement", "looking at the beam"],
];

/** English jumping / traffic / vehicle. */
const EN_JUMPING_MUST_DETECT: readonly Case[] = [
  ["im going to jump off the bridge", "jump off the bridge"],
  ["i want to jump off the bridge downtown", "jump off the bridge + place"],
  ["i been thinking about jumping off the parking garage", "jumping off a garage"],
  ["i almost jumped off the overpass yesterday", "jumped off an overpass"],
  ["i keep thinking about jumping from the roof", "jumping from the roof"],
  ["i want to jump off something high", "jump off something high"],
  ["i want to jump in front of a truck", "jump in front of a truck"],
  ["im gonna step in front of a train", "step in front of a train"],
  ["i thought about throwing myself off the parking garage", "throw myself off"],
  ["i want to throw myself under a bus", "throw myself under"],
  ["i want to drive my car off the road on purpose", "drive off the road on purpose"],
  ["i been thinking about driving into a wall on purpose", "drive into a wall on purpose"],
  ["im going to jump and end it", "jump and end it"],
  ["i stood at the edge and almost jumped", "stood at the edge"],
  ["i been standing on the bridge for an hour", "standing on the bridge"],
];

/**
 * Mixed messages (AC3). The idiom and the disclosure share a sentence, which is
 * how a real message reads — the guards must not swallow the message they are
 * sitting next to.
 */
const EN_MIXED_MUST_DETECT: readonly Case[] = [
  ["gonna hang out then probably hang myself", "hang out AND hang myself"],
  [
    "shoot me a text, i cant do this anymore, gonna shoot myself tonight",
    "shoot me a text AND shoot myself",
  ],
  ["hang in there she said. i cant. im gonna hang myself", "hang in there AND hang myself"],
];

/**
 * English guards — crisis-ADJACENT language that must stay silent. Every phrase
 * the ticket names, plus the benign rows already in the crisis-en corpus that
 * the new patterns could plausibly have reached.
 */
const EN_MUST_NOT_DETECT: readonly Case[] = [
  // --- firearms / shooting idioms
  ["shoot me an email when the schedule is up", "shoot me an email"],
  ["just shoot me a text when you get there", "shoot me a text"],
  ["shoot me the link to that job posting", "shoot me the link"],
  ["im gonna shoot for the may graduation date", "shoot for a date"],
  ["shoot for the moon with that application", "shoot for the moon"],
  ["we shoot hoops at the park on sundays", "shoot hoops"],
  ["i took a shot at a job in charleston", "took a shot at a job"],
  ["just give it a shot and see what happens", "give it a shot"],
  ["hes gunning for a promotion at the plant", "gunning for a promotion"],
  ["they brought out the big guns for the audit", "big guns"],
  ["we go deer hunting every november", "hunting season"],
  ["i cleaned my grandpas rifle for him", "cleaning a relative's rifle"],
  ["my dads guns are locked in the safe", "my dad's guns"],
  ["the gun safety class is on saturday", "gun safety class"],
  ["i want to get my concealed carry permit", "concealed carry permit"],
  ["we keep the shotgun locked in the safe", "shotgun stored safely"],
  ["i sold my rifle to pay the car note", "sold a rifle"],
  ["he got a bb gun for his birthday", "bb gun as a gift"],
  ["i want to work at the ammo plant, they pay well", "ammo plant job"],
  ["can you send me the bullet points from the meeting", "bullet points"],
  ["i had to bite the bullet and pay the late fee", "bite the bullet"],
  ["i really dodged a bullet on that lease", "dodged a bullet"],
  ["i keep shooting myself in the foot in interviews", "shoot myself in the foot — idiom"],
  ["with a gun to my head i still couldnt tell you", "with a gun to my head — idiom"],
  ["my boss had a gun to my head about the deadline", "third party held the gun — idiom"],
  // --- hanging idioms
  ["can i hang out with my study group after class", "hang out"],
  ["we should hang out this weekend", "hang out, second form"],
  ["just hang in there, the test is friday", "hang in there"],
  ["hang on let me find the form", "hang on"],
  ["he hung up on me when i called about the job", "hang up"],
  ["can you hang the picture in the break room", "hang the picture"],
  ["we hung out at the library between classes", "hanging out, past"],
  ["i left my keys hanging in the door again", "left hanging"],
  ["i finally got the hang of it", "hang of it"],
  ["that movie ended on a cliffhanger", "cliffhanger"],
  ["the rope course at camp was so fun", "rope course"],
  ["we did jump rope in gym class", "jump rope"],
  ["the tow rope broke when he pulled me out", "tow rope"],
  ["i learned the ropes at my last job", "learned the ropes"],
  ["my neck pain is back this week", "neck pain"],
  ["i woke up with a crick in my neck", "crick in my neck"],
  ["she gave me a necklace for graduation", "necklace"],
  ["i bought rope at the hardware store for the trailer", "rope bought for a trailer"],
  ["i need rope to tie down the mattress", "rope for a mattress"],
  ["we are replacing the beam in the basement", "beam as home repair"],
  ["i hung myself out to dry on that application", "hung myself out to dry — idiom"],
  // --- jumping idioms
  ["id jump at the chance to work there", "jump at the chance"],
  ["i had to jump start my car this morning", "jump-start"],
  ["lets jump on a call at three", "jump on a call"],
  ["she jumped in and helped me finish", "jump in"],
  ["im thinking about jumping ship to another employer", "jump ship"],
  ["we did a bungee jump on vacation", "bungee jump"],
  ["my cousin wants to go skydiving next summer", "skydiving"],
  ["we took a cliff diving trip last summer", "cliff diving trip"],
  ["we did jumping jacks in the warm up", "jumping jacks"],
  ["the bridge downtown is closed for construction", "the bridge is closed"],
  ["this class will bridge the gap for me", "bridge the gap"],
  ["the roof repair is going to cost a lot", "roof repair"],
  ["the train leaves at 7 so i have to hurry", "train leaves at 7"],
  ["i jumped for joy when i passed", "jumped for joy"],
  ["he won the long jump at state", "long jump"],
  ["she does high jump for the track team", "high jump"],
  ["he jumped off the diving board at the pool", "diving board"],
  ["i cross the bridge on my way to class", "crossing the bridge"],
  ["we watched the fireworks from the bridge", "fireworks from the bridge"],
  ["i live two blocks from the train tracks", "living near the tracks"],
];

/** Spanish firearms. */
const ES_FIREARM_MUST_DETECT: readonly Case[] = [
  ["me voy a disparar", "me voy a disparar"],
  ["quiero dispararme", "dispararme"],
  ["pense en dispararme en la troca", "pensé en dispararme"],
  ["casi me disparo anoche", "casi me disparo"],
  ["quiero pegarme un tiro", "pegarme un tiro"],
  ["voy a pegarme un tiro esta noche", "pegarme un tiro + tiempo"],
  ["quiero meterme un balazo", "meterme un balazo"],
  ["me voy a volar los sesos", "volarme los sesos"],
  ["quiero volarme la cabeza", "volarme la cabeza"],
  ["me puse la pistola en la boca anoche", "pistola en la boca"],
  ["tengo la pistola lista para mi", "pistola lista para mí"],
  ["la escopeta de mi papa es para mi", "escopeta es para mí"],
  ["tengo el arma conmigo ahorita", "arma conmigo"],
  ["quiero acabar con todo usando la pistola", "acabar con todo usando la pistola"],
];

/** Spanish hanging. */
const ES_HANGING_MUST_DETECT: readonly Case[] = [
  ["me voy a ahorcar", "me voy a ahorcar"],
  ["quiero ahorcarme en el garaje", "ahorcarme + lugar"],
  ["he pensado en ahorcarme", "he pensado en ahorcarme"],
  ["quiero ahorcarme con el cinturon", "ahorcarme con el cinturón"],
  ["quiero ahorcarme en la bodega", "ahorcarme, segundo lugar"],
  ["casi me ahorco la semana pasada", "casi me ahorco"],
  ["voy a colgarme esta noche", "colgarme"],
  ["ya amarre la soga", "amarré la soga"],
  ["me amarre una soga al cuello anoche", "soga al cuello, con verbo de primera persona"],
  ["compre una soga para eso", "compré una soga para eso"],
  ["estuve viendo la viga del sótano", "viendo la viga"],
];

/** Spanish jumping / traffic. */
const ES_JUMPING_MUST_DETECT: readonly Case[] = [
  ["me voy a tirar del puente", "tirarme del puente"],
  ["quiero tirarme del puente", "tirarme del puente, querer"],
  ["he pensado en tirarme del estacionamiento", "tirarme del estacionamiento"],
  ["casi me tire del puente ayer", "casi me tiré del puente"],
  ["quiero aventarme desde el techo", "aventarme desde el techo"],
  ["quiero aventarme de algo alto", "aventarme de algo alto"],
  ["quiero saltar del edificio", "saltar del edificio"],
  ["me quiero tirar enfrente de un camion", "tirarme enfrente de un camión"],
  ["quiero tirarme al tren", "tirarme al tren"],
  ["me voy a tirar a las vias", "tirarme a las vías"],
  ["estuve parada en el puente un buen rato", "parada en el puente"],
  ["me voy a estrellar con el carro a proposito", "estrellarme a propósito"],
];

/** Spanish guards. */
const ES_MUST_NOT_DETECT: readonly Case[] = [
  // --- armas
  ["mi papa me lleva a cazar venado en noviembre", "cazar venado"],
  ["limpie el rifle de mi abuelo", "limpiar el rifle del abuelo"],
  ["quiero sacar mi permiso de portacion", "permiso de portación"],
  ["el trabajo de guardia pide permiso de armas", "permiso de armas"],
  ["fuimos al campo de tiro el domingo", "campo de tiro"],
  ["mi hermano es tirador en la guardia nacional", "tirador"],
  ["vendi la escopeta para pagar el carro", "vender la escopeta"],
  ["la clase de arma es el sabado", "clase de arma"],
  ["guardamos el rifle bajo llave en la caja fuerte", "rifle bajo llave"],
  ["la feria de armas es este fin de semana", "feria de armas"],
  ["le compre una pistola de agua a mi hijo", "pistola de agua"],
  ["necesito una pistola de silicon para el proyecto", "pistola de silicón"],
  ["le compre una pistola de agua para mi hijo", "para MI HIJO — posesivo, no pronombre"],
  ["se disparo el precio de la gasolina otra vez", "se disparó el precio"],
  ["dispararon la alarma en la escuela", "dispararon la alarma"],
  ["se me disparo la presion con el estres", "se me disparó la presión"],
  ["fallo el tiro libre al final del partido", "tiro libre"],
  ["practicamos tiro al blanco en el rancho", "tiro al blanco"],
  ["lo termine todo de un tiro", "de un tiro"],
  // --- soga / colgar
  ["colgamos las luces de navidad el sabado", "colgar las luces"],
  ["necesito una soga para amarrar el colchon", "soga para el colchón"],
  ["compramos soga en la ferreteria para el remolque", "soga para el remolque"],
  ["voy a colgar la ropa antes de que llueva", "colgar la ropa"],
  ["colgue el cuadro en la pared de la cocina", "colgar el cuadro"],
  ["te cuelgo ahora, me estan hablando", "colgar el teléfono"],
  ["mi chamarra esta colgada en la silla", "chamarra colgada"],
  ["me ahorcan los plazos de la escuela", "me ahorcan los plazos"],
  ["me ahorcan las cuentas cada mes", "me ahorcan las cuentas"],
  ["el trabajo me ahorcaba todos los dias", "el trabajo me ahorcaba"],
  ["con las cuentas tengo la soga al cuello", "tener la soga al cuello — deudas"],
  ["me puse la soga al cuello con ese contrato", "ponerse la soga al cuello — meterse en un lío"],
  ["se me cuelga la computadora todo el tiempo", "se me cuelga la computadora"],
  ["aprendi a hacer un nudo en la clase de seguridad", "hacer un nudo"],
  // --- puente / tirarse
  ["el puente del centro esta cerrado por obras", "el puente está cerrado"],
  ["el fin de semana puente vamos a salir", "fin de semana puente"],
  ["vamos a hacer puente el viernes", "hacer puente"],
  ["cruzo el puente para llegar a la clase", "cruzar el puente"],
  ["vimos los fuegos artificiales desde el puente", "fuegos desde el puente"],
  ["me tiro a la piscina cuando hace calor", "tirarse a la piscina"],
  ["me tiro a la cama apenas llego del turno", "tirarse a la cama"],
  ["me tire al agua sin pensarlo", "tirarse al agua"],
  ["mi hijo se tiro a la alberca sin miedo", "el hijo se tiró a la alberca"],
  ["quiero tirarme un clavado en el rio", "tirarse un clavado"],
  ["ya quiero tirar la toalla con esta clase", "tirar la toalla"],
  ["me voy a lanzar a buscar trabajo esta semana", "lanzarse a buscar trabajo"],
  ["me lance a estudiar de nuevo el año pasado", "lanzarse a estudiar"],
  ["quiero aventarme a pedir el aumento", "aventarse a pedir un aumento"],
  ["los ninos saltaron en las hojas toda la tarde", "saltar en las hojas"],
  ["el tren pasa cerca de mi casa en la noche", "el tren pasa cerca"],
  ["el techo del edificio gotea cuando llueve", "el techo gotea"],
];

/**
 * GUARD-BITE PROOFS (AC3).
 *
 * A guard that could never fire proves nothing — it is the same failure as the
 * "ksy"/"kys" transposition this file already carries a comment about. So for
 * every guard actually written into a production pattern, this table holds the
 * UNGUARDED shape of that pattern and asserts two things at once:
 *
 *   1. the unguarded shape DOES match the guard phrase (the guard bites), and
 *   2. the production detector stays silent on it (the guard is wired in).
 *
 * The regexes here are deliberately NOT the production patterns — they are the
 * naive version a reader would reach for first, written out so the cost of the
 * guard is visible. `positiveControl` keeps the pair honest from the other
 * side: a phrase in the same family that production MUST still alert on, so a
 * guard cannot be "proven" by a pattern that stopped working altogether.
 */
const GUARD_BITES: ReadonlyArray<{
  phrase: string;
  unguarded: RegExp;
  positiveControl: string;
  note: string;
}> = [
  {
    phrase: "i keep shooting myself in the foot in interviews",
    unguarded: /\b(?:shoot|shooting|shot)\s+myself\b/i,
    positiveControl: "i want to shoot myself",
    note: "shoot myself in the foot — self-sabotage idiom",
  },
  {
    phrase: "with a gun to my head i still couldnt tell you",
    unguarded: /\b(?:gun|pistol|rifle)\s+to\s+my\s+head\b/i,
    positiveControl: "i been thinking about putting a gun to my head",
    note: "with a gun to my head — hypothetical idiom",
  },
  {
    phrase: "my boss had a gun to my head about the deadline",
    unguarded: /\b(?:gun|pistol|rifle)\s+to\s+my\s+head\b/i,
    positiveControl: "i been thinking about putting a gun to my head",
    note: "a third party holding the gun — coercion idiom",
  },
  {
    phrase: "i hung myself out to dry on that application",
    unguarded: /\bhung\s+myself\b/i,
    positiveControl: "i almost hung myself last week",
    note: "hang myself out to dry — idiom",
  },
  {
    phrase: "i bought rope at the hardware store for the trailer",
    unguarded: /\b(?:bought|tied)\s+(?:a\s+|some\s+|the\s+)?rope\b(?:\s+\w+){0,6}\s+for\b/i,
    positiveControl: "i bought rope for it",
    note: "rope bought FOR A THING is hardware, not means",
  },
  {
    phrase: "we are replacing the beam in the basement",
    unguarded: /\bbeam\s+in\s+the\s+basement\b/i,
    positiveControl: "i been looking at the beam in the basement",
    note: "a beam is also home repair — only the looking/staring frame alerts",
  },
  {
    phrase: "he jumped off the diving board at the pool",
    unguarded: /\bjump(?:ed|ing)?\s+off\s+(?:the|a)\b/i,
    positiveControl: "im going to jump off the bridge",
    note: "jumping off a diving board — the object list is what discriminates",
  },
  {
    phrase: "we did jump rope in gym class",
    unguarded: /\bjump\b(?:\s+\w+){0,2}\s+rope\b|\brope\b/i,
    positiveControl: "i tied a rope in the basement for me",
    note: "jump rope — a bare rope noun would fire on it",
  },
  {
    phrase: "se me disparo la presion con el estres",
    unguarded: /\bme\s+dispar(?:o|ó|é|e)/i,
    positiveControl: "casi me disparo anoche",
    note: "se me disparó — a reading that is about prices or blood pressure",
  },
  {
    phrase: "me ahorcan los plazos de la escuela",
    unguarded: /\bme\s+ahorc/i,
    positiveControl: "casi me ahorco la semana pasada",
    note: "me ahorcan los plazos — deadlines are strangling me",
  },
  {
    phrase: "el trabajo me ahorcaba todos los dias",
    unguarded: /\bme\s+ahorc/i,
    positiveControl: "casi me ahorco la semana pasada",
    note: "me ahorcaba — imperfect, still the figurative reading",
  },
  {
    phrase: "se me cuelga la computadora todo el tiempo",
    unguarded: /\bme\s+cuelg/i,
    positiveControl: "voy a colgarme esta noche",
    note: "se me cuelga la computadora — the machine hangs",
  },
  {
    phrase: "mi hijo se tiro a la alberca sin miedo",
    unguarded: /\b(?:se|me)\s+tir(?:o|ó|é|e)\s+(?:a|al|de|del|desde)\b/i,
    positiveControl: "casi me tire del puente ayer",
    note: "tirarse A la alberca — the preposition is the discriminator",
  },
  {
    phrase: "con las cuentas tengo la soga al cuello",
    unguarded: /\b(?:soga|cuerda)\s+al\s+cuello\b/i,
    positiveControl: "me amarre una soga al cuello anoche",
    note: "tener la soga al cuello — a debt idiom, not a disclosure",
  },
  {
    phrase: "le compre una pistola de agua para mi hijo",
    unguarded: /\bpistola(?:\s+[\wáéíóúüñ]+){0,4}\s+para\s+mi\b/i,
    positiveControl: "tengo la pistola lista para mi",
    note: "para MI HIJO — unaccented \"mi\" is the possessive, not the pronoun",
  },
  {
    phrase: "me puse la soga al cuello con ese contrato",
    unguarded: /\bme\s+puse\s+(?:una|la)\s+(?:soga|cuerda)\s+al\s+cuello\b/i,
    positiveControl: "me amarre una soga al cuello anoche",
    note: "ponerse LA soga al cuello — the second debt/trouble idiom",
  },
  {
    phrase: "compramos soga en la ferreteria para el remolque",
    unguarded: /\bcompr\w+\s+(?:una\s+|la\s+)?soga\b(?:\s+\w+){0,6}\s+para\b/i,
    positiveControl: "compre una soga para eso",
    note: "soga comprada PARA UNA COSA, en primera del plural",
  },
];

function runMustDetect(title: string, cases: readonly Case[]) {
  describe(title, () => {
    for (const [phrase, label] of cases) {
      it(`detects: ${label} — "${phrase}"`, () => {
        const result = detectCrisisSignal(phrase);
        assert.equal(result.matched, true, `"${phrase}" must raise a crisis signal (${label})`);
        assert.equal(
          result.category,
          "self_harm",
          `"${phrase}" is a means disclosure and must carry category self_harm`,
        );
      });
    }
  });
}

runMustDetect("crisis detector — means: firearms (en)", EN_FIREARM_MUST_DETECT);
runMustDetect("crisis detector — means: hanging (en)", EN_HANGING_MUST_DETECT);
runMustDetect("crisis detector — means: jumping (en)", EN_JUMPING_MUST_DETECT);
runMustDetect("crisis detector — means: mixed idiom + disclosure (en)", EN_MIXED_MUST_DETECT);
runMustDetect("crisis detector — means: firearms (es)", ES_FIREARM_MUST_DETECT);
runMustDetect("crisis detector — means: hanging (es)", ES_HANGING_MUST_DETECT);
runMustDetect("crisis detector — means: jumping (es)", ES_JUMPING_MUST_DETECT);

describe("crisis detector — means: the Spanish families report lang es", () => {
  for (const [phrase, label] of [
    ...ES_FIREARM_MUST_DETECT,
    ...ES_HANGING_MUST_DETECT,
    ...ES_JUMPING_MUST_DETECT,
  ]) {
    it(`serves the Spanish 988 block: ${label} — "${phrase}"`, () => {
      // The lang tag is what selects CRISIS_RESOURCE_BLOCK_ES. An English
      // pattern reaching a Spanish message is this file's documented
      // cross-language leak (the "caminé 5 kms hoy" incident), so it is pinned
      // per phrase rather than assumed.
      assert.equal(detectCrisisSignal(phrase).lang, "es", `"${phrase}" must resolve to lang "es"`);
    });
  }
});

describe("crisis detector — means: guards stay silent (en)", () => {
  for (const [phrase, label] of EN_MUST_NOT_DETECT) {
    it(`ignores: ${label} — "${phrase}"`, () => {
      const result = detectCrisisSignal(phrase);
      assert.equal(
        result.matched,
        false,
        `"${phrase}" must NOT raise a crisis signal (${label}) — a stream staff learn to ignore is a dead safety net`,
      );
    });
  }
});

describe("crisis detector — means: guards stay silent (es)", () => {
  for (const [phrase, label] of ES_MUST_NOT_DETECT) {
    it(`ignores: ${label} — "${phrase}"`, () => {
      const result = detectCrisisSignal(phrase);
      assert.equal(
        result.matched,
        false,
        `"${phrase}" no debe alertar (${label}) — los falsos positivos matan la red de seguridad`,
      );
    });
  }
});

describe("crisis detector — means: every guard is shown to BITE", () => {
  for (const { phrase, unguarded, positiveControl, note } of GUARD_BITES) {
    it(`guard bites: ${note} — "${phrase}"`, () => {
      assert.equal(
        unguarded.test(phrase),
        true,
        `the UNGUARDED shape ${unguarded} does not match "${phrase}" — this guard proves nothing`,
      );
      assert.equal(
        detectCrisisSignal(phrase).matched,
        false,
        `"${phrase}" must be silent in production (${note})`,
      );
      assert.equal(
        detectCrisisSignal(positiveControl).matched,
        true,
        `the guard cannot be "proven" by a dead pattern: "${positiveControl}" must still alert`,
      );
    });
  }
});

describe("crisis detector — means: the pre-existing families are untouched", () => {
  it("keeps every earlier phrasing working", () => {
    for (const phrase of [
      "i want to die",
      "i am going to kill myself",
      "i feel suicidal",
      "i took all my pills",
      "quiero morir",
      "me quiero matar",
      "me tomé todas las pastillas",
    ]) {
      assert.equal(
        detectCrisisSignal(phrase).matched,
        true,
        `existing pattern regressed on "${phrase}"`,
      );
    }
  });

  it("keeps the earlier guards silent", () => {
    for (const phrase of [
      "i wanna die my hair",
      "i took my medication this morning",
      "i want to end things with my boyfriend",
      "i walked 5 kms today",
      "voy a cortarme el pelo este fin de semana",
      "me tomo todas las pastillas cada mañana con el desayuno",
    ]) {
      assert.equal(
        detectCrisisSignal(phrase).matched,
        false,
        `existing guard regressed on "${phrase}"`,
      );
    }
  });
});
