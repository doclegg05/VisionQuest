# VisionQuest: Evidence-Based Adult Goal Achievement Research

## Executive Summary

Two parallel research agents analyzed 20+ frameworks, 50+ studies, and multiple high-performing workforce programs (Year Up, Per Scholas, Generation). The findings converge on 5 high-impact themes that VisionQuest should adopt.

---

## The 5 Big Ideas

### 1. WOOP > SMART (or better: SMART + WOOP)

**The research:** Gabriele Oettingen's mental contrasting + implementation intentions (WOOP) produces effect sizes of d=0.49-0.65 — substantially stronger than SMART goals alone. WOOP adds two critical steps: identifying obstacles and creating if-then plans. Implementation intentions alone increase follow-through by 40% (Duckworth, 2011). The effect is strongest for populations facing significant obstacles — exactly VisionQuest's users.

**What to build:**
- Guided WOOP wizard after each goal is set: "What's the best outcome? What obstacle might get in the way? If [obstacle], then I will [plan]."
- Store obstacle-plan pairs as structured data
- When goals stall (5+ days no activity), Sage references the student's own pre-committed if-then plan
- Frame obstacle identification as strength: "Every successful person plans for obstacles"

### 2. Motivational Interviewing for Sage

**The research:** MI's core insight is that arguing against resistance increases it. When a student says "I can't do this," the effective response is reflection ("It sounds like you're feeling overwhelmed"), not cheerleading ("Yes you can!"). Reflections should outnumber questions 2:1. Affirmations of effort ("You showed up despite everything on your plate") are more effective than outcome praise ("Great job!"). The "elicit-provide-elicit" pattern respects adult learners' existing knowledge.

**What to build:**
- Overhaul Sage's system prompt with MI-specific instructions
- Add OARS framework: Open questions, Affirmations, Reflections, Summaries
- Add explicit instruction: "Never give advice before reflecting and asking permission"
- Add scaling questions: "On a scale of 1-10, how motivated are you?"
- Handle sustain talk by reflecting, not arguing
- Affirm specific observable behaviors from the database (streaks, completions, returns after absence)

### 3. Self-Determination Theory — Autonomy, Competence, Relatedness

**The research:** Adults who experienced controlling educational environments (many ABE students had negative K-12 experiences) are especially sensitive to autonomy support. Choice in learning activities increases persistence even when choices are small. Process praise builds competence more than outcome praise. For many ABE students, the relationship with the instructor/advisor is the primary retention factor.

**What to build:**
- **Autonomy:** Audit all Sage prompts for controlling language ("you should" → "you might consider"). Always offer 2-3 choices. Provide rationale for required actions.
- **Competence:** Show personal growth over time ("Compared to your first month, you've completed 3x more tasks"). Use process praise. Create early quick wins.
- **Relatedness:** Sage remembers context across conversations. Teachers get structured check-in protocols. Peer cohort statistics (anonymous).

### 4. Behavioral Nudges That Actually Work

**The research:** Fresh start effects (Monday prompts, new month prompts) increase goal uptake. Two-way nudges (requiring a response) outperform broadcast nudges by 2-3x. Loss framing is more motivating but must be used carefully with vulnerable populations. Commitment devices increase follow-through by 82%. Social proof works when norms are positive.

**What to build:**
- Monday/new month "fresh start" prompts from Sage
- Two-way check-ins: "How did your goal work go today? [Great / Okay / Tough day]"
- Commitment devices: "Want to make this official? I'll check in on this Friday."
- Positive social proof on dashboards: "12 students completed a goal this week"
- Streak-recovery messaging (no shame): "Welcome back! Your last streak was 5 days — ready to start a new one?"

### 5. The Per Scholas Intervention Model

**The research:** High-performing programs intervene within 24-48 hours of warning signs — they don't wait for students to ask for help. Year Up pairs high expectations with high support. Generation teaches mindset alongside technical skills. All successful programs front-load quick wins (a credential in the first 2 weeks) and connect training to employment from Day 1.

**What to build:**
- Early warning system: surface teacher alerts within 2-3 days of inactivity (not 7)
- "Aggressive outreach" protocol: when a student goes inactive, teacher gets a notification with a suggested action
- Front-load the easiest certification so students earn a credential in week 1-2
- Surface career opportunities during onboarding (not after "training is done")
- "Life happens" re-engagement: preserve progress, warm return, no guilt

---

## Priority Implementation Ranking

| # | Feature | Evidence Strength | Effort | Impact |
|---|---------|------------------|--------|--------|
| 1 | **MI-informed Sage prompts** | Very strong (Miller & Rollnick) | Low (prompt changes) | High |
| 2 | **WOOP goal wizard** | Very strong (Oettingen, d=0.49-0.65) | Medium (UI + data model) | Very high |
| 3 | **Autonomy language audit** | Strong (SDT research) | Low (copy changes) | High |
| 4 | **Early warning system (2-3 day)** | Strong (Per Scholas model) | Low (extend existing) | High |
| 5 | **Endowed progress + quick wins** | Strong (Nunes & Dreze) | Low (scoring + prompts) | Medium |
| 6 | **Fresh start prompts** | Moderate (Dai et al.) | Low (time-aware prompts) | Medium |
| 7 | **Commitment devices** | Strong (Bryan et al.) | Medium (date tracking) | Medium |
| 8 | **Teacher check-in protocol** | Strong (MDRC WorkAdvance) | Medium (new UI) | High |
| 9 | **"Life happens" re-engagement** | Strong (ABE persistence) | Low (messaging) | High |
| 10 | **Voice input for chat** | Moderate (literacy research) | Low (Web Speech API) | Medium |
| 11 | **Peer cohort statistics** | Moderate (Year Up model) | Medium (new API) | Medium |
| 12 | **Streak recovery messaging** | Moderate (trauma-informed) | Low (prompt changes) | Medium |

---

## What NOT to Build

Based on the research, these common gamification elements should be avoided for the ABE population:

- **Leaderboards** — create anxiety and shame for lower performers
- **Public failure states** — "You failed" messages, visible dropped streaks
- **Controlling language** — "You must," "You need to," countdown timers
- **Arbitrary point inflation** — XP that doesn't map to real skill growth
- **Performance comparison** — ranking students against each other
- **Punitive gamification** — losing points, level demotion
- **Excessive notifications** — adults in survival mode have limited bandwidth

---

## Key Researchers Referenced

- Oettingen (WOOP/Mental Contrasting), Miller & Rollnick (Motivational Interviewing)
- Deci & Ryan (Self-Determination Theory), Bandura (Self-Efficacy)
- Thaler & Sunstein (Nudge Theory), Mullainathan & Shafir (Scarcity/Cognitive Bandwidth)
- Locke & Latham (Goal-Setting Theory), Amabile & Kramer (Progress Principle)
- MDRC (Year Up, WorkAdvance evaluations), Per Scholas, Generation program evidence
- Dai, Milkman & Riis (Fresh Start Effect), Nunes & Dreze (Endowed Progress)
- Fogg (Tiny Habits), SAMHSA (Trauma-Informed Care), Felitti (ACE Study)
