-- UniGate's goods fleet vocabulary (2026-09-27): the two truck sizes are Dyna and Lorry, each with a
-- refrigerated variant, and the pickup tier is retired.
--
-- The two renames happen in place so vehicles, bookings and frozen snapshots keep pointing at the
-- same row. PICKUP is deactivated, never deleted, for the same reason: it disappears from the
-- catalogue while historical rows that reference it stay readable. The seed (prisma/seed/reference.ts)
-- inserts the two refrigerated variants and reasserts this state.

UPDATE vehicle_categories
SET code = 'DYNA', name_en = 'Dyna', name_ar = 'دينا', sort_order = 120
WHERE code = 'LIGHT_TRUCK';

UPDATE vehicle_categories
SET code = 'LORRY', name_en = 'Lorry', name_ar = 'لوري', sort_order = 130
WHERE code = 'HEAVY_TRUCK';

UPDATE vehicle_categories SET is_active = false WHERE code = 'PICKUP';

-- Model body hints are labels, not foreign keys; keep them in step with the renamed categories.
UPDATE vehicle_models SET body_type = 'DYNA' WHERE body_type = 'LIGHT_TRUCK';
UPDATE vehicle_models SET body_type = 'LORRY' WHERE body_type = 'HEAVY_TRUCK';
