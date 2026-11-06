/**
 * Pure helpers for the applicants-waiting list. No server imports, so the
 * client component and its test can both load this file.
 */

/** Only admins place applicants. Program coordinators read the list. */
export function canPlaceApplicants(role: string): boolean {
  return role === "admin";
}

export interface PlaceApplicantRequest {
  url: string;
  body: { newClassId: string };
}

/** The request that moves a waiting applicant into a class. */
export function placeApplicantRequest(applicantId: string, classId: string): PlaceApplicantRequest {
  return {
    url: `/api/teacher/students/${encodeURIComponent(applicantId)}/reassign-class`,
    body: { newClassId: classId },
  };
}
