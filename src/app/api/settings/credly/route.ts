import { NextResponse } from "next/server";
import { withAuth, badRequest } from "@/lib/api-error";
import { prisma } from "@/lib/db";

/**
 * GET /api/settings/credly — get current Credly username
 */
export const GET = withAuth(async (session) => {
  const student = await prisma.student.findUnique({
    where: { id: session.id },
    select: { credlyUsername: true },
  });
  return NextResponse.json({ credlyUsername: student?.credlyUsername || null });
});

/**
 * POST /api/settings/credly — save Credly username
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await req.json();
  let username = (typeof body.credlyUsername === "string" ? body.credlyUsername : "").trim();

  // Extract username from full URL if pasted
  const usersMatch = username.match(/credly\.com\/users\/([^/\s?#]+)/);
  if (usersMatch) {
    username = usersMatch[1];
  } else if (username.includes("credly.com/")) {
    // Reject non-profile Credly URLs (e.g., /earner/dashboard)
    throw badRequest(
      "That looks like a Credly link but not a profile URL. Go to your Credly profile page — the URL should look like credly.com/users/your-name.",
    );
  }

  // Strip any remaining URL parts — username should be alphanumeric + hyphens
  username = username.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9._-]/g, "");

  if (!username) throw badRequest("Credly username is required.");
  if (username.length > 100) throw badRequest("Username is too long.");

  await prisma.student.update({
    where: { id: session.id },
    data: { credlyUsername: username },
  });

  return NextResponse.json({ credlyUsername: username });
});

/**
 * DELETE /api/settings/credly — remove Credly username
 */
export const DELETE = withAuth(async (session) => {
  await prisma.student.update({
    where: { id: session.id },
    data: { credlyUsername: null },
  });
  return NextResponse.json({ credlyUsername: null });
});
