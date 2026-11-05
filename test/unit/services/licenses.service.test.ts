import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryLicensesRepository } from '../../../src/modules/licenses/licenses.repository.memory.js';
import {
  createLicensesService,
  type LicensesService,
} from '../../../src/modules/licenses/licenses.service.js';
import { createContext, type AuthUser } from '../../../src/shared/context.js';
import { createMemoryStore, type MemoryStore } from '../../../src/shared/db/memory-store.js';
import { AppError } from '../../../src/shared/errors.js';
import { LICENSE_KEY_PATTERN } from '../../../src/shared/license-key.js';
import { asUser, runAs, seedLicense, seedUser } from '../../support/fixtures.js';

const SECRET = 'unit-webhook-secret-0001';

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  return p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : String(e)),
  );
}

describe('licenses.service', () => {
  let store: MemoryStore;
  let svc: LicensesService;
  let alice: AuthUser;
  let bob: AuthUser;
  let admin: AuthUser;

  beforeEach(() => {
    store = createMemoryStore();
    svc = createLicensesService({
      repo: createMemoryLicensesRepository(store),
      webhookSecret: SECRET,
    });
    alice = asUser(seedUser(store));
    bob = asUser(seedUser(store));
    admin = asUser(seedUser(store, { role: 'ADMIN' }));
  });

  const order = (
    user: AuthUser,
    planId = 'monthly',
    key = 'idem-key-0001',
  ): ReturnType<LicensesService['createOrder']> => runAs(user, () => svc.createOrder(planId, key));
  const pay = (
    orderId: string,
    eventId = 'evt-1',
    result: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED',
  ): ReturnType<LicensesService['handleWebhook']> =>
    runAs(null, () => svc.handleWebhook(SECRET, { eventId, orderId, result }));

  describe('plans & orders', () => {
    it('lists plans ordered by duration', async () => {
      expect((await svc.listPlans()).map((p) => p.durationDays)).toEqual([30, 90, 365]);
    });

    it('createOrder: requires a user; unknown plan → NOT_FOUND', async () => {
      expect(await codeOf(runAs(null, () => svc.createOrder('monthly', 'k-00000001')))).toBe(
        'UNAUTHENTICATED',
      );
      expect(await codeOf(order(alice, 'lifetime'))).toBe('NOT_FOUND');
    });

    it('createOrder prices from the plan and records the request business process', async () => {
      const ctx = createContext({ processId: 'proc-checkout-1' });
      const { order: o, created } = await runAs(alice, () => svc.createOrder('yearly', 'k-1'), ctx);
      expect(created).toBe(true);
      expect(o).toMatchObject({
        userId: alice.id,
        planId: 'yearly',
        amountCents: 7999,
        status: 'PENDING',
      });
      expect(o.processId).toBe('proc-checkout-1');
    });

    it('replay with the same key returns the same order and re-joins its business process', async () => {
      const first = await runAs(
        alice,
        () => svc.createOrder('monthly', 'k-1'),
        createContext({ processId: 'p-1' }),
      );
      const ctx = createContext({ processId: 'p-retry' });
      const replay = await runAs(alice, () => svc.createOrder('monthly', 'k-1'), ctx);
      expect(replay).toEqual({ order: first.order, created: false });
      expect(ctx.processId).toBe('p-1');
      expect(store.orders.size).toBe(1);
    });

    it('same key for a different plan → IDEMPOTENCY_CONFLICT; keys are per user', async () => {
      await order(alice, 'monthly', 'shared-key');
      expect(await codeOf(order(alice, 'yearly', 'shared-key'))).toBe('IDEMPOTENCY_CONFLICT');
      const bobs = await order(bob, 'yearly', 'shared-key');
      expect(bobs.created).toBe(true);
    });

    it('getOrder: owner and admin see it; another user gets NOT_FOUND (existence not revealed)', async () => {
      const { order: o } = await order(alice);
      expect((await runAs(alice, () => svc.getOrder(o.id))).id).toBe(o.id);
      expect((await runAs(admin, () => svc.getOrder(o.id))).id).toBe(o.id);
      expect(await codeOf(runAs(bob, () => svc.getOrder(o.id)))).toBe('NOT_FOUND');
      expect(
        await codeOf(runAs(alice, () => svc.getOrder('00000000-0000-4000-8000-000000000000'))),
      ).toBe('NOT_FOUND');
    });
  });

  describe('payment webhook', () => {
    it.each([
      ['wrong secret of equal length', 'unit-webhook-secret-0002'],
      ['shorter secret', 'x'],
      ['empty secret', ''],
    ])('%s → INVALID_WEBHOOK_SECRET, nothing changes', async (_case, secret) => {
      const { order: o } = await order(alice);
      const call = svc.handleWebhook(secret, { eventId: 'e', orderId: o.id, result: 'SUCCEEDED' });
      expect(await codeOf(runAs(null, () => call))).toBe('INVALID_WEBHOOK_SECRET');
      expect(store.orders.get(o.id)?.status).toBe('PENDING');
      expect(store.paymentEvents.size).toBe(0);
    });

    it('unknown order → NOT_FOUND', async () => {
      expect(await codeOf(pay('00000000-0000-4000-8000-000000000000'))).toBe('NOT_FOUND');
    });

    it('SUCCEEDED: order PAID, exactly one UNACTIVATED license for the buyer with the plan duration', async () => {
      const { order: o } = await order(alice, 'quarterly');
      const ctx = createContext({ processId: 'webhook-own' });
      const outcome = await runAs(
        null,
        () => svc.handleWebhook(SECRET, { eventId: 'e1', orderId: o.id, result: 'SUCCEEDED' }),
        ctx,
      );

      expect(outcome.kind).toBe('PAID');
      expect(ctx.processId).toBe(o.processId); // webhook joined the checkout process
      expect(store.orders.get(o.id)).toMatchObject({ status: 'PAID' });
      expect(store.orders.get(o.id)?.paidAt).toBeInstanceOf(Date);
      const licenses = [...store.licenses.values()];
      expect(licenses).toHaveLength(1);
      expect(licenses[0]).toMatchObject({
        userId: alice.id,
        orderId: o.id,
        status: 'UNACTIVATED',
        hwid: null,
        durationDays: 90,
        expiresAt: null,
      });
      expect(outcome.kind === 'PAID' && outcome.licenseKey).toBe(licenses[0]?.key);
      expect(licenses[0]?.key).toMatch(LICENSE_KEY_PATTERN);
    });

    it('the same event again → DUPLICATE and still exactly one license', async () => {
      const { order: o } = await order(alice);
      await pay(o.id, 'e1');
      expect((await pay(o.id, 'e1')).kind).toBe('DUPLICATE');
      expect(store.licenses.size).toBe(1);
    });

    it('FAILED: order FAILED, no license; a later event for it → ORDER_NOT_PAYABLE', async () => {
      const { order: o } = await order(alice);
      expect((await pay(o.id, 'e1', 'FAILED')).kind).toBe('FAILED');
      expect(store.orders.get(o.id)?.status).toBe('FAILED');
      expect(store.licenses.size).toBe(0);
      expect(await codeOf(pay(o.id, 'e2'))).toBe('ORDER_NOT_PAYABLE');
      expect(store.paymentEvents.has('e2')).toBe(false); // rejected event is not recorded
    });

    it('a new event for an already PAID order → ORDER_NOT_PAYABLE, no second license', async () => {
      const { order: o } = await order(alice);
      await pay(o.id, 'e1');
      expect(await codeOf(pay(o.id, 'e2'))).toBe('ORDER_NOT_PAYABLE');
      expect(store.licenses.size).toBe(1);
    });

    it('getOrder after payment exposes the license key', async () => {
      const { order: o } = await order(alice);
      const outcome = await pay(o.id);
      const viewed = await runAs(alice, () => svc.getOrder(o.id));
      expect(outcome.kind === 'PAID' && viewed.licenseKey === outcome.licenseKey).toBe(true);
    });
  });

  describe('my licenses & admin', () => {
    it('myLicenses: only the caller’s, newest first; 401 when anonymous', async () => {
      const old = seedLicense(store, { userId: alice.id, createdAt: new Date('2030-01-01') });
      const recent = seedLicense(store, { userId: alice.id, createdAt: new Date('2030-02-01') });
      seedLicense(store, { userId: bob.id });
      expect((await runAs(alice, () => svc.myLicenses())).map((l) => l.id)).toEqual([
        recent.id,
        old.id,
      ]);
      expect(await codeOf(runAs(null, () => svc.myLicenses()))).toBe('UNAUTHENTICATED');
    });

    it('admin operations are FORBIDDEN for users and UNAUTHENTICATED for anonymous', async () => {
      const l = seedLicense(store);
      const ops = [
        (): Promise<unknown> => svc.adminList({ limit: 10, offset: 0 }),
        (): Promise<unknown> => svc.adminIssue({ userId: null, durationDays: 1 }),
        (): Promise<unknown> => svc.adminBan(l.id),
        (): Promise<unknown> => svc.adminResetHwid(l.id),
      ];
      for (const op of ops) {
        expect(await codeOf(runAs(alice, op))).toBe('FORBIDDEN');
        expect(await codeOf(runAs(null, op))).toBe('UNAUTHENTICATED');
      }
      expect(store.licenses.get(l.id)?.status).toBe('UNACTIVATED');
    });

    it('adminList: owner email joined, status filter, newest first, limit/offset', async () => {
      const a1 = seedLicense(store, { userId: alice.id, createdAt: new Date('2030-01-01') });
      const a2 = seedLicense(store, {
        userId: alice.id,
        status: 'BANNED',
        createdAt: new Date('2030-01-02'),
      });
      const orphan = seedLicense(store, { userId: null, createdAt: new Date('2030-01-03') });

      const all = await runAs(admin, () => svc.adminList({ limit: 10, offset: 0 }));
      expect(all.map((l) => l.id)).toEqual([orphan.id, a2.id, a1.id]);
      expect(all.map((l) => l.ownerEmail)).toEqual([null, alice.email, alice.email]);

      const banned = await runAs(admin, () =>
        svc.adminList({ status: 'BANNED', limit: 10, offset: 0 }),
      );
      expect(banned.map((l) => l.id)).toEqual([a2.id]);

      const page2 = await runAs(admin, () => svc.adminList({ limit: 1, offset: 1 }));
      expect(page2.map((l) => l.id)).toEqual([a2.id]);
    });

    it('adminIssue: with or without owner; unknown owner → NOT_FOUND and nothing is created', async () => {
      const owned = await runAs(admin, () =>
        svc.adminIssue({ userId: alice.id, durationDays: 14 }),
      );
      const free = await runAs(admin, () => svc.adminIssue({ userId: null, durationDays: 1 }));
      expect(owned).toMatchObject({
        userId: alice.id,
        durationDays: 14,
        status: 'UNACTIVATED',
        orderId: null,
      });
      expect(free.userId).toBeNull();
      expect(owned.key).not.toBe(free.key);

      // The call must start INSIDE the admin's context (requireRole runs synchronously at call time).
      const missing = runAs(admin, () =>
        svc.adminIssue({ userId: '00000000-0000-4000-8000-000000000000', durationDays: 1 }),
      );
      expect(await codeOf(missing)).toBe('NOT_FOUND');
      expect(store.licenses.size).toBe(2);
    });

    it('adminBan sets BANNED; adminResetHwid clears only the hwid; unknown id → NOT_FOUND', async () => {
      const l = seedLicense(store, {
        status: 'ACTIVE',
        hwid: 'HWID-1',
        expiresAt: new Date('2031-01-01'),
      });
      expect((await runAs(admin, () => svc.adminResetHwid(l.id))).hwid).toBeNull();
      expect(store.licenses.get(l.id)).toMatchObject({
        status: 'ACTIVE',
        expiresAt: new Date('2031-01-01'),
      });
      expect((await runAs(admin, () => svc.adminBan(l.id))).status).toBe('BANNED');

      const ghost = '00000000-0000-4000-8000-000000000000';
      expect(await codeOf(runAs(admin, () => svc.adminBan(ghost)))).toBe('NOT_FOUND');
      expect(await codeOf(runAs(admin, () => svc.adminResetHwid(ghost)))).toBe('NOT_FOUND');
    });
  });
});
