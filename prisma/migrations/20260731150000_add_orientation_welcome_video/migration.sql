-- Add the required, one-time Sage welcome-video milestone without changing
-- existing orientation item ids or their historical progress rows.
INSERT INTO "visionquest"."OrientationItem" (
  "id", "label", "description", "section", "sortOrder", "required", "createdAt"
)
VALUES (
  'seed-orient-24',
  'Watch the VisionQuest welcome video',
  'Watch Sage''s welcome to VisionQuest, then earn a one-time XP reward for completing the introduction.',
  'Get Started with VisionQuest',
  24,
  true,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE SET
  "label" = EXCLUDED."label",
  "description" = EXCLUDED."description",
  "section" = EXCLUDED."section",
  "sortOrder" = EXCLUDED."sortOrder",
  "required" = EXCLUDED."required";
