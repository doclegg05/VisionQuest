import { NextResponse } from "next/server";

import { withErrorHandler } from "@/lib/api-error";
import { EMPLOYER_LINK_INACTIVE_MESSAGE, resolveEmployerLink } from "@/lib/connect/employer-link";
import { CONNECT_CONFIG_KEY } from "@/lib/connect/flags-shared";
import { prismaAdmin } from "@/lib/db";
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
 * Prefers a short-TTL presigned URL when object storage is configured (the
 * file then never passes through the app); falls back to streaming the bytes,
 * which is what local-disk development does.
 */
const PRESIGN_TTL_SECONDS = 300;

export const GET = withErrorHandler(
  async (_req: Request, context: { params: Promise<{ token: string }> }) => {
    const { token } = await context.params;

    const view = await resolveEmployerLink(
      token,
      await getPlainConfigValue(CONNECT_CONFIG_KEY),
    );
    if (!view || !view.packet.resumeFileUploadId) {
      return NextResponse.json({ error: EMPLOYER_LINK_INACTIVE_MESSAGE }, { status: 404 });
    }

    const upload = await prismaAdmin.fileUpload.findUnique({
      where: { id: view.packet.resumeFileUploadId },
      select: { storageKey: true, mimeType: true },
    });
    if (!upload) {
      return NextResponse.json({ error: EMPLOYER_LINK_INACTIVE_MESSAGE }, { status: 404 });
    }

    const presigned = await getPresignedDownloadUrl(upload.storageKey, {
      expiresIn: PRESIGN_TTL_SECONDS,
      contentType: upload.mimeType,
      // The filename an employer sees carries the candidate's display name
      // (first name + last initial), never their id or full surname.
      contentDisposition: `inline; filename="${view.packet.candidateName.replace(/[^\w. -]/g, "")} resume.pdf"`,
    });
    if (presigned) return NextResponse.redirect(presigned);

    const file = await downloadFile(upload.storageKey);
    if (!file) {
      return NextResponse.json({ error: EMPLOYER_LINK_INACTIVE_MESSAGE }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": "inline",
        // Never cached by a proxy: this is one candidate's résumé behind a
        // capability URL, not a public asset.
        "Cache-Control": "private, no-store",
      },
    });
  },
);
