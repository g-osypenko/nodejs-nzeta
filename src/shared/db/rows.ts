import type { UserRole } from '../context.js';

/**
 * Row shapes of the persistence model (mirror of migrations/*.sql, camelCased).
 * One model-placement strategy for the whole project: tables are described once here,
 * both the in-memory store and the Postgres repositories return these shapes.
 */

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
}

export interface SessionRow {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}

export interface PlanRow {
  id: string;
  name: string;
  durationDays: number;
  priceCents: number;
}

export type OrderStatus = 'PENDING' | 'PAID' | 'FAILED';

export interface OrderRow {
  id: string;
  userId: string;
  planId: string;
  status: OrderStatus;
  amountCents: number;
  idempotencyKey: string;
  processId: string;
  createdAt: Date;
  paidAt: Date | null;
}

export type PaymentResult = 'SUCCEEDED' | 'FAILED';

export interface PaymentEventRow {
  eventId: string;
  orderId: string;
  result: PaymentResult;
  receivedAt: Date;
}

export type LicenseStatus = 'UNACTIVATED' | 'ACTIVE' | 'BANNED';

export interface LicenseRow {
  id: string;
  key: string;
  hwid: string | null;
  status: LicenseStatus;
  userId: string | null;
  orderId: string | null;
  durationDays: number;
  activatedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface ConfigRow {
  id: string;
  userId: string;
  name: string;
  payload: JsonObject;
  updatedAt: Date;
}
