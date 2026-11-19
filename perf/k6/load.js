// k6 load scenarios of spec.md §9. Open model: constant-arrival-rate — the offered load does not
// drop when the server slows down (no coordinated omission); unserved arrivals are counted as
// dropped_iterations, which is itself the saturation signal.
//
//   k6 run -e SCENARIO=handshake -e RATE=200 -e DURATION=30s /scripts/load.js
//
// Data: `npm run db:seed -- --users=2000 --licenses=200000` (deterministic, see src/shared/db/seed.ts):
// license N has key APP-<N as 12 hex digits> and HWID seed-hwid-N, user N is seed-N@lch.local.
import { check, fail } from 'k6';
import http from 'k6/http';

const BASE = __ENV.BASE_URL || 'http://app:3000';
const SCENARIO = __ENV.SCENARIO || 'handshake';
const RATE = Number(__ENV.RATE || 100);
const DURATION = __ENV.DURATION || '30s';
const LICENSES = Number(__ENV.LICENSES || 200000);
const OUT = __ENV.OUT || '/out/summary.json';

// Expected business answers (403 HWID_MISMATCH / KEY_EXPIRED, 404 KEY_NOT_FOUND) are not failures.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

function arrival(exec, rate) {
  return {
    executor: 'constant-arrival-rate',
    exec,
    rate,
    timeUnit: '1s',
    duration: DURATION,
    preAllocatedVUs: Math.min(Math.max(20, Math.ceil(rate / 2)), 1000),
    maxVUs: Math.min(Math.max(50, rate * 2), 3000),
    gracefulStop: '5s',
  };
}

const NAMES = ['handshake', 'me', 'licenses', 'config-get', 'config-put', 'plans', 'admin-list'];

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  // Sign-in is passwordless (ADR 0011): there is no CPU-heavy login to load or to storm with any
  // more, so the `login` and `storm` scenarios of Lab 5 are gone.
  scenarios: { load: arrival(SCENARIO, RATE) },
  thresholds: {
    // No SLA gate here: thresholds only make k6 keep these values (and per-request-type
    // sub-metrics) in the summary.
    http_req_failed: ['rate>=0'],
    dropped_iterations: ['count>=0'],
    ...Object.fromEntries(NAMES.map((n) => [`http_req_duration{name:${n}}`, ['max>=0']])),
  },
};

const JSON_HEADERS = { 'content-type': 'application/json' };

function seededKey(n) {
  const h = n.toString(16).toUpperCase().padStart(12, '0');
  return `APP-${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`;
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Session cookie as a browser sends it (ADR 0011); reads need no CSRF proof. */
function sessionHeaders(token) {
  return { cookie: `lch_session=${token}`, 'sec-fetch-site': 'same-origin' };
}

export function setup() {
  // The harness creates sessions before the run (scripts/perf/stand.ts), so setup is not measured.
  const data = {
    tokens: (__ENV.TOKENS_LIST || '').split(',').filter(Boolean),
    adminToken: __ENV.ADMIN_TOKEN || null,
  };
  if ((SCENARIO === 'cabinet' || SCENARIO === 'mixed') && data.tokens.length === 0)
    fail('TOKENS_LIST is empty: run through `npm run perf:load`');
  if (SCENARIO === 'admin' && !data.adminToken) fail('ADMIN_TOKEN is empty');
  return data;
}

// 85 % own key + own HWID, 10 % another HWID, 5 % unknown key (spec §9).
export function handshake() {
  const r = Math.random();
  const n = randInt(1, LICENSES);
  const key =
    r < 0.05
      ? `APP-FFFF-FFFF-${randInt(0, 0xffff).toString(16).toUpperCase().padStart(4, '0')}`
      : seededKey(n);
  const hwid = r < 0.15 ? 'perf-other-device' : `seed-hwid-${n}`;
  const res = http.post(
    `${BASE}/api/v1/loader/handshake`,
    JSON.stringify({ license_key: key, hwid }),
    {
      headers: JSON_HEADERS,
      tags: { name: 'handshake' },
    },
  );
  check(res, { 'handshake answered': (x) => x.status < 500 });
}

const PROFILE = {
  payload: {
    sensitivity: 0.6,
    resolution: { width: 1920, height: 1080 },
    smoothing: { algorithm: 'ema', strength: 0.3 },
    fpsLimit: 144,
  },
};

export function cabinet(data) {
  const token = data.tokens[randInt(0, data.tokens.length - 1)];
  const headers = sessionHeaders(token);
  const step = randInt(0, 3);
  let res;
  if (step === 0) res = http.get(`${BASE}/api/v1/auth/me`, { headers, tags: { name: 'me' } });
  if (step === 1)
    res = http.get(`${BASE}/api/v1/licenses`, { headers, tags: { name: 'licenses' } });
  if (step === 2)
    res = http.get(`${BASE}/api/v1/configs/perf-profile`, {
      headers,
      tags: { name: 'config-get' },
    });
  if (step === 3) {
    res = http.put(`${BASE}/api/v1/configs/perf-profile`, JSON.stringify(PROFILE), {
      headers: { ...headers, ...JSON_HEADERS },
      tags: { name: 'config-put' },
    });
  }
  check(res, { 'cabinet answered': (x) => x.status < 500 });
}

export function plans() {
  const res = http.get(`${BASE}/api/v1/plans`, { tags: { name: 'plans' } });
  check(res, { 'plans 200': (x) => x.status === 200 });
}

export function admin(data) {
  const offset = randInt(0, Math.max(0, LICENSES - 50));
  const res = http.get(`${BASE}/api/v1/admin/licenses?limit=50&offset=${offset}`, {
    headers: sessionHeaders(data.adminToken),
    tags: { name: 'admin-list' },
  });
  check(res, { 'admin 200': (x) => x.status === 200 });
}

// Typical hour: 80 % handshake, 18 % cabinet, 2 % plans (sign-in by code is a few cheap queries).
export function mixed(data) {
  const r = Math.random();
  if (r < 0.8) return handshake();
  if (r < 0.98) return cabinet(data);
  return plans();
}

export function handleSummary(data) {
  return { [OUT]: JSON.stringify(data) };
}
