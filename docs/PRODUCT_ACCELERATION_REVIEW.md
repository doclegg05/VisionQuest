# VisionQuest Acceleration Review

Status: Active cycle-time pass  
Date: March 24, 2026  
Purpose: Speed up the surviving VisionQuest workflows without re-expanding scope or automating weak judgment.

This document applies only after [PRODUCT_CHARTER.md](./PRODUCT_CHARTER.md), [PRODUCT_SUBTRACTION_REVIEW.md](./PRODUCT_SUBTRACTION_REVIEW.md), and [PRODUCT_SIMPLIFICATION_REVIEW.md](./PRODUCT_SIMPLIFICATION_REVIEW.md).

## Rule

Accelerate only the workflows that still deserve to exist.

Do not accelerate:

- deleted scope
- duplicate surfaces
- vague reporting loops
- AI-first behavior that still needs human correction
- any process whose exception path is still unclear

## What Cycle Time Means Here

Cycle time is the elapsed time from a real trigger to a verified next state.

Examples:

- student confirms a goal -> approved pathway is visible
- student finishes a requirement -> proof is attached or verified
- a stall condition appears -> teacher assigns the next action
- orientation session starts -> required record is captured

If a workflow cannot name its trigger and finish state, it is not ready for acceleration.

## Accelerate These Core Loops

### 1. Goal Review Loop

Trigger:

- a goal becomes stale, unclear, or unreviewed

Finish state:

- the student has one current long-term goal, one active short-term goal, and a fresh review date

Why this deserves speed:

- this is the front door of the product
- every downstream recommendation depends on it

What to speed up:

- reduce the number of screens needed to confirm or review a goal
- make the current review state visible from the student home surface
- let instructors restate or correct goals without hunting through multiple pages

What not to speed up:

- generating more AI goal drafts
- collecting extra reflection prompts that do not change the goal state

Owner:

- Advising Owner

Target:

- a goal review should happen in one sitting and take under 5 minutes for a typical student

### 2. Goal-To-Pathway Assignment Loop

Trigger:

- a student has a confirmed goal that counts toward planning

Finish state:

- the student sees an approved course or certification pathway, or the goal is explicitly flagged as unmatched

Why this deserves speed:

- this is where VisionQuest becomes useful instead of inspirational

What to speed up:

- show the recommended pathway directly from the confirmed goal state
- keep instructor override to one clear action
- expose unmatched goals immediately instead of burying them in reports

What not to speed up:

- automatic final pathway assignment without a human owner

Owner:

- Curriculum Owner

Target:

- common goals should be matched the same day they are confirmed
- unmatched goals should be visible to staff within 1 business day

### 3. Orientation Completion Loop

Trigger:

- a student starts orientation or returns to an incomplete packet

Finish state:

- required orientation items are opened, recorded, and any needed uploads or signoffs are attached

Why this deserves speed:

- this is a weekly staff workflow
- slow orientation burns instructor time immediately

What to speed up:

- preserve one ordered checklist
- make each step open the right document or action directly
- keep the completion action next to the record artifact

What not to speed up:

- a parallel generic resource or file workflow
- extra confirmations after the record is already captured

Owner:

- Operations Owner

Target:

- a standard orientation session should be completable in one sitting without staff hunting across tabs

### 4. Evidence Capture Loop

Trigger:

- a student completes assigned learning, certification work, or portfolio-ready work

Finish state:

- proof is attached, visible in context, and ready for teacher verification when needed

Why this deserves speed:

- progress without proof is invisible
- staff follow-up gets slower when evidence lives in random places

What to speed up:

- keep uploads contextual
- reduce duplicate file entry
- show proof status from the owning workflow

What not to speed up:

- a generic student file bucket
- manual re-entry of the same completion state in multiple places

Owner:

- Operations Owner

Target:

- attaching routine proof should take under 2 minutes
- teacher verification should happen from one queue, not by opening multiple student pages

### 5. Intervention Loop

Trigger:

- the system detects a stalled student, overdue requirement, missing evidence, or stale goal

Finish state:

- the teacher sees the student in one queue, understands the blockage, and assigns one next action

Why this deserves speed:

- teacher time is the real constraint in the product

What to speed up:

- prioritize the queue by actionability, not by data volume
- make the reason for the alert obvious
- keep the intervention action close to the alert

What not to speed up:

- dumping more metrics into dashboards
- sending teachers into a full student record for every small action

Owner:

- Advising Owner

Target:

- a teacher should identify the top students needing intervention in under 5 minutes

## Compression Rules

Every accelerated workflow should follow these rules:

1. One trigger.
2. One owner.
3. One primary place to act.
4. One visible next state.
5. One exception path.

If a workflow needs multiple dashboards, duplicate edits, or a training memo to explain it, it is not ready to be sped up.

## What To Delay

Do not spend this pass on:

- speeding up gamification experiments
- speeding up setup wizard or platform configuration work
- accelerating a student-facing SPOKES rebuild
- optimizing broad KPI reporting before the intervention queue exists
- faster document libraries that do not sit in the owning workflow

## Metrics For This Pass

These are the only cycle-time metrics that matter for now:

1. Median time from confirmed goal to approved pathway.
2. Median time from completed work to proof attached.
3. Median time from detected stall to teacher-assigned next action.
4. Percent of orientation packets completed in one session.
5. Teacher time to identify the top students needing attention.

If a speed metric does not change a product or staffing decision, drop it.

## Immediate Acceleration Order

1. Build or tighten one teacher intervention queue.
2. Reduce goal review to the minimum number of student and teacher actions.
3. Keep pathway assignment visible from the goal state.
4. Tighten orientation and evidence capture around the owning checklist or task.
5. Only then optimize lower-value support flows.

## Kill Rule

If an acceleration effort makes the workflow faster but less trustworthy, the effort failed.
