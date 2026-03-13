#!/usr/bin/env node

/**
 * Seed script — populates orientation items, cert templates, SPOKES checklists,
 * and SPOKES module templates. Safe to run multiple times (upserts by label).
 *
 * Usage:
 *   DATABASE_URL="..." node scripts/seed-data.mjs
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ---------- Orientation Items ----------

const ORIENTATION_ITEMS = [
  { label: "Complete student registration", description: "Create your Visionquest account and set up your profile.", sortOrder: 0, required: true },
  { label: "Meet with your advisor", description: "Schedule and attend your first advising session.", sortOrder: 1, required: true },
  { label: "Review program handbook", description: "Read through the SPOKES program handbook and policies.", sortOrder: 2, required: true },
  { label: "Complete learning needs screening", description: "Take the learning needs assessment to help identify your starting point.", sortOrder: 3, required: true },
  { label: "Set up your Sage profile", description: "Introduce yourself to Sage and set your initial goals.", sortOrder: 4, required: true },
  { label: "Tour the facility", description: "Take a tour of the program facility and meet the staff.", sortOrder: 5, required: true },
  { label: "Review dress code policy", description: "Read and acknowledge the program dress code requirements.", sortOrder: 6, required: true },
  { label: "Complete media release form", description: "Review and sign the media release form.", sortOrder: 7, required: false },
  { label: "Set up WorkKeys account", description: "Create your ACT WorkKeys account for career readiness assessments.", sortOrder: 8, required: true },
  { label: "Review four-week schedule", description: "Review and understand your program schedule for the first four weeks.", sortOrder: 9, required: true },
];

// ---------- Ready-to-Work Certification Templates ----------

const CERT_TEMPLATES = [
  { label: "Attendance verification", description: "Maintain required attendance for the program period.", sortOrder: 0, required: true, needsFile: true, needsVerify: true },
  { label: "Resume completed", description: "Create a professional resume using the portfolio builder.", sortOrder: 1, required: true, needsFile: false, needsVerify: true },
  { label: "Cover letter completed", description: "Write a cover letter for a target job posting.", sortOrder: 2, required: true, needsFile: true, needsVerify: true },
  { label: "Mock interview", description: "Complete a mock interview session with an advisor.", sortOrder: 3, required: true, needsFile: false, needsVerify: true },
  { label: "Job search portfolio", description: "Build a portfolio of at least 5 job applications.", sortOrder: 4, required: true, needsFile: false, needsVerify: true },
  { label: "Professional references", description: "Compile a list of 3 professional references.", sortOrder: 5, required: true, needsFile: true, needsVerify: true },
  { label: "Workplace skills assessment", description: "Pass the workplace skills self-assessment.", sortOrder: 6, required: true, needsFile: false, needsVerify: true },
  { label: "Financial literacy module", description: "Complete the financial literacy training module.", sortOrder: 7, required: true, needsFile: false, needsVerify: true },
  { label: "Digital literacy basics", description: "Demonstrate basic computer and internet skills.", sortOrder: 8, required: true, needsFile: false, needsVerify: true },
  { label: "Conflict resolution workshop", description: "Attend and complete the conflict resolution workshop.", sortOrder: 9, required: true, needsFile: false, needsVerify: true },
];

// ---------- SPOKES Checklist Templates ----------

const SPOKES_CHECKLIST = [
  // Orientation category
  { label: "Referral received", category: "orientation", sortOrder: 0, required: true },
  { label: "Enrollment form completed", category: "orientation", sortOrder: 1, required: true },
  { label: "Student profile entered", category: "orientation", sortOrder: 2, required: true },
  { label: "TABE assessment scheduled", category: "orientation", sortOrder: 3, required: true },
  { label: "TABE assessment completed", category: "orientation", sortOrder: 4, required: true },
  { label: "Learning needs screening", category: "orientation", sortOrder: 5, required: true },
  { label: "Family survey offered", category: "orientation", sortOrder: 6, required: true },
  // Program file category
  { label: "Student information form", category: "program_file", sortOrder: 0, required: true },
  { label: "Emergency contact form", category: "program_file", sortOrder: 1, required: true },
  { label: "Media release form", category: "program_file", sortOrder: 2, required: false },
  { label: "Direct deposit authorization", category: "program_file", sortOrder: 3, required: false },
  { label: "Dress code acknowledgment", category: "program_file", sortOrder: 4, required: true },
  { label: "Attendance verification form", category: "program_file", sortOrder: 5, required: true },
  { label: "WV family survey", category: "program_file", sortOrder: 6, required: true },
  { label: "Career pathway plan", category: "program_file", sortOrder: 7, required: true },
  { label: "Recommended referrals documented", category: "program_file", sortOrder: 8, required: false },
];

// ---------- SPOKES Module Templates ----------

const SPOKES_MODULES = [
  { label: "IC3 Digital Literacy", description: "Internet and Computing Core Certification.", sortOrder: 0, required: true },
  { label: "Microsoft Office Specialist", description: "MOS certification in Word, Excel, or PowerPoint.", sortOrder: 1, required: false },
  { label: "Adobe Certified Professional", description: "Adobe Creative Cloud certification.", sortOrder: 2, required: false },
  { label: "Intuit QuickBooks", description: "QuickBooks certification for accounting fundamentals.", sortOrder: 3, required: false },
  { label: "Cybersecurity IT Specialist", description: "Certiport IT Specialist certification in cybersecurity.", sortOrder: 4, required: false },
  { label: "TTCE Part 1", description: "Technology and Career Education — Part 1.", sortOrder: 5, required: false },
  { label: "TTCE Part 2", description: "Technology and Career Education — Part 2.", sortOrder: 6, required: false },
  { label: "ACT WorkKeys", description: "National Career Readiness Certificate assessment.", sortOrder: 7, required: true },
  { label: "Life & Employability Skills", description: "SPOKES life and employability skills curriculum.", sortOrder: 8, required: true },
  { label: "Customer Service Module", description: "Customer service skills and certification.", sortOrder: 9, required: false },
];

// ---------- Seed logic ----------

async function seed() {
  console.log("Seeding orientation items...");
  for (const item of ORIENTATION_ITEMS) {
    await prisma.orientationItem.upsert({
      where: { id: `seed-orient-${item.sortOrder}` },
      update: { label: item.label, description: item.description, sortOrder: item.sortOrder, required: item.required },
      create: { id: `seed-orient-${item.sortOrder}`, ...item },
    });
  }
  console.log(`  ✓ ${ORIENTATION_ITEMS.length} orientation items`);

  console.log("Seeding Ready-to-Work cert templates...");
  for (const tmpl of CERT_TEMPLATES) {
    await prisma.certTemplate.upsert({
      where: { id: `seed-cert-${tmpl.sortOrder}` },
      update: { label: tmpl.label, description: tmpl.description, sortOrder: tmpl.sortOrder, required: tmpl.required, needsFile: tmpl.needsFile, needsVerify: tmpl.needsVerify },
      create: { id: `seed-cert-${tmpl.sortOrder}`, certType: "ready-to-work", ...tmpl },
    });
  }
  console.log(`  ✓ ${CERT_TEMPLATES.length} cert templates`);

  console.log("Seeding SPOKES checklist templates...");
  for (let i = 0; i < SPOKES_CHECKLIST.length; i++) {
    const item = SPOKES_CHECKLIST[i];
    await prisma.spokesChecklistTemplate.upsert({
      where: { id: `seed-spk-cl-${i}` },
      update: { label: item.label, category: item.category, sortOrder: item.sortOrder, required: item.required },
      create: { id: `seed-spk-cl-${i}`, ...item },
    });
  }
  console.log(`  ✓ ${SPOKES_CHECKLIST.length} SPOKES checklist items`);

  console.log("Seeding SPOKES module templates...");
  for (const mod of SPOKES_MODULES) {
    await prisma.spokesModuleTemplate.upsert({
      where: { id: `seed-spk-mod-${mod.sortOrder}` },
      update: { label: mod.label, description: mod.description, sortOrder: mod.sortOrder, required: mod.required },
      create: { id: `seed-spk-mod-${mod.sortOrder}`, ...mod },
    });
  }
  console.log(`  ✓ ${SPOKES_MODULES.length} SPOKES module templates`);

  console.log("\nDone! Seed data is ready.");
}

seed()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
