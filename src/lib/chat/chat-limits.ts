import type { DemoAccountKind, DemoLimits } from "@/lib/demo/config";

/**
 * Which Sage chat limits apply to one account. Pure on purpose: no env reads,
 * no counters. `POST /api/chat/send` owns the counters and their keys; this
 * file owns only the numbers, so the whole table can be read and tested here.
 */
export interface ChatLimits {
  /** Messages per hour for this account. Charged on every provider. */
  hourly: number;
  /** Messages per UTC day for this account, or null when it has no daily cap. */
  perAccountDaily: number | null;
  /** Messages per UTC day shared by all demo accounts, or null for a real account. */
  demoWideDaily: number | null;
}

export interface ChatLimitsInput {
  role: string;
  /** What the route computes: teacher, admin and coordinator chats are all staff chats. */
  isStaffChat: boolean;
  isCloudProvider: boolean;
  /** Present only on a demo account. */
  demoAccount?: DemoAccountKind;
}

// Host protection, not cost: well above a human chat pace (about one a minute)
// and inside what one Ollama host can serve to a whole cohort.
const ADMIN_HOURLY = 120;
const STAFF_HOURLY = 60;
const STUDENT_HOURLY = 40;

// The daily cap bounds API spend, so it applies to cloud providers only, and
// never to an admin.
const STAFF_CLOUD_DAILY = 400;
const STUDENT_CLOUD_DAILY = 200;

type AccountLimits = Pick<ChatLimits, "hourly" | "perAccountDaily">;

/** What a real account gets, and what a demo student gets underneath its extra cap. */
function realAccountLimits(input: ChatLimitsInput): AccountLimits {
  const hourly = input.isStaffChat
    ? input.role === "admin"
      ? ADMIN_HOURLY
      : STAFF_HOURLY
    : STUDENT_HOURLY;
  const capsByCost = input.isCloudProvider && input.role !== "admin";
  const perAccountDaily = capsByCost
    ? input.isStaffChat
      ? STAFF_CLOUD_DAILY
      : STUDENT_CLOUD_DAILY
    : null;
  return { hourly, perAccountDaily };
}

/**
 * `demo` is required for a demo account and ignored for a real one. A demo
 * account without it throws rather than quietly running with no demo-wide cap,
 * because a missing cap is a missing spending limit.
 */
export function chatLimitsFor(input: ChatLimitsInput, demo?: DemoLimits): ChatLimits {
  const kind = input.demoAccount;
  if (kind === undefined) return { ...realAccountLimits(input), demoWideDaily: null };
  if (demo === undefined) {
    throw new Error("A demo account needs the demo limits to find its chat limits.");
  }

  switch (kind) {
    case "instructor":
      // One shared instructor serves every visitor, so it gets room of its own
      // on any provider instead of the real staff numbers.
      return {
        hourly: demo.instructorSageHourly,
        perAccountDaily: demo.instructorSageDaily,
        demoWideDaily: demo.sageDaily,
      };
    case "student":
      return { ...realAccountLimits(input), demoWideDaily: demo.sageDaily };
    default: {
      const unhandled: never = kind;
      throw new Error(`Unhandled demo account kind: ${String(unhandled)}`);
    }
  }
}
