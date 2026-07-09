import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  fetchOccupationProfile,
  fetchOccupationWages,
  fetchSkillsMatcherQuestions,
  fetchToolsAndTechnology,
  fetchTrainingPrograms,
  searchOccupations,
  submitSkillsMatcher,
} from "./careeronestop-counseling";

const ORIGINAL_FETCH = globalThis.fetch;

interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

/** Install a scripted fetch: responses (or errors) are consumed in order. */
function scriptFetch(steps: Array<Response | Error>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  let index = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
    });
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;
    if (step instanceof Error) throw step;
    return step.clone();
  }) as typeof fetch;
  return calls;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const QUESTIONS_PAYLOAD = {
  Skills: [
    {
      ElementId: "2.A.1.a",
      ElementName: "Reading",
      Question: "How well can you read work documents?",
      EasyReadDescription: "Reading instructions and forms at work.",
      AnchorFirst: "Read short notes",
      AnchorLast: "Read complex reports",
      DataPoint20: 1.0,
      DataPoint35: 2.0,
      DataPoint50: 3.5,
      DataPoint65: 5.0,
      DataPoint80: 7.0,
    },
    {
      ElementId: "2.B.1.e",
      ElementName: "Instructing",
      Question: "How well can you teach others?",
      DataPoint20: "1",
      DataPoint35: "2",
      DataPoint50: "3",
      DataPoint65: "4",
      DataPoint80: "6",
    },
  ],
};

describe("careeronestop counseling client", () => {
  beforeEach(() => {
    process.env.COS_USER_ID = "test-user";
    process.env.COS_API_TOKEN = "test-token";
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.COS_USER_ID;
    delete process.env.COS_API_TOKEN;
  });

  describe("unconfigured environment", () => {
    it("every function returns configured:false with an empty payload and never fetches", async () => {
      delete process.env.COS_USER_ID;
      delete process.env.COS_API_TOKEN;
      globalThis.fetch = (async () => {
        throw new Error("fetch must not be called when unconfigured");
      }) as typeof fetch;

      const questions = await fetchSkillsMatcherQuestions();
      assert.deepEqual(questions, { configured: false, questions: [] });

      const matches = await submitSkillsMatcher([{ elementId: "2.A.1.a", rating: 3 }]);
      assert.deepEqual(matches, { configured: false, matches: [] });

      const occupations = await searchOccupations("nurse");
      assert.deepEqual(occupations, { configured: false, occupations: [] });

      const profile = await fetchOccupationProfile("nurse");
      assert.deepEqual(profile, { configured: false, profile: null });

      const wages = await fetchOccupationWages("nurse");
      assert.equal(wages.configured, false);
      assert.deepEqual(wages.wages, []);

      const tools = await fetchToolsAndTechnology("29-1141.00");
      assert.equal(tools.configured, false);
      assert.deepEqual(tools.tools, []);

      const programs = await fetchTrainingPrograms("welding");
      assert.deepEqual(programs, { configured: false, programs: [], totalCount: 0 });
    });
  });

  describe("hostile responses", () => {
    it("maps 401 (wrong token) to error=unauthorized without throwing", async () => {
      scriptFetch([new Response("denied", { status: 401 })]);
      const result = await fetchOccupationWages("nurse");
      assert.equal(result.configured, true);
      assert.equal(result.error, "unauthorized");
      assert.deepEqual(result.wages, []);
    });

    it("maps 404 to error=not_found", async () => {
      scriptFetch([new Response("missing", { status: 404 })]);
      const result = await searchOccupations("zzzz");
      assert.equal(result.error, "not_found");
      assert.deepEqual(result.occupations, []);
    });

    it("maps malformed JSON to error=bad_response", async () => {
      scriptFetch([new Response("<html>not json</html>", { status: 200 })]);
      const result = await fetchSkillsMatcherQuestions();
      assert.equal(result.error, "bad_response");
      assert.deepEqual(result.questions, []);
    });

    it("maps schema-violating JSON to error=bad_response", async () => {
      scriptFetch([jsonResponse({ Skills: "not-an-array" })]);
      const result = await fetchSkillsMatcherQuestions();
      assert.equal(result.error, "bad_response");
    });

    it("maps a timeout abort to error=timeout", async () => {
      scriptFetch([new DOMException("The operation timed out", "TimeoutError")]);
      const result = await fetchTrainingPrograms("welding");
      assert.equal(result.error, "timeout");
      assert.deepEqual(result.programs, []);
    });

    it("maps a connection failure to error=network", async () => {
      scriptFetch([new TypeError("fetch failed")]);
      const result = await fetchOccupationProfile("nurse");
      assert.equal(result.error, "network");
      assert.equal(result.profile, null);
    });

    it("rejects an oversized declared content-length as bad_response", async () => {
      scriptFetch([
        new Response("{}", {
          status: 200,
          headers: { "content-length": String(50_000_000) },
        }),
      ]);
      const result = await fetchOccupationWages("nurse");
      assert.equal(result.error, "bad_response");
    });

    it("rejects an oversized actual body as bad_response", async () => {
      scriptFetch([new Response("x".repeat(2_000_001), { status: 200 })]);
      const result = await searchOccupations("nurse");
      assert.equal(result.error, "bad_response");
    });
  });

  describe("skills matcher", () => {
    it("fetches and shapes the question list with auth header and user-id path", async () => {
      const calls = scriptFetch([jsonResponse(QUESTIONS_PAYLOAD)]);
      const result = await fetchSkillsMatcherQuestions();
      assert.equal(result.configured, true);
      assert.equal(result.error, undefined);
      assert.equal(result.questions.length, 2);
      assert.deepEqual(result.questions[0], {
        elementId: "2.A.1.a",
        skillName: "Reading",
        question: "How well can you read work documents?",
        easyReadDescription: "Reading instructions and forms at work.",
        lowestLabel: "Read short notes",
        highestLabel: "Read complex reports",
      });
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /\/v1\/skillsmatcher\/test-user$/);
      assert.equal(calls[0].headers.get("authorization"), "Bearer test-token");
    });

    it("maps ratings onto each question's own DataPoint scale when submitting", async () => {
      const calls = scriptFetch([
        jsonResponse(QUESTIONS_PAYLOAD),
        jsonResponse({
          SKARankList: [
            {
              OnetCode: "31-1131.00",
              OccupationTitle: "Nursing Assistants",
              Rank: 2,
              Score: 1.8,
              Outlook: "Bright",
              AnnualWages: 35000,
              TypicalEducation: "Certificate",
            },
            {
              OnetCode: "35-3023.00",
              OccupationTitle: "Fast Food Workers",
              Rank: 1,
              Score: 2.4,
              AnnualWages: "25000",
            },
            { OccupationTitle: "No code — dropped" },
          ],
        }),
      ]);

      const result = await submitSkillsMatcher([
        { elementId: "2.A.1.a", rating: 5 },
        { elementId: "2.B.1.e", rating: 1 },
        { elementId: "unknown-element", rating: 3 },
      ]);

      assert.equal(result.error, undefined);
      assert.equal(calls.length, 2);
      assert.equal(calls[1].method, "POST");
      const posted = JSON.parse(calls[1].body ?? "{}");
      // rating 5 → DataPoint80 (7), rating 1 → DataPoint20 ("1"); unknown skipped.
      assert.deepEqual(posted, {
        SKAValueList: [
          { ElementId: "2.A.1.a", DataValue: "7" },
          { ElementId: "2.B.1.e", DataValue: "1" },
        ],
      });
      // Sorted by rank ascending; the code-less row is dropped.
      assert.equal(result.matches.length, 2);
      assert.equal(result.matches[0].title, "Fast Food Workers");
      assert.equal(result.matches[0].medianAnnualWage, 25000);
      assert.equal(result.matches[1].onetCode, "31-1131.00");
      assert.equal(result.matches[1].typicalEducation, "Certificate");
    });

    it("rejects invalid answer shapes locally without calling the API", async () => {
      const calls = scriptFetch([jsonResponse(QUESTIONS_PAYLOAD)]);
      const result = await submitSkillsMatcher([{ elementId: "2.A.1.a", rating: 9 }]);
      assert.equal(result.error, "bad_response");
      assert.deepEqual(result.matches, []);
      assert.equal(calls.length, 0);
    });
  });

  describe("occupations, wages, tools, training", () => {
    it("searches occupations with a clamped limit", async () => {
      const calls = scriptFetch([
        jsonResponse({
          OccupationList: [
            { OnetTitle: "Registered Nurses", OnetCode: "29-1141.00", OccupationDescription: "Care for patients." },
            { OnetTitle: "No code — dropped" },
          ],
        }),
      ]);
      const result = await searchOccupations("nurse", { limit: 99 });
      assert.equal(result.occupations.length, 1);
      assert.deepEqual(result.occupations[0], {
        onetCode: "29-1141.00",
        title: "Registered Nurses",
        description: "Care for patients.",
      });
      assert.match(calls[0].url, /\/v1\/occupation\/test-user\/nurse\/N\/0\/10$/);
    });

    it("shapes an occupation profile with state wages before national", async () => {
      const calls = scriptFetch([
        jsonResponse({
          RecordCount: 1,
          OccupationDetail: [
            {
              OnetTitle: "Nursing Assistants",
              OnetCode: "31-1131.00",
              OnetDescription: "Provide basic patient care.  Lots   of whitespace.",
              EducationTraining: { EducationTitle: "Postsecondary certificate" },
              Tasks: [
                { TaskDescription: "Turn or reposition patients." },
                { TaskDescription: "Measure vital signs." },
              ],
              BrightOutlook: "Bright",
              Wages: {
                WageYear: "2025",
                NationalWagesList: [
                  { RateType: "Annual", Median: "38130", AreaName: "United States" },
                ],
                StateWagesList: [
                  { RateType: "Annual", Median: "33470", Pct10: "27000", Pct90: "41000", AreaName: "West Virginia" },
                ],
              },
            },
          ],
        }),
      ]);

      const result = await fetchOccupationProfile("nursing assistant");
      assert.equal(result.error, undefined);
      const profile = result.profile;
      assert.ok(profile);
      assert.equal(profile.title, "Nursing Assistants");
      assert.equal(profile.typicalEducation, "Postsecondary certificate");
      assert.equal(profile.description, "Provide basic patient care. Lots of whitespace.");
      assert.equal(profile.tasks.length, 2);
      assert.equal(profile.wageYear, 2025);
      assert.equal(profile.wages[0].areaName, "West Virginia");
      assert.equal(profile.wages[0].median, 33470);
      assert.equal(profile.wages[1].areaName, "United States");
      // WV default location + requested data flags on the URL.
      assert.match(calls[0].url, /\/v1\/occupation\/test-user\/nursing%20assistant\/WV\?/);
      assert.match(calls[0].url, /wages=true/);
    });

    it("reports not_found when the profile lookup matches nothing", async () => {
      scriptFetch([jsonResponse({ RecordCount: 0, OccupationDetail: [] })]);
      const result = await fetchOccupationProfile("florble");
      assert.equal(result.error, "not_found");
      assert.equal(result.profile, null);
    });

    it("shapes compare-salaries percentile rows (object OccupationDetail)", async () => {
      const calls = scriptFetch([
        jsonResponse({
          OccupationDetail: {
            OccupationTitle: "Registered Nurses",
            OccupationCode: "29-1141.00",
            Wages: {
              WageYear: 2025,
              StateWagesList: [
                { RateType: "Hourly", Pct10: "26.65", Pct25: "31.19", Median: "37.02", Pct75: "44.10", Pct90: "52.33", AreaName: "West Virginia" },
              ],
              NationalWagesList: [
                { RateType: "Hourly", Median: "41.38", AreaName: "United States" },
              ],
            },
          },
        }),
      ]);
      const result = await fetchOccupationWages("registered nurse");
      assert.equal(result.occupationTitle, "Registered Nurses");
      assert.equal(result.onetCode, "29-1141.00");
      assert.equal(result.wageYear, 2025);
      assert.equal(result.wages[0].median, 37.02);
      assert.equal(result.wages[0].pct10, 26.65);
      assert.equal(result.wages[0].areaName, "West Virginia");
      assert.match(calls[0].url, /\/v1\/comparesalaries\/test-user\/wage\?/);
      assert.match(calls[0].url, /location=WV/);
    });

    it("shapes tools & technology categories and drops empty ones", async () => {
      scriptFetch([
        jsonResponse({
          TechToolOccupationDetails: {
            OnetCode: "29-1141.00",
            OnetTitle: "Registered Nurses",
            Tools: {
              Categories: [
                { Title: "Medical equipment", Examples: [{ Name: "Blood pressure cuff" }, { Name: "Thermometer" }] },
                { Title: "Empty category", Examples: [] },
              ],
            },
            Technology: {
              CategoryList: [
                { Title: "Medical software", Examples: [{ Name: "Epic Systems" }] },
              ],
            },
          },
        }),
      ]);
      const result = await fetchToolsAndTechnology("29-1141.00");
      assert.equal(result.occupationTitle, "Registered Nurses");
      assert.equal(result.tools.length, 1);
      assert.deepEqual(result.tools[0], {
        category: "Medical equipment",
        examples: ["Blood pressure cuff", "Thermometer"],
      });
      assert.equal(result.technology.length, 1);
    });

    it("lists training programs with WV defaults and zeroed filter segments", async () => {
      const calls = scriptFetch([
        jsonResponse({
          RecordCount: 42,
          SchoolPrograms: [
            {
              SchoolName: "Mountwest Community College",
              EtaProgramName: "Welding Technology",
              Credential: "Certificate",
              City: "Huntington",
              StateAbbr: "WV",
              SchoolURL: "https://example.edu/welding",
              Distance: "12.4",
            },
            { EtaProgramName: "No school name — dropped" },
          ],
        }),
      ]);
      const result = await fetchTrainingPrograms("welding", { limit: 3 });
      assert.equal(result.totalCount, 42);
      assert.equal(result.programs.length, 1);
      assert.deepEqual(result.programs[0], {
        school: "Mountwest Community College",
        program: "Welding Technology",
        credential: "Certificate",
        city: "Huntington",
        state: "WV",
        url: "https://example.edu/welding",
        distanceMiles: 12.4,
      });
      assert.match(
        calls[0].url,
        /\/v2\/training\/programs\/test-user\/welding\/WV\/50\/0\/0\/0\/0\/0\/0\/0\/0\/0\/0\/3$/,
      );
    });
  });
});
