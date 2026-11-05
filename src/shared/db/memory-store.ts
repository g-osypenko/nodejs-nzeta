import type {
  ConfigRow,
  LicenseRow,
  OrderRow,
  PaymentEventRow,
  PlanRow,
  SessionRow,
  UserRow,
} from './rows.js';

/**
 * Static in-memory "database" for the prototype stage (DATA_SOURCE=memory).
 * Atomicity: Node runs JS on one thread, so a repository method that checks and
 * writes without an `await` in between cannot interleave with another request.
 */
export interface MemoryStore {
  users: Map<string, UserRow>;
  sessions: Map<string, SessionRow>;
  plans: Map<string, PlanRow>;
  orders: Map<string, OrderRow>;
  paymentEvents: Map<string, PaymentEventRow>;
  licenses: Map<string, LicenseRow>;
  configs: Map<string, ConfigRow>;
}

/** Reference data — the same rows are inserted by migrations/001_init.sql. */
export const PLANS: readonly PlanRow[] = [
  { id: 'monthly', name: 'Monthly', durationDays: 30, priceCents: 999 },
  { id: 'quarterly', name: 'Quarterly', durationDays: 90, priceCents: 2499 },
  { id: 'yearly', name: 'Yearly', durationDays: 365, priceCents: 7999 },
];

export function createMemoryStore(): MemoryStore {
  return {
    users: new Map(),
    sessions: new Map(),
    plans: new Map(PLANS.map((p) => [p.id, p])),
    orders: new Map(),
    paymentEvents: new Map(),
    licenses: new Map(),
    configs: new Map(),
  };
}
