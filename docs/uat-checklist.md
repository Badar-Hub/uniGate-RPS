# UniGate — UAT checklist (Phases 1–13, mobile M1–M3)

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

0. **Late invitation**: publish a request first, then approve a matching vehicle (or add the pickup city to a vendor's service areas) — within a few seconds the vendor sees the request under Opportunities and gets the opportunity notification; the invitation's match reason shows `LATE:vehicle.approved`.

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

## 16. Mobile — customer (Expo app, M1)

Run the app on a phone per [mobile-app.md §3](mobile-app.md) (Expo Go on the same Wi-Fi, `EXPO_PUBLIC_API_URL` = the API's LAN address). Sign in as the customer from §1; use a corporate customer (§2.4) for step 8.

1. **Requests tab**: the list shows the requests raised on the portal; status chips filter; pull down to refresh. Tap **+** → *New request*: pick a category, type pickup / drop-off addresses and cities (or choose a saved location — its coordinates are sent; otherwise the city centre), a pickup time 2+ days ahead, 30 passengers → **Publish now**. Expect the detail screen with "published to N matching owners"; the same request appears on the portal. Leave a required field empty → the field is highlighted, nothing is sent. If goods transport is enabled in settings, the *Passengers / Goods* toggle appears; a goods request (cargo type, weight, refrigeration with temperatures, shipper / consignee) publishes the same way.
2. **Request detail**: "bids close in …" counts down; **Save as draft** → *Publish* from the detail; cancel with a reason (≥ 5 chars) → *Cancelled*; a draft can be deleted.
3. **Bids**: after the vendor bids on the portal, **Compare bids** lists them cheapest first (sort by rating / arrival too), with the breakdown and notes. **Accept** → confirm → the booking opens; on the portal the other bid is *Rejected*. Multi-vehicle *all together* request: select exactly the remaining count → **Award** creates all bookings at once. Accepting an expired / already-accepted bid → the error banner names the reason.
4. **Booking detail**: status, vehicle / plate / driver, base + extras + VAT = total, billing mode, status history timeline. *Awaiting payment* + PREPAID shows **Pay**; an invoiced (corporate) booking shows "billed on your monthly invoice" and no pay button. **Cancel booking** shows the fee / refund quote first, then confirms; once the vendor assigns a driver, **Track live** appears; after completion, **Rate your trip** (stars + comment, once per subject) and **Open a dispute** (→ *Disputed* + a complaint).
5. **Payment**: **Pay** → choose a method → **Pay** creates the payment. With the MockGateway the in-app browser opens the mock page (it needs a portal session — close it) and the *Development gateway* buttons appear: **Simulate successful payment** → the return screen polls and shows "Payment received"; **Back to the booking** → *Confirmed*, *Paid*. **Simulate declined card** → "Payment not completed". *Bank transfer* → the reference to quote, booking stays *Awaiting payment*.
6. **Live tracking**: while the driver app (§8) is sending positions, the track screen shows the trip status, *Live* once the socket room is joined, the dot moving (Apple Maps on iOS; on Android the coordinates card unless a Maps key is configured), last-seen seconds, ETA when the API computes one, and **Call driver**. Kill the API socket → *Reconnecting…*, the 15 s HTTP poll keeps the position current.
7. **Complaints** (Account → Complaints or Home): raise one against the driver with a booking attached → it appears with *Open* and the SLA respond-by; ops replies on the portal → the reply shows in the thread; reply from the phone → back to *In review* on the portal.
8. **Corporate** (Account → Company): credit limit / outstanding / available match Admin → Customers; **Invoices** lists the monthly invoices from §9 with lines and totals; **Pay** on an *Issued* invoice runs the same payment flow with `INVOICE_PAYMENT`; **Open PDF** answers "not available yet" until rendering ships; **Account statement** for the current month shows balances, ageing and movements.
9. **Notifications tab**: the unread badge on the tab updates within 60 s of a portal event (or on returning to the app); tap a row → marks read and opens the booking / request / trip / invoice / complaint it refers to; *Unread only*, mark-all-read, delete. `unigate://bookings/<id>` typed in a browser on the phone opens the booking (development / store builds; Expo Go uses `exp://` links).
10. **Saved locations** (Account): add "Office" with an address and city → it is offered as a shortcut on *New request*; edit and delete it.
11. **Language**: switch to العربية in Account → every new screen is in Arabic, right-to-left (numbers, plates and timestamps stay left-to-right); dark mode follows the phone.

## 17. Mobile — vendor (Expo app, M2)

Same set-up as §16; sign in as a vendor (owner) account from §2. An owner sees the tabs Home / Opportunities / Bookings / Fleet / Account; Bids, Drivers, Settlements, Expenses, Maintenance and Documents are under **Account → Vehicle owner**. Camera / gallery / file uploads need a real phone (Expo Go asks for the permissions the first time).

1. **Home**: the tiles show open opportunities (and how many still lack a bid), bids awaiting a decision, upcoming bookings (and how many need dispatch), vehicles needing attention (not dispatchable, insurance / registration / inspection expiring within 30 days), the next booking and the last settlement; each tile opens its screen. Numbers match the portal lists.
2. **Owner profile** (Account → Company / owner profile): the onboarding status and its explanation; **Edit details** (business names, CR, VAT) → *Saved*; **Edit service areas** → tick cities → *Saved* (matching uses them); apply for the other vertical (button appears only for a vertical not yet applied for); the privacy switches change what customers see. **Documents** → the *Business* checklist (`OWNER`) and the *Identity* checklist (`USER`): **Upload** → *Take a photo* / *Choose a photo* / *Choose a file (PDF)* → the file line shows name · type · size (photos compressed to ≤ 2 MB) → expiry date where the type requires one → **Upload** shows *Preparing → Requesting → Uploading (progress) → Confirming* → *Uploaded — awaiting verification*; the row moves to *Awaiting verification*. A file of the wrong type / over the type's size is refused before anything is sent. **Submit for review** before the mandatory documents are uploaded → the banner names the missing codes (`OWNER_DOCUMENTS_INCOMPLETE`); after them → *Under review*; admin approves on the portal → *Approved*.
3. **Fleet tab**: vehicles with approval badge, lifecycle and *Dispatchable / Not dispatchable*; chips filter by approval. **+** → *Register a vehicle*: vertical (if goods is enabled), category, make → model, year, plate `1234 ABC` (upper-cased), Arabic plate, sequence number, registration number, VIN, colour, seats (or payload / volume / body type / refrigeration / tail lift for a goods category), base city, odometer, the three expiry dates → **Register** → the vehicle page opens with "registered as a draft". A bad plate / VIN / year is flagged on the field before sending; an unapproved owner gets `OWNER_NOT_APPROVED` in the banner.
4. **Vehicle detail**: spec card, the *why it cannot be dispatched* reasons, and three panels. **Documents**: upload each mandatory type (same flow as step 2); after the last confirm the vehicle moves to *Pending approval* by itself — admin verifies + approves on the portal → *Approved*, *Dispatchable*. **Submit for approval** shows for DRAFT / REJECTED and names the missing codes when refused. **Calendar**: 7 / 30 / 90-day window lists reservations, maintenance holds and your blocks; **Add block** (from / to / notes) → the block appears; an overlapping block → `VEHICLE_CALENDAR_CONFLICT` with the conflicting entries; **Release** removes it. **Drivers**: assign an approved driver (primary tick) → it appears in the history as *Active* and in the spec card; **Unassign** closes the row (history keeps it).
5. **Drivers** (Account → Drivers): list with approval / availability and the licence expiry; chips filter by status. **+** → *Register a driver* (names, mobile, language, ID type + number, date of birth, licence number + expiry + classes, verticals, emergency contact) → the driver page opens. On it: availability toggle *Available / Off duty* (`POST /drivers/{id}/availability`; *On trip* is system-set and the toggle hides), **Apply for goods** adds the vertical (status *Under review* until admin approves), the checklist (`DRIVER`: licence, TGA card per vertical, photo) with the same upload flow; admin verifies and approves on the portal → *Approved*.
6. **Opportunities tab**: open invitations best-match first with request number, category, route, vehicles still needed, match score and the eligible-vehicle count; chips *To bid / Bid placed / Dismissed*. Tap → the redacted request (no customer contacts / instructions until awarded), the countdown, the eligible vehicles and the match reasons. **Dismiss** → *Dismissed* (drops out of the default list; *Restore* brings it back). A customer publishing a matching request on the portal makes it appear here (pull to refresh).
7. **Place a bid**: vehicle (preselected when only one is eligible), driver (approved drivers assigned to that vehicle; optional), base fare, extras (label in both languages + amount; up to 20; the running extras total is shown), estimated duration, *valid until* (must precede the bidding deadline), notes → **Submit bid** → the bid screen opens with "Bid BID-… submitted — total X" where the total = base + extras + VAT computed by the API. Bidding closed / vehicle not eligible / same vehicle bid twice → the banner names the reason. A zero base or an extra without a label is flagged before sending.
8. **Bids** (Account → My bids): list with request, vehicle, version, validity and total; chips by status. Detail shows the amounts breakdown, effective commission when settings expose it, vehicle / driver, timing. **Revise bid** (SUBMITTED only) → change the base or an extra → *Bid revised — version 2, total Y*; the portal shows the new version and the customer is notified. **Withdraw** → confirm → *Withdrawn*. After the customer accepts on the phone or portal → *Accepted* with **Open booking**.
9. **Booking (owner side)**: Bookings tab → the booking from step 8 shows *Confirmed* and the **Your earnings** card (gross, net of VAT, commission, VAT on commission, payment fee, your net — the customer never sees this split). **Dispatch**: choose a driver (only approved drivers assigned to that vehicle are listed; none → "assign one from the vehicle page") → **Assign driver** → *Driver assigned* with the trip number; **Mark as ready** → *Ready*. The customer's app now shows the driver's name and **Track live** once the driver starts.
10. **Settlements** (Account → Settlements): the *Pending settlement (last 30 days)* card (gross / deductions / adjustments / net, bookings on hold, below-minimum note) and the list with status chips; detail shows totals, the payout account (IBAN last 4) and reference once paid, and every line (earnings / commission / adjustment / penalty / clawback) with a link to its booking. Finance building and paying a settlement on the portal is reflected here.
11. **Expenses** (Account → Expenses): the by-category summary and the list; **+** → category, net amount, VAT, date, vehicle, supplier, description, odometer, reimbursable → **Save** → the expense page; **Attach a receipt** runs the upload flow against the expense (`EXPENSE_RECEIPT`) and the row shows *Receipt attached*; **Delete** removes it; an expense inside a paid settlement period shows *Settled* and no actions (`EXPENSE_IMMUTABLE`).
12. **Maintenance** (Account → Maintenance): the *Due soon* panel (from the schedules on the portal) and the records list; **+** → vehicle, service, kind, starts as *Planned / In the workshop*, window, cost / VAT, workshop, notes → **Save** → the record page; the vehicle's calendar now shows the *Maintenance* hold and the vehicle is *Not dispatchable* while in the workshop. A window overlapping a booking → `MAINTENANCE_CALENDAR_CONFLICT` naming the booking. **Start** → *In the workshop*; **Mark as completed** (odometer, final cost, notes, "book the cost as an expense") → *Completed*, the hold is released, the expense appears under Expenses; **Cancel** with a reason releases the hold.
13. **Notifications**: a vendor push / inbox row with `settlementId`, `vehicleId`, `bidId` or `driverProfileId` opens the matching screen; `scheduleId` opens Maintenance, `documentId` the Documents screen.
14. **Language / RTL**: switch to العربية → every vendor screen is Arabic, right-to-left; plates, VINs, amounts and timestamps stay left-to-right; the bid extras keep both labels.

## 18. Mobile — driver (Expo app, M3)

Same set-up as §16; sign in as the driver from §3.0 (phone + one-time code from the API log / MailHog). A driver-only account sees the tabs Trips / Active / Notifications / Account; a driver who is also a customer or owner keeps their tabs plus **Trips**. Background location needs a **development build** on a real phone (`npx expo run:android` / EAS); Expo Go streams in the foreground only and says so on the trip screen.

1. **Active tab**: with nothing dispatched, "No trips assigned to you yet"; after the owner assigns this driver and marks the booking ready (§17.9), pull down → the trip appears under *Next trips* with its number, pickup and time. **Account → Driver account**: approval / availability badges; toggle *Available / Off duty* → saved (an expired licence refuses going on duty with `DRIVER_LICENSE_EXPIRED`; a licence expiring within 30 days shows the warning); the vehicle assignments list matches the vehicle's Drivers panel on the portal; *Location sharing* shows the permission state.
2. **Trips tab**: chips *Active / Upcoming / Done*; the upcoming trip is listed with plate and time; tap → the trip screen: trip number, booking number · plate, pickup / drop-off with **Open in maps**, the scheduled window, vehicle, the history (empty or *Assigned*).
3. **Start driving to pickup** → confirm → the phone asks for location *while using* then *all the time* (Android opens its settings page — choose *Allow all the time*). Status → *En route to pickup*; the location card turns green: *Sharing live location*, "Keeps running in the background", sent · queued counting up every 5 s, the last fix with ±m, and a persistent **UniGate — sharing your location** notification (Android). The customer's app (§16.6) and the portal booking page show the dot moving; the history row carries the coordinates.
4. **Background**: press Home / lock the phone / open a navigation app for a minute → the customer's map keeps moving and *sent* keeps counting when you return. Refuse the background permission instead → the card says *Foreground only* with **Open settings**, and sharing pauses while the app is in the background (this is the graceful degradation; Expo Go behaves the same and says *Expo Go*).
5. **Offline**: switch airplane mode on for 30 s → *queued* grows; switch it off → the queue flushes (*queued* back to 0, *sent* jumps) through `POST /tracking/ping/batch`; the API log shows the batch with per-item results. Kill the API instead → samples queue; restart it → they flush.
6. **Arrived at pickup** → *At pickup*. **Passengers on board — start trip** → the odometer prompt (required; a reading below the current one is refused with the floor) → *Trip started*; the booking on the portal is *In progress*. **Arrived at destination** → **Complete trip** with the end odometer → *Trip completed. Thank you.*; sharing stops, the notification disappears, availability is back to *Available*, the customer gets the rating prompt (§16.4). The Done chip lists the trip.
7. **Goods trip** (`platform.verticals_enabled` includes GOODS; a goods booking dispatched to this driver): *Start driving to pickup* asks for the **Bayan reference** when ops recorded none (sent with `PATCH /trips/{id}`); *Start loading → Loaded — depart* (odometer) *→ In transit → Arrived at destination → Start unloading → Delivered*: the proof-of-delivery form (recipient name required, ID last 4, notes) is recorded first (`POST …/proofs`) and referenced on the transition; the **Proofs** section lists it with the position; **Attach photo** / **Attach signature** run the upload flow (camera / gallery / file) against the proof and land in the documents queue on the portal; then *Complete trip*.
8. **Report a problem** (EXCEPTION) from any active state → *Exception* with the note; the buttons now offer the states to resume into; sharing continues. Ops cancelling the trip on the portal while the app is closed → the next sample is refused (`TRACKING_SESSION_NOT_ACTIVE`), sharing stops by itself and the card shows the refusal; the trip reads *Cancelled*.
9. **Record a proof** outside a transition (pickup confirmation, damage report) from the Proofs section → saved with the position → attach a photo.
10. **Notifications / deep links**: a trip notification (`tripId`) tapped by the driver opens the trip screen (a customer tapping the same hint gets the tracking view); `unigate://trips/<id>` in a browser opens it in a development build.
11. **Sign out** while sharing → the confirmation says sharing stops → the notification disappears; sign in again → nothing streams until a trip is opened.
12. **Language / RTL**: switch to العربية → every driver screen is Arabic, right-to-left; trip numbers, plates, coordinates and timestamps stay left-to-right; the Android service notification uses the app language at the time sharing started.
