# The mobile app — Expo (React Native) for customers and vehicle owners

**Status:** M0 delivered 2026-09-16 — scaffold, sign-in (password and phone OTP) against the real API, session bootstrap with transparent refresh, role-aware tabs with read-only lists, Arabic/English with RTL, push token obtained and logged. Decision record: [ADR-011](decisions/ADR-011-mobile-expo-over-pwa.md). Drivers keep the [PWA](driver-app.md) until M3.

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
| Push       | `expo-notifications`                                                                                                                                                             | M0 only obtains the token and logs it; registration with the API is M1                                                                                                             |
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
│  └─ (app)/_layout.tsx       role-aware <Tabs>; hidden tabs stay registered (href: null)
│     ├─ index.tsx            Home: who you are + shortcuts
│     ├─ requests.tsx         GET /trip-requests            (customer)
│     ├─ opportunities.tsx    GET /opportunities            (vendor)
│     ├─ bookings.tsx         GET /bookings                 (both)
│     ├─ fleet.tsx            GET /vehicles                 (vendor)
│     ├─ notifications.tsx    GET /notifications            (cursor list, first page)
│     └─ account.tsx          name, phone, email, roles, language switch, sign out
├─ src/
│  ├─ config.ts               apiUrl / appVersion / platformClientType()
│  ├─ lib/api.ts              the one ApiClient (refreshSession + onUnauthorized wired) and fetchOrThrow
│  ├─ lib/auth/tokens.ts      access token in memory, refresh token in SecureStore
│  ├─ lib/auth/device.ts      stable deviceId (UUID in SecureStore) + deviceName (expo-device)
│  ├─ lib/auth/events.ts      "signed out" listener so the plain client can reach React
│  ├─ lib/session.tsx         SessionProvider / useSession(): status, me, audience, can(), signIn(), signOut()
│  ├─ lib/tabs.ts             audienceOf(me) and tabsFor(audience) — pure, unit-tested
│  ├─ lib/push.ts             registerPushToken(): permission → token → console.warn
│  ├─ i18n/                   I18nProvider / useI18n(): t, has, errorMessage, locale, setLocale; rtl.ts
│  ├─ components/ui.tsx       Screen, Title, Field, Button, ErrorBanner, Badge, Card, Loading, Empty
│  ├─ components/list-screen.tsx  generic first-page list: number · status · date
│  └─ theme/tokens.js         Tailwind colour map + resolved hex palette for native props
├─ global.css                 :root / .dark:root CSS variables (identical to apps/web/src/app/globals.css)
├─ tailwind.config.js         nativewind preset, darkMode 'class', the same colour names as the web
├─ metro.config.js            monorepo resolution (§6) + NativeWind
├─ babel.config.js            babel-preset-expo with jsxImportSource nativewind
├─ eslint.config.mjs · tsconfig.json · vitest.config.ts · .env.example
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
- Layout direction: React Native fixes direction at start-up from `I18nManager`. `applyLayoutDirection(locale)` calls `allowRTL`/`forceRTL` when the native direction disagrees and asks for a reload — `DevSettings.reload()` in development, an "restart the app" notice in store builds until M1 adds `expo-updates` for in-app reload. A 15-second loop breaker prevents a reload storm if the shell refuses to keep the setting.
- **Expo Go limitation:** Expo Go resets RTL preferences each time it opens a project, so switching to Arabic in Expo Go may render LTR until the next launch and may not stick. Development builds (`npx expo run:android` / EAS) and store builds behave correctly. `app.config.ts` enables `supportsRTL` through the `expo-localization` plugin for those builds.
- Components use only logical spacing/alignment classes (`ms-`, `me-`, `text-start`, `text-end`); the one directional icon (the chevron on Home) is mirrored explicitly.

## 8. Dark mode

`userInterfaceStyle: automatic`; NativeWind's `useColorScheme()` follows the system, `global.css` swaps the variables under `.dark:root`, and `src/theme/tokens.js` carries the resolved hex values for the few native props (tab bar, status bar, activity indicators) that cannot read CSS variables.

## 9. Push notifications (M0 scope)

`registerPushToken()` runs once after sign-in: asks permission, creates the Android `default` channel, then `getExpoPushTokenAsync({ projectId })` when an EAS project id exists, else the raw device token (`getDevicePushTokenAsync`). The token is **logged with `console.warn` and not sent anywhere**. On a simulator, or in Expo Go on Android (SDK 53+ removed remote push there), it resolves to null quietly.

## 10. What M1 / M2 / M3 add

| Milestone | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M1**    | Device registration (`POST /me/devices` + the notifications module's push channel); deep links `unigate://bookings/{id}` etc. and universal links; detail screens for requests / opportunities / bookings / vehicles; create trip request (passenger vertical); vendor bid submit / revise; accept bid / award on the customer side; infinite scroll on lists and the cursor inbox; `expo-updates` for in-app reload after a language change; `apps/web` switched to `@unigate/api-client` |
| **M2**    | Payment hand-off (hosted page in an in-app browser + return deep link), document upload from camera / gallery to presigned URLs with the malware-scan states, offline tolerance for lists, real icon/splash, EAS Build profiles, store listings (customer + vendor test accounts for review), crash reporting                                                                                                                                                                              |
| **M3**    | Driver surface in the same app: my trips, status transitions, **background location** via `expo-location` foreground service posting to `POST /tracking/ping` / `/ping/batch`; the driver PWA retired once parity is proven                                                                                                                                                                                                                                                                |
