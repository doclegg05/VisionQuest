// =============================================================================
// The email an employer contact receives — pure, so its contents are testable
// without a mailer.
//
// The guardrail from the design spec §10 is exact: "the employer email
// contains no PII beyond the packet the student approved". This builder is
// therefore given the FROZEN packet and nothing else about the student — it
// has no access to a Student row, so it cannot leak a field by reaching for
// one. The body carries the candidate's display name (first name + last
// initial), the job, the link, and the instructor as sender of record.
//
// No student id appears anywhere, including the URL: the link carries an
// opaque token. `buildEmployerEmail`'s test asserts that property directly.
// =============================================================================

import { SUBSIDY_FALLBACK_LINE, packetFieldList, type Packet } from "./packet-shared";

export interface EmployerEmailInput {
  packet: Packet;
  contactName: string;
  /** The lead's title, already sanitized by the caller. */
  jobTitle: string;
  employerName: string;
  /** Sender of record: the instructor's name and the program's email. */
  instructorName: string;
  programEmail: string;
  programName: string;
  /** Absolute URL of /connect/<token>. */
  responseUrl: string;
}

export interface EmployerEmail {
  subject: string;
  text: string;
}

/**
 * Plain text only. An employer reads this on a phone, often through a filter
 * that strips HTML, and there is nothing here that needs formatting — the
 * detail lives behind the link, where a view can be recorded and a response
 * taken.
 */
export function buildEmployerEmail(input: EmployerEmailInput): EmployerEmail {
  const fields = packetFieldList(input.packet);
  const subsidy = input.packet.subsidyLine ?? SUBSIDY_FALLBACK_LINE;

  const lines = [
    `Hello ${input.contactName},`,
    "",
    `I work with ${input.programName}. I have a candidate for your ${input.jobTitle} opening at ${input.employerName}.`,
    "",
    `The candidate is ${input.packet.candidateName}. They agreed to share:`,
    ...fields.map((field) => `- ${field}`),
    "",
    subsidy,
    "",
    "Open this link to see their information and reply:",
    input.responseUrl,
    "",
    "You can say you are interested and pick a time to meet, say not right now, or tell us if you hire them. The link works for 14 days.",
    "",
    `${input.instructorName}`,
    `${input.programName}`,
    input.programEmail,
  ];

  return {
    subject: `${input.programName} candidate for your ${input.jobTitle} opening`,
    text: lines.join("\n"),
  };
}
