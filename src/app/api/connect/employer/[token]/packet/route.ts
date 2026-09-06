import { NextResponse } from "next/server";

import { withErrorHandler } from "@/lib/api-error";
import {
  EMPLOYER_LINK_INACTIVE_MESSAGE,
  resolvePacketFile,
} from "@/lib/connect/employer-link";
import { CONNECT_CONFIG_KEY } from "@/lib/connect/flags-shared";
import { downloadFile, getPresignedDownloadUrl } from "@/lib/storage";
import { getPlainConfigValue } from "@/lib/system-config";

/**
 * GET /api/connect/employer/[token]/packet — the résumé PDF.
 *
 * A GET, so no body token: the URL is the capability, exactly as it is for the
 * page itself, and this route resolves it through the same bounded helper. It
 * returns 404 for anything the page would render neutrally, so a dead link
 * cannot be probed for whether a document exists behind it.
 *
 * The lookup is scoped to the connection's OWN student inside
 * `resolvePacketFile` — the route never sees a student id, and cannot serve a
 * file belonging to anyone else even if `resumeFileUploadId` were wrong.
 *
 * Prefers a short-TTL presigned URL when object storage is configured (the
 * file then never passes through the app); falls back to streaming the bytes,
 * which is what local-disk development does.
 */
const PRESIGN_TTL_SECONDS = 300;

export const GET = withErrorHandler(
  async (_req: Request, context: { params: Promise<{ token: string }> }) => {
    const { token } = await context.params;

    const file = await resolvePacketFile(
      token,
      await getPlainConfigValue(CONNECT_CONFIG_KEY),
    );
    if (!file) {
      return NextResponse.json({ error: EMPLOYER_LINK_INACTIVE_MESSAGE }, { status: 404 });
    }

    // The filename an employer sees carries the candidate's display name
    // (first name + last initial), never their id or full surname. Built once
    // so the presigned redirect and the streamed fallback cannot drift into
    // showing two different names for the same document.
    const disposition = `inline; filename="${file.candidateName.replace(/[^\w. -]/g, "")} resume.pdf"`;

    const presigned = await getPresignedDownloadUrl(file.storageKey, {
      expiresIn: PRESIGN_TTL_SECONDS,
      contentType: file.mimeType,
      contentDisposition: disposition,
    });
    if (presigned) return NextResponse.redirect(presigned);

    const bytes = await downloadFile(file.storageKey);
    if (!bytes) {
      return NextResponse.json({ error: EMPLOYER_LINK_INACTIVE_MESSAGE }, { status: 404 });
    }

    const body = new Uint8Array(bytes.buffer);
    return new NextResponse(body, {
      headers: {
        "Content-Type": bytes.mimeType,
        // Same name as the presigned path. Without it the fallback saved as
        // "packet" or "route", which is not obviously a résumé to somebody
        // deciding whether to open an attachment from a link.
        "Content-Disposition": disposition,
        // Declared so the browser can show progress and detect a truncated
        // transfer, rather than treating a cut connection as a short PDF.
        "Content-Length": String(body.byteLength),
        // Never cached by a proxy: this is one candidate's résumé behind a
        // capability URL, not a public asset.
        "Cache-Control": "private, no-store",
      },
    });
  },
);
