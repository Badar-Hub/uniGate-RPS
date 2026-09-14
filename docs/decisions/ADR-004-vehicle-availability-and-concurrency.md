# ADR-004 — A unified vehicle calendar with a GiST exclusion constraint

**Status:** Accepted
**Date:** 2026-09-14

> This is the most important technical decision in the platform. If exactly one thing in this design must be right, it is this.

## Context

Engagement brief §45: *"The same vehicle must not accidentally be booked for conflicting periods. Design a proper vehicle availability strategy. Do not rely only on frontend validation."*

A vehicle becomes unavailable for three unrelated reasons:

1. It is reserved for a confirmed booking.
2. It is in the workshop (brief §21: "vehicle availability should be affected when the vehicle is under maintenance").
3. The owner has blocked it out (personal use, driver leave).

And the contention is real: multiple customers can be comparing bids that offer the same vehicle for overlapping windows, and each can click *Accept* at the same moment.

## The rejected approach

The design that looks obvious and fails:

```
vehicles.status = 'AVAILABLE' | 'RESERVED' | 'ON_TRIP' | 'UNDER_MAINTENANCE'
```

Two fatal problems:

- **A status column cannot answer the actual question.** "Is this vehicle available?" is meaningless without a time window. A vehicle idle today may be booked next Tuesday. A single column can only describe *now*, so it cannot support forward booking at all — which is the platform's entire purpose.
- **It conflates independent facts.** A vehicle can be approved, active *and* on a trip simultaneously. One column forces information loss on every transition.

The next approach — a `vehicle_reservations` table with a `SELECT ... WHERE period && ... ; INSERT` check — fails differently. Between the `SELECT` and the `INSERT`, another transaction can insert a conflicting row. Under `READ COMMITTED` that is a textbook write-skew, and it produces exactly the double-booking the brief forbids. It will pass every manual test and fail in production under load.

## Decision

**One table, `vehicle_calendar_entries`, holding all three kinds of occupancy, protected by a PostgreSQL exclusion constraint.**

```sql
CREATE TABLE vehicle_calendar_entries (
  id                    uuid PRIMARY KEY,
  vehicle_id            uuid NOT NULL REFERENCES vehicles(id),
  entry_type            calendar_entry_type NOT NULL,  -- RESERVATION | MAINTENANCE | OWNER_BLOCK
  period                tstzrange NOT NULL,            -- occupied window, [inclusive, exclusive)
  booking_id            uuid REFERENCES bookings(id),
  maintenance_record_id uuid REFERENCES maintenance_records(id),
  status                calendar_entry_status NOT NULL, -- HELD | CONFIRMED | RELEASED
  ...
);

ALTER TABLE vehicle_calendar_entries
  ADD CONSTRAINT ex_vehicle_calendar_no_overlap
  EXCLUDE USING gist (vehicle_id WITH =, period WITH &&)
  WHERE (status <> 'RELEASED');
```

Vehicle status is separately decomposed into three orthogonal columns — `approval_status`, `lifecycle_status`, `operational_status` — none of which is availability.

## Rationale

### The constraint is the guarantee

`EXCLUDE USING gist` instructs PostgreSQL to reject any row whose `vehicle_id` equals an existing row's **and** whose `period` overlaps it. This is enforced at write time, inside the transaction, by the database — with the same rigour as a unique constraint. There is no window in which two conflicting rows can exist.

Two concurrent bid acceptances for the same vehicle: one commits; the other receives SQLSTATE `23P01` (`exclusion_violation`), which the service maps to `409 BID_VEHICLE_UNAVAILABLE`. No lost update, no manual locking protocol, no reconciliation job.

### Why one table for all three reasons

If reservations, maintenance and owner blocks lived in three tables, preventing overlap would require three pairwise checks in application code — nine ordered comparisons, every one of which must be remembered on every write path. That code would eventually be wrong.

With one table, **the constraint covers all combinations automatically.** Booking a vehicle that is in the workshop fails for the same structural reason as booking one that is already hired. Brief §21's "maintenance should affect availability" stops being a rule someone must implement and becomes a property of the schema.

### Turnaround buffer

The stored `period` is the customer-facing window plus a configurable buffer at each end (`booking.turnaround_buffer_minutes`, default 60 — assumption A-07), so a vehicle is not booked to finish in Jeddah at 14:00 and start in Riyadh at 14:05. The commercial window and the occupancy window are stored separately: `bookings.scheduled_start_at`/`scheduled_end_at` versus `vehicle_calendar_entries.period`.

### Lock ordering

Bid acceptance touches three rows under lock. They are always acquired in the order **trip_request → bid → vehicle**, globally. A consistent global ordering makes deadlock structurally impossible rather than merely unlikely.

### `RELEASED` entries are retained

Cancelling a booking sets `status = 'RELEASED'` rather than deleting the row. The `WHERE` clause removes it from the constraint while preserving the record that the vehicle *was* reserved — which matters in a cancellation dispute.

## Consequences

**Positive:** double-booking is impossible, not unlikely. Maintenance integrates for free. The conflict path is a specific, testable error rather than silent corruption. Availability queries over any time window are a single range query against a GiST index.

**Negative:**
- Requires the `btree_gist` extension.
- **Prisma cannot express this constraint** — it lives in a hand-written SQL migration and is invisible in `schema.prisma`. This is risk AR-1, mitigated by a migration-integrity test that asserts the constraint exists after a clean `migrate deploy`. A developer who loses it must fail CI, not production.
- Open-ended trips need an estimated end; over-running trips require extending the entry, which can itself conflict and must be surfaced to operations.
- `23P01` must be handled explicitly wherever calendar entries are written; a generic 500 handler would turn a meaningful conflict into an opaque error.

## Testing requirement

Phase 5 and Phase 7 cannot close without a test that runs **against real PostgreSQL** (Testcontainers) and fires N concurrent acceptances at the same vehicle and overlapping window, asserting: exactly one `201`, the remainder `409 BID_VEHICLE_UNAVAILABLE`, exactly one calendar entry, and no orphaned booking.

A mocked database cannot test a database constraint. This test is the proof that the invariant holds.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Status column on `vehicles` | Cannot express time windows; conflates independent facts; makes forward booking impossible |
| `SELECT` overlap check then `INSERT` | Write skew under `READ COMMITTED`; passes tests, fails under concurrency |
| `SERIALIZABLE` isolation | Correct, but pushes serialization failures and retry logic into every transaction and costs throughput across the whole application to solve one table's problem |
| PostgreSQL advisory locks keyed on vehicle id | Workable, but the lock is a convention that every future write path must remember. The constraint cannot be forgotten |
| Redis distributed lock | Correctness would depend on a second system's availability and clock behaviour, for a guarantee PostgreSQL provides natively and transactionally |
| Separate tables per occupancy reason | Requires pairwise application-level overlap checks; brittle and certain to drift |
