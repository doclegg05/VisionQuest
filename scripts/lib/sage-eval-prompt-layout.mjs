/** Apply the production Mac prompt layout to sequential synthetic harness cases. */
export function withMacEvalPromptLayout(provider, buildCacheableSystemPrompt) {
  let current;
  const optionsFor = (text, options) => {
    if (!current || !text.startsWith(current.text)) {
      throw new Error("Mac cache eval prompt was not built by the configured builder");
    }
    return { ...options, systemPrefixLength: current.systemPrefixLength };
  };
  const wrapped = Object.create(provider);
  for (const method of ["generateResponse", "streamResponse", "generateStructuredResponse"]) {
    wrapped[method] = (text, messages, usage, options) =>
      provider[method](text, messages, usage, optionsFor(text, options));
  }
  if (provider.streamWithTools) {
    wrapped.streamWithTools = (text, messages, tools, handler, options) =>
      provider.streamWithTools(text, messages, tools, handler, optionsFor(text, options));
  }
  return {
    provider: wrapped,
    buildSystemPrompt: (stage, context) => {
      current = buildCacheableSystemPrompt(stage, context, "compact");
      return current.text;
    },
  };
}
