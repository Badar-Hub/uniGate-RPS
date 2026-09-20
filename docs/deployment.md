# Deployment (Phase 16)

Single-host container deployment of the whole stack, plus the mobile release builds. This is the
"one VM" shape from [architecture.md §13](architecture.md#13-deployment-architecture) — the same
images run unchanged behind a load balancer with managed Postgres / Redis / object storage when
UniGate picks a hosting region (OQ-12).

| Artefact | Purpose |
|---|---|
| [`docker/Dockerfile.api`](../docker/Dockerfile.api) | API, worker and one-shot jobs (migrate, seed, CLIs) — one image, three commands |
| [`docker/Dockerfile.web`](../docker/Dockerfile.web) | Next.js portal, standalone output |
| [`docker/nginx/nginx.conf`](../docker/nginx/nginx.conf) | TLS edge: `:443` portal + `/api`, `:9443` object storage, `:80` redirect |
| [`docker-compose.prod.yml`](../docker-compose.prod.yml) | postgres · redis · minio · mailhog · migrate → api → worker → web → proxy |
| [`.env.deploy.example`](../.env.deploy.example) | Every variable the stack needs; copy to `.env.deploy` (chmod 600) |
| [`scripts/deploy/make-certs.sh`](../scripts/deploy/make-certs.sh) | Private CA + server certificate when there is no public domain |
| [`scripts/deploy/vm-deploy.sh`](../scripts/deploy/vm-deploy.sh) | `deploy` · `seed` · `status` · `logs` |
| [`scripts/mobile/build-android.sh`](../scripts/mobile/build-android.sh) | Signed APK + AAB on Linux without an Expo account |
| [`apps/mobile/eas.json`](../apps/mobile/eas.json) | EAS Build / Submit profiles (cloud builds, iOS) |

## 1. Host

Ubuntu 22.04+ with Docker Engine + Compose v2; the deploying user in the `docker` group. Sizing
that ran comfortably: 8 vCPU / 8 GB RAM / 50 GB disk (image builds peak at ~3 GB RAM; the Android
build needs ~4 GB). Memory limits per container are in the compose file and sum to ≈5.5 GB.

## 2. Configuration

```bash
git clone <repo> unigate-rps && cd unigate-rps
cp .env.deploy.example .env.deploy && chmod 600 .env.deploy
```

Fill in `.env.deploy`. Rules enforced by the API at boot (`packages/config/src/env.ts`):

- `NODE_ENV=staging` is the tier for a box without procured vendors: production build, but the mock
  gateway, console OTP/SMS and MailHog are still allowed. `production` refuses to boot with any of
  them, with `API_DOCS_ENABLED=true`, or with `SEED_ADMIN_*` set.
- `APP_URL` / `API_URL` **must be https** outside development. There is no override.
- Every secret is checked against a placeholder pattern; generate them (`openssl rand -hex 32`,
  `ENCRYPTION_KEY` = `openssl rand -base64 32`).
- `DATABASE_URL`, `REDIS_URL` and `SMTP_HOST` are injected by the compose file (service names).

## 3. TLS

Everything public goes through the nginx container; the application containers publish no ports.

- **With a domain**: put the issued certificate and key at `certs/server.crt` / `certs/server.key`
  (Let's Encrypt via certbot on the host works: `--webroot` is not needed because port 80 is only a
  redirect — use `certbot certonly --standalone` while the proxy is stopped, or DNS-01). Restart the
  proxy after renewal: `docker compose -f docker-compose.prod.yml --env-file .env.deploy restart proxy`.
- **Without a domain** (LAN IP, this VM): `scripts/deploy/make-certs.sh` creates a private CA
  (`certs/ca.crt`, 10 years) and a leaf for the IP (397 days — Apple's ceiling). Install `ca.crt` on
  every client:
  - Windows: `certutil -addstore -user Root certs\ca.crt` (or double-click → *Trusted Root CAs*).
  - macOS: Keychain Access → System → import → *Always Trust*.
  - Android: Settings → Security → Encryption & credentials → Install a certificate → CA certificate.
    Chrome then trusts it; **apps do not** unless they opt in — the UniGate app bundles the CA
    (below), so testers only need the device install for the browser.
  - iOS: AirDrop / e-mail `ca.crt` → Settings → Profile Downloaded → Install, then Settings →
    General → About → Certificate Trust Settings → enable full trust. Apps use the system store, so
    the UniGate app works after this step.
  - Node / curl on a workstation: `NODE_EXTRA_CA_CERTS=certs/ca.crt`, `curl --cacert certs/ca.crt`.

The API and web containers get `NODE_EXTRA_CA_CERTS=/certs/ca.crt` so server-to-server calls
(presigned-upload verification against MinIO on `:9443`) trust the same CA. With a public
certificate the mount is harmless.

## 4. Deploy

```bash
scripts/deploy/make-certs.sh            # once (or drop in a real certificate)
scripts/deploy/vm-deploy.sh             # build images → migrate → start everything
scripts/deploy/vm-deploy.sh seed        # first deploy only: reference data + SEED_ADMIN_* user
scripts/deploy/vm-deploy.sh status
```

Order inside `up`: postgres/redis/minio healthy → `migrate` (`prisma migrate deploy`, exits 0) →
`api` healthy (`GET /api/v1/health`) → `worker` and `web` → `proxy`. A failed migration stops the
rollout before the old API is replaced. Re-running `vm-deploy.sh` after `git pull` rebuilds only the
layers that changed and recreates only the containers whose image or config changed.

Other one-shot commands run inside the API image:

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env.deploy run --rm --no-deps -T api"
$C node_modules/.bin/tsx src/cli/create-admin.ts            # another admin
E2E_PASSWORD=… $C node_modules/.bin/tsx src/cli/e2e-seed.ts # UAT customer + vendor (refused in production)
```

Backups: `scripts/db/backup.sh` works unchanged against the loopback-published Postgres (`127.0.0.1:5433`);
MinIO data lives in the `minio-data` volume — snapshot the volume or `mc mirror` it.

### What is still development-grade on a staging box

| Item | Why | Replace with |
|---|---|---|
| MailHog (`:8025`, plain http) | no SMTP relay procured | `EMAIL_PROVIDER=smtp` + relay credentials; remove the service |
| Console OTP / SMS | no SMS vendor (B-9 / OQ-10) | vendor adapter + `OTP_PROVIDER` / `SMS_PROVIDER` |
| Mock payment gateway | no gateway contract | `PAYMENT_PROVIDER=hyperpay|moyasar|…` + keys |
| MinIO | fine as a service; single node | any S3-compatible managed bucket (`STORAGE_*`) |
| Private CA | no domain | public certificate, same file names |
| `SCAN_PROVIDER=none` | no scanner (A-25) | ClamAV container + `SCAN_PROVIDER=clamav` |

## 5. Mobile app

### Android (this repository, no Expo account)

`scripts/mobile/build-android.sh` runs on Linux (the VM) and needs nothing installed with sudo:

```bash
scripts/mobile/build-android.sh setup      # JDK 17 + Android SDK 36 into ~/android-tools (~2 GB, once)
scripts/mobile/build-android.sh keystore   # upload key in ~/unigate-keys — BACK IT UP, Play ties the listing to it
cp certs/ca.crt apps/mobile/certs/ca.pem   # staging only: the app trusts the private CA (plugins/with-network-security.js)
echo EXPO_PUBLIC_API_URL=https://<host>/api/v1 > apps/mobile/.env
scripts/mobile/build-android.sh build      # prebuild → gradle → ~/unigate-builds/<version>/unigate-<version>-<code>.{apk,aab}
```

- `.apk` — sideload on any Android phone (allow "install unknown apps"), or share through a link.
- `.aab` — the Play Store upload format. **Do not bundle `ca.pem` in a store build**: delete
  `apps/mobile/certs/` first, so the network security config only trusts system CAs.
- Bump `android.versionCode` in `app.config.ts` for every Play upload (`buildNumber` for iOS).

### iOS

An iOS binary can only be produced on macOS (Xcode) or by a cloud macOS builder — this Linux/Windows
setup cannot compile it. Two routes:

1. **EAS Build (recommended, no Mac needed)**: `npm i -g eas-cli`, `eas login` (free Expo account),
   `cd apps/mobile && eas build --platform ios --profile preview` (ad-hoc, install via link on
   registered devices) or `--profile production` (App Store). EAS asks for the Apple Developer
   credentials once and manages certificates/provisioning. `eas.json` already carries the profiles;
   `EXPO_PUBLIC_API_URL` per profile is set there.
2. **Local**: any Mac with Xcode 16: `npx expo prebuild --platform ios && open ios/UniGate.xcworkspace`,
   set the team, Product → Archive → Distribute.

Both need an **Apple Developer Program** membership (USD 99/year) before anything can be signed.

### Store submission

| Step | Google Play | Apple App Store |
|---|---|---|
| Account | Play Console developer account (one-off USD 25) | Apple Developer Program (USD 99/yr) |
| Identity | `sa.unigate.app`; upload key from `build-android.sh keystore` (or let Play manage signing and upload with that key) | Bundle id `sa.unigate.app`, created in the developer portal; EAS creates certificates |
| Binary | Upload the `.aab` under *Testing → Internal testing* first, then promote | `eas submit -p ios` (or Transporter / Xcode) → TestFlight → App Store Connect review |
| Listing | Name, short/long description (ar + en), 2–8 screenshots per form factor, feature graphic 1024×500, app icon 512×512, category *Maps & Navigation* or *Business* | Name, subtitle, description (ar + en), screenshots for 6.7" and 6.1" iPhones, 1024×1024 icon, category *Business* |
| Policy forms | Data safety (location, photos, identifiers), privacy policy URL, content rating questionnaire, target audience, background-location declaration with a demo video (drivers stream location — required) | App privacy "nutrition label", privacy policy URL, `NSLocation…` purpose strings (already in `app.config.ts`), background location justification in review notes |
| Review notes | Test account (customer + vendor) and the staging URL with the CA note | Same; Apple will need a reachable https API — a public domain and certificate, not the private CA |
| Rollout | Internal → closed → open → production tracks | TestFlight (up to 10 000 testers) → App Store |

Typical review time: Google a few hours to 2 days for a new app (longer with background location);
Apple 24–48 hours. Both stores reject binaries whose backend is unreachable, so the public
deployment (domain + certificate + real providers) must exist before submission — the `staging`
tier is for internal testing only.

### Over-the-air updates

JS-only changes can ship without a store release through `expo-updates` (EAS Update) once the app is
built with it; that is not enabled yet — every change today is a new binary.
