import { ApiClientError } from "@/lib/api";
import { REGION_MESSAGES } from "./regions-copy";
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

/** A failure the form can act on beyond showing words: the short code is taken. */
export type SaveProblem = "code-taken";

export interface Failure {
  ok: false;
  message: string;
  problem?: SaveProblem;
}

export type Outcome<T> = { ok: true; value: T } | Failure;

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

function failed(message: string): Failure {
  return { ok: false, message };
}

function statusOf(error: unknown): number | null {
  return error instanceof ApiClientError ? error.status : null;
}

/**
 * Plain words for a failed save. The server's own text is for developers
 * ("Region not found.", Zod messages), so it is never shown. A 404 or a 409
 * means someone changed the region on another screen.
 */
function saveFailure(error: unknown): Failure {
  const status = statusOf(error);
  return failed(status === 404 || status === 409 ? REGION_MESSAGES.changedElsewhere : MESSAGES.saveFailed);
}

/** Runs one request and turns a thrown error into the failure `onError` picks. */
async function attempt<T>(request: () => Promise<Outcome<T>>, onError: (error: unknown) => Failure): Promise<Outcome<T>> {
  try {
    return await request();
  } catch (error) {
    return onError(error);
  }
}

export function loadRegions(http: RegionsHttp): Promise<Outcome<AdminRegion[]>> {
  return attempt(async () => {
    const regions = parseRegionList(await http.get(REGIONS_URL));
    return regions ? { ok: true, value: regions } : failed(MESSAGES.unreadableList);
  }, () => failed(MESSAGES.loadFailed));
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
  }, (error) =>
    // The only conflict a create can meet is a short code already in use.
    statusOf(error) === 409 ? { ...failed(REGION_MESSAGES.codeTaken(code)), problem: "code-taken" } : saveFailure(error),
  );
}

/** Resolves to the name the server kept. */
export async function renameRegion(http: RegionsHttp, regionId: string, name: string): Promise<Outcome<string>> {
  const trimmed = name.trim();
  if (!trimmed) return failed(MESSAGES.blankName);
  return attempt(async () => {
    const region = parseRegionReply(await http.patch(regionUrl(regionId), { name: trimmed }));
    return { ok: true, value: region?.name ?? trimmed };
  }, saveFailure);
}

export function assignCoordinator(http: RegionsHttp, regionId: string, coordinatorId: string): Promise<Outcome<null>> {
  return attempt(async () => {
    await http.post(`${regionUrl(regionId)}/coordinators`, { coordinatorId });
    return { ok: true, value: null };
  }, saveFailure);
}

export function removeCoordinator(http: RegionsHttp, regionId: string, coordinatorId: string): Promise<Outcome<null>> {
  return attempt(async () => {
    await http.del(`${regionUrl(regionId)}/coordinators/${encodeURIComponent(coordinatorId)}`);
    return { ok: true, value: null };
  }, saveFailure);
}
