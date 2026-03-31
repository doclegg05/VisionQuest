/**
 * Daily coaching prompt selector for Sage.
 *
 * Selects the most contextually relevant prompt template for a student based
 * on their current engagement state. No AI calls — templates only.
 */

export interface DailyPromptContext {
  studentName: string;
  currentStreak: number;
  longestStreak: number;
  lastLoginDate: string | null; // ISO date of last check-in
  daysSinceLastLogin: number;
  activeGoals: { level: string; content: string; status: string }[];
  weeklyGoalContent: string | null;
  upcomingDeadlines: { content: string; dueDate: string }[]; // goal resource links due in next 3 days
  orientationComplete: boolean;
  orientationPendingCount: number;
  recentAchievement: string | null; // most recent achievement label
  certInProgress: string | null; // name of cert being worked on
  coachingArcWeek: number | null; // future use
}

export interface DailyPrompt {
  title: string;
  body: string;
  actionUrl: string;
}

/**
 * Select the highest-priority daily coaching prompt for a student.
 *
 * Priority order:
 * 1. Re-engagement (3+ days away)
 * 2. Streak at risk (1 day gap, active streak)
 * 3. Goal deadline (upcoming due date)
 * 4. Milestone celebration (recent achievement)
 * 5. Orientation nudge (incomplete orientation)
 * 6. Active streak with weekly goal
 * 7. General encouragement (default)
 */
export function selectDailyPrompt(ctx: DailyPromptContext): DailyPrompt {
  const name = ctx.studentName;

  // 1. Re-engagement — student has been away 3+ days
  if (ctx.daysSinceLastLogin >= 3) {
    return {
      title: "We missed you",
      body: `Hey ${name}, no pressure — your progress is right where you left it. When you're ready, Sage is here.`,
      actionUrl: "/chat",
    };
  }

  // 2. Streak at risk — one-day gap with an active streak
  if (ctx.daysSinceLastLogin === 1 && ctx.currentStreak > 0) {
    return {
      title: "Your streak is still alive!",
      body: `Hey ${name}, your ${ctx.currentStreak}-day streak is still alive! One quick check-in keeps it going.`,
      actionUrl: "/dashboard",
    };
  }

  // 3. Goal deadline — something due in the next 3 days
  if (ctx.upcomingDeadlines.length > 0) {
    const deadline = ctx.upcomingDeadlines[0];
    const daysUntil = daysUntilDue(deadline.dueDate);
    const daysText = daysUntil === 0 ? "today" : daysUntil === 1 ? "tomorrow" : `in ${daysUntil} days`;
    return {
      title: "Goal step due soon",
      body: `${name}, your goal step "${deadline.content}" is due ${daysText}. Want to talk through what's left?`,
      actionUrl: "/chat",
    };
  }

  // 4. Milestone celebration — earned an achievement in the last 7 days
  if (ctx.recentAchievement !== null) {
    return {
      title: "You earned something!",
      body: `You just earned "${ctx.recentAchievement}"! That's real progress, ${name}.`,
      actionUrl: "/dashboard",
    };
  }

  // 5. Orientation nudge — onboarding incomplete
  if (!ctx.orientationComplete && ctx.orientationPendingCount > 0) {
    return {
      title: "Orientation items waiting",
      body: `${name}, you have ${ctx.orientationPendingCount} orientation item${ctx.orientationPendingCount === 1 ? "" : "s"} left. Let's knock one out today!`,
      actionUrl: "/orientation",
    };
  }

  // 6. Active streak with a weekly goal set
  if (ctx.currentStreak > 0 && ctx.weeklyGoalContent !== null) {
    return {
      title: `Day ${ctx.currentStreak} — keep it going`,
      body: `Day ${ctx.currentStreak}! Your weekly goal: ${ctx.weeklyGoalContent}. What's your plan for today?`,
      actionUrl: "/chat",
    };
  }

  // 7. Coaching arc weekly nudge — only when an arc week is set
  if (ctx.coachingArcWeek !== null) {
    const arcPrompt = ARC_WEEK_PROMPTS[ctx.coachingArcWeek];
    if (arcPrompt) {
      return {
        title: arcPrompt.title,
        body: `${name}, ${arcPrompt.body}`,
        actionUrl: arcPrompt.actionUrl,
      };
    }
  }

  // 8. Default — general encouragement
  return {
    title: "Good morning from Sage",
    body: `Good morning, ${name}! Your goals are waiting. What will you work on today?`,
    actionUrl: "/goals",
  };
}

interface ArcWeekPrompt {
  title: string;
  body: string;
  actionUrl: string;
}

const ARC_WEEK_PROMPTS: Record<number, ArcWeekPrompt> = {
  1: {
    title: "Week 1: Discover your direction",
    body: "this week is all about discovering your direction. Chat with Sage to explore your interests!",
    actionUrl: "/chat",
  },
  2: {
    title: "Week 2: Dream big",
    body: "week 2 is time to dream big! Let's set your main goal with Sage.",
    actionUrl: "/chat",
  },
  3: {
    title: "Week 3: Build momentum",
    body: "week 3 is about building momentum! Start on a certification this week.",
    actionUrl: "/learning",
  },
  4: {
    title: "Week 4: Review your progress",
    body: "let's review your progress this week. How are your goals going?",
    actionUrl: "/chat",
  },
  5: {
    title: "Week 5: Career prep time",
    body: "week 5 is career prep time! Work on your resume and portfolio.",
    actionUrl: "/portfolio",
  },
  6: {
    title: "Week 6: Launch ready!",
    body: "this is the final week! Let's make sure you're launch-ready.",
    actionUrl: "/chat",
  },
};

/** Returns the number of whole days between now and a future ISO date string. */
function daysUntilDue(dueDateIso: string): number {
  const due = new Date(dueDateIso);
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((due.getTime() - now.getTime()) / msPerDay));
}
