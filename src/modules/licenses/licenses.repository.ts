import type {
  LicenseRow,
  LicenseStatus,
  OrderRow,
  PaymentResult,
  PlanRow,
} from '../../shared/db/rows.js';

export interface NewOrder {
  userId: string;
  planId: string;
  amountCents: number;
  idempotencyKey: string;
  processId: string;
}

export interface OrderWithLicense extends OrderRow {
  licenseKey: string | null;
}

export interface PaymentInput {
  eventId: string;
  orderId: string;
  result: PaymentResult;
  generateKey: () => string;
}

export type PaymentOutcome =
  { kind: 'DUPLICATE' } | { kind: 'FAILED' } | { kind: 'PAID'; licenseKey: string };

export interface LicenseFilter {
  status?: LicenseStatus | undefined;
  limit: number;
  offset: number;
}

/** Admin registry read model: license + owner email, produced by a single query. */
export interface LicenseWithOwner extends LicenseRow {
  ownerEmail: string | null;
}

export interface NewLicense {
  userId: string | null;
  durationDays: number;
  generateKey: () => string;
}

/** Port of the licenses module (shop + admin registry). */
export interface LicensesRepository {
  listPlans(): Promise<PlanRow[]>;
  findPlan(id: string): Promise<PlanRow | null>;
  /** Idempotent by (userId, idempotencyKey): a replay returns the existing order with `created: false`. */
  createOrder(order: NewOrder): Promise<{ order: OrderRow; created: boolean }>;
  findOrder(id: string): Promise<OrderWithLicense | null>;
  /**
   * Atomic: records the provider event (dedupe by eventId), closes the order and,
   * on success, issues exactly one license for it.
   * @throws AppError NOT_FOUND | ORDER_NOT_PAYABLE
   */
  applyPayment(input: PaymentInput): Promise<PaymentOutcome>;
  listUserLicenses(userId: string): Promise<LicenseRow[]>;
  /** One query regardless of page size (no N+1, spec.md §4.8). */
  listLicenses(filter: LicenseFilter): Promise<LicenseWithOwner[]>;
  issueLicense(input: NewLicense): Promise<LicenseRow>;
  banLicense(id: string): Promise<LicenseRow | null>;
  resetHwid(id: string): Promise<LicenseRow | null>;
}
