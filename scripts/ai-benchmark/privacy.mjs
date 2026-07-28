const REQUIRED_CLASSIFICATION = "public_synthetic";
const REQUIRED_CONTEXT_MARKER = "[PUBLIC SYNTHETIC FIXTURE]";

const FORBIDDEN_KEY_NAMES = new Set([
  "address",
  "benefitsid",
  "casenumber",
  "dateofbirth",
  "dob",
  "email",
  "firstname",
  "fullname",
  "lastname",
  "phonenumber",
  "ssn",
  "studentid",
]);

const FORBIDDEN_VALUE_PATTERNS = [
  { label: "email address", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { label: "US phone number", pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/ },
  { label: "US Social Security number", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  { label: "VisionQuest production URL", pattern: /https?:\/\/visionquest\.onrender\.com\b/i },
];

function inspectValue(value, path, errors) {
  if (typeof value === "string") {
    for (const { label, pattern } of FORBIDDEN_VALUE_PATTERNS) {
      if (pattern.test(value)) errors.push(`${path} contains a ${label}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectValue(item, `${path}[${index}]`, errors));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
    if (FORBIDDEN_KEY_NAMES.has(normalizedKey)) {
      errors.push(`${path}.${key} uses a protected-data field name`);
    }
    inspectValue(child, `${path}.${key}`, errors);
  }
}

export function validateFixturePrivacy(config) {
  const errors = [];
  if (config?.dataClassification !== REQUIRED_CLASSIFICATION) {
    errors.push(`dataClassification must be "${REQUIRED_CLASSIFICATION}"`);
  }
  if (!Array.isArray(config?.cases) || config.cases.length === 0) {
    errors.push("cases must be a non-empty array");
  } else {
    const caseIds = new Set();
    for (const [index, testCase] of config.cases.entries()) {
      const path = `cases[${index}]`;
      if (!testCase?.id || typeof testCase.id !== "string") {
        errors.push(`${path}.id must be a non-empty string`);
      } else if (caseIds.has(testCase.id)) {
        errors.push(`${path}.id duplicates "${testCase.id}"`);
      } else {
        caseIds.add(testCase.id);
      }
      if (typeof testCase?.context !== "string" || !testCase.context.startsWith(REQUIRED_CONTEXT_MARKER)) {
        errors.push(`${path}.context must start with ${REQUIRED_CONTEXT_MARKER}`);
      }
    }
  }

  inspectValue(config, "fixture", errors);
  return { valid: errors.length === 0, errors };
}

export function assertFixturePrivacy(config) {
  const result = validateFixturePrivacy(config);
  if (!result.valid) {
    throw new Error(`Benchmark fixture privacy validation failed:\n- ${result.errors.join("\n- ")}`);
  }
  return result;
}

export const PRIVACY_POLICY = Object.freeze({
  classification: REQUIRED_CLASSIFICATION,
  contextMarker: REQUIRED_CONTEXT_MARKER,
  forbiddenKeyNames: [...FORBIDDEN_KEY_NAMES],
  forbiddenValuePatternLabels: FORBIDDEN_VALUE_PATTERNS.map(({ label }) => label),
});
