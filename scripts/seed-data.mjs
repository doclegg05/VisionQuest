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

// ---------- SPOKES Module Templates (Certifications) ----------
// Mirrors the WVAdultEd Professional Development Portal certificate catalog.
// Categories drive the grouped UI on the teacher SPOKES tab. SortOrder controls
// row order within each category. Required defaults to true per program intent —
// every offered certificate is a tracked credential a student may earn.

const SPOKES_MODULES = [
  // =========================================================================
  // Career Readiness — completion / participation certificates
  // =========================================================================
  { category: "career-readiness", label: "Ready-to-Work Certificate", description: "Career Readiness foundational completion certificate.", sortOrder: 0, required: true },
  { category: "career-readiness", label: "Achievement Certificate", description: "Recognition of academic / program achievement.", sortOrder: 1, required: true },
  { category: "career-readiness", label: "Participation Certificate", description: "Recognition of program participation.", sortOrder: 2, required: true },

  // =========================================================================
  // Career Readiness Certificate (ACT WorkKeys NCRC tiers)
  // =========================================================================
  { category: "ncrc", label: "Career Readiness Certificate — Platinum", description: "ACT WorkKeys NCRC, Platinum level.", sortOrder: 10, required: true },
  { category: "ncrc", label: "Career Readiness Certificate — Gold", description: "ACT WorkKeys NCRC, Gold level.", sortOrder: 11, required: true },
  { category: "ncrc", label: "Career Readiness Certificate — Silver", description: "ACT WorkKeys NCRC, Silver level.", sortOrder: 12, required: true },
  { category: "ncrc", label: "Career Readiness Certificate — Bronze", description: "ACT WorkKeys NCRC, Bronze level.", sortOrder: 13, required: true },

  // =========================================================================
  // Customer Service
  // =========================================================================
  { category: "customer-service", label: "TTCE Part 1", description: "Through the Customer's Eyes — Part 1.", sortOrder: 30, required: true },
  { category: "customer-service", label: "TTCE Part 2", description: "Through the Customer's Eyes — Part 2.", sortOrder: 31, required: true },
  { category: "customer-service", label: "CSM Certificate of High Performance", description: "Customer Service Management — High Performance certificate.", sortOrder: 32, required: true },
  { category: "customer-service", label: "CSM Career Strategies", description: "Customer Service Management — Career Strategies certificate.", sortOrder: 33, required: true },

  // =========================================================================
  // Computer Essentials (tiered)
  // =========================================================================
  { category: "computer-essentials", label: "Computer Essentials Certificate — Platinum", description: "Computer Essentials overall certificate, Platinum tier.", sortOrder: 50, required: true },
  { category: "computer-essentials", label: "Computer Essentials Certificate — Gold", description: "Computer Essentials overall certificate, Gold tier.", sortOrder: 51, required: true },
  { category: "computer-essentials", label: "Computer Essentials Certificate — Silver", description: "Computer Essentials overall certificate, Silver tier.", sortOrder: 52, required: true },
  { category: "computer-essentials", label: "Computer Essentials Certificate — Bronze", description: "Computer Essentials overall certificate, Bronze tier.", sortOrder: 53, required: true },
  { category: "computer-essentials", label: "Computer Essentials: Computing Fundamentals — Platinum", description: "Computing Fundamentals subsection, Platinum tier.", sortOrder: 54, required: true },
  { category: "computer-essentials", label: "Computer Essentials: Computing Fundamentals — Gold", description: "Computing Fundamentals subsection, Gold tier.", sortOrder: 55, required: true },
  { category: "computer-essentials", label: "Computer Essentials: Computing Fundamentals — Silver", description: "Computing Fundamentals subsection, Silver tier.", sortOrder: 56, required: true },
  { category: "computer-essentials", label: "Computer Essentials: Computing Fundamentals — Bronze", description: "Computing Fundamentals subsection, Bronze tier.", sortOrder: 57, required: true },
  { category: "computer-essentials", label: "Computer Essentials: Key Applications — Platinum", description: "Key Applications subsection, Platinum tier.", sortOrder: 58, required: true },
  { category: "computer-essentials", label: "Computer Essentials: Key Applications — Gold", description: "Key Applications subsection, Gold tier.", sortOrder: 59, required: true },
  { category: "computer-essentials", label: "Computer Essentials: Key Applications — Silver", description: "Key Applications subsection, Silver tier.", sortOrder: 60, required: true },
  { category: "computer-essentials", label: "Computer Essentials: Key Applications — Bronze", description: "Key Applications subsection, Bronze tier.", sortOrder: 61, required: true },
  { category: "computer-essentials", label: "Computer Essentials: Living Online — Platinum", description: "Living Online subsection, Platinum tier.", sortOrder: 62, required: true },
  { category: "computer-essentials", label: "Computer Essentials: Living Online — Gold", description: "Living Online subsection, Gold tier.", sortOrder: 63, required: true },
  { category: "computer-essentials", label: "Computer Essentials: Living Online — Silver", description: "Living Online subsection, Silver tier.", sortOrder: 64, required: true },
  { category: "computer-essentials", label: "Computer Essentials: Living Online — Bronze", description: "Living Online subsection, Bronze tier.", sortOrder: 65, required: true },

  // =========================================================================
  // IC3 Digital Literacy — GS5 + GS6
  // =========================================================================
  { category: "ic3", label: "IC3 GS5 — Computing Fundamentals", description: "IC3 GS5 Credential, Computing Fundamentals exam.", sortOrder: 70, required: true },
  { category: "ic3", label: "IC3 GS5 — Key Applications", description: "IC3 GS5 Credential, Key Applications exam.", sortOrder: 71, required: true },
  { category: "ic3", label: "IC3 GS5 — Living Online", description: "IC3 GS5 Credential, Living Online exam.", sortOrder: 72, required: true },
  { category: "ic3", label: "IC3 GS5 Certified", description: "IC3 GS5 — Full certification (all 3 exams passed).", sortOrder: 73, required: true },
  { category: "ic3", label: "IC3 GS6 — Level 1 Exam", description: "IC3 GS6 Credential, Level 1 exam.", sortOrder: 75, required: true },
  { category: "ic3", label: "IC3 GS6 — Level 2 Exam", description: "IC3 GS6 Credential, Level 2 exam.", sortOrder: 76, required: true },
  { category: "ic3", label: "IC3 GS6 — Level 3 Exam", description: "IC3 GS6 Credential, Level 3 exam.", sortOrder: 77, required: true },
  { category: "ic3", label: "IC3 GS6 Certified", description: "IC3 GS6 — Full certification (all 3 exams passed).", sortOrder: 78, required: true },

  // =========================================================================
  // Microsoft Office Specialist — 2016
  // =========================================================================
  { category: "mos-2016", label: "MOS 2016 Specialist — Word", description: "Microsoft Office Specialist 2016 — Word.", sortOrder: 80, required: true },
  { category: "mos-2016", label: "MOS 2016 Specialist — Excel", description: "Microsoft Office Specialist 2016 — Excel.", sortOrder: 81, required: true },
  { category: "mos-2016", label: "MOS 2016 Specialist — PowerPoint", description: "Microsoft Office Specialist 2016 — PowerPoint.", sortOrder: 82, required: true },
  { category: "mos-2016", label: "MOS 2016 Specialist — Outlook", description: "Microsoft Office Specialist 2016 — Outlook.", sortOrder: 83, required: true },
  { category: "mos-2016", label: "MOS 2016 Specialist — Access", description: "Microsoft Office Specialist 2016 — Access.", sortOrder: 84, required: true },
  { category: "mos-2016", label: "MOS 2016 Expert — Word", description: "Microsoft Office Expert 2016 — Word.", sortOrder: 85, required: true },
  { category: "mos-2016", label: "MOS 2016 Expert — Excel", description: "Microsoft Office Expert 2016 — Excel.", sortOrder: 86, required: true },
  { category: "mos-2016", label: "MOS 2016 Master", description: "Microsoft Office 2016 Master certification.", sortOrder: 87, required: true },

  // =========================================================================
  // Microsoft Office Specialist — 2019
  // =========================================================================
  { category: "mos-2019", label: "MOS 2019 Associate — Word", description: "Microsoft Office Associate 2019 — Word.", sortOrder: 90, required: true },
  { category: "mos-2019", label: "MOS 2019 Associate — Excel", description: "Microsoft Office Associate 2019 — Excel.", sortOrder: 91, required: true },
  { category: "mos-2019", label: "MOS 2019 Associate — PowerPoint", description: "Microsoft Office Associate 2019 — PowerPoint.", sortOrder: 92, required: true },
  { category: "mos-2019", label: "MOS 2019 Associate — Outlook", description: "Microsoft Office Associate 2019 — Outlook.", sortOrder: 93, required: true },
  { category: "mos-2019", label: "MOS 2019 Specialist Associate (Earned Certificate)", description: "MOS 2019 Specialist — Associate-tier earned certificate.", sortOrder: 94, required: true },
  { category: "mos-2019", label: "MOS 2019 Expert — Access", description: "Microsoft Office Expert 2019 — Access.", sortOrder: 95, required: true },
  { category: "mos-2019", label: "MOS 2019 Expert — Word", description: "Microsoft Office Expert 2019 — Word.", sortOrder: 96, required: true },
  { category: "mos-2019", label: "MOS 2019 Expert — Excel", description: "Microsoft Office Expert 2019 — Excel.", sortOrder: 97, required: true },
  { category: "mos-2019", label: "MOS 2019 Specialist Expert (Earned Certificate)", description: "MOS 2019 Specialist — Expert-tier earned certificate.", sortOrder: 98, required: true },

  // =========================================================================
  // Microsoft Office 365
  // =========================================================================
  { category: "office-365", label: "Office 365 Associate — Word", description: "Microsoft Office 365 Associate — Word.", sortOrder: 100, required: true },
  { category: "office-365", label: "Office 365 Associate — Excel", description: "Microsoft Office 365 Associate — Excel.", sortOrder: 101, required: true },
  { category: "office-365", label: "Office 365 Associate — PowerPoint", description: "Microsoft Office 365 Associate — PowerPoint.", sortOrder: 102, required: true },
  { category: "office-365", label: "Office 365 Specialist Associate (Earned Certificate)", description: "Office 365 Specialist — Associate-tier earned certificate.", sortOrder: 103, required: true },
  { category: "office-365", label: "Office 365 Expert — Access", description: "Microsoft Office 365 Expert — Access.", sortOrder: 104, required: true },
  { category: "office-365", label: "Office 365 Expert — Word", description: "Microsoft Office 365 Expert — Word.", sortOrder: 105, required: true },
  { category: "office-365", label: "Office 365 Expert — Excel", description: "Microsoft Office 365 Expert — Excel.", sortOrder: 106, required: true },
  { category: "office-365", label: "Office 365 Specialist Expert (Earned Certificate)", description: "Office 365 Specialist — Expert-tier earned certificate.", sortOrder: 107, required: true },

  // =========================================================================
  // Intuit
  // =========================================================================
  { category: "intuit", label: "Intuit QuickBooks Online", description: "Intuit Certification — QuickBooks Online.", sortOrder: 120, required: true },
  { category: "intuit", label: "Intuit QuickBooks Desktop", description: "Intuit Certification — QuickBooks Desktop.", sortOrder: 121, required: true },
  { category: "intuit", label: "Intuit Bookkeeping", description: "Intuit Certification — Professional Bookkeeping.", sortOrder: 122, required: true },
  { category: "intuit", label: "Intuit Design for Delight", description: "Intuit Certification — Design for Delight Innovator.", sortOrder: 123, required: true },
  { category: "intuit", label: "Intuit Personal Finance", description: "Intuit Certification — Personal Finance.", sortOrder: 124, required: true },

  // =========================================================================
  // Adobe Certified Professional
  // =========================================================================
  { category: "adobe", label: "Adobe Certified Professional — Photoshop", description: "Adobe Creative Cloud — Photoshop.", sortOrder: 140, required: true },
  { category: "adobe", label: "Adobe Certified Professional — Animate", description: "Adobe Creative Cloud — Animate.", sortOrder: 141, required: true },
  { category: "adobe", label: "Adobe Certified Professional — Dreamweaver", description: "Adobe Creative Cloud — Dreamweaver.", sortOrder: 142, required: true },
  { category: "adobe", label: "Adobe Certified Professional — After Effects", description: "Adobe Creative Cloud — After Effects.", sortOrder: 143, required: true },
  { category: "adobe", label: "Adobe Certified Professional — Premiere Pro", description: "Adobe Creative Cloud — Premiere Pro.", sortOrder: 144, required: true },
  { category: "adobe", label: "Adobe Certified Professional — Illustrator", description: "Adobe Creative Cloud — Illustrator.", sortOrder: 145, required: true },
  { category: "adobe", label: "Adobe Certified Professional — InDesign", description: "Adobe Creative Cloud — InDesign.", sortOrder: 146, required: true },
  { category: "adobe", label: "Adobe Certified Professional — Acrobat Pro", description: "Adobe Creative Cloud — Acrobat Pro.", sortOrder: 147, required: true },
  { category: "adobe", label: "Adobe Certified Professional — Express", description: "Adobe Creative Cloud — Express.", sortOrder: 148, required: true },
  { category: "adobe", label: "Adobe Specialty — Professional Visual Design", description: "Adobe Specialty Credential — Professional Visual Design.", sortOrder: 149, required: true },
  { category: "adobe", label: "Adobe Specialty — Professional Video Design", description: "Adobe Specialty Credential — Professional Video Design.", sortOrder: 150, required: true },
  { category: "adobe", label: "Adobe Specialty — Professional Web Design", description: "Adobe Specialty Credential — Professional Web Design.", sortOrder: 151, required: true },

  // =========================================================================
  // Information Technology / Cybersecurity / Networking
  // =========================================================================
  { category: "it-cybersecurity", label: "IT Specialist — Cybersecurity", description: "Certiport IT Specialist — Cybersecurity.", sortOrder: 170, required: true },
  { category: "it-cybersecurity", label: "CISCO Support Tech", description: "Cisco Networking Academy — Support Technician.", sortOrder: 171, required: true },

  // =========================================================================
  // Critical Career Skills
  // =========================================================================
  { category: "critical-career-skills", label: "Generative AI Foundations", description: "Critical Career Skills — Generative AI Foundations.", sortOrder: 190, required: true },
  { category: "critical-career-skills", label: "Professional Communication", description: "Critical Career Skills — Professional Communication.", sortOrder: 191, required: true },

  // =========================================================================
  // Work / Money Essentials
  // =========================================================================
  { category: "work-essentials", label: "Work Essentials — Job Seeking", description: "Work Essentials — Job Seeking module.", sortOrder: 200, required: true },
  { category: "work-essentials", label: "Work Essentials — Job Ready", description: "Work Essentials — Job Ready module.", sortOrder: 201, required: true },
  { category: "work-essentials", label: "Work Essentials — Job Keeping", description: "Work Essentials — Job Keeping module.", sortOrder: 202, required: true },
  { category: "work-essentials", label: "Work Essentials — All 3 Complete", description: "Work Essentials — All three modules completed.", sortOrder: 203, required: true },
  { category: "work-essentials", label: "Money Essentials", description: "Money Essentials Certificate.", sortOrder: 204, required: true },

  // =========================================================================
  // Health & Safety
  // =========================================================================
  { category: "health-safety", label: "Non-Medical CPR", description: "CPR / 1st Aid — Non-Medical CPR.", sortOrder: 210, required: true },
  { category: "health-safety", label: "Healthcare CPR", description: "CPR / 1st Aid — Healthcare provider CPR.", sortOrder: 211, required: true },
  { category: "health-safety", label: "Bloodborne Pathogens Certification", description: "Workplace Health & Safety — Bloodborne Pathogens.", sortOrder: 212, required: true },
  { category: "health-safety", label: "Food Handler Card", description: "Health & Safety — Food Handler card.", sortOrder: 213, required: true },

  // =========================================================================
  // WV-Specific
  // =========================================================================
  { category: "wv-specific", label: "WV Tourism Works Certificate", description: "WV-specific — Tourism Works program certificate.", sortOrder: 230, required: true },
  { category: "wv-specific", label: "WV Welcome Certificate", description: "WV-specific — WV Welcome certificate.", sortOrder: 231, required: true },

  // =========================================================================
  // Life & Employability Skills (curriculum)
  // =========================================================================
  { category: "life-employability", label: "Life & Employability Skills", description: "SPOKES life and employability skills curriculum.", sortOrder: 250, required: true },
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
      update: {
        label: mod.label,
        description: mod.description,
        category: mod.category,
        sortOrder: mod.sortOrder,
        required: mod.required,
      },
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
