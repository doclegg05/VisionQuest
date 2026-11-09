import { NextResponse } from "next/server";
import { withAuth, rateLimited } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { cached } from "@/lib/cache";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";

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

interface NormalizedBadge {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  issuedAt: string | undefined;
  issuerName: string;
  badgeUrl: string;
}

/** Credly could not be read: not the same thing as "this account has no badges". */
class CredlyUnavailableError extends Error {
  constructor(readonly code: string) {
    super("Credly unavailable");
  }
}

const UNAVAILABLE_MESSAGE = "We could not reach Credly just now. Please try again in a few minutes.";
const DB_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Stored badges carry the username they were fetched for, so a cache written
 * for one account can never be served under another. Old rows (a bare array)
 * have no username and are treated as absent.
 */
function readStoredBadges(raw: string | null, username: string): NormalizedBadge[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return [];
    const { username: storedFor, badges } = parsed as { username?: unknown; badges?: unknown };
    if (typeof storedFor !== "string" || !Array.isArray(badges)) return [];
    return storedFor.toLowerCase() === username.toLowerCase() ? (badges as NormalizedBadge[]) : [];
  } catch {
    return [];
  }
}

async function fetchCredlyBadges(username: string): Promise<NormalizedBadge[]> {
  let res: Response;
  try {
    res = await fetch(`https://www.credly.com/users/${encodeURIComponent(username)}/badges.json`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new CredlyUnavailableError("network");
  }
  if (!res.ok) throw new CredlyUnavailableError(`status_${res.status}`);

  let data: CredlyBadgesResponse;
  try {
    data = (await res.json()) as CredlyBadgesResponse;
  } catch {
    throw new CredlyUnavailableError("unparseable");
  }
  if (!data || !Array.isArray(data.data)) throw new CredlyUnavailableError("unexpected_shape");

  return data.data.map((badge) => ({
    id: badge.id,
    name: badge.badge_template?.name || "Unknown Badge",
    description: badge.badge_template?.description || "",
    imageUrl: badge.badge_template?.image?.url || badge.badge_template?.image_url || "",
    issuedAt: badge.issued_at_date || badge.issued_at || badge.created_at,
    issuerName: badge.issuer?.entities?.[0]?.entity?.name || "",
    badgeUrl: `https://www.credly.com/badges/${badge.id}`,
  }));
}

/**
 * GET /api/credly/badges
 *
 * Fetches the authenticated student's Credly badges from the public profile.
 * No API key needed. A successful lookup is cached 10 minutes in process and
 * stored on the student as last-good (bound to the username). A failed lookup
 * is never cached; it serves last-good for this username, or answers 502 with
 * `unavailable: true`. Nothing here grants certification credit.
 */
export const GET = withAuth(async (session) => {
  // 30 requests per minute per account. The cache key below is
  // `credly:<username>`, and the username is whatever the student last saved
  // through POST /api/settings/credly — so without a limit one account can mint
  // unbounded 10-minute cache entries against a shared 10,000-key ceiling that
  // refuses writes rather than evicting. Generous for a page that fetches
  // badges on load; cheap for anyone driving it in a loop.
  const rl = await rateLimit(`credly:${session.id}`, 30, 60 * 1000);
  if (!rl.success) throw rateLimited();

  const student = await prisma.student.findUnique({
    where: { id: session.id },
    select: { credlyUsername: true, credlyBadgesCache: true, credlyBadgesCachedAt: true },
  });

  if (!student?.credlyUsername) {
    return NextResponse.json({ badges: [], username: null });
  }

  const username = student.credlyUsername.trim();
  const storedBadges = readStoredBadges(student.credlyBadgesCache, username);
  const dbCacheFresh =
    student.credlyBadgesCachedAt !== null &&
    Date.now() - student.credlyBadgesCachedAt.getTime() < DB_CACHE_TTL_MS;
  if (dbCacheFresh && storedBadges.length > 0) {
    return NextResponse.json({ badges: storedBadges, username, cached: true });
  }

  let badges: NormalizedBadge[];
  try {
    badges = await cached(`credly:${username}`, 600, () => fetchCredlyBadges(username));
  } catch (error) {
    if (!(error instanceof CredlyUnavailableError)) throw error;
    logger.warn("credly_lookup_failed", { student: studentLogKey(session.id), reason: error.code });
    if (storedBadges.length > 0) {
      return NextResponse.json({ badges: storedBadges, username, cached: true, stale: true });
    }
    return NextResponse.json(
      { badges: [], username, unavailable: true, error: UNAVAILABLE_MESSAGE },
      { status: 502 },
    );
  }

  if (badges.length > 0) {
    // Persist last-good for outage resilience; never blocks the response.
    void prisma.student
      .update({
        where: { id: session.id },
        data: {
          credlyBadgesCache: JSON.stringify({ username, badges }),
          credlyBadgesCachedAt: new Date(),
        },
      })
      .catch((error: unknown) => {
        logger.warn("credly_cache_store_failed", {
          student: studentLogKey(session.id),
          reason: error instanceof Error ? error.name : "unknown",
        });
      });
  }
  return NextResponse.json({ badges, username });
});
