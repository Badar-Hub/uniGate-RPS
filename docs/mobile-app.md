# The mobile app — Expo (React Native) for customers and vehicle owners

**Status:** M1 delivered 2026-09-17 — the customer journey end to end: new request (passenger and goods), request detail, bid comparison with accept / group award / reject, booking detail with cancel-with-quote, pay-now through the gateway hand-off and return polling, live tracking over Socket.IO with a map, ratings and complaints, the corporate credit / invoices / statement screens, saved locations, the inbox with an unread badge and deep links, and push-device registration. M0 (2026-09-16) was the scaffold: sign-in (password and phone OTP), session bootstrap with transparent refresh, role-aware tabs, Arabic/English with RTL. Decision record: [ADR-011](decisions/ADR-011-mobile-expo-over-pwa.md). Drivers keep the [PWA](driver-app.md) until M3.

## 1. Stack

| Concern    | Choice                                                                                                                                                                           | Why                                                                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime    | **Expo SDK 57** (React Native 0.86, React 19.2), managed workflow, Hermes                                                                                                        | Expo Go from the stores runs only the current SDK, so LAN testing on a phone needs the latest; config plugins give push, secure storage, localisation without native project files |
| Navigation | **Expo Router** (file-based; `app/`)                                                                                                                                             | Same mental model as the Next.js portal: layouts, groups, typed routes                                                                                                             |
| Styling    | **NativeWind v4** (Tailwind 3.4)                                                                                                                                                 | The portal's shadcn/zinc tokens are copied verbatim into `global.css`; logical utilities (`ms-` `me-` `ps-` `pe-` `text-start` `text-end`) flip under RTL                          |
| Data       | **TanStack Query v5**                                                                                                                                                            | Caching, refetch-on-focus, pull-to-refresh with no bespoke store                                                                                                                   |
| API        | **`@unigate/api-client`** (new shared package, §5) + `@unigate/types` + `@unigate/validation`                                                                                    | One envelope/error/idempotency implementation for both clients; DTOs and Zod schemas consumed directly                                                                             |
| Secrets    | `expo-secure-store`                                                                                                                                                              | Refresh token, device id and the locale preference in the OS keystore                                                                                                              |
| i18n       | `i18n-js` + `expo-localization`                                                                                                                                                  | `src/i18n/messages/{en,ar}.json`; catalogue lookup mirrors the web app's `common.errors.*` keys                                                                                    |
| Push       | `expo-notifications`                                                                                                                                                             | Token → `POST /notifications/devices` on sign-in, `DELETE …/{token}` on sign-out; a tapped notification routes through the deep-link resolver (§10)                                 |
| Realtime   | `socket.io-client`                                                                                                                                                               | The `/rt` namespace with the Bearer token in `auth` (api.md §9); re-authenticates in place after every HTTP refresh (§11)                                                            |
| Maps       | `react-native-maps`                                                                                                                                                              | Apple Maps on iOS; Google Maps on Android when `EXPO_PUBLIC_MAPS_ANDROID_KEY` is set, else a coordinates card (§11)                                                                  |
| Checkout   | `expo-web-browser`                                                                                                                                                               | `openAuthSessionAsync` for the gateway's hosted page, closed by the `unigate://pay/return` deep link (§12)                                                                          |
| Pickers    | `@react-native-community/datetimepicker`                                                                                                                                         | Pickup / return time (date then time on Android, inline spinner on iOS); selects are a modal list (`src/components/select-field.tsx`)                                                |
| Config     | `app.config.ts` + `expo-constants`                                                                                                                                               | `EXPO_PUBLIC_API_URL` → `extra.apiUrl`; scheme `unigate`                                                                                                                           |
| Quality    | TypeScript 6 strict (the `@unigate/tsconfig` flags repeated on top of `expo/tsconfig.base`), ESLint (Expo rules + the monorepo baseline), Vitest for pure modules, `expo-doctor` | All wired into `pnpm run ci` through Turborepo                                                                                                                                     |

## 2. Folder layout

```
apps/mobile/
├─ app.config.ts              Expo config (name, scheme, plugins, extra.apiUrl from EXPO_PUBLIC_API_URL)
├─ app/                       Expo Router routes
│  ├─ _layout.tsx             providers: QueryClient → I18n → Session; splash until both are ready
│  ├─ index.tsx               redirect: signed in → (app), else → (auth)/login
│  ├─ (auth)/login.tsx        identifier + password → POST /auth/login
│  ├─ (auth)/otp.tsx          phone → POST /auth/otp/request → code → POST /auth/otp/verify (purpose LOGIN)
│  └─ (app)/_layout.tsx       signed-in <Stack>: the tab bar first, detail screens with a native header; push registration + tap routing
│     ├─ (tabs)/_layout.tsx   role-aware <Tabs>; hidden tabs stay registered (href: null); unread badge on Notifications
│     │  ├─ index.tsx         Home: who you are + shortcuts (new request, requests, bookings, complaints, …)
│     │  ├─ requests.tsx      GET /trip-requests?status=       status chips, pull-to-refresh, load-more, + → new
│     │  ├─ opportunities.tsx GET /opportunities               (vendor, unchanged from M0)
│     │  ├─ bookings.tsx      GET /bookings?status=            → booking detail
│     │  ├─ fleet.tsx         GET /vehicles                    (vendor, unchanged from M0)
│     │  ├─ notifications.tsx GET /notifications (cursor)      unread filter, read / read-all / delete, tap → deep link
│     │  └─ account.tsx       profile, Saved locations, Complaints, Company / Invoices / Statement (corporate), language, sign out
│     ├─ requests/new.tsx     POST /trip-requests ⧗            passenger + goods form (§9)
│     ├─ requests/[id]/index.tsx  GET /trip-requests/{id}; POST …/publish, …/cancel; DELETE (draft)
│     ├─ requests/[id]/bids.tsx   GET /trip-requests/{id}/bids; POST /bids/{id}/accept ⧗, /bids/{id}/reject, /trip-requests/{id}/award ⧗
│     ├─ bookings/[id].tsx    GET /bookings/{id}, …/status-history, …/cancellation-quote; POST …/cancel ⧗, …/dispute; rating prompt
│     ├─ pay/[bookingId].tsx  GET /payments/config; POST /payments ⧗ (bookingId, BOOKING_PAYMENT)        (§12)
│     ├─ pay/invoice/[invoiceId].tsx  the same with invoiceId + INVOICE_PAYMENT
│     ├─ pay/return.tsx       GET /payments/{id}/status polled until terminal; GET /payments/{id} for the way back
│     ├─ track/[tripId].tsx   GET /tracking/trips/{id} (+15 s poll), …/history; socket room trip:{id}   (§11)
│     ├─ complaints/index.tsx GET /complaints?status=; new.tsx POST /complaints; [id].tsx GET /complaints/{id}, POST …/notes
│     ├─ account/saved-locations.tsx  GET/POST/PATCH/DELETE /me/saved-locations
│     ├─ account/company.tsx  GET /customers/{id}/credit         (corporate only)
│     ├─ account/statement.tsx GET /customers/{id}/statement?periodStart&periodEnd
│     └─ invoices/index.tsx   GET /invoices; [id].tsx GET /invoices/{id}, …/lines, …/pdf-url
├─ src/
│  ├─ config.ts               apiUrl / appVersion / platformClientType() / mapsAndroidKeyConfigured
│  ├─ lib/api.ts              the one ApiClient (refreshSession + onUnauthorized wired; refresh re-auths the socket) and fetchOrThrow
│  ├─ lib/auth/tokens.ts      access token in memory, refresh token in SecureStore
│  ├─ lib/auth/device.ts      stable deviceId (UUID in SecureStore) + deviceName (expo-device)
│  ├─ lib/auth/events.ts      "signed out" listener so the plain client can reach React
│  ├─ lib/session.tsx         SessionProvider / useSession(): status, me, audience, can(), signIn(), signOut() (deregisters push, drops the socket)
│  ├─ lib/tabs.ts             audienceOf(me) and tabsFor(audience) — pure, unit-tested
│  ├─ lib/push.ts             syncPushRegistration(), unregisterPush(), watchNotificationTaps(); lazy expo-notifications, null in Expo Go
│  ├─ lib/realtime.ts         realtime() socket (/rt, Bearer in auth), joinRoom / leaveRoom, refreshRealtimeAuth()
│  ├─ lib/queries.ts          query keys + shared read hooks (settings/public, cities, categories, saved locations, booking, …)
│  ├─ lib/deep-link.ts        routeForNotification(data) / routeForUrl(url) — pure, unit-tested (§10)
│  ├─ lib/trip-request-body.ts  form state → POST /trip-requests body, client-side gate — pure, unit-tested (§9)
│  ├─ lib/payment-poll.ts     the checkout-return poller as a reducer — pure, unit-tested (§12)
│  ├─ lib/format.ts           formatMoney (string grouping, no parseFloat), formatDateTime/Date/Time (Intl, Gregorian, Latin digits), countdown
│  ├─ lib/status.ts           status → badge tone + catalogue lookups (status.<group>.<code>, enums.<group>.<code>)
│  ├─ hooks/use-action.ts     busy / banner / field errors for one API action (fieldErrors + unmappedFieldErrors)
│  ├─ hooks/use-unread-count.ts  GET /notifications/unread-count every 60 s while foregrounded
│  ├─ i18n/                   I18nProvider / useI18n(): t, has, errorMessage, locale, setLocale; rtl.ts; messages/{en,ar}.json
│  ├─ components/ui.tsx       Screen, FormScreen, Title, Field, TextArea, Button, ErrorBanner, Notice, Row, Chip, Segmented, CheckRow, StatusBadge, Stars, QueryState, …
│  ├─ components/list-screen.tsx  offset list: filter chips, pull-to-refresh, load-more, row press
│  ├─ components/select-field.tsx · date-time-field.tsx · pay-screen.tsx · rating-prompt.tsx · trip-map.tsx
│  └─ theme/tokens.js         Tailwind colour map + resolved hex palette for native props
├─ global.css                 :root / .dark:root CSS variables (identical to apps/web/src/app/globals.css)
├─ tailwind.config.js         nativewind preset, darkMode 'class', the same colour names as the web
├─ metro.config.js            monorepo resolution (§6) + NativeWind
├─ babel.config.js            babel-preset-expo with jsxImportSource nativewind
├─ eslint.config.mjs · tsconfig.json · vitest.config.ts · .env.example (EXPO_PUBLIC_API_URL, optional EXPO_PUBLIC_MAPS_ANDROID_KEY)
└─ assets/images/             placeholder icon / splash (Expo's defaults, tinted #0a7050) — replace before M2
```

`packages/api-client/` — `src/client.ts` (createApiClient), `envelope.ts` (parseEnvelope, ApiError, ApiResult), `errors.ts` (errorMessageKey, errorMessage, fieldErrors, unmappedFieldErrors, isThrottled), `idempotency.ts` (idempotencyKey), `auth.ts` (login, requestOtp, verifyOtpLogin, refresh, logout, me), with Vitest specs beside each module.

## 3. Running it on a phone (Expo Go, LAN)

Prerequisites: the API running and reachable on the LAN (`pnpm --filter @unigate/api dev`, listening on `0.0.0.0:4000`; `CORS_ORIGINS` is irrelevant for the app — it sends Bearer tokens, not cookies), Expo Go installed on the phone from the App Store / Play Store, phone and dev machine on the same Wi-Fi.

```bash
pnpm install                                   # once; root .npmrc keeps node-linker=isolated
pnpm --filter @unigate/api-client build        # the app imports dist/ of the shared packages
pnpm --filter @unigate/types build
pnpm --filter @unigate/validation build

cd apps/mobile
cp .env.example .env                           # EXPO_PUBLIC_API_URL=http://172.23.65.81:4000/api/v1 (the dev host's LAN IP)
pnpm start                                     # = expo start; press "s" to switch to Expo Go if it offers a dev build
```

Scan the QR code with the camera (iOS) or from Expo Go (Android). The bundle downloads from the dev machine; the app then calls the API at `EXPO_PUBLIC_API_URL` **from the phone**, so `localhost` will never work there — use the LAN IP. If the QR code does not connect (client isolation on the Wi-Fi), `pnpm start:tunnel` routes the bundle through Expo's tunnel; the API URL still has to be LAN-reachable.

The Account tab shows the API URL the build was made with. Change `.env`, then restart `expo start` — `EXPO_PUBLIC_*` values are inlined at bundle time.

Test accounts: the same seed users as the portal (`pnpm db:seed`; see `uat-checklist.md`). A customer account gets the customer tabs; an owner gets the vendor tabs; an account with both profiles gets both.

Useful commands:

```bash
pnpm --filter @unigate/mobile typecheck lint test    # what CI runs
pnpm --filter @unigate/mobile doctor                 # expo-doctor: SDK/package consistency, metro config, peer deps
pnpm --filter @unigate/api-client build test
cd apps/mobile && npx expo export --platform android # offline Metro bundle check without a phone
```

## 4. Authentication and token storage

|                 | Web portal (cookie mode)                 | Mobile app (Bearer mode, ADR-003)                                                                                                                                          |
| --------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clientType`    | `WEB`                                    | `IOS` \| `ANDROID` (`Platform.OS`)                                                                                                                                         |
| Where tokens go | httpOnly cookies set by the API          | `data.tokens.{accessToken, refreshToken}` in the login / OTP / refresh body                                                                                                |
| Access token    | never in JS                              | **memory only** (`src/lib/auth/tokens.ts`); a cold start always refreshes                                                                                                  |
| Refresh token   | `ug_rt` cookie                           | **`expo-secure-store`** (Keychain / Android Keystore), rotated on every refresh                                                                                            |
| CSRF            | `X-Requested-With: unigate-web` + Origin | not applicable — the API exempts Bearer requests                                                                                                                           |
| Extra headers   | —                                        | `Authorization: Bearer …`, `X-Client-Type`, `Accept-Language`                                                                                                              |
| Device          | —                                        | `deviceId` (stable UUID kept in SecureStore, regenerated on reinstall) + `deviceName` (`expo-device` manufacturer + model), so `GET /me/sessions` shows one row per device |

Flow, as implemented in `@unigate/api-client` and `src/lib/session.tsx`:

1. **Sign-in** — `POST /auth/login` or `POST /auth/otp/verify` (`purpose: LOGIN`) with the device info → store the pair → `GET /me` → `signedIn`. Errors are shown through `errorMessage(error)`: `errors.<CODE>` from the catalogue (`AUTH_INVALID_CREDENTIALS`, `AUTH_ACCOUNT_LOCKED`, …), the `_VERTICAL` variant when `details.vertical` is present, `errors.generic` for anything unknown. A 429 (`RATE_LIMITED`, `AUTH_OTP_THROTTLED`) starts a countdown from `Retry-After` / `details.retryAfterSeconds` and disables the button — the API escalates clients that retry immediately (api.md §11). `AUTH_NEW_DEVICE` / `AUTH_STEP_UP_REQUIRED` / `AUTH_PHONE_NOT_VERIFIED` show their message and, when the identifier is a phone number, offer the OTP path with the number prefilled.
2. **Cold start** — refresh token present → `GET /me` → the API answers `401 AUTH_TOKEN_MISSING` → the client calls `refreshSession()` once (`POST /auth/refresh { refreshToken }`), stores the rotated pair and retries `/me`. No refresh token → straight to login.
3. **During use** — any `401 AUTH_TOKEN_EXPIRED` triggers the same single refresh; concurrent requests share one in-flight refresh. If the refresh fails (family reuse detected, refresh expired, password changed) the tokens are cleared, `onUnauthorized` fires and the app returns to login. A 401 on login-type calls (`retryOnExpired: false`) never triggers refresh or sign-out.
4. **Sign-out** — `POST /auth/logout` (best effort), tokens cleared, query cache cleared.
5. **Permissions** — `useSession().can('bookings.read')` checks the resolved `permissions` array from `/me` (api.md §6.5); the tab set comes from the profiles (`tabsFor(audienceOf(me))`), the same rule as the portal shell.

## 5. `@unigate/api-client`

Ported from `apps/web/src/lib/{api-client,api,errors}.ts` into pure functions with an injectable transport:

```ts
const client = createApiClient({
  baseUrl,
  clientType: 'ANDROID',
  getAccessToken: () => tokens.getAccess(),
  refreshSession, // POST /auth/refresh with the stored token; resolves true when a new pair is stored
  onUnauthorized, // the session is gone — sign out
  headers: () => ({ 'Accept-Language': locale }),
});
const r = await client.api<BookingDto[]>('/bookings', { query: { page: 1, pageSize: 20 } });
// r: { ok: true, data, meta } | { ok: false, error: { status, code, message, details?, requestId?, retryAfterSeconds? } }
```

Also exported: `parseEnvelope`, `idempotencyKey()` (UUID v4 with a `getRandomValues` fallback), `fieldErrors(error)` (drops `body.` / `query.` / `params.`), `unmappedFieldErrors(error, known)`, `errorMessageKey(error)` / `errorMessage({ t, has }, error)`, `isThrottled(error)`, and the typed auth calls. The web app still has its own copy; switching it to this package is a follow-up (the package has no cookie mode yet — adding `credentials: 'include'` + the CSRF header is a small option).

## 6. Monorepo notes (pnpm isolated linking)

The root `.npmrc` keeps `node-linker=isolated`; nothing was hoisted. Expo SDK 54+ supports isolated dependencies, with two things to know:

- `metro.config.js` sets `watchFolders = [<root>]` and `resolver.nodeModulesPaths = [app/node_modules, root/node_modules]` (what `expo/metro-config` also detects for a pnpm workspace); symlink following is Metro's default and `expo-doctor` rejects overriding it, so it is not set.
- A package that Babel **injects** into app source must be a direct dependency of the app, because isolated linking does not let `apps/mobile` see nativewind's dependencies: `react-native-css-interop` (NativeWind's JSX runtime) and `expo-font` (peer of `@expo/vector-icons`) are therefore listed in `apps/mobile/package.json`. The symptom otherwise is `Unable to resolve module react-native-css-interop/jsx-runtime`.
- The shared packages are consumed from their `dist/`; Turborepo's `^build` dependency builds them before `typecheck` / `lint` / `test` of the app.
- ESLint: the app composes `eslint-config-expo`'s core/react/expo pieces with `@unigate/eslint-config/base`. Expo's TypeScript slice is left out on purpose — it registers a second `@typescript-eslint` plugin instance (pnpm isolates one per TypeScript major) and ESLint refuses to redefine a plugin.
- TypeScript is 6.0 in the app (what SDK 57 pins; `expo-doctor` checks it) while the rest of the monorepo is on 5.x; both are inside typescript-eslint's supported range. The `@unigate/tsconfig` strictness flags are repeated in `apps/mobile/tsconfig.json` because the shared base's `module: NodeNext` would break Metro's bundler resolution.

## 7. Localisation and RTL

- Locale resolution: stored preference → device language if `ar`/`en` → **`ar`** (Arabic-first). The choice persists in SecureStore and goes out as `Accept-Language` so API messages and OTP SMS follow it.
- Layout direction: React Native fixes direction at start-up from `I18nManager`. `applyLayoutDirection(locale)` calls `allowRTL`/`forceRTL` when the native direction disagrees and asks for a reload — `DevSettings.reload()` in development, an "restart the app" notice in store builds until M2 adds `expo-updates` for in-app reload. A 15-second loop breaker prevents a reload storm if the shell refuses to keep the setting.
- **Expo Go limitation:** Expo Go resets RTL preferences each time it opens a project, so switching to Arabic in Expo Go may render LTR until the next launch and may not stick. Development builds (`npx expo run:android` / EAS) and store builds behave correctly. `app.config.ts` enables `supportsRTL` through the `expo-localization` plugin for those builds.
- Components use only logical spacing/alignment classes (`ms-`, `me-`, `text-start`, `text-end`); the one directional icon (the chevron on Home) is mirrored explicitly.

## 8. Dark mode

`userInterfaceStyle: automatic`; NativeWind's `useColorScheme()` follows the system, `global.css` swaps the variables under `.dark:root`, and `src/theme/tokens.js` carries the resolved hex values for the few native props (tab bar, status bar, activity indicators) that cannot read CSS variables.

## 9. The customer journey (M1)

Every screen calls the real API with the same request bodies as the web portal (`apps/web/src/components/portal/*` is the behavioural reference); the DTOs come from `@unigate/types`, amounts stay strings and are grouped for display (`formatMoney`), dates go through `Intl` with the active locale (Gregorian calendar, Latin digits so numbers read the same in both languages).

| Screen | Calls | Notes |
| --- | --- | --- |
| New request | `GET /settings/public` (`platform.verticals_enabled` decides whether the Passengers / Goods toggle shows), `GET /vehicle-categories?transportType=`, `GET /reference/cities`, `GET /me/saved-locations`, `POST /trip-requests` ⧗ | `src/lib/trip-request-body.ts` builds the body exactly like the web form: integers for counts, `Number(x).toFixed(2)` strings for weight / volume / value / budget, only the active vertical's detail block, coordinates from the chosen saved location or else the city centre, `publish: true` for *Publish now*. A client-side gate mirrors the web's disabled-button conditions; a 422's `fieldErrors` land on the matching inputs (dotted keys such as `pickup.cityId`, `goodsDetails.cargoWeightKg`), the rest go into the banner through `unmappedFieldErrors`. |
| Request detail | `GET /trip-requests/{id}`, `POST …/publish`, `POST …/cancel { reason }` (≥ 5 chars), `DELETE /trip-requests/{id}` (draft) | Bidding countdown from `biddingClosesAt`; the passenger or goods block rendered from the DTO; *Compare bids* while the request is `PUBLISHED / PARTIALLY_AWARDED / FULLY_AWARDED / CLOSED_PARTIAL`. |
| Bids | `GET /trip-requests/{id}/bids?pageSize=100`, `POST /bids/{id}/accept` ⧗ `{}`, `POST /bids/{id}/reject { reason? }`, `POST /trip-requests/{id}/award` ⧗ `{ bidIds }` | Sort by total (default, cheapest first), owner rating or arrival. Single accept when the order allows partial fulfilment; otherwise the all-or-nothing group award needs exactly `vehiclesRequired − vehiclesAwarded` selections (the web's `RequestBids` rule). Error codes (`BID_EXPIRED`, `BID_VEHICLE_UNAVAILABLE`, `RULE_PARTIAL_AWARD_NOT_ALLOWED`, `RULE_AWARD_SET_INCOMPLETE`, `RULE_CREDIT_LIMIT_EXCEEDED`, `RULE_CREDIT_NOT_APPROVED`, `VEHICLE_NOT_DISPATCHABLE`, `TRIP_REQUEST_*`) all have catalogue text. |
| Booking detail | `GET /bookings/{id}`, `GET …/status-history`, `GET …/cancellation-quote` → `POST …/cancel` ⧗ `{ reasonCode, reasonText? }`, `POST …/dispute { category, subject, description }` | Snapshot fields for vehicle / plate / owner / driver; base + extras + VAT = total; `billingMode`: `PREPAID` + `PENDING_PAYMENT` shows **Pay**, `INVOICED` shows "billed on your monthly invoice" and no pay button. Cancel is quote-first (fee, refund, allowed reasons, `windowPassed`). **Track** while `trip.status` is a tracked state; **Rate** (below) after `COMPLETED`; **Dispute** on `IN_PROGRESS / COMPLETED`. |
| Ratings | `GET /ratings/eligible` filtered to the booking, `POST /ratings { bookingId, raterRole, subjectType, subjectId, score, comment? }` | One star row per remaining subject, as the web's `RatingPrompt`. |
| Complaints | `GET /complaints?status=`, `POST /complaints { againstType, category, subject, description, severity, bookingId? }` (categories from `platform.complaint_categories`), `GET /complaints/{id}`, `POST …/notes { body, isInternal: false }` | The raiser's view only; ops actions stay on the portal. |
| Corporate | `GET /customers/{id}/credit`, `GET /invoices?status=`, `GET /invoices/{id}`, `GET …/lines`, `GET …/pdf-url` → `expo-web-browser`, `POST /payments` ⧗ with `invoiceId` + `purpose: INVOICE_PAYMENT`, `GET /customers/{id}/statement?periodStart&periodEnd` (one calendar month) | Shown only when `me.profiles.customer.customerType === 'CORPORATE'`. `pdf-url` currently answers `501 INVOICE_RENDERING_NOT_AVAILABLE`; the app shows that as a banner. |
| Saved locations | `GET / POST / PATCH / DELETE /me/saved-locations` | Label, address, city; coordinates are the city centre until the maps picker lands (M2). |
| Inbox | `GET /notifications?pageSize&unreadOnly&cursor`, `POST /notifications/{id}/read`, `POST /notifications/read-all`, `DELETE /notifications/{id}`, `GET /notifications/unread-count` | Cursor list with load-more; the tab badge polls every 60 s while the app is foregrounded and refetches on return to foreground. |

## 10. Deep links and push

`src/lib/deep-link.ts` is the one resolver for the inbox rows, a tapped push notification and inbound `unigate://` / universal-link URLs (pure, unit-tested). It reads the same `data` keys as the web's `notifications/deep-link.ts`, in the same precedence:

| `data` key | Route | URL form |
| --- | --- | --- |
| `bookingId` | `/bookings/{id}` | `unigate://bookings/{id}` |
| `tripId` | `/track/{id}` | `unigate://track/{id}` |
| `tripRequestId` | `/requests/{id}` | `unigate://requests/{id}` |
| `invoiceId` | `/invoices/{id}` | `unigate://invoices/{id}` |
| `complaintId` | `/complaints/{id}` | `unigate://complaints/{id}` |
| — | `/pay/return?paymentId=…` | `unigate://pay/return?paymentId=…` (checkout return; only `paymentId` is read) |
| anything else (`settlementId`, `vehicleId`, `documentId`, …) | the inbox | — |

Ids must match `^[A-Za-z0-9-]{1,64}$`; nothing else from an inbound URL reaches the router. Expo Router maps the scheme path to the same screen files, so a cold-start `unigate://bookings/{id}` lands on the booking once the session is restored (a signed-out user is sent to login and the link is not replayed — M2).

**Push.** On every signed-in start the app runs `syncPushRegistration()`: permission → Android `default` channel → `getExpoPushTokenAsync({ projectId })` when an EAS project id exists, else the raw device token → `POST /notifications/devices { token, platform: IOS | ANDROID, appVersion }` (the API upserts on `token`). `addPushTokenListener` re-registers when the provider rotates the token. Sign-out calls `DELETE /notifications/devices/{token}` first, while the Bearer token is still valid, then `POST /auth/logout`. A tapped notification (foreground, background or cold start via `getLastNotificationResponse`) is routed through `routeForNotification(data)` — or `routeForUrl(data.url)` when the provider sends a link. In Expo Go and on simulators `registerPushToken()` resolves null and nothing is registered; `expo-notifications` stays lazily imported so Expo Go on Android does not crash at import time.

## 11. Live tracking and realtime

`app/(app)/track/[tripId].tsx` follows the web's `LiveTracking`: `GET /tracking/trips/{id}` is the source of truth (position, status, ETA, driver phone for the customer while active) and is polled every 15 s as the fallback; `GET /tracking/trips/{id}/history?limit=500` seeds the trail. `src/lib/realtime.ts` opens the `/rt` namespace on the API origin (`path: /api/v1/rt/socket.io`, websocket transport) with the **Bearer access token in `auth.token`** — never a query string (api.md §9.1) — joins `trip:{id}` with `room.join`, listens to `trip.location` (moves the dot, extends the trail) and `trip.status` (refetches), leaves the room on unmount. After every successful `POST /auth/refresh` the API client calls `refreshRealtimeAuth()`, which emits `auth.refresh { token }` so the server re-evaluates the rooms; sign-out disconnects the socket. The *Live* badge reflects the join ack; *Reconnecting…* means the HTTP poll is carrying the screen.

The map (`src/components/trip-map.tsx`) draws the vehicle, pickup / drop-off pins and the trail polyline with `react-native-maps`: Apple Maps on iOS needs nothing; Google Maps on Android needs `EXPO_PUBLIC_MAPS_ANDROID_KEY` at build time (`app.config.ts` puts it in `android.config.googleMaps.apiKey`; only the fact that one exists reaches JS). Without a key — and always inside Expo Go on Android — the screen shows the coordinates card (vehicle position, recorded time, speed, pickup / drop-off coordinates, ETA) so the flow is testable without a native build; an error boundary falls back to the same card if the native map throws.

## 12. Payments

`src/components/pay-screen.tsx` serves both `pay/[bookingId]` (a `PENDING_PAYMENT` + `PREPAID` booking) and `pay/invoice/[invoiceId]` (an `ISSUED / PARTIALLY_PAID / OVERDUE` invoice with a balance):

1. `GET /payments/config` → the enabled `methodTypes` (first one preselected) and `isMock`.
2. `POST /payments` ⧗ `{ bookingId | invoiceId, amount, currency, methodType, returnUrl, purpose: BOOKING_PAYMENT | INVOICE_PAYMENT }`. `returnUrl` is always the app scheme, `unigate://pay/return` — the API allow-lists the mobile scheme (`payment.service assertReturnUrl`) and refuses anything else with `PAYMENT_RETURN_URL_NOT_ALLOWED`, which the app shows as an ordinary error. (`Linking.createURL` would produce `exp://host/--/…` inside Expo Go, so the helper falls back to the scheme URL there.)
3. `action.type`: **REDIRECT** → the hosted page opens in `WebBrowser.openAuthSessionAsync(url, returnUrl)` with the page's `return` parameter rewritten to `unigate://pay/return?paymentId={id}`; when the session closes on that link the app goes to the return screen. **NONE** (bank transfer / cash) → the reference from `clientPayload.reference` (or the payment number) with "confirmed once reconciled". **FORM_POST / SDK** → "not supported in this build" (the gateway SDK lands later).
4. **Return** (`pay/return.tsx`) polls `GET /payments/{id}/status` with the bounded backoff in `src/lib/payment-poll.ts` (1 s, 2 s, … capped at 8 s, at most 9 attempts, transport errors retried, definitive API errors stop) until `PAID / FAILED / CANCELLED` (or the refund states), then shows the outcome and returns to the booking (with the "payment received" notice) or the invoice. The return itself proves nothing — the state is the API's (api.md §10). A deep-link return without the booking id reads `GET /payments/{id}` to find the way back.

**MockGateway in development.** The mock's hosted page is the web portal's `/pay/mock/{providerPaymentId}`, which needs a portal session the phone's browser rarely has. When `config.isMock` is true the pay screen therefore also shows the *Development gateway* buttons, which call the same dev-only `POST /payments/mock/checkout/{providerPaymentId} { outcome }` the page calls — the signed webhook, the job and the booking transition all run for real — and then hand off to the return screen. Real gateways never expose these buttons.

## 13. What M2 / M3 add

| Milestone | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M1** ✓  | The customer journey (§9–§12): new request for both verticals, request detail, bids with accept / group award / reject, booking detail with quote-first cancel, dispute, ratings, pay-now with the gateway hand-off and the return poller, live tracking over Socket.IO with a map, complaints, corporate credit / invoices / statement, saved locations, the cursor inbox with an unread badge, deep links and push-device registration; offset lists with status filters and load-more |
| **M2**    | Vendor side in the app (opportunity detail, bid submit / revise / withdraw, vehicle detail, dispatch); universal links (`https://` association files) and replaying a deep link after sign-in; a maps picker for saved locations and request addresses (coordinates today are the city centre); the real gateway SDK for `FORM_POST` / `SDK` actions; document upload from camera / gallery to presigned URLs with the malware-scan states; `expo-updates` for in-app reload after a language change; offline tolerance for lists; real icon/splash, EAS Build profiles, store listings (customer + vendor test accounts for review), crash reporting; `apps/web` switched to `@unigate/api-client` |
| **M3**    | Driver surface in the same app: my trips, status transitions, **background location** via `expo-location` foreground service posting to `POST /tracking/ping` / `/ping/batch`; the driver PWA retired once parity is proven                                                                                                                                                                                                                                                                |
