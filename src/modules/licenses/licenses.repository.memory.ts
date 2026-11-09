import { randomUUID } from 'node:crypto';
import type { MemoryStore } from '../../shared/db/memory-store.js';
import type { LicenseRow, OrderRow } from '../../shared/db/rows.js';
import { AppError, notFound } from '../../shared/errors.js';
import type { LicensesRepository } from './licenses.repository.js';

export function createMemoryLicensesRepository(store: MemoryStore): LicensesRepository {
  const keyExists = (key: string): boolean =>
    [...store.licenses.values()].some((l) => l.key === key);

  const insertLicense = (
    userId: string | null,
    orderId: string | null,
    durationDays: number,
    generateKey: () => string,
  ): LicenseRow => {
    let key = generateKey();
    while (keyExists(key)) key = generateKey();
    const row: LicenseRow = {
      id: randomUUID(),
      key,
      hwid: null,
      status: 'UNACTIVATED',
      userId,
      orderId,
      durationDays,
      activatedAt: null,
      expiresAt: null,
      createdAt: new Date(),
    };
    store.licenses.set(row.id, row);
    return row;
  };

  const update = (id: string, patch: Partial<LicenseRow>): LicenseRow | null => {
    const row = store.licenses.get(id);
    if (!row) return null;
    const next = { ...row, ...patch };
    store.licenses.set(id, next);
    return next;
  };

  const repository: LicensesRepository = {
    async listPlans() {
      return [...store.plans.values()].sort((a, b) => a.durationDays - b.durationDays);
    },

    async findPlan(id) {
      return store.plans.get(id) ?? null;
    },

    async createOrder(input) {
      const existing = [...store.orders.values()].find(
        (o) => o.userId === input.userId && o.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return { order: existing, created: false };
      const order: OrderRow = {
        id: randomUUID(),
        status: 'PENDING',
        createdAt: new Date(),
        paidAt: null,
        ...input,
      };
      store.orders.set(order.id, order);
      return { order, created: true };
    },

    async findOrder(id) {
      const order = store.orders.get(id);
      if (!order) return null;
      const license = [...store.licenses.values()].find((l) => l.orderId === id);
      return { ...order, licenseKey: license?.key ?? null };
    },

    async applyPayment({ eventId, orderId, result, generateKey }) {
      if (store.paymentEvents.has(eventId)) return { kind: 'DUPLICATE' };
      const order = store.orders.get(orderId);
      if (!order) throw notFound('Order');
      if (order.status !== 'PENDING') {
        throw new AppError('ORDER_NOT_PAYABLE', `Order is already ${order.status}`);
      }
      const plan = store.plans.get(order.planId);
      if (!plan) throw notFound('Plan');

      store.paymentEvents.set(eventId, { eventId, orderId, result, receivedAt: new Date() });
      if (result === 'FAILED') {
        store.orders.set(orderId, { ...order, status: 'FAILED' });
        return { kind: 'FAILED' };
      }
      const license = insertLicense(order.userId, order.id, plan.durationDays, generateKey);
      store.orders.set(orderId, { ...order, status: 'PAID', paidAt: new Date() });
      return { kind: 'PAID', licenseKey: license.key };
    },

    async listUserLicenses(userId) {
      return [...store.licenses.values()]
        .filter((l) => l.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    async listLicenses({ status, limit, offset }) {
      return [...store.licenses.values()]
        .filter((l) => status === undefined || l.status === status)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(offset, offset + limit)
        .map((l) => ({
          ...l,
          ownerEmail: l.userId ? (store.users.get(l.userId)?.email ?? null) : null,
        }));
    },

    async issueLicense({ userId, durationDays, generateKey }) {
      // Same FK invariant as licenses.user_id REFERENCES users (spec.md §4.10).
      if (userId !== null && !store.users.has(userId)) throw notFound('User');
      return insertLicense(userId, null, durationDays, generateKey);
    },

    async banLicense(id) {
      return update(id, { status: 'BANNED' });
    },

    async resetHwid(id) {
      return update(id, { hwid: null });
    },
  };
  return repository;
}
