-- The vehicle form asks for the owner's ID instead of the istimara number, and for the vehicle's
-- overall length (2026-09-27).
--
-- The owner ID is a Saudi national ID / iqama (10 digits, starting 1 or 2) — personal data, so it
-- is stored encrypted exactly like owner_profiles.national_id_encrypted and only its last four
-- digits are ever returned by the API. registration_number becomes nullable rather than dropped:
-- vehicles registered before this change keep their istimara number.

ALTER TABLE vehicles
  ADD COLUMN owner_id_encrypted TEXT,
  ADD COLUMN owner_id_last4 CHAR(4),
  ADD COLUMN vehicle_length_cm INTEGER;

ALTER TABLE vehicles ALTER COLUMN registration_number DROP NOT NULL;

ALTER TABLE vehicles
  ADD CONSTRAINT ck_vehicles_vehicle_length_cm CHECK (vehicle_length_cm IS NULL OR (vehicle_length_cm > 0 AND vehicle_length_cm <= 3000));
