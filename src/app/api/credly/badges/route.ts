import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { cached } from "@/lib/cache";

interface CredlyBadgeTemplate {
  name?: string;
  description?: string;
  image?: { url?: string };
  image_url?: string;
}

interface CredlyIssuerEntity {
  entity?: { name?: string };
}

interface CredlyBadge {
  id: string;
  issued_at?: string;
  issued_at_date?: string;
  created_at?: string;
  badge_template?: CredlyBadgeTemplate;
  issuer?: { entities?: CredlyIssuerEntity[] };
}

interface CredlyBadgesResponse {
  data?: CredlyBadge[];
}

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

      const data = (await res.json()) as CredlyBadgesResponse;

      if (!data?.data || !Array.isArray(data.data)) return [];

      return data.data.map((badge) => ({
        id: badge.id,
        name: badge.badge_template?.name || "Unknown Badge",
        description: badge.badge_template?.description || "",
        imageUrl: badge.badge_template?.image?.url || badge.badge_template?.image_url || "",
        issuedAt: badge.issued_at_date || badge.issued_at || badge.created_at,
        issuerName: badge.issuer?.entities?.[0]?.entity?.name || "",
        badgeUrl: `https://www.credly.com/badges/${badge.id}`,
      }));
    } catch {
      return [];
    }
  });

  return NextResponse.json({ badges, username });
});
