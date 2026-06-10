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
const DB_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const GET = withAuth(async (session) => {
  const student = await prisma.student.findUnique({
    where: { id: session.id },
    select: { credlyUsername: true, credlyBadgesCache: true, credlyBadgesCachedAt: true },
  });

  if (!student?.credlyUsername) {
    return NextResponse.json({ badges: [], username: null });
  }

  const username = student.credlyUsername.trim();

  // Last-good badges (Phase 5): persisted in DB so they survive server
  // restarts and Credly outages. Fresh within 24h -> serve directly.
  const staleBadges: unknown[] = (() => {
    try {
      return student.credlyBadgesCache ? JSON.parse(student.credlyBadgesCache) : [];
    } catch {
      return [];
    }
  })();
  const dbCacheFresh =
    student.credlyBadgesCachedAt !== null &&
    Date.now() - student.credlyBadgesCachedAt.getTime() < DB_CACHE_TTL_MS;
  if (dbCacheFresh && staleBadges.length > 0) {
    return NextResponse.json({ badges: staleBadges, username, cached: true });
  }

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

  if (badges.length > 0) {
    // Persist last-good for outage resilience; never blocks the response.
    void prisma.student
      .update({
        where: { id: session.id },
        data: { credlyBadgesCache: JSON.stringify(badges), credlyBadgesCachedAt: new Date() },
      })
      .catch(() => undefined);
    return NextResponse.json({ badges, username });
  }

  // Fetch failed or returned nothing — serve stale last-good if we have it.
  if (staleBadges.length > 0) {
    return NextResponse.json({ badges: staleBadges, username, cached: true, stale: true });
  }
  return NextResponse.json({ badges, username });
});
