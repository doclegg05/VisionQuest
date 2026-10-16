// Shared by the Sage agent eval and red-team eval: the text a scenario adds to
// the system prompt. Kept in one place so both evals show a model the same
// attachment block, and the same one /api/chat/send builds.

/**
 * The text appended to SYSTEM for one scenario: its context, then its
 * attachment block. The caller passes the formatter /api/chat/send uses
 * (src/lib/chat/attachment-context.ts), so an attachment case is graded on the
 * prompt production sends, including the open orientation items
 * (`openOrientationItems` on the scenario) that submit_form needs an id from.
 * It is a parameter, not an import: a static .ts import fails CJS named-export
 * detection under tsx, and a top-level await would stop the contract tests
 * from loading the eval scripts.
 */
export function buildScenarioContext(scenario, formatAttachmentContext) {
  const context = scenario.context ? `\n\n${scenario.context}` : "";
  if (!scenario.attachment) return context;
  const { fileUploadId, filename, gist } = scenario.attachment;
  return (
    context +
    formatAttachmentContext({
      files: [{ id: fileUploadId, filename, gist }],
      openOrientationItems: scenario.openOrientationItems ?? [],
    })
  );
}
