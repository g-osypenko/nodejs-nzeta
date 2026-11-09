import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPostgresAuthRepository } from '../../src/modules/auth/auth.repository.postgres.js';
import type { LicensesRepository } from '../../src/modules/licenses/licenses.repository.js';
import { createPostgresLicensesRepository } from '../../src/modules/licenses/licenses.repository.postgres.js';
import { createContext, runWithContext } from '../../src/shared/context.js';
import { createDb, type Db } from '../../src/shared/db/client.js';
import type { UserRow } from '../../src/shared/db/rows.js';
import { AppError } from '../../src/shared/errors.js';
import { generateLicenseKey } from '../../src/shared/license-key.js';

describe('postgres licenses repository (transactions, idempotency, N+1)', () => {
  let sql: Db;
  let repo: LicensesRepository;
  let user: UserRow;

  beforeAll(async () => {
    sql = createDb({ url: inject('databaseUrl'), max: 10, statementTimeoutMs: 5000 });
    repo = createPostgresLicensesRepository(sql);
    user = await createPostgresAuthRepository(sql).createUser({
      email: `lic-${randomUUID()}@test.local`,
      passwordHash: 'x',
      role: 'USER',
    });
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  const newOrder = (
    key = randomUUID(),
    planId = 'monthly',
  ): ReturnType<LicensesRepository['createOrder']> =>
    repo.createOrder({
      userId: user.id,
      planId,
      amountCents: 999,
      idempotencyKey: key,
      processId: randomUUID(),
    });

  async function codeOf(p: Promise<unknown>): Promise<string | null> {
    return p.then(
      () => null,
      (e: unknown) => (e instanceof AppError ? e.code : `non-AppError ${String(e)}`),
    );
  }

  it('10 concurrent createOrder with one Idempotency-Key → one row, all callers get the same order', async () => {
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 10 }, () => newOrder(key)));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.order.id)).size).toBe(1);
    const [{ count } = { count: -1 }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM orders WHERE idempotency_key = ${key}`;
    expect(count).toBe(1);
  });

  it('10 concurrent webhooks (different event ids) for one order → exactly one PAID and one license', async () => {
    const { order } = await newOrder();
    const settled = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        repo.applyPayment({
          eventId: `evt_${randomUUID()}`,
          orderId: order.id,
          result: 'SUCCEEDED',
          generateKey: generateLicenseKey,
        }),
      ),
    );
    const outcomes = settled.map((s) =>
      s.status === 'fulfilled'
        ? s.value.kind
        : s.reason instanceof AppError
          ? s.reason.code
          : 'OTHER',
    );
    expect(outcomes.filter((o) => o === 'PAID')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'ORDER_NOT_PAYABLE')).toHaveLength(9);
    const licenses = await sql`SELECT id FROM licenses WHERE order_id = ${order.id}`;
    expect(licenses).toHaveLength(1);
    const events = await sql`SELECT event_id FROM payment_events WHERE order_id = ${order.id}`;
    expect(events).toHaveLength(1); // rejected events were rolled back, not stored
  });

  it('10 concurrent deliveries of the SAME event → one PAID, nine DUPLICATE', async () => {
    const { order } = await newOrder();
    const eventId = `evt_${randomUUID()}`;
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () =>
        repo.applyPayment({
          eventId,
          orderId: order.id,
          result: 'SUCCEEDED',
          generateKey: generateLicenseKey,
        }),
      ),
    );
    expect(outcomes.filter((o) => o.kind === 'PAID')).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === 'DUPLICATE')).toHaveLength(9);
  });

  it('license key collision is resolved inside the transaction (ON CONFLICT + regenerate)', async () => {
    const taken = (
      await repo.issueLicense({ userId: null, durationDays: 1, generateKey: generateLicenseKey })
    ).key;
    const fresh = generateLicenseKey();
    const keys = [taken, taken, fresh];
    const { order } = await newOrder();

    const outcome = await repo.applyPayment({
      eventId: `evt_${randomUUID()}`,
      orderId: order.id,
      result: 'SUCCEEDED',
      generateKey: () => keys.shift() ?? generateLicenseKey(),
    });

    expect(outcome).toEqual({ kind: 'PAID', licenseKey: fresh });
  });

  it('gives up after 5 colliding keys and rolls the whole payment back', async () => {
    const taken = (
      await repo.issueLicense({ userId: null, durationDays: 1, generateKey: generateLicenseKey })
    ).key;
    const { order } = await newOrder();
    const eventId = `evt_${randomUUID()}`;

    await expect(
      repo.applyPayment({
        eventId,
        orderId: order.id,
        result: 'SUCCEEDED',
        generateKey: () => taken,
      }),
    ).rejects.toThrow(/unique license key in 5 attempts/);

    const [row] = await sql<{ status: string }[]>`SELECT status FROM orders WHERE id = ${order.id}`;
    expect(row?.status).toBe('PENDING');
    expect(await sql`SELECT 1 FROM payment_events WHERE event_id = ${eventId}`).toHaveLength(0);
  });

  it('webhook for an unknown order → NOT_FOUND (no FK error leaks)', async () => {
    const call = repo.applyPayment({
      eventId: `evt_${randomUUID()}`,
      orderId: randomUUID(),
      result: 'SUCCEEDED',
      generateKey: generateLicenseKey,
    });
    expect(await codeOf(call)).toBe('NOT_FOUND');
  });

  it('admin registry costs ONE query regardless of page size (N+1 regression, spec §4.8)', async () => {
    for (let i = 0; i < 25; i += 1) {
      await repo.issueLicense({
        userId: user.id,
        durationDays: 1,
        generateKey: generateLicenseKey,
      });
    }
    const ctx = createContext();
    const page = await runWithContext(ctx, () => repo.listLicenses({ limit: 25, offset: 0 }));
    expect(page).toHaveLength(25);
    expect(page.filter((l) => l.ownerEmail === user.email).length).toBeGreaterThan(0);
    expect(ctx.dbQueries).toBe(1);
  });

  it('findOrder joins the license key; unknown → null', async () => {
    const { order } = await newOrder();
    expect((await repo.findOrder(order.id))?.licenseKey).toBeNull();
    const outcome = await repo.applyPayment({
      eventId: `evt_${randomUUID()}`,
      orderId: order.id,
      result: 'SUCCEEDED',
      generateKey: generateLicenseKey,
    });
    expect((await repo.findOrder(order.id))?.licenseKey).toBe(
      outcome.kind === 'PAID' ? outcome.licenseKey : 'x',
    );
    expect(await repo.findOrder(randomUUID())).toBeNull();
  });
});
