import { generateStructuredResponse } from "@/lib/gemini";
import { normalizeResumeContent, type ResumeContent } from "@/lib/resume";

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const result = await pdfParse(buffer);
  return result.text;
}

export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

export async function extractTextFromFile(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === "application/pdf") {
    return extractTextFromPdf(buffer);
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    return extractTextFromDocx(buffer);
  }
  throw new Error("Unsupported file type. Upload a PDF or Word document.");
}

const EXTRACT_PROMPT = `You are an expert resume parser. Extract structured resume data from the raw text provided.

Rules:
- Extract ALL information faithfully — names, dates, employers, titles, skills, education, certifications.
- Do NOT invent or embellish any information. Only use what is explicitly stated in the text.
- Rewrite job descriptions and objectives into concise, ATS-friendly language using action verbs.
- Quantify achievements where numbers are present in the original text.
- Combine fragmented text into coherent sentences where the meaning is clear.
- For skills, extract both explicit skill lists AND skills implied by job descriptions/certifications.
- If a section is empty or not found in the text, leave it as empty string or empty array.
- Experience descriptions should be bullet-style lines separated by newlines.

Return valid JSON in this exact shape:
{
  "resume": {
    "headline": "",
    "objective": "",
    "contact": {
      "email": "",
      "phone": "",
      "location": "",
      "website": "",
      "linkedin": ""
    },
    "skills": [],
    "experience": [
      {
        "title": "",
        "company": "",
        "location": "",
        "dates": "",
        "description": ""
      }
    ],
    "education": [
      {
        "school": "",
        "degree": "",
        "location": "",
        "dates": ""
      }
    ],
    "certifications": [
      {
        "name": "",
        "issuer": "",
        "dates": ""
      }
    ],
    "references": ""
  },
  "improvements": [],
  "notes": ""
}

The "improvements" array should list specific suggestions for strengthening the resume (e.g., "Add measurable achievements to your cashier role", "Include graduation year for your GED").
The "notes" field should contain a brief overall assessment.`;

export interface ResumeExtractResult {
  resume: ResumeContent;
  improvements: string[];
  notes: string;
}

export async function extractResumeFromText(
  apiKey: string,
  rawText: string,
  studentName: string,
): Promise<ResumeExtractResult> {
  const userMessage = [
    `Student name: ${studentName}`,
    "",
    "Raw resume text extracted from uploaded document:",
    "---",
    rawText.slice(0, 15000),
    "---",
    "",
    "Parse this resume and return the structured JSON.",
  ].join("\n");

  const responseText = await generateStructuredResponse(apiKey, EXTRACT_PROMPT, [
    { role: "user", content: userMessage },
  ]);

  const parsed = JSON.parse(responseText);

  return {
    resume: normalizeResumeContent(parsed?.resume ?? {}),
    improvements: Array.isArray(parsed?.improvements)
      ? parsed.improvements.filter((s: unknown) => typeof s === "string" && s.trim())
      : [],
    notes: typeof parsed?.notes === "string" ? parsed.notes : "",
  };
}
