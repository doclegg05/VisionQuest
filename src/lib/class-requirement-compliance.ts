import { prisma } from "./db";

export interface RequirementComplianceItem {
  requirementId: string;
  itemType: string;
  itemId: string;
  title: string;
  requiredStatus: string; // "required" | "optional" | "not_applicable"
  met: boolean;
}

export interface StudentRequirementCompliance {
  studentId: string;
  classId: string;
  items: RequirementComplianceItem[];
  requiredCount: number;
  requiredMet: number;
  optionalCount: number;
  optionalMet: number;
  compliant: boolean;
}

/**
 * Check a single student's compliance with their class requirements.
 *
 * Looks up the student's enrolled class, its ClassRequirement records,
 * and checks each one against the student's actual progress in
 * certifications, orientation, and forms.
 */
export async function checkStudentCompliance(
  studentId: string,
): Promise<StudentRequirementCompliance | null> {
  // Find student's active enrollment
  const enrollment = await prisma.studentClassEnrollment.findFirst({
    where: { studentId, status: "active" },
    select: { classId: true },
  });
  if (!enrollment) return null;

  return checkStudentComplianceForClass(studentId, enrollment.classId);
}

/**
 * Check a student's compliance against a specific class's requirements.
 */
export async function checkStudentComplianceForClass(
  studentId: string,
  classId: string,
): Promise<StudentRequirementCompliance> {
  const [requirements, certifications, orientationProgress, formSubmissions] =
    await Promise.all([
      prisma.classRequirement.findMany({
        where: { classId },
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      }),
      prisma.certification.findMany({
        where: { studentId },
        select: { certType: true, status: true },
      }),
      prisma.orientationProgress.findMany({
        where: { studentId, completed: true },
        select: { itemId: true },
      }),
      prisma.formSubmission.findMany({
        where: { studentId },
        select: { formId: true, status: true },
      }),
    ]);

  const completedCerts = new Set(
    certifications
      .filter((c) => c.status === "completed")
      .map((c) => c.certType),
  );
  const inProgressCerts = new Set(
    certifications
      .filter((c) => c.status !== "completed")
      .map((c) => c.certType),
  );
  const completedOrientation = new Set(
    orientationProgress.map((o) => o.itemId),
  );
  const submittedForms = new Set(
    formSubmissions
      .filter((f) => f.status === "approved" || f.status === "submitted")
      .map((f) => f.formId),
  );

  const items: RequirementComplianceItem[] = requirements.map((req) => {
    let met = false;

    switch (req.itemType) {
      case "certification":
        met = completedCerts.has(req.itemId) || inProgressCerts.has(req.itemId);
        break;
      case "orientation":
        met = completedOrientation.has(req.itemId);
        break;
      case "form":
        met = submittedForms.has(req.itemId);
        break;
      case "course":
        // Courses (platforms) are met if the student has visited the platform
        // We don't have a direct check here — treat as met for now if not required
        met = req.status === "not_applicable";
        break;
    }

    return {
      requirementId: req.id,
      itemType: req.itemType,
      itemId: req.itemId,
      title: req.title,
      requiredStatus: req.status,
      met,
    };
  });

  const required = items.filter((i) => i.requiredStatus === "required");
  const optional = items.filter((i) => i.requiredStatus === "optional");

  return {
    studentId,
    classId,
    items,
    requiredCount: required.length,
    requiredMet: required.filter((i) => i.met).length,
    optionalCount: optional.length,
    optionalMet: optional.filter((i) => i.met).length,
    compliant: required.every((i) => i.met),
  };
}

/**
 * Check compliance for all active students in a class.
 * Returns a map of studentId -> compliance data.
 */
export async function checkClassCompliance(
  classId: string,
): Promise<Map<string, StudentRequirementCompliance>> {
  const enrollments = await prisma.studentClassEnrollment.findMany({
    where: { classId, status: "active" },
    select: { studentId: true },
  });

  const results = new Map<string, StudentRequirementCompliance>();

  // Batch: fetch requirements once, then check each student
  const requirements = await prisma.classRequirement.findMany({
    where: { classId },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });

  if (requirements.length === 0) return results;

  const studentIds = enrollments.map((e) => e.studentId);

  const [allCerts, allOrientation, allForms] = await Promise.all([
    prisma.certification.findMany({
      where: { studentId: { in: studentIds } },
      select: { studentId: true, certType: true, status: true },
    }),
    prisma.orientationProgress.findMany({
      where: { studentId: { in: studentIds }, completed: true },
      select: { studentId: true, itemId: true },
    }),
    prisma.formSubmission.findMany({
      where: { studentId: { in: studentIds } },
      select: { studentId: true, formId: true, status: true },
    }),
  ]);

  // Group by student
  const certsByStudent = new Map<string, typeof allCerts>();
  for (const c of allCerts) {
    const list = certsByStudent.get(c.studentId) ?? [];
    list.push(c);
    certsByStudent.set(c.studentId, list);
  }
  const orientationByStudent = new Map<string, typeof allOrientation>();
  for (const o of allOrientation) {
    const list = orientationByStudent.get(o.studentId) ?? [];
    list.push(o);
    orientationByStudent.set(o.studentId, list);
  }
  const formsByStudent = new Map<string, typeof allForms>();
  for (const f of allForms) {
    const list = formsByStudent.get(f.studentId) ?? [];
    list.push(f);
    formsByStudent.set(f.studentId, list);
  }

  for (const sid of studentIds) {
    const certs = certsByStudent.get(sid) ?? [];
    const orientation = orientationByStudent.get(sid) ?? [];
    const forms = formsByStudent.get(sid) ?? [];

    const completedCerts = new Set(
      certs.filter((c) => c.status === "completed").map((c) => c.certType),
    );
    const inProgressCerts = new Set(
      certs.filter((c) => c.status !== "completed").map((c) => c.certType),
    );
    const completedOrientation = new Set(orientation.map((o) => o.itemId));
    const submittedForms = new Set(
      forms
        .filter((f) => f.status === "approved" || f.status === "submitted")
        .map((f) => f.formId),
    );

    const items: RequirementComplianceItem[] = requirements.map((req) => {
      let met = false;
      switch (req.itemType) {
        case "certification":
          met = completedCerts.has(req.itemId) || inProgressCerts.has(req.itemId);
          break;
        case "orientation":
          met = completedOrientation.has(req.itemId);
          break;
        case "form":
          met = submittedForms.has(req.itemId);
          break;
        case "course":
          met = req.status === "not_applicable";
          break;
      }
      return {
        requirementId: req.id,
        itemType: req.itemType,
        itemId: req.itemId,
        title: req.title,
        requiredStatus: req.status,
        met,
      };
    });

    const required = items.filter((i) => i.requiredStatus === "required");
    const optional = items.filter((i) => i.requiredStatus === "optional");

    results.set(sid, {
      studentId: sid,
      classId,
      items,
      requiredCount: required.length,
      requiredMet: required.filter((i) => i.met).length,
      optionalCount: optional.length,
      optionalMet: optional.filter((i) => i.met).length,
      compliant: required.every((i) => i.met),
    });
  }

  return results;
}
