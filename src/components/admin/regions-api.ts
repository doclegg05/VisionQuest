import {
  REGION_CODE_MAX_LENGTH,
  REGION_CODE_PATTERN,
  parseRegionList,
  parseRegionReply,
  type AdminRegion,
} from "./regions-model";

/** The four calls this screen makes. The app's `api` client fits; a test passes a stand-in. */
export interface RegionsHttp {
  get(url: string): Promise<unknown>;
  post(url: string, body: unknown): Promise<unknown>;
  patch(url: string, body: unknown): Promise<unknown>;
  del(url: string): Promise<unknown>;
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; message: string };

export interface NewRegionInput {
  name: string;
  code: string;
}

const REGIONS_URL = "/api/admin/regions";

const MESSAGES = {
  loadFailed: "We could not load the regions. Please try again.",
  unreadableList: "We could not read the list of regions. Please try again.",
  saveFailed: "We could not save that. Please try again.",
  savedUnseen: "The region was saved, but we could not show it. Reload the page to see it.",
  blankName: "Type a name for the region.",
  badCode: "Use only letters, numbers and dashes in the short code.",
} as const;

function regionUrl(regionId: string): string {
  return `${REGIONS_URL}/${encodeURIComponent(regionId)}`;
}

function failed(message: string): Outcome<never> {
  return { ok: false, message };
}

/** The server's own words when it sent any (the `api` client throws them), or the fallback. */
function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Runs one request and turns a thrown error into a failed outcome carrying its message. */
async function attempt<T>(request: () => Promise<Outcome<T>>, fallback: string): Promise<Outcome<T>> {
  try {
    return await request();
  } catch (error) {
    return failed(messageFrom(error, fallback));
  }
}

export function loadRegions(http: RegionsHttp): Promise<Outcome<AdminRegion[]>> {
  return attempt(async () => {
    const regions = parseRegionList(await http.get(REGIONS_URL));
    return regions ? { ok: true, value: regions } : failed(MESSAGES.unreadableList);
  }, MESSAGES.loadFailed);
}

function isValidCode(code: string): boolean {
  return code.length <= REGION_CODE_MAX_LENGTH && REGION_CODE_PATTERN.test(code);
}

export async function createRegion(http: RegionsHttp, input: NewRegionInput): Promise<Outcome<AdminRegion>> {
  const name = input.name.trim();
  const code = input.code.trim().toLowerCase();
  // The server trims a name after it checks the length, so it would store a blank one.
  if (!name) return failed(MESSAGES.blankName);
  if (!isValidCode(code)) return failed(MESSAGES.badCode);
  return attempt(async () => {
    const region = parseRegionReply(await http.post(REGIONS_URL, { name, code }));
    return region ? { ok: true, value: region } : failed(MESSAGES.savedUnseen);
  }, MESSAGES.saveFailed);
}

/** Resolves to the name the server kept. */
export async function renameRegion(http: RegionsHttp, regionId: string, name: string): Promise<Outcome<string>> {
  const trimmed = name.trim();
  if (!trimmed) return failed(MESSAGES.blankName);
  return attempt(async () => {
    const region = parseRegionReply(await http.patch(regionUrl(regionId), { name: trimmed }));
    return { ok: true, value: region?.name ?? trimmed };
  }, MESSAGES.saveFailed);
}

export function assignCoordinator(http: RegionsHttp, regionId: string, coordinatorId: string): Promise<Outcome<null>> {
  return attempt(async () => {
    await http.post(`${regionUrl(regionId)}/coordinators`, { coordinatorId });
    return { ok: true, value: null };
  }, MESSAGES.saveFailed);
}

export function removeCoordinator(http: RegionsHttp, regionId: string, coordinatorId: string): Promise<Outcome<null>> {
  return attempt(async () => {
    await http.del(`${regionUrl(regionId)}/coordinators/${encodeURIComponent(coordinatorId)}`);
    return { ok: true, value: null };
  }, MESSAGES.saveFailed);
}
