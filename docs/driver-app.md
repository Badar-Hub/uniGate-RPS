# The driver app — installable live-tracking agent

**Status:** delivered in Phase 10 (2026-09-15) as a Progressive Web App served from the same Next.js app at `/{locale}/driver`. Installable on Android and iOS from the browser ("Add to Home screen"); no store listing needed for the MVP.

## What it does

| Capability | How |
|---|---|
| Sign-in | The same accounts and OTP/password flow as the portal. A driver-only account lands on the driver app after login. |
| My trips | `GET /trips` scoped to the signed-in driver, active first. |
| Trip execution | One screen per trip: the status buttons are exactly `allowedNextStatuses` from the API (the vertical's own transition map), with the odometer prompt where the step needs it and coordinates captured at every transition (`POST /trips/{id}/status`). |
| **Live vehicle tracking** | `lib/driver/tracker.ts` — the agent. Starts automatically once the trip is in a tracked state (from `DRIVER_EN_ROUTE`), watches the device GPS at high accuracy, throttles to one sample every 5 s (the API allows 30/min per trip), posts each to `POST /tracking/ping`, and shows sent / queued counts, the last fix and its accuracy. |
| Offline | Samples that cannot be delivered (no network, API down) are queued in `localStorage` (up to 200) and flushed in recorded order through `POST /tracking/ping/batch` when the connection returns; per-item results mean one stale sample never blocks the rest. A service worker (`/driver-sw.js`, scope `/{locale}/driver/`) serves the app shell and an offline page; API calls are never cached. |
| Screen wake lock | The Screen Wake Lock API keeps the screen (and therefore the GPS watch) alive while the phone sits on the dashboard; re-acquired when the page returns to the foreground. |
| Customer side | `/{locale}/track/{tripId}` — Leaflet map with pickup, destination, the moving vehicle and its trail; joins the `trip:{id}` Socket.IO room for `trip.location` events with a 15-s polling fallback; ETA from the maps provider; the driver's phone only while the trip is active. |

## Honest limits of a web agent — and the native path

Mobile browsers stop delivering GPS fixes when the page is in the background or the screen is locked (always on iOS; on Android after a short grace period). The wake lock covers the common case — phone mounted, screen on — but it is not background tracking.

When background tracking becomes a requirement, the recommended path is a **thin native wrapper around this same app** (Capacitor or a small React Native shell) that adds a foreground-service / background-location plugin and posts to the **same** `POST /tracking/ping` and `/ping/batch` endpoints with the same Bearer session. Nothing in the API or the tracking pipeline changes; the agent's throttle, queue and batch flush move into the native plugin's callback. Estimated effort: 1–2 weeks incl. store submission, once UniGate decides on the stores.

A dedicated GPS device per vehicle (`gps_devices`, `LocationSource = GPS_DEVICE`) is the other route to always-on tracking; the ingestion path is the same endpoint with a device credential, and lands with the fleet-telematics integration.

## Installing on a phone (development)

1. Serve the web app over a URL the phone can reach (`NEXT_PUBLIC_API_URL` must point to the API from the phone's network; HTTPS is required for GPS and the service worker on anything but `localhost`).
2. Open `/ar/driver` (or `/en/driver`), sign in with a driver account, then use the browser's "Add to Home screen". The manifest is `/driver.webmanifest` (standalone display, portrait, brand theme colour).
3. Allow location for the site when prompted. The trip screen shows the sharing state, the last fix, and the queue.

## Security properties kept

- The agent holds no long-lived secret: it uses the session cookie like the portal, and `tracking.publish` is granted only to the `DRIVER` role; the API additionally requires the actor to be the trip's **assigned** driver (404 otherwise) and refuses samples without an `ACTIVE` tracking session.
- Rate limit 30 pings/min per trip; samples older than the reorder tolerance or in the future are refused; `accuracyM > 500` is accepted but flagged and never used for the ETA.
- The socket is a delivery channel only — no client→server event mutates state; rooms are authorised with the same predicate as `GET /tracking/trips/{id}`.
- The Engine.IO path is `/api/v1/rt/socket.io` so the `ug_at` cookie (scoped to `/api/v1`) reaches the handshake without widening where the token travels.
