function wordCount(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function includesCaseInsensitive(text, term) {
  return text.toLocaleLowerCase().includes(String(term).toLocaleLowerCase());
}

function validateJson(text, specification, errors) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    errors.push("output is not valid JSON");
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    errors.push("JSON output must be an object");
    return;
  }

  const requiredKeys = specification.requiredKeys ?? [];
  for (const key of requiredKeys) {
    if (!(key in parsed)) errors.push(`JSON is missing required key "${key}"`);
  }
  if (specification.exactKeys) {
    const expected = new Set(requiredKeys);
    for (const key of Object.keys(parsed)) {
      if (!expected.has(key)) errors.push(`JSON contains unexpected key "${key}"`);
    }
  }
  for (const [key, expectedType] of Object.entries(specification.types ?? {})) {
    if (key in parsed && typeof parsed[key] !== expectedType) {
      errors.push(`JSON key "${key}" must be ${expectedType}`);
    }
  }
  for (const [key, [minimum, maximum]] of Object.entries(specification.numberRanges ?? {})) {
    if (typeof parsed[key] === "number" && (parsed[key] < minimum || parsed[key] > maximum)) {
      errors.push(`JSON key "${key}" must be between ${minimum} and ${maximum}`);
    }
  }
}

export function validateOutput(text, specification = {}) {
  const output = typeof text === "string" ? text.trim() : "";
  const errors = [];
  if (!output) errors.push("output is empty");

  if (Number.isFinite(specification.maxWords) && wordCount(output) > specification.maxWords) {
    errors.push(`output exceeds ${specification.maxWords} words`);
  }
  for (const term of specification.mustContain ?? []) {
    if (!includesCaseInsensitive(output, term)) errors.push(`output must contain "${term}"`);
  }
  const anyTerms = specification.mustContainAny ?? [];
  if (anyTerms.length > 0 && !anyTerms.some((term) => includesCaseInsensitive(output, term))) {
    errors.push(`output must contain at least one of: ${anyTerms.join(", ")}`);
  }
  for (const term of specification.mustNotContain ?? []) {
    if (includesCaseInsensitive(output, term)) errors.push(`output must not contain "${term}"`);
  }
  if (specification.json) validateJson(output, specification.json, errors);

  return {
    valid: errors.length === 0,
    errors,
    wordCount: wordCount(output),
  };
}
