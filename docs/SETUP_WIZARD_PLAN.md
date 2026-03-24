# Setup Wizard Plan

## Status

This document captures the planned instructor-facing setup wizard for Visionquest.
It is a planning artifact only. No product behavior in this document is implemented yet.

## Goal

Make class and program setup manageable for non-technical instructors without requiring them to configure Render, Supabase, secrets, migrations, or other deployment details.

## Product Direction

### Near-Term

Use a managed deployment model:

- platform admin provisions the environment
- instructor completes setup inside the app through a guided wizard

### Long-Term

Build the wizard on top of a reusable `Program` or `Workspace` abstraction so the same onboarding flow can later support:

- one deployment per class
- multiple classes in one deployment
- a commercial multi-tenant version of the app

## Why This Is Needed

The current product already has configuration surfaces for:

- orientation
- SPOKES setup
- LMS links
- certifications
- advising
- career tools

These exist as separate management areas and are too fragmented for a normal instructor to configure confidently on first use. Some setup still lives outside the app entirely in deployment and seed steps.

## What The Wizard Should Do

The wizard should guide an instructor through first-time setup in plain language and save progress between steps.

### Step 1: Program Basics

- class name
- instructor name
- site title
- optional logo and accent color
- confirmation that attendance is tracked externally

### Step 2: SPOKES Setup

- choose a default SPOKES template
- confirm orientation paperwork
- confirm program-file checklist
- confirm required SPOKES modules

### Step 3: Learning Providers

- enable or disable providers such as:
  - WV Tourism Works
  - Essential Education
  - Certiport
  - GMetrix
  - Schoology
- paste or confirm launch links where needed

### Step 4: Pathway Setup

- choose a default pathway for the class
- select required and optional provider sequences
- support common defaults such as:
  - WV Tourism Works -> Essential Education -> MOS core
  - Computer Essentials -> MOS Word -> MOS Excel -> MOS PowerPoint

### Step 5: Certifications

- choose which certification families are enabled
- set required vs optional tracks
- define milestone order and completion expectations

### Step 6: Students

- upload a CSV roster
- manually add students
- optionally send invitations or password reset guidance

### Step 7: Review And Launch

- preview the student experience
- confirm active pathways and providers
- publish the class configuration

## What The Wizard Should Not Ask Instructors To Do

- configure databases
- create buckets
- enter deployment secrets
- run migrations
- understand Prisma or hosting details

Those remain platform-admin responsibilities.

## Recommended Technical Shape

The wizard should not be built as one-off hardcoded UI. It should sit on top of reusable configuration models that support future growth.

### Suggested Data Models

- `ProgramSettings`
- `SetupProgress`
- `ProviderCatalog`
- `PathwayTemplate`
- `PathwayStep`
- `ProgramPathway`
- `RosterImport`

## Suggested UX Flow

- first teacher login checks whether setup is complete
- incomplete setup redirects to `/teacher/setup`
- each step saves draft progress
- instructors can leave and return later
- completion unlocks the normal management dashboard

## Implementation Phases

### Phase 1

Build a first-run setup wizard for the current single-program deployment.

### Phase 2

Introduce the reusable configuration models that back the wizard and support presets/templates.

### Phase 3

Extend the same structure to support multiple classes or true multi-tenant deployments.

## Recommendation

Do not build full commercial multi-tenancy first.

The most practical sequence is:

1. managed deployment plus in-app setup wizard
2. reusable `Program` configuration layer
3. multi-class and commercial tenant support

This keeps the immediate instructor experience simple while preserving a path toward a future sellable product.
