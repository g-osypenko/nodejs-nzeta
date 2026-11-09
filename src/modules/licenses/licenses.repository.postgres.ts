import type { TransactionSql } from 'postgres';
import type { Db } from '../../shared/db/client.js';
import { withRetry } from '../../shared/db/retry.js';
import type { LicenseRow, OrderRow, PlanRow } from '../../shared/db/rows.js';
import { AppError, notFound } from '../../shared/errors.js';
import type {
  LicensesRepository,
  LicenseWithOwner,
  OrderWithLicense,
} from './licenses.repository.js';

const MAX_KEY_ATTEMPTS = 5;

export function createPostgresLicensesRepository(sql: Db): LicensesRepository {
  /**
   * Inserts a license with a fresh random key. A key collision (unique violation) must not abort
   * the surrounding transaction, so it is resolved with ON CONFLICT + regeneration, not try/catch.
   */
  async function insertLicense(
    tx: TransactionSql,
    userId: string | null,
    orderId: string | null,
    durationDays: number,
    generateKey: () => string,
  ): Promise<LicenseRow> {
    for (let attempt = 1; attempt <= MAX_KEY_ATTEMPTS; attempt += 1) {
      const [row] = await tx<LicenseRow[]>`
        INSERT INTO licenses (key, user_id, order_id, duration_days)
        VALUES (${generateKey()}, ${userId}, ${orderId}, ${durationDays})
        ON CONFLICT (key) DO NOTHING
        RETURNING *`;
      if (row) return row;
    }
    throw new Error(`could not generate a unique license key in ${MAX_KEY_ATTEMPTS} attempts`);
  }

  const repository: LicensesRepository = {
    async listPlans() {
      return sql<PlanRow[]>`SELECT * FROM plans ORDER BY duration_days`;
    },

    async findPlan(id) {
      const [row] = await sql<PlanRow[]>`SELECT * FROM plans WHERE id = ${id}`;
      return row ?? null;
    },

    createOrder(order) {
      return withRetry('createOrder', async () => {
        const [inserted] = await sql<OrderRow[]>`
          INSERT INTO orders (user_id, plan_id, amount_cents, idempotency_key, process_id)
          VALUES (${order.userId}, ${order.planId}, ${order.amountCents},
                  ${order.idempotencyKey}, ${order.processId})
          ON CONFLICT (user_id, idempotency_key) DO NOTHING
          RETURNING *`;
        if (inserted) return { order: inserted, created: true };
        // Replay: the conflicting row is committed (ON CONFLICT waited for it), read it back.
        const [existing] = await sql<OrderRow[]>`
          SELECT * FROM orders
          WHERE user_id = ${order.userId} AND idempotency_key = ${order.idempotencyKey}`;
        if (!existing) throw new Error('idempotent order vanished after conflict');
        return { order: existing, created: false };
      });
    },

    async findOrder(id) {
      const [row] = await sql<OrderWithLicense[]>`
        SELECT o.*, l.key AS license_key
        FROM orders o LEFT JOIN licenses l ON l.order_id = o.id
        WHERE o.id = ${id}`;
      return row ?? null;
    },

    applyPayment({ eventId, orderId, result, generateKey }) {
      // Whole transaction is idempotent (event_id PK, order row lock, one license per order),
      // so re-running it after a transient failure is safe.
      return withRetry('applyPayment', () =>
        sql.begin(async (tx) => {
          const [order] = await tx<(OrderRow & { durationDays: number })[]>`
            SELECT o.*, p.duration_days
            FROM orders o JOIN plans p ON p.id = o.plan_id
            WHERE o.id = ${orderId}
            FOR UPDATE OF o`;
          if (!order) throw notFound('Order');

          const [event] = await tx`
            INSERT INTO payment_events (event_id, order_id, result)
            VALUES (${eventId}, ${orderId}, ${result})
            ON CONFLICT (event_id) DO NOTHING
            RETURNING event_id`;
          if (!event) return { kind: 'DUPLICATE' as const };

          if (order.status !== 'PENDING') {
            throw new AppError('ORDER_NOT_PAYABLE', `Order is already ${order.status}`); // rollback
          }
          if (result === 'FAILED') {
            await tx`UPDATE orders SET status = 'FAILED' WHERE id = ${orderId}`;
            return { kind: 'FAILED' as const };
          }
          await tx`UPDATE orders SET status = 'PAID', paid_at = now() WHERE id = ${orderId}`;
          const license = await insertLicense(
            tx,
            order.userId,
            order.id,
            order.durationDays,
            generateKey,
          );
          return { kind: 'PAID' as const, licenseKey: license.key };
        }),
      );
    },

    async listUserLicenses(userId) {
      return sql<LicenseRow[]>`
        SELECT * FROM licenses WHERE user_id = ${userId} ORDER BY created_at DESC`;
    },

    async listLicenses({ status, limit, offset }) {
      return sql<LicenseWithOwner[]>`
        SELECT l.*, u.email AS owner_email
        FROM licenses l LEFT JOIN users u ON u.id = l.user_id
        ${status === undefined ? sql`` : sql`WHERE l.status = ${status}`}
        ORDER BY l.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`;
    },

    async issueLicense({ userId, durationDays, generateKey }) {
      return sql.begin(async (tx) => {
        if (userId !== null) {
          // Check the FK target up front (FOR KEY SHARE blocks a concurrent delete) instead of
          // letting 23503 reach the client as 500 (spec.md §4.10).
          const [owner] = await tx`SELECT 1 FROM users WHERE id = ${userId} FOR KEY SHARE`;
          if (!owner) throw notFound('User');
        }
        return insertLicense(tx, userId, null, durationDays, generateKey);
      });
    },

    async banLicense(id) {
      const [row] = await sql<LicenseRow[]>`
        UPDATE licenses SET status = 'BANNED' WHERE id = ${id} RETURNING *`;
      return row ?? null;
    },

    async resetHwid(id) {
      const [row] = await sql<LicenseRow[]>`
        UPDATE licenses SET hwid = NULL WHERE id = ${id} RETURNING *`;
      return row ?? null;
    },
  };
  return repository;
}
