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

// Matches the official "SPOKES Checklist for Student Orientation and Intake" (Reviewed 6/13/2025)
// plus Required Forms for SPOKES Student Files
const ORIENTATION_ITEMS = [
  // Section 1: Welcome Activity & Program Overview
  { label: "Program overview and facility tour", description: "Learn about the program purpose, available services, program components, physical layout, class and building rules.", section: "Welcome Activity & Program Overview", sortOrder: 0, required: true },
  { label: "Review Rights and Responsibilities", description: "Read and sign the SPOKES Rights and Responsibilities form.", section: "Welcome Activity & Program Overview", sortOrder: 1, required: true },
  { label: "Review Code of Conduct and Dress Code", description: "Read and acknowledge the program dress code and conduct expectations.", section: "Welcome Activity & Program Overview", sortOrder: 2, required: true },
  { label: "Review Attendance/Class Closing Policy", description: "Understand the attendance requirements and class closing policy.", section: "Welcome Activity & Program Overview", sortOrder: 3, required: true },
  { label: "Review Daily Sign-in Sheet", description: "Review the daily attendance sign-in sheet process.", section: "Welcome Activity & Program Overview", sortOrder: 4, required: true },
  { label: "Review Class Schedule/Holidays Observed", description: "Review the class schedule and holidays observed.", section: "Welcome Activity & Program Overview", sortOrder: 5, required: true },

  // Section 2: Registration Forms
  { label: "Complete SPOKES Student Profile", description: "Fill out the Student Profile form (key information completed by student, remainder by instructor).", section: "Registration Forms", sortOrder: 6, required: true },
  { label: "Sign Personal Attendance Contract", description: "Read and sign the SPOKES Personal Attendance Contract.", section: "Registration Forms", sortOrder: 7, required: true },
  { label: "Sign Authorization for Release of Information", description: "Complete the WVAdultEd/SPOKES Authorization for Release of Information to the Department of Health Services.", section: "Registration Forms", sortOrder: 8, required: true },
  { label: "Complete Media Release Form", description: "Review and sign the media release form.", section: "Registration Forms", sortOrder: 9, required: false },
  { label: "Sign Technology Acceptable Use Policy", description: "Read and sign the WVAdultEd Student Technology Acceptable Use Policy.", section: "Registration Forms", sortOrder: 10, required: true },
  { label: "Complete DoHS Participant Time Sheet", description: "Fill out the WVDoHS Participant Time Sheet (DFA-TS-12) for activity tracking.", section: "Registration Forms", sortOrder: 11, required: true },

  // Section 3: Learning Needs / Barriers Screening
  { label: "Complete Learning Needs Screening", description: "Take the WV Learning Needs Screening (13 questions + follow-up on barriers). Results may come from the Assessment Specialist or WVDoHS referral.", section: "Learning Needs / Barriers Screening", sortOrder: 12, required: true },
  { label: "Document disability accommodations", description: "If applicable, document disabilities and arrange accommodations with your WVDoHS Case Manager.", section: "Learning Needs / Barriers Screening", sortOrder: 13, required: false },

  // Section 4: Strengths Identification
  { label: "Complete TABE Locator assessment", description: "Take the TABE Locator to determine the correct pre-test level for reading and math.", section: "Strengths Identification", sortOrder: 14, required: true },

  // Section 5: Standardized Entry Assessment
  { label: "Complete TABE entry assessment", description: "Take the TABE assessment in reading and math. Results will be recorded on your Student Profile.", section: "Standardized Entry Assessment", sortOrder: 15, required: true },

  // Section 6: Goal and Career Exploration
  { label: "Complete Education and Career Plan", description: "Work with your instructor to create your SPOKES Education and Career Plan, including short-term and long-term goals.", section: "Goal and Career Exploration", sortOrder: 16, required: true },
  { label: "Complete career interest assessment", description: "Take a career interest and aptitude assessment to help identify career pathways.", section: "Goal and Career Exploration", sortOrder: 17, required: true },

  // Section 7: Private Student Interview
  { label: "Private student interview", description: "Meet one-on-one with your instructor to discuss assessment results, barriers, support services, career interests, and certificate programs.", section: "Private Student Interview", sortOrder: 18, required: true },
  { label: "Confirm attendance schedule", description: "Confirm your attendance schedule and commitment status using the SPOKES Personal Attendance Contract.", section: "Private Student Interview", sortOrder: 19, required: true },

  // Section 8: Required Program Forms
  { label: "Review Employment Portfolio Checklist", description: "Review the Employment Portfolio Checklist and understand portfolio requirements.", section: "Required Program Forms", sortOrder: 20, required: true },
  { label: "Review SPOKES Module Record", description: "Review the SPOKES Module Record for tracking program module completion.", section: "Required Program Forms", sortOrder: 21, required: true },
  { label: "Review Ready to Work Attendance Verification", description: "Review the Ready to Work Attendance Verification form for certification tracking.", section: "Required Program Forms", sortOrder: 22, required: true },

  // Section 9: Get Started with VisionQuest
  { label: "Set up your Sage profile", description: "Introduce yourself to Sage, your AI career coach, and set your initial goals.", section: "Get Started with VisionQuest", sortOrder: 23, required: true },
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
      update: { label: item.label, description: item.description, section: item.section ?? null, sortOrder: item.sortOrder, required: item.required },
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
