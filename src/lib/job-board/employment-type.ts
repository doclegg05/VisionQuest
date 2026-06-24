export type EmploymentType = "full_time" | "part_time";

const PART_TIME_PATTERN = /\b(part[\s-]?time|prn|per[\s-]?diem)\b/i;
const FULL_TIME_PATTERN = /\b(full[\s-]?time)\b/i;

export function inferEmploymentType(input: {
  title?: string | null;
  description?: string | null;
}): EmploymentType | null {
  const text = [input.title, input.description].filter(Boolean).join(" ");
  if (PART_TIME_PATTERN.test(text)) return "part_time";
  if (FULL_TIME_PATTERN.test(text)) return "full_time";
  return null;
}
