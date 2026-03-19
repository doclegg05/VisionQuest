import { GOAL_LEVELS, type GoalLevel } from "../goals";

const XP_NEXT_LEVEL: Record<number, number> = {
  1: 200,
  2: 450,
  3: 750,
  4: 1100,
  5: 1500,
};

const STREAK_BONUS: Record<number, number> = {
  3: 25,
  7: 75,
  14: 150,
  30: 300,
};

export const ACHIEVEMENT_DEFS: Record<string, { label: string; desc: string }> = {
  "xp:bhag_set":         { label: "Dream Defined",       desc: "Set your Big Hairy Audacious Goal" },
  "xp:monthly_set":      { label: "Monthly Mapper",      desc: "Set a monthly goal" },
  "xp:weekly_set":       { label: "Weekly Warrior",       desc: "Set a weekly goal" },
  "xp:daily_set":        { label: "Daily Driver",         desc: "Set a daily goal" },
  "xp:task_set":         { label: "Action Taker",         desc: "Created action tasks" },
  "xp:daily_checkin":    { label: "Check-In Champ",       desc: "Completed a daily check-in" },
  "xp:task_complete":    { label: "Task Crusher",          desc: "Completed a task" },
  "xp:growth_prompt":    { label: "Deep Thinker",          desc: "Reflected on a growth prompt" },
  "xp:weekly_review":    { label: "Weekly Reflector",      desc: "Completed a weekly review" },
  "xp:monthly_review":   { label: "Monthly Strategist",    desc: "Completed a monthly review" },
  "xp:chat_session":     { label: "Conversation Starter",  desc: "Had a meaningful chat with Sage" },
  "streak:3":            { label: "3-Day Streak",          desc: "Checked in 3 days in a row" },
  "streak:7":            { label: "Week Warrior",          desc: "7-day check-in streak" },
  "streak:14":           { label: "Fortnight Focus",       desc: "14-day check-in streak" },
  "streak:30":           { label: "Monthly Machine",       desc: "30-day check-in streak" },
  "level:2":             { label: "Horizon Set",           desc: "Reached Level 2" },
  "level:3":             { label: "Strategist",            desc: "Reached Level 3" },
  "level:4":             { label: "Executor",              desc: "Reached Level 4" },
  "level:5":             { label: "Quest Complete",        desc: "Reached Level 5" },

  // Certification achievements
  "cert:first_started":     { label: "Cert Seeker",         desc: "Started your first certification" },
  "cert:first_earned":      { label: "Certified!",           desc: "Earned your first certification" },
  "cert:five_earned":       { label: "Cert Collector",       desc: "Earned 5 certifications" },
  "cert:all_earned":        { label: "Master Certified",     desc: "Earned every available certification" },

  // Platform engagement
  "platform:first_visit":   { label: "Explorer",             desc: "Visited your first learning platform" },
  "platform:five_used":     { label: "Multi-Learner",        desc: "Used 5 different platforms" },
  "platform:all_explored":  { label: "Platform Master",      desc: "Explored every learning platform" },

  // Orientation
  "orientation:complete":   { label: "Onboarded",            desc: "Completed all orientation steps" },

  // Vision Board
  "visionboard:first_pin":   { label: "Dreamer",      desc: "Added your first vision board item" },
  "visionboard:five_pins":   { label: "Visionary",    desc: "Pinned 5 items to your vision board" },
  "visionboard:ten_pins":    { label: "Dream Weaver", desc: "Pinned 10 items to your vision board" },
  "visionboard:goal_linked": { label: "Goal Mapper",  desc: "Linked a goal to your vision board" },

  // Portfolio
  "portfolio:first_item":   { label: "Portfolio Starter",    desc: "Added your first portfolio item" },
  "portfolio:resume":       { label: "Resume Ready",         desc: "Created your resume" },
  "portfolio:shared":       { label: "Portfolio Published",  desc: "Shared your portfolio publicly" },

  // SPOKES Program Certificate tiers
  "tier:attendance":        { label: "Consistent",           desc: "Earned Certificate of Attendance" },
  "tier:participation":     { label: "Engaged",              desc: "Earned Certificate of Participation" },
  "tier:completion":        { label: "Committed",            desc: "Earned Certificate of Completion" },
  "tier:achievement":       { label: "Accomplished",         desc: "Earned Certificate of Achievement" },
  "tier:ready_to_work":     { label: "Ready to Work",        desc: "Earned the Ready to Work Certificate" },

  // Readiness score milestones
  "readiness:50":           { label: "Halfway There",        desc: "Reached 50% job readiness" },
  "readiness:75":           { label: "Almost Ready",         desc: "Reached 75% job readiness" },
  "readiness:100":          { label: "Job Ready!",           desc: "Reached 100% job readiness" },
};

export interface ProgressionState {
  level: number;
  xp: number;
  completedGoalLevels: string[];
  dailyCheckinsCount: number;
  currentStreak: number;
  longestStreak: number;
  streakDays: string[];
  weeklyReviewsDone: number;
  monthlyReviewsDone: number;
  achievements: string[];
  levelUpHistory: { level: number; at: string; reason: string }[];
  certificationsStarted: number;
  certificationsEarned: number;
  platformsVisited: string[];
  orientationComplete: boolean;
  portfolioItemCount: number;
  resumeCreated: boolean;
  portfolioShared: boolean;
  visionBoardItemCount: number;
}

function isoNow(): string {
  return new Date().toISOString();
}

function normalizeDay(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function uniqueSortedDays(days: string[]): string[] {
  const uniq = [...new Set(days.map(normalizeDay).filter(Boolean))];
  return uniq.sort();
}

function computeCurrentStreak(days: string[]): number {
  if (!days.length) return 0;
  const sorted = [...days].sort().reverse();
  let streak = 1;
  const cursor = new Date(`${sorted[0]}T00:00:00`);
  cursor.setDate(cursor.getDate() - 1);

  for (let i = 1; i < sorted.length; i++) {
    const candidate = new Date(`${sorted[i]}T00:00:00`);
    if (candidate.getTime() === cursor.getTime()) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else if (candidate.getTime() < cursor.getTime()) {
      continue;
    } else {
      break;
    }
  }
  return streak;
}

export function createInitialState(): ProgressionState {
  return {
    level: 1,
    xp: 0,
    completedGoalLevels: [],
    dailyCheckinsCount: 0,
    currentStreak: 0,
    longestStreak: 0,
    streakDays: [],
    weeklyReviewsDone: 0,
    monthlyReviewsDone: 0,
    achievements: [],
    levelUpHistory: [],
    certificationsStarted: 0,
    certificationsEarned: 0,
    platformsVisited: [],
    orientationComplete: false,
    portfolioItemCount: 0,
    resumeCreated: false,
    portfolioShared: false,
    visionBoardItemCount: 0,
  };
}

export function parseState(raw: string | null): ProgressionState {
  if (!raw) return createInitialState();
  try {
    const parsed = JSON.parse(raw);
    return {
      level: Math.max(1, Math.min(5, parsed.level || 1)),
      xp: Math.max(0, parsed.xp || 0),
      completedGoalLevels: Array.isArray(parsed.completedGoalLevels) ? parsed.completedGoalLevels : [],
      dailyCheckinsCount: Math.max(0, parsed.dailyCheckinsCount || 0),
      currentStreak: Math.max(0, parsed.currentStreak || 0),
      longestStreak: Math.max(0, parsed.longestStreak || 0),
      streakDays: uniqueSortedDays(Array.isArray(parsed.streakDays) ? parsed.streakDays : []),
      weeklyReviewsDone: Math.max(0, parsed.weeklyReviewsDone || 0),
      monthlyReviewsDone: Math.max(0, parsed.monthlyReviewsDone || 0),
      achievements: Array.isArray(parsed.achievements) ? parsed.achievements : [],
      levelUpHistory: Array.isArray(parsed.levelUpHistory) ? parsed.levelUpHistory : [],
      certificationsStarted: Math.max(0, parsed.certificationsStarted || 0),
      certificationsEarned: Math.max(0, parsed.certificationsEarned || 0),
      platformsVisited: Array.isArray(parsed.platformsVisited) ? parsed.platformsVisited : [],
      orientationComplete: !!parsed.orientationComplete,
      portfolioItemCount: Math.max(0, parsed.portfolioItemCount || 0),
      resumeCreated: !!parsed.resumeCreated,
      portfolioShared: !!parsed.portfolioShared,
      visionBoardItemCount: Math.max(0, parsed.visionBoardItemCount || 0),
    };
  } catch {
    return createInitialState();
  }
}

function levelFromGoals(completedLevels: string[]): number {
  const set = new Set(completedLevels);
  if (set.has("task")) return 5;
  if (set.has("daily")) return 4;
  if (set.has("weekly")) return 3;
  if (set.has("monthly")) return 2;
  if (set.has("bhag")) return 2;
  return 1;
}

function addAchievement(state: ProgressionState, key: string) {
  if (!state.achievements.includes(key)) {
    state.achievements.push(key);
  }
}

export function recordGoalSet(
  state: ProgressionState,
  level: string
): { state: ProgressionState; xpGained: number; levelChanged: boolean } {
  const prevLevel = state.level;
  let xpGained = 0;

  if (!state.completedGoalLevels.includes(level)) {
    state.completedGoalLevels.push(level);
    xpGained = 50;
    state.xp += xpGained;
    addAchievement(state, `xp:${level}_set`);
  }

  state.level = Math.max(state.level, levelFromGoals(state.completedGoalLevels));

  // Level achievements
  for (let l = 2; l <= 5; l++) {
    if (state.level >= l) addAchievement(state, `level:${l}`);
  }

  if (state.level > prevLevel) {
    state.levelUpHistory.push({ level: state.level, at: isoNow(), reason: `${level}_set` });
  }

  return { state, xpGained, levelChanged: state.level > prevLevel };
}

export function recordDailyCheckin(
  state: ProgressionState
): { state: ProgressionState; xpGained: number; streakMilestone: number | null } {
  const today = new Date().toISOString().slice(0, 10);
  if (state.streakDays.includes(today)) return { state, xpGained: 0, streakMilestone: null }; // Already checked in today

  const day = normalizeDay(isoNow());
  let xpGained = 15;
  state.xp += xpGained;
  state.dailyCheckinsCount++;
  addAchievement(state, "xp:daily_checkin");

  // Update streak
  state.streakDays = uniqueSortedDays([...state.streakDays, day]).slice(-90);
  state.currentStreak = computeCurrentStreak(state.streakDays);
  state.longestStreak = Math.max(state.longestStreak, state.currentStreak);

  const milestone = [30, 14, 7, 3].find((v) => v === state.currentStreak) || null;
  if (milestone) {
    const key = `streak:${milestone}`;
    if (!state.achievements.includes(key)) {
      addAchievement(state, key);
      const bonus = STREAK_BONUS[milestone] || 0;
      state.xp += bonus;
      xpGained += bonus;
    }
  }

  return { state, xpGained, streakMilestone: milestone };
}

export function recordTaskComplete(state: ProgressionState): { state: ProgressionState; xpGained: number } {
  state.xp += 10;
  addAchievement(state, "xp:task_complete");
  return { state, xpGained: 10 };
}

export function recordWeeklyReview(state: ProgressionState): { state: ProgressionState; xpGained: number } {
  state.xp += 40;
  state.weeklyReviewsDone++;
  addAchievement(state, "xp:weekly_review");
  return { state, xpGained: 40 };
}

export function recordMonthlyReview(state: ProgressionState): { state: ProgressionState; xpGained: number } {
  state.xp += 60;
  state.monthlyReviewsDone++;
  addAchievement(state, "xp:monthly_review");
  return { state, xpGained: 60 };
}

export function recordChatSession(state: ProgressionState): { state: ProgressionState; xpGained: number } {
  state.xp += 10;
  addAchievement(state, "xp:chat_session");
  return { state, xpGained: 10 };
}

export function getXpProgress(state: ProgressionState) {
  const nextTarget = XP_NEXT_LEVEL[state.level] || XP_NEXT_LEVEL[5];
  const prevTarget = XP_NEXT_LEVEL[state.level - 1] || 0;
  const span = Math.max(1, nextTarget - prevTarget);
  const progress = Math.max(0, Math.min(span, state.xp - prevTarget));
  return {
    current: state.xp,
    nextTarget,
    prevTarget,
    ratio: progress / span,
  };
}

export function getAchievementsWithDefs(state: ProgressionState) {
  return state.achievements
    .map((key) => ({
      key,
      ...(ACHIEVEMENT_DEFS[key] || { label: key, desc: "" }),
    }));
}

function checkTierUnlocks(state: ProgressionState): void {
  // Attendance tier: 7-day streak
  if (!state.achievements.includes("tier:attendance") && state.longestStreak >= 7) {
    addAchievement(state, "tier:attendance");
  }

  // Participation tier: chat session + daily checkin + platform visit
  if (!state.achievements.includes("tier:participation") &&
      state.achievements.includes("xp:chat_session") &&
      state.achievements.includes("xp:daily_checkin") &&
      state.achievements.includes("platform:first_visit")) {
    addAchievement(state, "tier:participation");
  }

  // Completion tier: orientation done + first cert earned
  if (!state.achievements.includes("tier:completion") &&
      state.orientationComplete &&
      state.certificationsEarned >= 1) {
    addAchievement(state, "tier:completion");
  }

  // Achievement tier: 5 certs + resume + level 3
  if (!state.achievements.includes("tier:achievement") &&
      state.certificationsEarned >= 5 &&
      state.resumeCreated &&
      state.level >= 3) {
    addAchievement(state, "tier:achievement");
  }

  // Ready to Work: all previous tiers
  if (!state.achievements.includes("tier:ready_to_work") &&
      state.achievements.includes("tier:attendance") &&
      state.achievements.includes("tier:participation") &&
      state.achievements.includes("tier:completion") &&
      state.achievements.includes("tier:achievement")) {
    addAchievement(state, "tier:ready_to_work");
  }
}

export function recordCertificationStarted(state: ProgressionState): void {
  state.certificationsStarted++;
  state.xp += 25;
  if (state.certificationsStarted === 1) {
    addAchievement(state, "cert:first_started");
  }
}

export function recordCertificationEarned(state: ProgressionState): void {
  state.certificationsEarned++;
  state.xp += 100;
  if (state.certificationsEarned === 1) addAchievement(state, "cert:first_earned");
  if (state.certificationsEarned >= 5) addAchievement(state, "cert:five_earned");
  if (state.certificationsEarned >= 19) addAchievement(state, "cert:all_earned"); // 19 total certs available
  checkTierUnlocks(state);
}

export function recordPlatformVisit(state: ProgressionState, platformId: string): void {
  if (!state.platformsVisited.includes(platformId)) {
    state.platformsVisited.push(platformId);
    state.xp += 5;
    if (state.platformsVisited.length === 1) addAchievement(state, "platform:first_visit");
    if (state.platformsVisited.length >= 5) addAchievement(state, "platform:five_used");
    if (state.platformsVisited.length >= 13) addAchievement(state, "platform:all_explored");
    checkTierUnlocks(state);
  }
}

export function recordOrientationComplete(state: ProgressionState): void {
  if (!state.orientationComplete) {
    state.orientationComplete = true;
    state.xp += 75;
    addAchievement(state, "orientation:complete");
    checkTierUnlocks(state);
  }
}

export function recordPortfolioItem(state: ProgressionState, type: "item" | "resume" | "shared"): void {
  if (type === "item") {
    state.portfolioItemCount++;
    state.xp += 15;
    if (state.portfolioItemCount === 1) addAchievement(state, "portfolio:first_item");
  } else if (type === "resume") {
    if (!state.resumeCreated) {
      state.resumeCreated = true;
      state.xp += 50;
      addAchievement(state, "portfolio:resume");
      checkTierUnlocks(state);
    }
  } else if (type === "shared") {
    if (!state.portfolioShared) {
      state.portfolioShared = true;
      state.xp += 30;
      addAchievement(state, "portfolio:shared");
    }
  }
}

export function checkReadinessAchievements(state: ProgressionState, readinessScore: number): void {
  if (readinessScore >= 50 && !state.achievements.includes("readiness:50")) {
    addAchievement(state, "readiness:50");
  }
  if (readinessScore >= 75 && !state.achievements.includes("readiness:75")) {
    addAchievement(state, "readiness:75");
  }
  if (readinessScore >= 100 && !state.achievements.includes("readiness:100")) {
    addAchievement(state, "readiness:100");
  }
}

export function recordVisionBoardItem(state: ProgressionState, type: "pin" | "goal_link"): void {
  if (type === "pin") {
    state.visionBoardItemCount++;
    state.xp += 10;
    if (state.visionBoardItemCount === 1) addAchievement(state, "visionboard:first_pin");
    if (state.visionBoardItemCount === 5) addAchievement(state, "visionboard:five_pins");
    if (state.visionBoardItemCount === 10) addAchievement(state, "visionboard:ten_pins");
  } else if (type === "goal_link") {
    state.visionBoardItemCount++;
    state.xp += 15;
    if (!state.achievements.includes("visionboard:goal_linked")) {
      addAchievement(state, "visionboard:goal_linked");
    }
    if (state.visionBoardItemCount === 1) addAchievement(state, "visionboard:first_pin");
    if (state.visionBoardItemCount === 5) addAchievement(state, "visionboard:five_pins");
    if (state.visionBoardItemCount === 10) addAchievement(state, "visionboard:ten_pins");
  }
}

export { GOAL_LEVELS };
export type { GoalLevel };
