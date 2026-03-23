import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { cached } from "@/lib/cache";

/**
 * GET /api/credly/badges
 *
 * Fetches the authenticated student's Credly badges from the public profile.
 * No API key needed — uses Credly's public badge page endpoint.
 * Cached for 10 minutes per student.
 */
export const GET = withAuth(async (session) => {
  const student = await prisma.student.findUnique({
    where: { id: session.id },
    select: { credlyUsername: true },
  });

  if (!student?.credlyUsername) {
    return NextResponse.json({ badges: [], username: null });
  }

  const username = student.credlyUsername.trim();

  const badges = await cached(`credly:${username}`, 600, async () => {
    try {
      const res = await fetch(
        `https://www.credly.com/users/${encodeURIComponent(username)}/badges.json`,
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        },
      );

      if (!res.ok) return [];

      const data = await res.json();

      if (!data?.data || !Array.isArray(data.data)) return [];

      return data.data.map((badge: Record<string, unknown>) => ({
        id: badge.id,
        name: (badge as { badge_template?: { name?: string } }).badge_template?.name || "Unknown Badge",
        description: (badge as { badge_template?: { description?: string } }).badge_template?.description || "",
        imageUrl: (badge as { badge_template?: { image_url?: string } }).badge_template?.image_url || "",
        issuedAt: badge.issued_at || badge.created_at,
        issuerName: (badge as { issuer?: { name?: string } }).issuer?.name || "",
        badgeUrl: badge.badge_url || `https://www.credly.com/badges/${badge.id}`,
      }));
    } catch {
      return [];
    }
  });

  return NextResponse.json({ badges, username });
});
