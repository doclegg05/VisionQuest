import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider } from "@/lib/ai";
import { EMPTY_RESUME, type ResumeContent } from "@/lib/resume";
import { generateResumeDraft } from "./resume-ai";

// FERPA review §2.c.3 / W10 (2026-09-06): resume_assist sent `Student.email`
// for no reason the model needs, plus the résumé's own contact block (email,
// phone, home location). The model writes the BODY; the contact block is
// re-attached locally, the way the Connect packet already strips it (SEC-W4).

const CONTACT = {
  email: "tanesha.zqx@example.org",
  phone: "(304) 555-0142",
  location: "Beckley, WV 25801",
  website: "https://tanesha.example",
  linkedin: "linkedin.com/in/tanesha-zqx",
};

const STORED: ResumeContent = {
  ...EMPTY_RESUME,
  headline: "Warehouse associate",
  contact: CONTACT,
  skills: ["forklift"],
};

/** Captures what the model is sent, and returns whatever the test hands it. */
function capturingProvider(reply: unknown): AIProvider & { sent: { system: string; user: string } } {
  const sent = { system: "", user: "" };
  const provider = {
    name: "mock-model",
    sent,
    generateResponse: async () => "",
    streamResponse: async function* () {},
    generateStructuredResponse: async (system: string, messages: Array<{ content: string }>) => {
      sent.system = system;
      sent.user = messages.map((m) => m.content).join("\n");
      return JSON.stringify(reply);
    },
  };
  return provider as unknown as AIProvider & { sent: { system: string; user: string } };
}

function modelReply(overrides: Record<string, unknown> = {}) {
  return {
    resume: {
      headline: "Forklift-certified warehouse associate",
      objective: "Move into a lead role.",
      skills: ["forklift", "inventory"],
      experience: [],
      education: [],
      certifications: [],
      references: "Available upon request",
      ...overrides,
    },
    missingInformation: [],
    notes: "",
  };
}

describe("generateResumeDraft: the contact block never reaches the model", () => {
  it("sends neither the email, the phone, nor the location", async () => {
    const provider = capturingProvider(modelReply());
    await generateResumeDraft(provider, {
      prompt: "warehouse jobs",
      existingResume: STORED,
      goals: ["Get a forklift job"],
      portfolioItems: [],
      certifications: [],
    });

    const wire = `${provider.sent.system}\n${provider.sent.user}`;
    for (const value of Object.values(CONTACT)) {
      assert.ok(!wire.includes(value), `contact detail reached the model: ${value}`);
    }
    assert.ok(!/Student email on file/.test(wire), "the email line is still sent");
  });

  it("does not ask the model to write contact fields", async () => {
    const provider = capturingProvider(modelReply());
    await generateResumeDraft(provider, {
      prompt: "",
      existingResume: STORED,
      goals: [],
      portfolioItems: [],
      certifications: [],
    });
    assert.ok(!/"contact"/.test(provider.sent.system), "the JSON shape still has a contact key");
  });

  it("still sends the résumé body it needs to rewrite", async () => {
    const provider = capturingProvider(modelReply());
    await generateResumeDraft(provider, {
      prompt: "",
      existingResume: STORED,
      goals: ["Get a forklift job"],
      portfolioItems: [{ title: "Safety cert", description: null, type: "certificate" }],
      certifications: [{ name: "Forklift Operator", issuer: "SPOKES Program", dates: "Aug 2026" }],
    });
    assert.ok(provider.sent.user.includes("Warehouse associate"));
    assert.ok(provider.sent.user.includes("forklift"));
    assert.ok(provider.sent.user.includes("Get a forklift job"));
    assert.ok(provider.sent.user.includes("Forklift Operator"));
  });
});

describe("generateResumeDraft: the stored contact block is re-attached locally", () => {
  it("returns the original contact block on the draft", async () => {
    const provider = capturingProvider(modelReply());
    const result = await generateResumeDraft(provider, {
      prompt: "",
      existingResume: STORED,
      goals: [],
      portfolioItems: [],
      certifications: [],
    });
    assert.deepEqual(result.resume.contact, CONTACT);
    assert.equal(result.resume.headline, "Forklift-certified warehouse associate");
  });

  it("ignores any contact block the model invents", async () => {
    const provider = capturingProvider(
      modelReply({ contact: { email: "made.up@example.org", phone: "555-000-0000", location: "Nowhere", website: "", linkedin: "" } }),
    );
    const result = await generateResumeDraft(provider, {
      prompt: "",
      existingResume: STORED,
      goals: [],
      portfolioItems: [],
      certifications: [],
    });
    assert.deepEqual(result.resume.contact, CONTACT);
  });

  it("keeps an empty contact block empty when nothing is stored", async () => {
    const provider = capturingProvider(modelReply({ contact: { email: "made.up@example.org" } }));
    const result = await generateResumeDraft(provider, {
      prompt: "",
      existingResume: EMPTY_RESUME,
      goals: [],
      portfolioItems: [],
      certifications: [],
    });
    assert.deepEqual(result.resume.contact, EMPTY_RESUME.contact);
  });
});
