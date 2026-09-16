/**
 * k6 baseline load test against the agreed year-one estimates (OQ-15, NFR-01…NFR-09 `ESTIMATE`):
 * 10k users, 2k vehicles, 500 requests/day, 200 concurrently tracked trips (≈ 20 tracking pings/s),
 * Hajj/Umrah peaks at 3× baseline. This script exercises the request path a customer and a vendor
 * hit most — session, settings, request/booking lists, notifications — at 3× the expected peak of
 * signed-in users, and asserts the latency budgets from docs/hardening.md §5.
 *
 *   k6 run -e K6_BASE_URL=http://172.23.65.81:4000/api/v1 \
 *          -e K6_IDENTIFIER=customer@matrix.test -e K6_PASSWORD='…' \
 *          -e K6_VUS=60 -e K6_DURATION=3m tools/load/k6-baseline.js
 *
 * Run against a NON-production environment with RATE_LIMIT_ENABLED=false (or an allow-listed IP):
 * the user tiers (300 reads / min) are deliberately below what one VU generates. Credentials come
 * from the environment only. Tracking ingest is covered separately by k6-tracking.js once trips
 * exist; it needs driver sessions bound to active trips.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.K6_BASE_URL || 'http://localhost:4000/api/v1';
const VUS = Number(__ENV.K6_VUS || 30);
const DURATION = __ENV.K6_DURATION || '2m';

const login = new Trend('unigate_login_ms', true);
const lists = new Trend('unigate_list_ms', true);

export const options = {
  scenarios: {
    portal: { executor: 'ramping-vus', startVUs: 1, stages: [{ duration: '30s', target: VUS }, { duration: DURATION, target: VUS }, { duration: '30s', target: 0 }] },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    unigate_login_ms: ['p(95)<800'],
    unigate_list_ms: ['p(95)<500'],
    http_req_duration: ['p(95)<800', 'p(99)<1500'],
  },
};

function envelope(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}

export function setup() {
  const identifier = __ENV.K6_IDENTIFIER;
  const password = __ENV.K6_PASSWORD;
  if (!identifier || !password) throw new Error('K6_IDENTIFIER and K6_PASSWORD are required (never hard-code them)');
  const res = http.post(`${BASE}/auth/login`, JSON.stringify({ identifier, password, clientType: 'ANDROID', deviceId: 'k6-baseline-0001', deviceName: 'k6' }), { headers: { 'Content-Type': 'application/json' } });
  const body = envelope(res);
  if (res.status !== 200 || !body || !body.data || !body.data.tokens) throw new Error(`login failed: ${res.status} ${res.body}`);
  return { accessToken: body.data.tokens.accessToken, refreshToken: body.data.tokens.refreshToken, identifier, password };
}

export default function (data) {
  const auth = { headers: { Authorization: `Bearer ${data.accessToken}` } };

  // 1 in 20 iterations re-authenticates: logins are the expensive path (Argon2id).
  if (__ITER % 20 === 0) {
    const res = http.post(`${BASE}/auth/login`, JSON.stringify({ identifier: data.identifier, password: data.password, clientType: 'ANDROID', deviceId: `k6-baseline-vu-${String(__VU).padStart(4, '0')}` }), { headers: { 'Content-Type': 'application/json' } });
    login.add(res.timings.duration);
    check(res, { 'login 200': (r) => r.status === 200 });
  }

  const me = http.get(`${BASE}/me`, auth);
  lists.add(me.timings.duration);
  check(me, { 'me 200': (r) => r.status === 200 });

  const pub = http.get(`${BASE}/settings/public`);
  lists.add(pub.timings.duration);
  check(pub, { 'settings 200': (r) => r.status === 200 });

  for (const path of ['/trip-requests?pageSize=20', '/bookings?pageSize=20', '/notifications?pageSize=20', '/notifications/unread-count']) {
    const res = http.get(`${BASE}${path}`, auth);
    lists.add(res.timings.duration);
    check(res, { [`${path} ok`]: (r) => r.status === 200 || r.status === 403 });
  }
  sleep(1 + Math.random());
}
