import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withErrorHandler } from "@/lib/api-error";

/**
 * CSP violation reporting endpoint.
 * Browsers POST violation reports here when Content-Security-Policy is violated.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  try {
    const body = await req.json();

    // Standard CSP report format wraps in "csp-report", Reporting API v2 doesn't
    const report = body["csp-report"] || body;

    logger.warn("CSP violation", {
      blockedUri: report["blocked-uri"] || report.blockedURL,
      violatedDirective: report["violated-directive"] || report.effectiveDirective,
      documentUri: report["document-uri"] || report.documentURL,
      sourceFile: report["source-file"] || report.sourceFile,
      lineNumber: report["line-number"] || report.lineNumber,
    });
  } catch {
    // Malformed report — ignore silently
  }

  return new NextResponse(null, { status: 204 });
});
