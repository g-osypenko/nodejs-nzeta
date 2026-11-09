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
const USERS = Number(__ENV.USERS || 2000);
const SEED_PASSWORD = __ENV.SEED_PASSWORD || 'seed-password-01';
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'admin@lch.local';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'perf-admin-password';
const TOKENS = Number(__ENV.TOKENS || 50);
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

// storm: the handshake load of RATE plus a login burst of LOGIN_RATE at the same time — does one
// module degrade another on the shared CPU?
const LOGIN_RATE = Number(__ENV.LOGIN_RATE || 60);
const NAMES = [
  'handshake',
  'login',
  'me',
  'licenses',
  'config-get',
  'config-put',
  'plans',
  'admin-list',
];

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  scenarios:
    SCENARIO === 'storm'
      ? { handshake: arrival('handshake', RATE), login: arrival('loginFlow', LOGIN_RATE) }
      : { load: arrival(SCENARIO === 'login' ? 'loginFlow' : SCENARIO, RATE) }, // `login` is the setup helper
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

function login(email, password) {
  const res = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({ email, password }), {
    headers: JSON_HEADERS,
    tags: { name: 'login' },
  });
  if (res.status !== 200) fail(`login ${email} → ${res.status} ${res.body}`);
  return res.json('token');
}

export function setup() {
  // The harness passes ready sessions, so setup logins (scrypt) do not land in the measured CPU.
  if (__ENV.TOKENS_LIST || __ENV.ADMIN_TOKEN) {
    return {
      tokens: (__ENV.TOKENS_LIST || '').split(',').filter(Boolean),
      adminToken: __ENV.ADMIN_TOKEN || null,
    };
  }
  const data = { tokens: [], adminToken: null };
  if (SCENARIO === 'cabinet' || SCENARIO === 'mixed') {
    for (let i = 1; i <= TOKENS; i += 1)
      data.tokens.push(login(`seed-${i}@lch.local`, SEED_PASSWORD));
  }
  if (SCENARIO === 'admin') data.adminToken = login(ADMIN_EMAIL, ADMIN_PASSWORD);
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
  const headers = { authorization: `Bearer ${token}` };
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

export function loginFlow() {
  const res = http.post(
    `${BASE}/api/v1/auth/login`,
    JSON.stringify({ email: `seed-${randInt(1, USERS)}@lch.local`, password: SEED_PASSWORD }),
    { headers: JSON_HEADERS, tags: { name: 'login' } },
  );
  check(res, { 'login 200': (x) => x.status === 200 });
}

export function plans() {
  const res = http.get(`${BASE}/api/v1/plans`, { tags: { name: 'plans' } });
  check(res, { 'plans 200': (x) => x.status === 200 });
}

export function admin(data) {
  const offset = randInt(0, Math.max(0, LICENSES - 50));
  const res = http.get(`${BASE}/api/v1/admin/licenses?limit=50&offset=${offset}`, {
    headers: { authorization: `Bearer ${data.adminToken}` },
    tags: { name: 'admin-list' },
  });
  check(res, { 'admin 200': (x) => x.status === 200 });
}

// Typical hour: 80 % handshake, 15 % cabinet, 3 % login, 2 % plans.
export function mixed(data) {
  const r = Math.random();
  if (r < 0.8) return handshake();
  if (r < 0.95) return cabinet(data);
  if (r < 0.98) return loginFlow();
  return plans();
}

export function handleSummary(data) {
  return { [OUT]: JSON.stringify(data) };
}
