# Gamification Backlog

## Status

This document is a planning artifact only. No product behavior in this document is implemented yet.

## Goal

Shift VisionQuest progression from a chat-centered XP loop to a behavior-centered system that rewards real workforce actions, supports adult learners, and fits the modules already in the app.

## Definition Of Done

- progression reads and writes use one canonical service instead of route-level JSON parsing
- XP is awarded for real actions across orientation, tasks, applications, events, portfolio, certifications, and credential publishing
- duplicate retries do not double-award XP
- the dashboard shows weekly missions and practical reward unlocks
- teachers can issue kudos tied to professional behaviors
- unit and smoke coverage exists for the new progression write paths

## Product Guardrails

- no public leaderboard in the first release
- no fake currency or prize shop
- rewards should feel career-relevant, not childish
- keep the current `Progression.state` snapshot for fast reads, but source writes from an event ledger

## Current Gaps To Fix First

- student and teacher views do not read progression state consistently
- most live XP is still awarded from Sage chat and goal capture
- extracted `xp_events` are generated but not consumed
- there is no idempotent progression event ledger

## Milestones

| # | Milestone | Timeline | Success Criteria |
|---|-----------|----------|------------------|
| 1 | Contract Hardening | 2 days | student and teacher views resolve progression through the same parser/service |
| 2 | Behavior XP Ledger | 5 days | existing routes award idempotent progression events for real actions |
| 3 | Weekly Missions | 4 days | students see and complete a weekly mission board tied to live product behavior |
| 4 | Kudos And Rewards | 4 days | teachers can issue kudos and students can unlock practical perks |

## Prisma Migration Plan

### Migration 1: Progression Event Ledger

Keep the existing `Progression` model and add a write-side ledger.

- add `ProgressionEvent`
- fields:
  - `id`
  - `studentId`
  - `eventType`
  - `sourceType`
  - `sourceId`
  - `xp`
  - `metadata`
  - `occurredAt`
  - `createdAt`
- constraints:
  - unique on `[studentId, eventType, sourceType, sourceId]`
- indexes:
  - `[studentId, occurredAt]`
  - `[eventType, occurredAt]`

### Migration 2: Weekly Missions

- add `MissionTemplate`
- fields:
  - `id`
  - `key`
  - `title`
  - `description`
  - `goalType`
  - `targetCount`
  - `xp`
  - `active`
  - `sortOrder`
- add `StudentMission`
- fields:
  - `id`
  - `studentId`
  - `templateId`
  - `weekStart`
  - `status`
  - `progressCount`
  - `completedAt`
  - `rewardKey`
  - `createdAt`
  - `updatedAt`
- constraints:
  - unique on `[studentId, templateId, weekStart]`

### Migration 3: Kudos And Reward Unlocks

- add `TeacherKudos`
- fields:
  - `id`
  - `studentId`
  - `teacherId`
  - `kudosType`
  - `message`
  - `createdAt`
- add `RewardUnlock`
- fields:
  - `id`
  - `studentId`
  - `rewardKey`
  - `sourceType`
  - `sourceId`
  - `unlockedAt`
  - `consumedAt`
- constraints:
  - unique on `[studentId, rewardKey, sourceType, sourceId]`

## Service Layer Plan

Create a new progression service instead of letting routes mutate JSON state directly.

### New Files

- `src/lib/progression/service.ts`
- `src/lib/progression/contracts.ts`
- `src/lib/progression/missions.ts`
- `src/lib/progression/rewards.ts`

### Responsibilities

- `parseProgressionState()`
- `serializeProgressionState()`
- `awardProgressionEvent()`
- `rebuildProgressionSnapshot()`
- `generateWeeklyMissions()`
- `syncMissionProgressForEvent()`
- `unlockReward()`

## Exact Route Changes

### Progression Readers

- `src/app/api/progression/route.ts`
  - return canonical progression payload
  - later include `missions`, `rewardUnlocks`, and recent kudos
- `src/app/api/teacher/dashboard/route.ts`
  - stop reading `state.streaks.daily.current`
  - use canonical parser fields such as `currentStreak`
- `src/app/api/teacher/students/[id]/route.ts`
  - stop ad hoc JSON parsing
  - use canonical parser and expose recent progression events

### Existing Behavior Routes To Instrument

- `src/app/api/chat/send/route.ts`
  - award `chat_session`
  - award `goal_set` by level
  - consume extracted `xp_events`
- `src/app/api/orientation/route.ts`
  - award `orientation_item_completed` when an item changes from incomplete to complete
- `src/app/api/tasks/[id]/route.ts`
  - award `task_completed` when status changes to `completed`
- `src/app/api/applications/route.ts`
  - award `application_applied`
  - award `application_interviewing`
  - award `application_offer`
- `src/app/api/events/[id]/register/route.ts`
  - award `event_registered`
  - defer event attendance XP until attendance exists in the data model
- `src/app/api/portfolio/route.ts`
  - award `portfolio_item_created`
  - later add count-based milestones through the mission layer
- `src/app/api/certifications/route.ts`
  - award `cert_requirement_completed`
  - award `certification_completed`
- `src/app/api/credentials/share/route.ts`
  - award `credential_page_published` on first public publish

### New Routes

- `src/app/api/missions/route.ts`
  - list current week missions and progress
- `src/app/api/teacher/students/[id]/kudos/route.ts`
  - create kudos
  - list recent kudos for the student

## UI Change Plan

### Student

- `src/app/(student)/dashboard/page.tsx`
  - fetch mission and reward data with progression
- `src/app/(student)/dashboard/DashboardClient.tsx`
  - add weekly mission board above achievements
  - add practical reward unlocks section
  - keep XP and streaks, but shift copy away from chat-first language
- `src/components/ui/AchievementList.tsx`
  - update empty-state copy so it reflects real actions across modules

### Teacher

- `src/components/teacher/StudentDetail.tsx`
  - add kudos composer
  - add recent kudos list
  - add recent progression events or mission completion summary

## Suggested Event Catalog For Phase 1

| Event Type | XP | Source |
|-----------|----|--------|
| `chat_session` | 5 | Sage conversation |
| `bhag_set` | 40 | goal extraction |
| `monthly_set` | 35 | goal extraction |
| `weekly_set` | 30 | goal extraction |
| `daily_set` | 20 | goal extraction |
| `task_set` | 10 | goal extraction |
| `orientation_item_completed` | 15 | orientation |
| `task_completed` | 20 | student task |
| `application_applied` | 30 | application |
| `application_interviewing` | 50 | application |
| `application_offer` | 100 | application |
| `event_registered` | 20 | event registration |
| `portfolio_item_created` | 25 | portfolio |
| `cert_requirement_completed` | 30 | certification |
| `certification_completed` | 150 | certification |
| `credential_page_published` | 50 | credential sharing |

## Suggested Reward Catalog For Phase 3

- `priority_resume_review`
- `priority_mock_interview_slot`
- `portfolio_spotlight`
- `teacher_endorsement`
- `event_early_access`
- `streak_freeze`

## First 10 Tickets

### 1. Canonical progression contract

- effort: 4h
- depends on: none
- files:
  - `src/lib/progression/contracts.ts`
  - `src/app/api/teacher/dashboard/route.ts`
  - `src/app/api/teacher/students/[id]/route.ts`
- done when:
  - teacher and student readers use the same parsed shape
  - stale `streaks.daily.current` reads are removed

### 2. Add `ProgressionEvent` migration

- effort: 3h
- depends on: ticket 1
- files:
  - `prisma/schema.prisma`
  - `prisma/migrations/*`
- done when:
  - Prisma schema and migration exist
  - migration applies cleanly locally

### 3. Build progression event service

- effort: 6h
- depends on: ticket 2
- files:
  - `src/lib/progression/service.ts`
  - `src/lib/progression/engine.ts`
  - `src/lib/progression/engine.test.ts`
- done when:
  - routes can award events through one helper
  - duplicate source retries do not double-award XP

### 4. Wire Sage chat and goal extraction into the event service

- effort: 5h
- depends on: ticket 3
- files:
  - `src/app/api/chat/send/route.ts`
  - `src/lib/sage/goal-extractor.ts`
- done when:
  - `chat_session` and goal events are awarded through the new service
  - extracted `xp_events` are consumed

### 5. Wire orientation and task completion into progression

- effort: 4h
- depends on: ticket 3
- files:
  - `src/app/api/orientation/route.ts`
  - `src/app/api/tasks/[id]/route.ts`
- done when:
  - completion transitions award XP once
  - reopening a task or unchecking orientation does not create duplicate awards

### 6. Wire applications and event registration into progression

- effort: 5h
- depends on: ticket 3
- files:
  - `src/app/api/applications/route.ts`
  - `src/app/api/events/[id]/register/route.ts`
- done when:
  - applications award status-based XP on first transition
  - registrations award once per event

### 7. Wire portfolio, certifications, and credential publishing into progression

- effort: 6h
- depends on: ticket 3
- files:
  - `src/app/api/portfolio/route.ts`
  - `src/app/api/certifications/route.ts`
  - `src/app/api/credentials/share/route.ts`
- done when:
  - each route emits idempotent progression events
  - certification completion emits a high-value milestone event

### 8. Expand progression API payload and dashboard copy

- effort: 3h
- depends on: tickets 4-7
- files:
  - `src/app/api/progression/route.ts`
  - `src/app/(student)/dashboard/page.tsx`
  - `src/components/ui/AchievementList.tsx`
- done when:
  - dashboard payload is sourced from the canonical service
  - empty-state and helper copy are no longer chat-centric

### 9. Add mission models and generation service

- effort: 6h
- depends on: tickets 4-7
- files:
  - `prisma/schema.prisma`
  - `prisma/migrations/*`
  - `src/lib/progression/missions.ts`
- done when:
  - current week missions can be generated from existing app behaviors
  - missions are stored per student per week

### 10. Ship the weekly mission board

- effort: 6h
- depends on: ticket 9
- files:
  - `src/app/api/missions/route.ts`
  - `src/app/(student)/dashboard/DashboardClient.tsx`
  - `src/app/(student)/dashboard/page.tsx`
- done when:
  - students can see mission titles, progress, XP, and completion state
  - at least 5 mission types are active

## Next Queue After Ticket 10

- add `TeacherKudos` and `RewardUnlock`
- build teacher kudos route and UI
- add reward unlock notifications
- add smoke coverage for missions and kudos

## Dependency Map

```text
1 -> 2 -> 3 -> 4
            -> 5
            -> 6
            -> 7
4,5,6,7 -> 8
4,5,6,7 -> 9 -> 10
10 -> kudos and rewards
```

## Recommended Execution Order

1. harden the progression contract
2. land the event ledger and service
3. wire all existing behavior routes
4. update the dashboard copy and payload
5. add missions
6. add teacher kudos and practical rewards

## Recommended First Release Scope

Ship milestones 1 through 3 first. That gets VisionQuest to a materially better adult-learner gamification model without overbuilding recognition and perks before the base loops are trustworthy.
