export type RegionStatus = "active" | "archived";

/** A coordinator as this screen shows them. The login id never leaves the parse step. */
export interface RegionPerson {
  id: string;
  displayName: string;
  email: string | null;
}

export interface AdminRegion {
  id: string;
  name: string;
  code: string;
  status: RegionStatus;
  classCount: number;
  coordinators: readonly RegionPerson[];
}

export interface RegionChange {
  name?: string;
}

/** The server's limits on a region code (src/app/api/admin/regions/route.ts). */
export const REGION_CODE_MAX_LENGTH = 40;
export const REGION_CODE_PATTERN = /^[a-z0-9-]+$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStatus(value: unknown): value is RegionStatus {
  return value === "active" || value === "archived";
}

function parsePerson(value: unknown): RegionPerson | null {
  if (!isRecord(value)) return null;
  const { id, displayName, email } = value;
  if (typeof id !== "string" || id === "" || typeof displayName !== "string") return null;
  return { id, displayName, email: typeof email === "string" && email !== "" ? email : null };
}

/** Parses every item, or returns null as soon as one does not parse. */
function parseAll<T>(values: readonly unknown[], parse: (value: unknown) => T | null): T[] | null {
  const parsed: T[] = [];
  for (const value of values) {
    const item = parse(value);
    if (item === null) return null;
    parsed.push(item);
  }
  return parsed;
}

function parsePeople(value: unknown): RegionPerson[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) ? parseAll(value, parsePerson) : null;
}

function parseRegion(value: unknown): AdminRegion | null {
  if (!isRecord(value)) return null;
  const { id, name, code, status, classCount } = value;
  if (typeof id !== "string" || id === "" || typeof name !== "string" || typeof code !== "string") return null;
  if (!isStatus(status)) return null;
  const coordinators = parsePeople(value.coordinators);
  if (coordinators === null) return null;
  return { id, name, code, status, classCount: typeof classCount === "number" ? classCount : 0, coordinators };
}

/**
 * Reads GET /api/admin/regions. Null when the reply is not a list of regions.
 *
 * Archived regions are left out. This screen cannot archive or restore a
 * region yet: archiving does not end a coordinator's access
 * (`coordinated_region_ids` and `coordinatorHasRegion` ignore the status), and
 * it drops the region's students from every dashboard. Until a migration fixes
 * that, a region archived some other way is simply not listed here.
 */
export function parseRegionList(payload: unknown): AdminRegion[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.regions)) return null;
  const regions = parseAll(payload.regions, parseRegion);
  return regions && regions.filter((region) => region.status === "active");
}

/** Reads the `{ region }` reply of a create or an update. It carries no classes or coordinators. */
export function parseRegionReply(payload: unknown): AdminRegion | null {
  return isRecord(payload) ? parseRegion(payload.region) : null;
}

/** A code the server accepts, made from the name: "North Central" becomes "north-central". */
export function suggestRegionCode(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, REGION_CODE_MAX_LENGTH)
    .replace(/-+$/, "");
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

function sortRegions(regions: readonly AdminRegion[]): AdminRegion[] {
  return [...regions].sort(byName);
}

function mapRegion(
  regions: readonly AdminRegion[],
  regionId: string,
  change: (region: AdminRegion) => AdminRegion,
): AdminRegion[] {
  return sortRegions(regions.map((region) => (region.id === regionId ? change(region) : region)));
}

export function withRegionAdded(regions: readonly AdminRegion[], region: AdminRegion): AdminRegion[] {
  return sortRegions([...regions.filter((item) => item.id !== region.id), region]);
}

export function withRegionChanged(regions: readonly AdminRegion[], regionId: string, change: RegionChange): AdminRegion[] {
  return mapRegion(regions, regionId, (region) => ({ ...region, ...change }));
}

export function withCoordinatorAdded(regions: readonly AdminRegion[], regionId: string, person: RegionPerson): AdminRegion[] {
  return mapRegion(regions, regionId, (region) => ({
    ...region,
    coordinators: [...region.coordinators.filter((item) => item.id !== person.id), person],
  }));
}

export function withCoordinatorRemoved(regions: readonly AdminRegion[], regionId: string, coordinatorId: string): AdminRegion[] {
  return mapRegion(regions, regionId, (region) => ({
    ...region,
    coordinators: region.coordinators.filter((item) => item.id !== coordinatorId),
  }));
}

/** One saved change to the list, as the reducer applies it. */
export type RegionListChange =
  | { kind: "region-added"; region: AdminRegion }
  | { kind: "region-changed"; regionId: string; change: RegionChange }
  | { kind: "coordinator-added"; regionId: string; person: RegionPerson }
  | { kind: "coordinator-removed"; regionId: string; coordinatorId: string };

export function applyRegionChange(regions: readonly AdminRegion[], change: RegionListChange): AdminRegion[] {
  switch (change.kind) {
    case "region-added":
      return withRegionAdded(regions, change.region);
    case "region-changed":
      return withRegionChanged(regions, change.regionId, change.change);
    case "coordinator-added":
      return withCoordinatorAdded(regions, change.regionId, change.person);
    case "coordinator-removed":
      return withCoordinatorRemoved(regions, change.regionId, change.coordinatorId);
    default: {
      const _exhaustive: never = change;
      return _exhaustive;
    }
  }
}

/**
 * Everyone seen holding a region, once each, by name. People already known
 * stay known, so a coordinator removed from their last region can be added back.
 */
export function mergePeople(known: readonly RegionPerson[], regions: readonly AdminRegion[]): RegionPerson[] {
  const byId = new Map<string, RegionPerson>();
  for (const person of [...known, ...regions.flatMap((region) => region.coordinators)]) {
    byId.set(person.id, person);
  }
  return [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** The people who can be added to a region: everyone known who is not in it already. */
export function coordinatorChoices(people: readonly RegionPerson[], region: AdminRegion): RegionPerson[] {
  const assigned = new Set(region.coordinators.map((person) => person.id));
  return people.filter((person) => !assigned.has(person.id));
}

/** How many of the listed regions a coordinator holds. */
export function regionCountFor(regions: readonly AdminRegion[], coordinatorId: string): number {
  return regions.filter((region) => region.coordinators.some((person) => person.id === coordinatorId)).length;
}

/**
 * The name of another region called the same thing, ignoring case and outer
 * spaces, or null. The server allows it; the screen only warns.
 */
export function regionWithSameName(regions: readonly AdminRegion[], name: string, exceptId?: string): string | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  const match = regions.find((region) => region.id !== exceptId && region.name.trim().toLowerCase() === wanted);
  return match ? match.name : null;
}
