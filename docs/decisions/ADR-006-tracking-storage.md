# ADR-006 — Three-tier location storage with sampled durable history

**Status:** Accepted
**Date:** 2026-09-14

## Context

Engagement brief §15 requires real-time tracking, provider independence, and specifically: *"Avoid writing every GPS coordinate permanently into the primary transactional tables."*

Location data has an awkward profile: very high write rate, very low individual value, high *aggregate* value (dispute evidence, distance verification, utilisation reporting), and a hard real-time delivery requirement.

At the assumed volume (A-15, OQ-15) — 200 concurrently tracked trips pinging every 10 seconds — naive persistence is ~20 writes/second growing without bound, in the same tables serving bookings and payments.

## Decision

**Three storage tiers, each matched to one access pattern, with durable history written at a sampled rate.**

| Tier | Written | Read by | Storage |
|---|---|---|---|
| Redis `loc:{vehicleId}` | **every** ping | Socket.IO fan-out | Redis, 60 s TTL |
| `current_vehicle_locations` | **every** ping (UPSERT) | "where is it now" queries, admin fleet map | PostgreSQL — exactly one row per vehicle, bounded forever |
| `vehicle_location_points` | **sampled** | replay, disputes, distance verification | PostgreSQL, monthly RANGE partitions |

**Sampling rule** — persist a durable point only when, since the last persisted point:
- ≥ 30 seconds elapsed, **or**
- ≥ 50 metres moved, **or**
- heading changed by > 30°

## Rationale

### Why three tiers rather than one

Each tier answers a different question, and a single store optimised for one answers the others badly:

- *"Where is this vehicle right now?"* — needs microsecond reads and no durability at all. Redis.
- *"Where is every vehicle in the fleet?"* — needs a bounded, queryable, joinable set. One row per vehicle in PostgreSQL: ~2,000 rows at the assumed fleet size, permanently hot in cache.
- *"Where did this vehicle go last Tuesday?"* — needs durable, ordered history, read rarely. A partitioned append-only table.

### Why sampling, and why those thresholds

A vehicle parked at a loading dock for two hours emits 720 pings, all at the same coordinate. Persisting them is pure cost with zero information gain. Conversely, a vehicle rounding a junction changes heading sharply — and dropping that point is what turns a route replay into a line through a building.

The three conditions are OR'd deliberately: **time** guarantees a heartbeat even when stationary (proving the vehicle *was* there, which matters in a demurrage dispute), **distance** captures movement, **heading** captures the geometry that makes a replayed route look like the road rather than a polygon.

Effect at assumed volume: ~20 writes/s of live state against a bounded table, and roughly 6–7 appends/s of durable history. Well within a single PostgreSQL instance.

### Why partition rather than delete

`vehicle_location_points` is RANGE-partitioned monthly on `recorded_at`. Retention (12 months, A-12, pending OQ-08) is then `DETACH PARTITION` followed by an archive — a metadata operation.

The alternative, `DELETE FROM ... WHERE recorded_at < ...` over tens of millions of rows, is a long-running transaction generating enormous WAL, bloating the table, and requiring a `VACUUM` that competes with production traffic. Partitioning turns a recurring operational incident into a scheduled no-op.

Partitioning requires the partition key in the primary key, hence `PRIMARY KEY (id, recorded_at)`.

### Provider independence

Three ingestion sources — driver mobile app, GPS hardware, external tracking API — all normalise to one `LocationUpdate` before entering the pipeline. Everything downstream is provider-agnostic. Since the GPS vendor is unselected (**OQ-11**), only the driver-app path is implemented at launch; a telematics adapter slots in behind the same interface without touching storage, fan-out or authorization.

### Authorization is not optional here

Location is the most privacy-sensitive data in the platform. A tracking link that works after a trip ends is a stalking vector, not a feature.

- Socket room joins are authorized **server-side**, at join time, against the same policy functions the REST API uses.
- A customer may join `trip:{id}` only while they are that booking's customer **and** the trip is in an active state.
- Fan-out stops the moment the trip completes.
- The socket layer never makes an authorization decision and never broadcasts a payload the recipient could not have fetched over REST. It is a delivery channel, nothing more.

## Consequences

**Positive:** transactional tables are protected from location write volume; live reads are sub-millisecond; retention is operationally trivial; provider-independent; history is dense enough for disputes and sparse enough to be cheap.

**Negative:**
- Three tiers mean three places where "the location" lives; the reconciliation rule (Redis is authoritative for *live*, PostgreSQL for *durable*) must be documented and understood.
- Sampling loses fidelity by design. If exact second-by-second telemetry is ever required — e.g. for an insurance product — the thresholds are configurable, but the trade-off must be re-made deliberately.
- Redis becomes a dependency of the live-tracking feature. Degradation is graceful: tracking falls back to `current_vehicle_locations` at reduced freshness rather than failing.
- Partition creation must be automated; a missing future partition causes insert failures. A scheduled job pre-creates partitions three months ahead, and its failure is alerted.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Persist every ping to one unpartitioned table | Exactly what brief §15 forbids; unbounded growth; contention with transactional tables; painful retention |
| Redis only, no durable history | No dispute evidence, no distance verification, no utilisation reporting |
| TimescaleDB from day one | The right answer at 10× the assumed volume; adds an extension dependency and operational surface not justified yet. Documented escalation path for risk AR-5 |
| A dedicated time-series store (InfluxDB, ClickHouse) | A second database to operate, back up and secure, for a volume PostgreSQL handles comfortably |
| Client-side batching only, no sampling | Reduces request count but not stored volume; the two are complementary — batching *is* used on the wire, sampling governs storage |
