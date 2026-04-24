-- Seed the six WV Adult Ed / SPOKES regional coordinator regions.
-- Reference: WV Adult Ed regional map (six coordinator regions grouping the
-- state's 55 counties). The map is the source of truth for region
-- assignments; this migration just materializes the region rows so
-- SpokesClass.regionId, RegionCoordinator, and GrantGoal can reference them.
--
-- IDs are static sentinel values (sys_region_*_v1) so:
--   - they're stable across environments
--   - RLS/analytics queries can rely on them
--   - they do not collide with cuid() values Prisma generates for new rows
--
-- Idempotent via ON CONFLICT (code).

INSERT INTO "visionquest"."Region"
  ("id", "name", "code", "description", "status", "createdAt", "updatedAt")
VALUES
  (
    'sys_region_northern_v1',
    'Northern Region',
    'NORTHERN',
    'Hancock, Brooke, Ohio, Marshall, Wetzel, Tyler, Pleasants, Doddridge, Ritchie.',
    'active',
    NOW(),
    NOW()
  ),
  (
    'sys_region_north_central_v1',
    'North Central Region',
    'NORTH_CENTRAL',
    'Monongalia, Marion, Preston, Taylor, Harrison, Barbour, Tucker, Lewis, Upshur, Randolph.',
    'active',
    NOW(),
    NOW()
  ),
  (
    'sys_region_eastern_panhandle_v1',
    'Eastern Panhandle Region',
    'EASTERN_PANHANDLE',
    'Morgan, Berkeley, Jefferson, Mineral, Hampshire, Hardy, Grant, Pendleton.',
    'active',
    NOW(),
    NOW()
  ),
  (
    'sys_region_mid_ohio_valley_v1',
    'Mid-Ohio Valley Region',
    'MID_OHIO_VALLEY',
    'Wood, Wirt, Gilmer, Calhoun, Roane, Jackson, Mason, Braxton.',
    'active',
    NOW(),
    NOW()
  ),
  (
    'sys_region_south_east_v1',
    'South East Region',
    'SOUTH_EAST',
    'Nicholas, Pocahontas, Webster, Fayette, Greenbrier, Raleigh, Wyoming, Summers, Mercer, Monroe, McDowell.',
    'active',
    NOW(),
    NOW()
  ),
  (
    'sys_region_south_west_v1',
    'South West Region',
    'SOUTH_WEST',
    'Cabell, Wayne, Lincoln, Boone, Logan, Mingo, Kanawha, Clay, Putnam.',
    'active',
    NOW(),
    NOW()
  )
ON CONFLICT ("code") DO NOTHING;
