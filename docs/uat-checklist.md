# UniGate — UAT checklist (Phases 1–13)

A hands-on script for testing every module on a running dev stack. Written for the LAN setup (`http://<host-ip>:3001` portal, `http://<host-ip>:4000/api/v1` API, MailHog at `:8025`, MinIO console at `:9001`). Replace the IP with the one in your root `.env` (`APP_URL`).

## 0. Before you start

| Need | Where |
|---|---|
| Super admin | `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in the root `.env` — **Password** tab on the sign-in page (the seed admin has no phone, so no OTP login). |
| One-time codes (OTP, step-up) | With the dev OTP provider every code is **mirrored into MailHog** (subject `[dev] OTP LOGIN for +9665•• … : 123456`) and also printed in the API log (`.logs/api.log`, block `┌─ OTP (LOGIN) → …`). Step-up codes need a verified phone on the account. |
| Emails (activation links, password reset, notifications) | **MailHog** `http://<host-ip>:8025`. |
| SMS / push | Printed in the API/worker logs (`┌─ SMS →`); push is `SUPPRESSED` until FCM is configured — that is expected. |
| Payments | The **MockGateway**: every checkout shows a mock page where you choose SUCCESS / FAIL; webhooks are signed and processed for real. |
| Background jobs | The **worker** process must be running (matching, expiry, notifications, exports, reminders). |
| Test data | Create your own: 1 admin (seeded), 1 ops manager, 1 finance officer, 2 customers (one corporate), 2 vendors (owners) each with a vehicle + driver. |

Suggested order: sections 1 → 13 build on each other (users → vendor → vehicle → request → bid → booking → payment → trip → finance → engagement → admin).

## 1. IAM — accounts, sessions, access

1. Sign in as the seed admin (password). Open the avatar menu → sign out → sign in again.
2. Register a **customer** from `/register` with a Saudi phone: enter the OTP from the API log. Expect: dashboard with the customer profile card.
3. Try to register as a *vehicle owner* from `/register` — the option is hidden (self-registration is off by `onboarding.owner_self_registration_enabled`).
4. Admin → **Roles**: create a role `FLEET_SUPERVISOR` with a few permissions (step-up code from the API log / MailHog). Expect: the role appears; system roles are read-only.
5. Admin → **Vendors** → *Add a vendor*: create the vendor, copy the activation link, also check MailHog received it. Open the link in a private window → set a password → sign in as the vendor.
6. Admin → Vendors → *Access* on that vendor: deny `vehicles.delete`, save with step-up. Sign in as the vendor → the delete action is gone (denied on the next request).
7. Wrong password 5× → account locked message; wait or use OTP.

## 2. Profiles & documents (vendor onboarding)

1. As the vendor: **Documents** → upload every mandatory company document (PDF/PNG). After the last upload the profile moves to *Documents submitted* by itself.
2. As admin: **Owner review** queue → open the vendor → verify each document → *Approve*. Try approving before all documents are verified → refused (`OWNER_DOCUMENTS_INCOMPLETE`).
3. As the vendor: add a **driver** (Fleet → drivers), upload the driver's licence/ID; admin approves the driver.
4. As a customer: complete the profile, add a saved location. As admin: **Admin → Customers** → *Manage* → fill the corporate record (company, CR, contact, national address, billing cycle *Monthly*), set the VAT number, verify the three corporate documents the customer uploaded (Documents page), **Verify corporate record**, then in *Credit & invoicing* set status *Approved* + a credit limit — needed for invoiced bookings in §7.5 and §9.

## 3. Fleet

0. **Drivers** page (vendor, or staff on behalf of a vendor / the UniGate fleet): *Add driver* (name, mobile, ID, licence, classes, verticals) → open the driver → upload licence, TGA card for each vertical, photo → staff **Verify** each document → **Approve driver**. The driver signs in to `/ar/driver` with the mobile number + one-time code.

1. As the vendor: **Fleet → Add vehicle** (category, plate, capacity…). Try to add a vehicle before the vendor is approved → refused (`OWNER_NOT_APPROVED`).
2. Upload the vehicle's mandatory documents; the vehicle enters *Pending approval* automatically. Admin → **Vehicle approvals** → verify documents → approve. Expect `dispatchable: ok`.
3. Assign the approved driver to the vehicle.
4. **Calendar**: block two days on the vehicle; try an overlapping block → `VEHICLE_CALENDAR_CONFLICT`.
5. Edit the plate number → the vehicle drops back to *Pending approval* (material change); edit the colour → stays approved.

## 4. Trip requests (demand)

1. As a customer: **Requests → New**: passenger trip, pickup/drop-off in Riyadh, date 2+ days ahead, 30 passengers, publish. Expect a request number and a matched-owners count.
2. As the vendor: **Opportunities** shows the request (service area + category + approved vehicle). Dismiss one opportunity → it disappears.
3. Customer cancels a draft request; tries to cancel a request with an accepted bid → refused.
4. Leave a published request past its bidding window → the worker expires it (check status after `bidding.window_hours`; shorten the setting under Admin → Settings → bidding to test quickly).

## 5. Bidding

1. As the vendor: **Opportunities → Bid** (base amount, extras, validity). Revise the bid (amount changes, history kept). Withdraw and re-bid.
2. Bid with a second vendor. As the customer: **Requests → detail → Bids**: compare, then **Accept** one. Expect: booking created, the other bid *Rejected*, the vehicle reserved on its calendar, notifications to both vendors (bell / MailHog).
3. Try to accept twice / accept an expired bid → refused.
4. Multi-vehicle: publish a request for 3 vehicles with partial fulfilment allowed; accept 2 bids → request *partially awarded*, remainder stays open; close the remainder from the request page.

## 6. Bookings

1. Customer opens the booking: status *Pending payment* (prepaid) with the payment window countdown.
2. Vendor: **Bookings → assign driver** → trip created (*Driver assigned*), customer notified.
3. Cancellation quote: as the customer open *Cancel* → the fee/refund preview (policies are `NONE` by default → 0 fee; set a policy under Admin → Settings/`cancellation_policies` to see tiers). Cancel a second booking and confirm the calendar reservation is released.
4. Ops (admin): booking detail → **waive fee** (needs a reason); **no-show** (owner party, optional fee override) → booking cancelled, customer refund requested, fee shown as a settlement penalty later (§9).
5. Let a prepaid booking sit unpaid past the payment window → the worker cancels it (`PAYMENT_WINDOW_EXPIRED`) and notifies the parties.

## 7. Payments & refunds

1. Customer: booking → **Pay now** → mock checkout → SUCCESS. Expect: booking *Confirmed*, payment *Paid*, `PAYMENT_SUCCESSFUL` notification, ledger postings (Admin → Reports → *revenue* later).
2. Repeat with FAIL → `PAYMENT_FAILED` notification, booking still pending.
   Offline payment (bank transfer / cash): ops open the booking → *Disputes & no-show* card → **Confirm booking — payment received** with a reconciliation note → booking *Confirmed* (audited as `booking.confirmed_by_ops`).
3. Cancel a paid booking → a refund request appears in **Admin → Refunds**. Approve with a *different* staff user (four-eyes: the requester cannot approve), then **Process** → mock gateway completes it → booking *Refunded*, `REFUND_COMPLETED` notification.
4. Admin → **System → Payment webhooks**: the stored events with valid signatures; *Replay* one → result `SKIPPED`/`PROCESSED` (idempotent).
5. Corporate customer with approved credit: book → no payment step, booking *Confirmed*, `billingMode: INVOICED`; check `/customers/{id}/credit` headroom drops (Invoices page → statement).

## 8. Trips & tracking (driver app)

1. Sign in as the driver (phone OTP) → **Driver** screen shows the assigned trip.
2. Move through *En route → Arrived → Started → Completed* with location permission granted; the customer's booking page shows the live map and each status notification.
3. Goods trip (needs `platform.verticals_enabled` to include `GOODS` in Settings): before departure the driver must enter the Bayan reference; before *Delivered* the proof-of-delivery form (recipient, ID last 4).
4. Ops: **Track** a trip from the admin side; cancel a trip from ops with a reason → parties notified.
5. Trip exceptions: pause/exception from the driver app, then resume.

## 9. Finance

1. **Commissions** (Admin → Commissions): create a 10 % NET_OF_VAT rule; preview a gross amount → split; set a per-request override before bids exist.
2. Complete a paid booking (§8) → **Settlements** (finance officer): preview for the vendor (booking earnings, held items inside the hold period, **negative adjustment for the no-show penalty** from §6.4), create → add a manual line → submit → approve with a second finance user → pay (bank account cool-off applies). Vendor sees the settlement and balance; `SETTLEMENT_PAID` notification.
3. **Invoices**: prepaid booking → simplified invoice after capture; corporate cycle → `POST /admin/invoices/generate` (Invoices → *Generate*) → tax invoice cleared by the mock provider; pay it from the customer's Invoices page; issue a credit note; try to void a paid invoice → refused.
4. **Expenses** (vendor): record an expense, view the summary; an expense inside a *paid* settlement period is locked.
5. Customer **statement** (Invoices page, corporate customer): opening/closing balance, movements and ageing for the month.
6. Overdue: set an invoice due date in the past (or wait) → the finance job flags it *Overdue* and sends `INVOICE_OVERDUE` reminders on the configured days.

## 10. Goods vertical

1. Admin → Settings → `platform.verticals_enabled` = `["PASSENGER","GOODS"]` (step-up).
2. Vendor applies for the GOODS vertical (profile) → admin approves; add a truck (goods category), refrigeration certificate if refrigerated.
3. Customer: New request → *Goods*: cargo type, weight, packages, refrigeration range, loading responsibility. Only trucks matching the cargo appear as opportunities; a passenger bus cannot bid.
4. Run the freight trip: loading → loaded → in transit → arrived → unloading → delivered (with proof) → completed. Freight invoice line wording.

## 11. Maintenance

1. Vendor → **Maintenance**: add a schedule (oil change every 10 000 km / 180 days) → *Due soon* panel shows it as the odometer approaches.
2. Plan a workshop visit for tomorrow → the vehicle calendar is blocked; try to book/bid the vehicle for that window → conflict. Try to plan a visit over an existing reservation → `MAINTENANCE_CALENDAR_CONFLICT` naming the booking.
3. Start → vehicle *Under maintenance*; complete with odometer, cost and VAT → hold released, odometer moved, schedule rolled forward, a MAINTENANCE expense appears under Expenses.
4. Reminders: the daily job publishes `maintenance.due` → vendor gets a `MAINTENANCE_DUE` notification (shorten `notifications.maintenance_reminder_days_before` to test).

## 12. Notifications

1. Bell in the header: unread badge, latest eight, click → marks read and deep-links (booking, request, invoice…).
2. **Notifications** page: filters, read-all, delete; **preferences** matrix — switch off *Bidding → Email*, then trigger a bid → in-app row arrives, no email; *Security/Payments/Trips* cannot be switched off.
3. MailHog shows emails for the events above; the worker log shows SMS lines; PUSH rows are *Suppressed* (no provider) — expected.
4. Admin → **Notifications (ops)**: edit the wording of `BOOKING_CONFIRMED` (en), preview with sample variables, save → next confirmation uses the new text. **Send** `OPS_ANNOUNCEMENT` to profile type *Vehicle owners* → each vendor's bell rings; sending with a missing variable → 422.
5. Forgot password from the sign-in page → the reset link arrives in MailHog → set a new password; the stored notification row shows `[link]`, never the token.

## 13. Engagement — ratings & complaints

1. After a completed booking: dashboard and booking page show **Rate your trip**; customer rates vehicle 4★ with a comment; vendor rates the customer. Rating twice → refused; a stranger → 404.
2. Set `booking.rating_review_below_score` = 2 → a 1★ commented rating lands in *Pending review*; admin publishes or hides it (`/ratings` moderation via API or a quick call from the reports/audit view); aggregates update on the vehicle card.
3. Customer → **Complaints**: raise one against the driver on the booking (category from settings). Ops → Complaints queue: SLA *respond-by* shown; assign to me (OPEN → In review); add an **internal** note (invisible to the customer); move to *Awaiting your reply*; customer replies → back to *In review*; resolve with a written resolution → customer gets `COMPLAINT_RESOLVED`.
4. Booking detail → **Open a dispute** (customer, completed booking) → booking *Disputed* + linked HIGH complaint; ops **Resolve dispute** as *service stands* (→ Completed) or *refund* (→ refund request → Refunds queue → Refunded).

## 14. Admin & reporting

1. **Dashboard (ops)**: pick the last 30 days; switch vertical Passenger/Goods; series by day/week. Numbers match what you created above; `computedAt` refreshes every 60 s.
2. **Settings**: change `bidding.bid_validity_hours` (step-up), watch the audit entry; code-managed keys are locked; SECRET keys never appear.
3. **Audit log**: filter action prefix `booking.`, open *History* on a booking → every transition with before/after values; export a date range (≤ 90 days) → collect the CSV from **Reports → Exports**.
4. **Reports**: as the vendor run *owner-earnings*, *vehicle-utilisation*, *settlements* (own rows only); as finance run *revenue*, *AR ageing*, *commission*, *payments*, *refunds*; as ops run *bookings*/*trips* (403 on *revenue* — no financial permission); customer runs *order-fulfilment*. Export *bookings* as CSV → wait ~15 s → Download (signed link, opens in Excel with Arabic intact). XLSX → *not available* message.
5. **System**: health (DB/Redis/storage up, migration name, provider codes), queue depths, failed outbox events → *Retry*.
6. **Refunds**: the four-eyes rule (§7.3); reject with a reason.

## 15. Cross-cutting checks

- Switch language (العربية) on every screen: RTL layout, Arabic copy, Arabic notification text for users whose locale is `ar`.
- Open the portal from a phone on the same Wi-Fi: the driver app (`/driver`) with location permission.
- Two browsers logged in as customer and vendor side by side: bids, bookings and notifications appear in real time / within the 60 s poll.
- API docs: `http://<host-ip>:4000/api/v1/docs` lists every endpoint used above.
