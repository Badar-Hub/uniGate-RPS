# ADR-011 — One Expo / React Native app for customers and vendors; the driver PWA stays until M3

**Status:** Accepted — mobile phase opened after OQ-14 (web first) was satisfied by the delivered portal
**Date:** 2026-09-16
**Relates to:** [ADR-001](ADR-001-monorepo-and-modular-monolith.md) (monorepo, shared packages), [ADR-003](ADR-003-authentication.md) (dual-mode tokens: cookies for web, Bearer for mobile), [ADR-010](ADR-010-vertical-modules-over-a-shared-core.md) (portals follow the vertical split), [driver-app.md](../driver-app.md)

## Context

RFP §5.2 names "mobile applications for customers and vehicle owners/drivers" as a deliverable. UniGate answered OQ-14 on 2026-09-15: **web first, mobile in a later phase once the portal is fully functional**. The portal is functional across every module (IMPLEMENTATION_STATUS.md), the API was kept strictly client-agnostic for exactly this moment (A-28: Bearer mode in `POST /auth/login`, `X-Client-Type`, OpenAPI published), and the driver's live-tracking need has been met by an installable PWA (Phase 10) whose known limit is background GPS.

So the question is no longer _whether_ but _what shape_. Three audiences exist — customers (individual and corporate), vehicle owners (vendors) and drivers — and the shape decision has to answer: one app or several, which technology, and what happens to the driver PWA.

Constraints that matter:

- **Arabic-first with full RTL** (architecture.md §11). Whatever we pick must flip layout natively, not emulate it.
- **Shared contract.** `@unigate/types` (DTOs, enums) and `@unigate/validation` (Zod) already exist and are hand-written, Prisma-free by rule. A client that cannot consume TypeScript packages from the monorepo re-implements the contract and drifts.
- **Push notifications, secure token storage, deep links, background location (for drivers).** These are the capabilities a browser cannot provide reliably — they are the reason to leave the web at all.
- **Team.** The team that built the API and the portal is a TypeScript / React team. There is no separate mobile team.
- **Expo Go testing on the LAN** during development, without Apple/Google accounts, keeps the feedback loop with UniGate short.

## Decision

1. **One role-aware Expo (React Native) app, `apps/mobile`, for customers and vendors.** A user signs in against the same API; `GET /me` decides the tab set (customer: Home · Requests · Bookings · Notifications · Account; vendor: Home · Opportunities · Bookings · Fleet · Account; both: the customer set plus Fleet). Individual and corporate customers share the customer surface; the corporate differences (credit terms, invoicing in arrears) are data the API already returns, not a second app.

2. **Expo managed workflow with Expo Router, NativeWind (Tailwind), TanStack Query, `expo-secure-store`.** Expo gives us the native capabilities as config-plugin modules, over-the-air JS updates later, and EAS builds without a Mac on every desk. Expo Router keeps the mental model identical to the Next.js app (file-based routes, layouts, groups). NativeWind reuses the portal's shadcn/zinc tokens so the two clients look related and, through logical utilities (`ms-`/`me-`/`text-start`), flip correctly under RTL.

3. **`packages/api-client` is the third shared package.** The envelope parsing, error-code → i18n-key mapping, field-error prefix stripping, idempotency keys and the transparent refresh are ported from `apps/web/src/lib` into a platform-agnostic package with an injectable transport. The mobile app consumes it from day one; the web app switches to it in a follow-up so both clients have one implementation of api.md §2/§4/§7.

4. **Token model on mobile (ADR-003 mobile mode).** Access token in memory only; refresh token in the OS keystore via `expo-secure-store`; `X-Client-Type: IOS|ANDROID`; one transparent `POST /auth/refresh { refreshToken }` on `AUTH_TOKEN_EXPIRED`, then sign-out. Nothing about sessions changes server-side.

5. **The driver PWA stays until M3.** Drivers keep the installable web agent ([driver-app.md](../driver-app.md)); it works today and its only real gap is background GPS. M3 adds a Driver surface to this same app with `expo-location` background updates posting to the **same** `POST /tracking/ping` / `/ping/batch` endpoints — the path driver-app.md already recommends — and retires the PWA once parity is proven.

6. **Milestones.** M0 (this ADR): scaffold, login (password + OTP), session bootstrap, role-aware tabs with read-only lists, i18n/RTL, push token obtained and logged. M1: device registration for push, deep links (`unigate://`) into bookings/requests, detail screens, create request, bid/award on the vendor side, in-app language reload via `expo-updates`. M2: payments hand-off, documents upload from camera/gallery, offline tolerance for lists, EAS builds and store listings. M3: driver surface with background tracking; PWA retired.

## Consequences

**Positive.**

- One codebase for two audiences and, from M3, three — the same reasoning that kept the web portal one Next.js app with role-aware navigation. Shared screens (bookings, notifications, account, documents) are written once.
- The contract packages are consumed directly; a DTO change breaks the mobile typecheck in CI, not a tester's phone.
- Expo Go on the LAN lets UniGate hold the app in hand within the current engagement, before any store account exists.
- The driver path is additive: nothing shipped in Phase 10 is thrown away, and the tracking pipeline does not change.

**Negative.**

- **Native toolchain surface.** Expo hides most of it, but store submission, signing, push credentials (APNs key, FCM) and EAS become the team's responsibility. Budgeted in M2.
- **pnpm isolated linking needs care.** Metro resolves through symlinks; a few packages that Babel injects (`react-native-css-interop` for NativeWind) must be direct dependencies of the app. Documented in mobile-app.md; the root `.npmrc` is unchanged.
- **Dynamic RTL switching does not work inside Expo Go** (it resets the native direction per launch). It works in development and store builds. Testers switching language in Expo Go may need to relaunch.
- **Two clients to keep in step** with every API change until the web app also consumes `@unigate/api-client`. The follow-up is scheduled, not optional.
- **One app for all roles means one store listing with role-dependent content.** Store reviewers will need a customer and a vendor test account; noted for M2.

## Alternatives considered

| Alternative                                                             | Rejected because                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PWA for customers and vendors** (extend the driver PWA pattern)       | Works for the driver's single-trip flow, but customers and vendors need reliable push (bid received, award, trip started), secure token storage and store presence — RFP §5.2 names _applications_. iOS PWA push is opt-in and fragile; background work is unavailable. The PWA remains the right answer for the driver until M3 precisely because its scope is narrow |
| **Flutter**                                                             | A second language and toolchain; cannot consume `@unigate/types` / `@unigate/validation` / `@unigate/api-client`, so the contract is re-typed by hand and drifts. No Flutter capacity in the team                                                                                                                                                                      |
| **Two (or three) separate apps** — customer app, vendor app, driver app | Duplicates auth, session, notifications, account, documents and bookings screens; a user who is both customer and owner (a real case — a company that hires and also rents out) would need two installs. Role-aware navigation is a solved problem in the portal; the same shape applies                                                                               |
| **Bare React Native (no Expo)**                                         | Same language and packages, but native project files in the repo, manual linking of every capability module and a Mac requirement for iOS. Expo's config plugins and EAS remove that cost; `prebuild` remains available if a capability ever needs it                                                                                                                  |
| **Capacitor wrapper around the Next.js portal**                         | Fastest to a store icon, but the portal is desktop-first, the wrapper cannot render native navigation or RTL-aware native controls, and background location still requires a plugin bridge. driver-app.md keeps this as the _minimum_ fallback for background GPS should M3 slip                                                                                       |
