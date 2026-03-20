#!/usr/bin/env node

/**
 * Seed script — populates ProgramDocument table from the docs-upload/_inventory.txt.
 * Safe to run multiple times (upserts by storageKey).
 *
 * Usage:
 *   DATABASE_URL="..." node scripts/seed-documents.mjs
 *   node scripts/seed-documents.mjs          (uses .env.local)
 *   node scripts/seed-documents.mjs --dry-run (preview, no DB writes)
 */

import { PrismaClient } from "@prisma/client";
import { readFile } from "fs/promises";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");
const ROOT = dirname(fileURLToPath(import.meta.url));
const INVENTORY_PATH = join(ROOT, "../docs-upload/_inventory.txt");

// ─── FOLDER → STORAGE PREFIX (must match upload-to-supabase.mjs) ────────────
const FOLDER_MAP = {
  forms:        "forms",
  orientation:  "orientation",
  lms:          "lms",
  students:     "students/resources",
  teachers:     "teachers/guides",
  presentation: "presentations",
};

// ─── LMS SUBFOLDER → PLATFORM ID (matches platforms.ts) ─────────────────────
const PLATFORM_MAP = {
  "Aztec":                                           "aztec",
  "Bring Your A Game to Work":                       "bring-your-a-game",
  "Burlington English":                              "burlington-english",
  "CSMLearn":                                        "csmlearn",
  "Edgenuity":                                       "edgenuity",
  "Essential Education":                             "essential-education",
  "GMetrix and LearnKey":                            "gmetrix-and-learnkey",
  "Khan Academy":                                    "khan-academy",
  "Learning Express":                                "learning-express-library",
  "Ready to Work":                                   "ready-to-work",
  "Through the Customer's Eyes-Customer Service Training": "through-the-customers-eyes",
  "USA Learns":                                      "usa-learns",
};

// ─── MIME TYPES ──────────────────────────────────────────────────────────────
const MIME_MAP = {
  ".pdf":  "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".mp3":  "audio/mpeg",
  ".avi":  "video/x-msvideo",
  ".txt":  "text/plain",
};

// Extensions to skip entirely
const SKIP_EXTENSIONS = new Set([".url", ".ai"]);

// ─── TITLE OVERRIDES (storageKey → human-readable display title) ────────────
const TITLE_OVERRIDES = {
  // DoHS Forms
  "forms/DFA-PRC-1_Rev-1-24.pdf": "Personal Responsibility Contract (DFA-PRC-1)",
  "forms/DFA_-_SSP-1_1-9-24.pdf": "Self-Sufficiency Plan (DFA-SSP-1)",
  "forms/DFA-TS-12_Rev_-2-24_Fillable.pdf": "Transitional Support Form — Fillable (DFA-TS-12)",
  "forms/DFA-TS-12_Rev_-2-24.pdf": "Transitional Support Form (DFA-TS-12)",
  "forms/DFA-WVW-25_Rev_6-24.pdf": "WV Works Activity Assignment (DFA-WVW-25)",
  "forms/DFA-WVW-70_Rev-3-5-24-Sample.pdf": "WV Works Participation Report — Sample (DFA-WVW-70)",
  "forms/LNS_with_Referral_4.24.pdf": "Learner Notification of Services with Referral",
  "forms/Prospective_Employer_Letter_ESP_EIP.docx.pdf": "Prospective Employer Letter — ESP/EIP",
  "forms/PY_24_Student_Profile_Fillable_11.15.23.pdf": "Student Profile — Program Year 2024 (Fillable)",
  "forms/Support_Services_Fact_Sheet_Rev_6-22.pdf": "Support Services Fact Sheet",
  "forms/WVAdultEd_ESOL_RegistrationBackground_Interview-fillable_updated_July_2022.pdf": "ESOL Registration & Background Interview (Fillable)",
  "forms/WVAdultEd_Sign_in_sheet_5_2023 (1).pdf": "WV Adult Education Sign-In Sheet",

  // Orientation
  "orientation/WVAdultEd_Tech_Accept_Use_Fillable.pdf": "Technology Acceptable Use Policy (Fillable)",
  "orientation/SPOKES_Rights_and_Responsibilites_FY26_Fillable.pdf": "SPOKES Rights and Responsibilities (Fillable)",
  "orientation/WVAdultEd_DoHS_Release_of_Information_FY26_Fillable.pdf": "DoHS Release of Information (Fillable)",

  // LMS Platform Guides
  "lms/Burlington English/02_Accessing_BE_1.pdf": "Accessing Burlington English — Getting Started",
  "lms/Bring Your A Game to Work/BYAG_PPT_by_Kara_Richards.pptx": "Bring Your A Game — Presentation by Kara Richards",
  "lms/Bring Your A Game to Work/BYAGTW_T3_-_2015_Webinar.pdf": "Bring Your A Game — Tier 3 Webinar",
  "lms/Burlington English/IH-012-921_Guide_for_IEL-CE.pdf": "Burlington English Guide for IEL-CE",
  "lms/Burlington English/IH-013-089_Certificate_of_Achievement__fillable.pdf": "Burlington English Certificate of Achievement (Fillable)",
  "lms/Burlington English/IH-015-816_BE_certificate_of_achivement_West_Coast_fillable.pdf": "Burlington English Certificate of Achievement — West Coast (Fillable)",
  "lms/Aztec/MSESC_-_PLUS_Quick_Start_Teacher_Guide_-_Version_9.0.pdf": "Aztec PLUS Quick Start Teacher Guide",
  "lms/Burlington English/QG_for_Teachers_Aug2017.pdf": "Burlington English Quick Guide for Teachers",
  "lms/Through the Customer's Eyes-Customer Service Training/TTCE_LEVEL_2_CERTIFICATE_2.pdf": "Through the Customer's Eyes — Level 2 Certificate",
  "lms/Burlington English/UPDATED_BE_Placement_Chart_USA__BB_2-2017.pdf": "Burlington English Placement Chart",
  "lms/Burlington English/WVAE_Certificate.pdf": "WV Adult Ed Certificate — Burlington English",
  "lms/Burlington English/WVAE_Certificate_hours.pdf": "WV Adult Ed Certificate Hours — Burlington English",
  "lms/Through the Customer's Eyes-Customer Service Training/facilitatorsGuide1.pdf": "Through the Customer's Eyes — Facilitator's Guide",
  "lms/Bring Your A Game to Work/Pyscho_Metrics_of_Personality.pdf": "Psychometrics of Personality",
  "lms/GMetrix and LearnKey/Intuit/Instuit Quickbooks Certificate.pdf": "Intuit QuickBooks Certificate",
  "lms/Ready to Work/Matching-WKs2Jobs-Exercise.pdf": "Matching Workplace Skills to Jobs — Exercise",
  "lms/Ready to Work/Ready to Work Certficate.pdf": "Ready to Work Certificate",

  // Certification / Program Info
  "lms/certifications/program-info/SPOKES Life and Employabilitly Skills Curriculum Module Descriptor.pdf": "SPOKES Life & Employability Skills — Module Descriptor",
  "lms/certifications/program-info/MOS Module Descriptor.pdf": "Microsoft Office Specialist (MOS) — Module Descriptor",
  "lms/certifications/program-info/Sample_TABE_13_Result_to_DoHS.pdf": "Sample TABE 13/14 Result Report for DoHS",

  // Teacher Guides
  "teachers/guides/34_CFR_463.20d_13_Considerations.pdf": "WIOA 34 CFR 463.20(d) — 13 Considerations for IET Programs",
  "teachers/guides/ABEEducatorEvaluationProcedures.abe_final.pdf": "ABE Educator Evaluation Procedures",
  "teachers/guides/esea_edeval_timeline_000.pdf": "ESEA Educator Evaluation Timeline",
  "teachers/guides/Administrative_Guide_Revised_10.4.2024.pdf": "SPOKES Administrative Guide",
  "teachers/guides/Americas-Talent-Strategy-Building-the-Workforce-for-the-Golden-Age.pdf": "America's Talent Strategy — Building the Workforce",
  "teachers/guides/Hanbook Appendix/Section 10/NWD_WV_user_flyer.pdf": "No Wrong Door WV — User Flyer",
  "teachers/guides/Hanbook Appendix/Section 11/post-sec_verification_form_9.2.25.pdf": "Post-Secondary Verification Form",
  "teachers/guides/Hanbook Appendix/Section 10/Workforce-Flyer-updated-06.24.pdf": "Workforce Development Flyer",
  "teachers/guides/Hanbook Appendix/Section 11/Desktop_Monitoring_Reflection_Tool_Master_4_-_Fill4_2.pdf": "Desktop Monitoring Reflection Tool (Fillable)",
  "teachers/guides/Hanbook Appendix/Section 14/ESL_WIOA_2015.pptx": "ESOL & WIOA Requirements Presentation",
  "teachers/guides/Hanbook Appendix/Section 15/WV_SDT_ECP_FY22 (1).pdf": "WV Standardized Data Tool — Education & Career Plan",
  "teachers/guides/Hanbook Appendix/Section 2/Burnout_SelfCare_WVAEA_4.pdf": "Burnout & Self-Care — WV Adult Ed Association",
  "teachers/guides/Hanbook Appendix/Section 10/Logos/class.png": "Adult Education Classroom Image",
  "teachers/guides/Hanbook Appendix/Section 10/Logos/Weekly_Orientation_BampW.JPG": "Weekly Orientation Flyer (B&W)",
  "teachers/guides/Hanbook Appendix/Section 10/AdultEd_FactSheet-rev_SA.pdf": "Adult Education Fact Sheet",
  "teachers/guides/Hanbook Appendix/Section 10/Triple_AI_Datasheet_K-12_Interactive_Final.pdf": "Triple AI Datasheet — K-12 Interactive",
  "teachers/guides/Hanbook Appendix/Section 11/All_Measurable_Skills_Gain_and_Outcomes_3.29.22.pdf": "Measurable Skills Gain & Outcomes Reference",
  "teachers/guides/Hanbook Appendix/Section 11/Average_Contact_Hours_Per_Student_updated.pdf": "Average Contact Hours Per Student",

  // WV Adult Ed Handbook Sections
  "teachers/guides/WV Adult Ed Handbook/Section_1_2025.2026.pdf": "Handbook Section 1 — Acronyms & Definitions",
  "teachers/guides/WV Adult Ed Handbook/Section_2_2025.2026.pdf": "Handbook Section 2 — Professional Development",
  "teachers/guides/WV Adult Ed Handbook/Section_3_2025.2026.pdf": "Handbook Section 3 — Learning Disabilities",
  "teachers/guides/WV Adult Ed Handbook/Section_4_2025.2026.pdf": "Handbook Section 4 — Student Intake & Orientation",
  "teachers/guides/WV Adult Ed Handbook/Section_5_2025.2026.pdf": "Handbook Section 5 — Barrier Reduction",
  "teachers/guides/WV Adult Ed Handbook/Section_6_2025.2026.pdf": "Handbook Section 6 — Assessment (TABE/CASAS)",
  "teachers/guides/WV Adult Ed Handbook/Section_7_2025.2026.pdf": "Handbook Section 7 — Career Pathways & Certificates",
  "teachers/guides/WV Adult Ed Handbook/Section_8_2025.2026.pdf": "Handbook Section 8 — Curriculum Standards (CCR)",
  "teachers/guides/WV Adult Ed Handbook/Section_9_2025.2026.pdf": "Handbook Section 9 — Instructional Strategies",
  "teachers/guides/WV Adult Ed Handbook/Section_10_2025.2026.pdf": "Handbook Section 10 — Marketing & Outreach",
  "teachers/guides/WV Adult Ed Handbook/Section_11_2025.2026_2.pdf": "Handbook Section 11 — Data & Monitoring (NRS)",
  "teachers/guides/WV Adult Ed Handbook/Section_12_2025.2026.pdf": "Handbook Section 12 — HSE Diplomas",
  "teachers/guides/WV Adult Ed Handbook/Section_13_2025.2026_updated_2.18.26.pdf": "Handbook Section 13 — Proxy Hours & Distance Education",
  "teachers/guides/WV Adult Ed Handbook/Section_14_2025.2026.pdf": "Handbook Section 14 — ESOL",
  "teachers/guides/WV Adult Ed Handbook/Section_15_2025_2026.pdf": "Handbook Section 15 — Corrections Education",
  "teachers/guides/WV Adult Ed Handbook/Section_16_2025.2026.pdf": "Handbook Section 16 — SPOKES Modules",

  // Teacher docs with raw-looking titles
  "teachers/guides/professional-growth-development-plan-form.pdf": "Professional Growth & Development Plan Form",
  "teachers/guides/Hanbook Appendix/Section 10/Logos/free_customer_service_training.png": "Free Customer Service Training Promo",
  "teachers/guides/Hanbook Appendix/Section 10/Logos/wvadulted.com_1.png": "WV Adult Education Website Banner",
  "teachers/guides/Hanbook Appendix/Section 15/WVAdultEd_Corrections_Sign_in_sheet_2_2.1.22_1.pdf": "Corrections Education Sign-In Sheet",
  "teachers/guides/Hanbook Appendix/Section 2/WVAEA_GED_Program_Tools_and_Resources_for_Student_Success_09.11.25.pdf": "GED Program Tools & Resources for Student Success",
  "teachers/guides/Hanbook Appendix/Section 2/WVAEA_Preparing_Students_for_the_GED_RLA_Extended_Response_09.11.25.pdf": "Preparing Students for the GED RLA Extended Response",
  "teachers/guides/Hanbook Appendix/Section 4/Program_Files_Checklist_8.11.25.pdf": "Program Files Checklist",
  "teachers/guides/Hanbook Appendix/Section 4/WVAdultEd_Enrollment_Verification_1.8.25.pdf": "WV Adult Education Enrollment Verification",

  // Presentations / Marketing
  "presentations/wvadulted.com_1.png": "WV Adult Education Website Screenshot",
  "presentations/WVAE-color-contacts.png": "WV Adult Education Contact Information (Color)",
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Parse an inventory line into a relative path from docs-upload/ */
function parseInventoryLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // Lines look like: C:\Users\...\docs-upload\forms\file.pdf
  const marker = "docs-upload\\";
  const idx = trimmed.indexOf(marker);
  if (idx === -1) return null;
  return trimmed.slice(idx + marker.length).replace(/\\/g, "/");
}

/** Build the Supabase storageKey from a relative path */
function getStorageKey(relPath) {
  const topFolder = relPath.split("/")[0];
  const prefix = FOLDER_MAP[topFolder];
  if (!prefix) return null;

  const rest = relPath.slice(topFolder.length + 1);

  // Special case: teachers/Hanbook Appendix/Section 16/* → lms/certifications/program-info/*
  if (topFolder === "teachers" && rest.includes("Hanbook Appendix/Section 16/")) {
    const fileName = rest.split("/").pop();
    return `lms/certifications/program-info/${fileName}`;
  }

  return `${prefix}/${rest}`;
}

/** Determine ProgramDocCategory from the relative path */
function getCategory(relPath) {
  const lower = relPath.toLowerCase();
  const topFolder = relPath.split("/")[0];

  if (topFolder === "orientation") return "ORIENTATION";
  if (topFolder === "presentation") return "PRESENTATION";
  if (topFolder === "students") return "STUDENT_RESOURCE";

  if (topFolder === "forms") {
    // Refine forms into sub-categories
    if (/rights|acceptable.?use|dress.?code|non.?discrimination|confidential/i.test(lower))
      return "PROGRAM_POLICY";
    if (/ready.?to.?work|module.?rubric|attendance.?verification|benchmark/i.test(lower))
      return "READY_TO_WORK";
    if (/portfolio|employment.?portfolio/i.test(lower))
      return "READY_TO_WORK";
    if (/referral|lns.?with.?referral|prospective.?employer/i.test(lower))
      return "STUDENT_REFERRAL";
    return "DOHS_FORM";
  }

  if (topFolder === "lms") {
    const parts = relPath.split("/");
    const subfolder = parts[1] || "";
    if (/ready.?to.?work/i.test(subfolder)) return "READY_TO_WORK";
    return "LMS_PLATFORM_GUIDE";
  }

  if (topFolder === "teachers") {
    // Section 16 = certification module descriptors
    if (lower.includes("section 16")) return "CERTIFICATION_INFO";
    return "TEACHER_GUIDE";
  }

  return "STUDENT_RESOURCE";
}

/** Determine audience from relative path */
function getAudience(relPath) {
  const topFolder = relPath.split("/")[0];
  if (topFolder === "teachers") return "TEACHER";
  if (topFolder === "students") return "STUDENT";
  if (topFolder === "orientation") return "STUDENT";
  return "BOTH";
}

/** Extract platformId for lms/ documents */
function getPlatformId(relPath) {
  const topFolder = relPath.split("/")[0];
  if (topFolder !== "lms") return null;
  const parts = relPath.split("/");
  const subfolder = parts[1] || "";
  return PLATFORM_MAP[subfolder] || null;
}

/** Derive a human-readable title from a filename */
function deriveTitle(filename) {
  // Strip extension
  const ext = extname(filename);
  let title = filename.slice(0, -ext.length);

  // Replace underscores and hyphens with spaces
  title = title.replace(/_/g, " ").replace(/-/g, " ");

  // Remove common version suffixes
  title = title
    .replace(/\s*FY\s*\d{2,4}/gi, "")
    .replace(/\s*Fillable/gi, "")
    .replace(/\s*fillable/gi, "")
    .replace(/\s*Rev[\s.]*[\d\-]+/gi, "")
    .replace(/\s*updated[\s.]*[\d\-]+/gi, "")
    .replace(/\s*v\d+/gi, "")
    .replace(/\s*\(\d+\)/g, "")         // Remove (1), (2) suffixes
    .replace(/\s+/g, " ")
    .trim();

  return title || filename;
}

/** Get MIME type from extension */
function getMimeType(filename) {
  const ext = extname(filename).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

/** Check if file should be skipped */
function shouldSkip(filename) {
  const ext = extname(filename).toLowerCase();
  return SKIP_EXTENSIONS.has(ext);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📚  VisionQuest — Seed Program Documents`);
  if (DRY_RUN) console.log(`    Mode: DRY RUN (no DB writes)\n`);
  else console.log(`    Mode: LIVE\n`);

  const inventoryRaw = await readFile(INVENTORY_PATH, "utf-8");
  const lines = inventoryRaw.split("\n");

  const documents = [];

  for (const line of lines) {
    const relPath = parseInventoryLine(line);
    if (!relPath) continue;

    const filename = relPath.split("/").pop();
    if (!filename || shouldSkip(filename)) continue;

    const storageKey = getStorageKey(relPath);
    if (!storageKey) continue;

    const category = getCategory(relPath);
    const audience = getAudience(relPath);
    const platformId = getPlatformId(relPath);
    const title = TITLE_OVERRIDES[storageKey] || deriveTitle(filename);
    const mimeType = getMimeType(filename);

    // For Section 16 mapped to lms/, override audience to BOTH
    const finalAudience =
      relPath.startsWith("teachers/") && relPath.includes("Section 16/")
        ? "BOTH"
        : audience;

    documents.push({
      title,
      storageKey,
      mimeType,
      category,
      audience: finalAudience,
      platformId,
      sortOrder: 0,
      isActive: true,
    });
  }

  console.log(`  Found ${documents.length} documents to seed.\n`);

  if (DRY_RUN) {
    const byCat = {};
    for (const doc of documents) {
      byCat[doc.category] = (byCat[doc.category] || 0) + 1;
    }
    console.log("  By category:");
    for (const [cat, count] of Object.entries(byCat).sort()) {
      console.log(`    ${cat}: ${count}`);
    }
    console.log(`\n  Sample documents:`);
    for (const doc of documents.slice(0, 10)) {
      console.log(`    [${doc.category}] ${doc.title}`);
      console.log(`      storageKey: ${doc.storageKey}`);
      console.log(`      audience: ${doc.audience}, platform: ${doc.platformId || "—"}`);
    }
    return;
  }

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const doc of documents) {
    try {
      const result = await prisma.programDocument.upsert({
        where: { storageKey: doc.storageKey },
        create: doc,
        update: {
          title: doc.title,
          mimeType: doc.mimeType,
          category: doc.category,
          audience: doc.audience,
          platformId: doc.platformId,
        },
      });
      // Check if it was created or updated by comparing createdAt vs updatedAt
      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        created++;
      } else {
        updated++;
      }
    } catch (err) {
      console.error(`  ❌  ${doc.storageKey}: ${err.message}`);
      errors++;
    }
  }

  console.log(`  ✅  Created: ${created}`);
  console.log(`  🔄  Updated: ${updated}`);
  if (errors > 0) console.log(`  ❌  Errors: ${errors}`);
  console.log();
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
