# VisionQuest Automation Review

Status: Active automation pass  
Date: March 24, 2026  
Purpose: Automate only the streamlined VisionQuest workflows that are stable, repeated, and low-judgment.

This document applies only after [PRODUCT_CHARTER.md](./PRODUCT_CHARTER.md), [PRODUCT_SUBTRACTION_REVIEW.md](./PRODUCT_SUBTRACTION_REVIEW.md), [PRODUCT_SIMPLIFICATION_REVIEW.md](./PRODUCT_SIMPLIFICATION_REVIEW.md), and [PRODUCT_ACCELERATION_REVIEW.md](./PRODUCT_ACCELERATION_REVIEW.md).

## Rule

Automate an already optimized process.

Do not automate:

- unstable workflows
- duplicate workflows
- decisions that still depend on human judgment
- manual steps that exist because product ownership is unclear

If a human still has to constantly correct the automation, the process is not ready.

## Automation Readiness Test

A workflow is ready only if all of these are true:

1. It has one accountable owner.
2. It has one source of truth.
3. The manual version already works.
4. The exception path is known.
5. Failure is reversible.
6. Automation reduces correction time, not just clicks.

If any condition is false, keep the process manual for now.

## Safe Automation Targets

### 1. Reminder Automation

Good fit because:

- reminders are repetitive
- the trigger conditions can be made explicit
- a failure is visible and reversible

Good candidates:

- goal review due reminders
- appointment reminders
- orientation follow-up reminders
- overdue requirement reminders

Guardrail:

- reminders should point to one owning workflow, not a generic dashboard maze

Owner:

- Advising Owner for review reminders
- Operations Owner for orientation and requirement reminders

### 2. Queue Generation And Prioritization

Good fit because:

- detection rules can be explicit
- teachers still make the final intervention decision

Good candidates:

- stale goal flags
- missing evidence flags
- overdue requirement flags
- class inactivity review states

Guardrail:

- the system may surface the student and reason
- the teacher still decides the actual intervention

Owner:

- Advising Owner

### 3. Document Routing And Record Attachment

Good fit because:

- document matching is mechanical once the source map is correct
- it prevents repetitive staff hunting

Good candidates:

- opening the right PDF from an orientation step
- attaching uploads to the correct requirement or step
- generating the current resume PDF from saved resume data for an application

Guardrail:

- the automation must always leave the underlying record visible and editable

Owner:

- Operations Owner

### 4. Monthly KPI Rollups

Good fit because:

- rollups are repetitive
- the main judgment happens after the numbers are assembled

Good candidates:

- class-level completion summaries
- intervention queue counts
- goal review freshness summaries

Guardrail:

- do not automate narrative interpretation before the metric definitions are trusted

Owner:

- Product Sponsor

## Limited AI Assistance That Is Acceptable

AI may assist with:

- drafting resume language from confirmed student facts
- suggesting pathway matches from a human-owned catalog
- summarizing student status for staff review
- proposing next-step language for tasks or interventions

AI may not finalize:

- a student goal
- a final pathway assignment
- an archive decision
- an outcome claim used for reporting

Human confirmation remains mandatory for those.

## Do Not Automate Yet

### 1. Final Goal Creation Or Confirmation

Why not:

- this is still a judgment-heavy counseling step
- bad automation here poisons everything downstream

Owner:

- Advising Owner

### 2. Final Pathway Assignment

Why not:

- a suggested match is useful
- an unreviewed final assignment is not

Owner:

- Curriculum Owner

### 3. Student Archiving

Why not:

- inactivity does not always mean disengagement or exit
- automatic archiving can hide students who still need intervention

Owner:

- Operations Owner

### 4. Gamification Expansion

Why not:

- the system still needs trustworthy core-loop data first
- automation would amplify a weak hypothesis

Owner:

- Product Sponsor

### 5. Full Instructor Setup Automation

Why not:

- this remains future platform scope, not current program value

Owner:

- Product Sponsor

## Automation Sequence

### Stage 1: Mechanical Automation

- reminders
- document routing
- generated application resume files
- monthly rollups from trusted data

### Stage 2: Detection Automation

- queue generation
- stall detection
- missing proof detection

### Stage 3: Assistive AI

- draft suggestions
- summaries
- recommended next actions

Stage 3 ships only after Stage 1 and Stage 2 are trustworthy.

## Approval Standard For New Automation

No automation ships without:

- baseline manual workflow documented
- owner named
- trigger and finish state defined
- failure mode documented
- rollback path documented
- measurement plan defined

## Kill Rule

If the automation increases hidden errors, correction time, or staff distrust, turn it off.
