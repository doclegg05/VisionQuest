/**
 * Single source of truth for resume APPEARANCE.
 * Both renderers (buildResumePrintHtml + generateResumePdf) read from this module
 * so the preview, Print view, and downloaded/attached PDF cannot drift.
 */

export const RESUME_FONT_KEYS = ["times", "arial", "garamond", "lato"] as const;
export type ResumeFontKey = (typeof RESUME_FONT_KEYS)[number];

export interface ResumeFont {
  key: ResumeFontKey;
  label: string;
  /** font-family stack for the HTML renderer */
  cssStack: string;
  /** font name registered in jsPDF (built-in for core, addFont name for embedded) */
  jsPdfFont: string;
  kind: "core" | "embedded";
  /** Google Fonts family query (HTML side) — embedded fonts only */
  googleFamily?: string;
}

export const RESUME_FONTS: Record<ResumeFontKey, ResumeFont> = {
  times: {
    key: "times",
    label: "Times New Roman",
    cssStack: `"Times New Roman", Times, serif`,
    jsPdfFont: "times",
    kind: "core",
  },
  arial: {
    key: "arial",
    label: "Arial",
    cssStack: `Arial, Helvetica, sans-serif`,
    jsPdfFont: "helvetica",
    kind: "core",
  },
  garamond: {
    key: "garamond",
    label: "EB Garamond",
    cssStack: `"EB Garamond", Georgia, serif`,
    jsPdfFont: "EBGaramond",
    kind: "embedded",
    googleFamily: "EB+Garamond:wght@400;700",
  },
  lato: {
    key: "lato",
    label: "Lato",
    cssStack: `"Lato", Arial, sans-serif`,
    jsPdfFont: "Lato",
    kind: "embedded",
    googleFamily: "Lato:wght@400;700",
  },
};

export const DEFAULT_RESUME_FONT: ResumeFontKey = "times";

export function getResumeFont(key: string | null | undefined): ResumeFont {
  if (key && (RESUME_FONT_KEYS as readonly string[]).includes(key)) {
    return RESUME_FONTS[key as ResumeFontKey];
  }
  return RESUME_FONTS[DEFAULT_RESUME_FONT];
}

/** Section identity, order, and headings — shared by both renderers. */
export const RESUME_SECTION_ORDER = [
  "summary",
  "skills",
  "experience",
  "education",
  "certifications",
  "references",
] as const;

export type ResumeSectionId = (typeof RESUME_SECTION_ORDER)[number];

export const RESUME_SECTION_TITLES: Record<ResumeSectionId, string> = {
  summary: "Professional Summary",
  skills: "Skills",
  experience: "Experience",
  education: "Education",
  certifications: "Certifications",
  references: "References",
};

/** Colors — hex for HTML/CSS, rgb tuples for jsPDF setTextColor/setDrawColor. */
export const RESUME_COLORS = { ink: "#16263f", inkSoft: "#48566b", rule: "#9ca7b6" } as const;
export const RESUME_RGB = {
  ink: [22, 38, 63] as const,
  inkSoft: [72, 86, 107] as const,
  rule: [156, 167, 182] as const,
} as const;
