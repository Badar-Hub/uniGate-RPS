-- Phase 11b (goods vertical): the per-trip regulatory document reference (TGA Bayan for goods — OQ-29).
-- Captured by ops or the driver; whether dispatch is blocked without it is a setting the goods plugin reads.
ALTER TABLE trips ADD COLUMN regulatory_reference VARCHAR(64);
ALTER TABLE trips ADD COLUMN regulatory_reference_type VARCHAR(24);
ALTER TABLE trips ADD CONSTRAINT ck_trips_regulatory_reference CHECK (
  (regulatory_reference IS NULL AND regulatory_reference_type IS NULL) OR (regulatory_reference IS NOT NULL AND regulatory_reference_type IS NOT NULL)
);
