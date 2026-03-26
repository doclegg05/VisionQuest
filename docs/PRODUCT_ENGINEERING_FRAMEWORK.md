# Product Engineering Framework

A 5-step process for building products that work. Each step must be completed in order. Do not skip ahead.

---

## Step 1: Question Every Requirement

Before building anything, challenge every requirement. The most common source of waste is building the wrong thing well.

### Rules

- Every requirement must have one named owner who can defend it with a user problem and a measurable outcome.
- If a requirement needs a long explanation to justify its existence, it is probably wrong.
- Requirements without an owner are rejected.
- Planning artifacts are not approved scope until referenced by the product charter and assigned to an owner.
- Metrics that do not trigger a decision should not be collected.

### Test Each Requirement

Ask these questions:

1. Who specifically needs this?
2. What user problem does it solve?
3. How will we know it worked?
4. What happens if we don't build it?

If the answers are vague, the requirement is not ready.

---

## Step 2: Delete

Subtract first. If you are not occasionally having to add back something you cut, you are not deleting enough. Target: add back roughly 10% of what you remove.

### Cut Rule

Cut by default if any item:

- Duplicates another workflow
- Is motivational but not tied to a real user action
- Exists mainly because it sounded useful
- Creates setup burden without clear payoff
- Adds reporting without changing a decision
- Needs a long explanation to justify its existence

### What To Delete

- Features that duplicate another feature's job
- Surfaces that make users choose between pages answering the same question
- Metrics that do not change a decision
- Planning artifacts behaving like approved scope
- Generic utilities when contextual actions already exist
- Support mechanics (gamification, badges, streaks) before the core loop works

### Deliberate Add-Back

After cutting, review what you removed. Add back only:

- Items where the cut created a real gap in the core workflow
- Utilities needed as supporting infrastructure (not primary destinations)
- Data integrity work that supports reliable measurement

### Decision Standard

If a cut feels uncomfortable but no owner can defend the item with a user problem and a metric, the discomfort is not a reason to keep it.

---

## Step 3: Simplify

Refine what survived the cuts. Do not polish deleted scope. Do not preserve multiple medium-good workflows when one clear workflow would do.

### Simplification Principle

Every product should answer a small number of clear questions. If a user has to think about which page answers their question, the product is too complex.

### Rules

- One job gets one primary surface
- Dashboards may summarize but do not become second editors
- Navigation should be as short as possible
- Every page should answer one job clearly without long orientation text
- Users should not choose between overlapping destinations

### What To Simplify

- Merge surfaces that answer the same user question
- Reduce navigation count to the minimum
- Remove duplicate planning/editing sections across pages
- Compress settings to only what matters

### Acceptance Standard

Simplification succeeds only if:

- Navigation becomes shorter
- Page purpose becomes more obvious
- The same task appears in fewer places
- Users need fewer clicks to accomplish their core job

---

## Step 4: Accelerate

Speed up the surviving workflows. Do not accelerate deleted scope, duplicate surfaces, or processes whose exception path is unclear.

### What Cycle Time Means

Cycle time is elapsed time from a real trigger to a verified next state. If a workflow cannot name its trigger and finish state, it is not ready for acceleration.

### Compression Rules

Every accelerated workflow should follow these rules:

1. One trigger
2. One owner
3. One primary place to act
4. One visible next state
5. One exception path

If a workflow needs multiple dashboards, duplicate edits, or a training memo to explain it, it is not ready to be sped up.

### What To Accelerate

- Reduce the number of screens needed to complete a core action
- Make the current state visible from the primary surface
- Keep the action close to the information
- Expose exceptions immediately instead of burying them in reports

### What Not To Accelerate

- Generating more AI drafts before the human workflow is stable
- Collecting extra data that does not change the next action
- Support flows before core flows are fast

### Kill Rule

If acceleration makes the workflow faster but less trustworthy, the effort failed.

---

## Step 5: Automate

Automate only processes that are stable, repeated, and low-judgment. This step comes last because automating a broken process just produces broken results faster.

### Automation Readiness Test

A workflow is ready for automation only if ALL of these are true:

1. It has one accountable owner
2. It has one source of truth
3. The manual version already works
4. The exception path is known
5. Failure is reversible
6. Automation reduces correction time, not just clicks

If any condition is false, keep the process manual.

### Safe Automation Targets (in order)

**Stage 1 — Mechanical automation:**
- Reminders and notifications
- Document routing and record attachment
- Generated files from saved data
- Periodic rollups from trusted data

**Stage 2 — Detection automation:**
- Queue generation and prioritization
- Stall/inactivity detection
- Missing requirement/evidence flags

**Stage 3 — Assistive AI:**
- Draft suggestions
- Status summaries
- Recommended next actions

Stage 3 ships only after Stages 1 and 2 are trustworthy.

### What AI May Assist With

- Drafting language from confirmed facts
- Suggesting matches from a human-owned catalog
- Summarizing status for review
- Proposing next-step language

### What AI May Not Finalize

- User goals or commitments
- Final assignments or pathway decisions
- Archive or removal decisions
- Outcome claims used for reporting

Human confirmation remains mandatory for those.

### Approval Standard

No automation ships without:

- Baseline manual workflow documented
- Owner named
- Trigger and finish state defined
- Failure mode documented
- Rollback path documented
- Measurement plan defined

### Kill Rule

If the automation increases hidden errors, correction time, or user distrust, turn it off.

---

## Applying The Framework

Run the steps in order on any new project or feature:

1. **Question** — Is each requirement real, owned, and measurable?
2. **Delete** — Remove everything that doesn't directly serve the core loop. Add back ~10%.
3. **Simplify** — Merge duplicates, shorten navigation, one surface per job.
4. **Accelerate** — Speed up what survived. One trigger, one owner, one action.
5. **Automate** — Only stable, repeated, low-judgment processes. Manual first.

The most common mistake is jumping to Step 5. The most valuable step is usually Step 2.
