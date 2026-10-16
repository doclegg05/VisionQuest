import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getEnabledTools, toolsForTurn } from "./tools";
import type { AgentTool } from "./types";

/**
 * A file's fileUploadId reaches the model only on the turn that carries the
 * file: chat saves message text, and tool calls are not replayed into later
 * turns. On any other turn a tool that needs a fileUploadId can only be called
 * with an invented one. Offering those tools anyway drew "put my food handler
 * card in my portfolio" to file_document and classify_attachment in about one
 * sample in five (2026-10-14 probes), so a turn without an attachment does not
 * offer them at all.
 */

const ROLES = ["student", "teacher", "admin", "coordinator"] as const;

function everyTool(): AgentTool[] {
  const byName = new Map<string, AgentTool>();
  for (const role of ROLES) {
    for (const tool of getEnabledTools(role, "full")) byName.set(tool.name, tool);
  }
  return [...byName.values()];
}

const names = (tools: AgentTool[]) => tools.map((tool) => tool.name).sort();

describe("attachment-only tools", () => {
  it("a tool is attachment-only exactly when it requires a fileUploadId", () => {
    for (const tool of everyTool()) {
      const needsFile = (tool.parameters.required ?? []).includes("fileUploadId");
      assert.equal(
        tool.requiresAttachment === true,
        needsFile,
        needsFile
          ? `${tool.name} requires a fileUploadId but is not marked requiresAttachment, so turns with no file would still offer it`
          : `${tool.name} is marked requiresAttachment but does not require a fileUploadId`,
      );
    }
  });

  it("covers the three file tools today", () => {
    assert.deepEqual(names(everyTool().filter((tool) => tool.requiresAttachment)), [
      "classify_attachment",
      "file_document",
      "submit_form",
    ]);
  });

  it("toolsForTurn drops them on a turn with no attachment and keeps everything else", () => {
    const tools = getEnabledTools("student", "full");
    const offered = toolsForTurn(tools, { hasAttachment: false });
    assert.deepEqual(
      names(offered),
      names(tools.filter((tool) => !tool.requiresAttachment)),
    );
    assert.ok(!names(offered).includes("file_document"));
    assert.ok(names(offered).includes("add_portfolio_item"));
  });

  it("toolsForTurn offers every tool on a turn with an attachment", () => {
    const tools = getEnabledTools("student", "full");
    assert.deepEqual(names(toolsForTurn(tools, { hasAttachment: true })), names(tools));
  });
});
