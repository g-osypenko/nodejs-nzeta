import { z } from 'zod';
import type { LicenseRow, OrderRow, PlanRow } from '../../shared/db/rows.js';
import { isExpired } from '../../shared/license-key.js';
import type { OrderWithLicense } from './licenses.repository.js';

export const IdParams = z.object({ id: z.uuid() });

export const CreateOrderBody = z.object({ planId: z.string().min(1).max(64) });

/** Client-generated key that makes POST /orders safe to retry. */
export const IdempotencyKeyHeader = z
  .string({ error: 'Idempotency-Key header is required' })
  .min(8)
  .max(128);

export const WebhookBody = z.object({
  eventId: z.string().min(1).max(128),
  orderId: z.uuid(),
  result: z.enum(['SUCCEEDED', 'FAILED']),
});
export type WebhookEvent = z.infer<typeof WebhookBody>;

export const AdminListQuery = z.object({
  status: z.enum(['UNACTIVATED', 'ACTIVE', 'BANNED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const IssueLicenseBody = z.object({
  durationDays: z.number().int().min(1).max(3650),
  userId: z.uuid().nullable().default(null),
});

export interface PlanDto {
  id: string;
  name: string;
  durationDays: number;
  priceCents: number;
}

export function toPlanDto(p: PlanRow): PlanDto {
  return { id: p.id, name: p.name, durationDays: p.durationDays, priceCents: p.priceCents };
}

export interface OrderDto {
  id: string;
  planId: string;
  status: string;
  amountCents: number;
  processId: string;
  createdAt: string;
  paidAt: string | null;
  licenseKey: string | null;
}

export function toOrderDto(o: OrderRow | OrderWithLicense): OrderDto {
  return {
    id: o.id,
    planId: o.planId,
    status: o.status,
    amountCents: o.amountCents,
    processId: o.processId,
    createdAt: o.createdAt.toISOString(),
    paidAt: o.paidAt?.toISOString() ?? null,
    licenseKey: 'licenseKey' in o ? o.licenseKey : null,
  };
}

export interface LicenseDto {
  id: string;
  key: string;
  /** EXPIRED is derived from expiresAt, never stored (spec.md §2). */
  status: string;
  hwid: string | null;
  durationDays: number;
  activatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export function toLicenseDto(l: LicenseRow): LicenseDto {
  return {
    id: l.id,
    key: l.key,
    status: l.status !== 'BANNED' && isExpired(l.expiresAt) ? 'EXPIRED' : l.status,
    hwid: l.hwid,
    durationDays: l.durationDays,
    activatedAt: l.activatedAt?.toISOString() ?? null,
    expiresAt: l.expiresAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
  };
}
