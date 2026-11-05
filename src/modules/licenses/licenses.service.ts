import { timingSafeEqual } from 'node:crypto';
import {
  adoptProcessId,
  currentProcessId,
  requireRole,
  requireUser,
} from '../../shared/context.js';
import type { LicenseRow, OrderRow, PlanRow } from '../../shared/db/rows.js';
import { AppError, notFound } from '../../shared/errors.js';
import { generateLicenseKey } from '../../shared/license-key.js';
import { logger } from '../../shared/logger.js';
import type {
  LicenseFilter,
  LicensesRepository,
  OrderWithLicense,
  PaymentOutcome,
} from './licenses.repository.js';
import type { WebhookEvent } from './licenses.schemas.js';

/** Port for resolving license owners (implemented by the auth module's data, wired in container.ts). */
export interface OwnerDirectory {
  findEmail(userId: string): Promise<string | null>;
}

export interface AdminLicenseView {
  license: LicenseRow;
  ownerEmail: string | null;
}

export interface LicensesService {
  listPlans(): Promise<PlanRow[]>;
  createOrder(
    planId: string,
    idempotencyKey: string,
  ): Promise<{ order: OrderRow; created: boolean }>;
  getOrder(id: string): Promise<OrderWithLicense>;
  handleWebhook(secret: string, event: WebhookEvent): Promise<PaymentOutcome>;
  myLicenses(): Promise<LicenseRow[]>;
  adminList(filter: LicenseFilter): Promise<AdminLicenseView[]>;
  adminIssue(input: { userId: string | null; durationDays: number }): Promise<LicenseRow>;
  adminBan(id: string): Promise<LicenseRow>;
  adminResetHwid(id: string): Promise<LicenseRow>;
}

export interface LicensesServiceDeps {
  repo: LicensesRepository;
  owners: OwnerDirectory;
  webhookSecret: string;
}

function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createLicensesService({
  repo,
  owners,
  webhookSecret,
}: LicensesServiceDeps): LicensesService {
  const service: LicensesService = {
    listPlans() {
      return repo.listPlans();
    },

    async createOrder(planId, idempotencyKey) {
      const user = requireUser();
      const plan = await repo.findPlan(planId);
      if (!plan) throw notFound('Plan');

      const result = await repo.createOrder({
        userId: user.id,
        planId: plan.id,
        amountCents: plan.priceCents,
        idempotencyKey,
        processId: currentProcessId(),
      });
      if (!result.created && result.order.planId !== planId) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency-Key was already used for another plan',
        );
      }
      // A replay continues the original checkout process.
      adoptProcessId(result.order.processId);
      logger.info({ orderId: result.order.id, created: result.created }, 'order placed');
      return result;
    },

    async getOrder(id) {
      const user = requireUser();
      const order = await repo.findOrder(id);
      // Someone else's order is reported as missing: do not reveal that it exists.
      if (!order || (order.userId !== user.id && user.role !== 'ADMIN')) throw notFound('Order');
      return order;
    },

    async handleWebhook(secret, event) {
      if (!secretMatches(secret, webhookSecret)) {
        throw new AppError('INVALID_WEBHOOK_SECRET', 'Invalid webhook secret');
      }
      const order = await repo.findOrder(event.orderId);
      if (!order) throw notFound('Order');
      adoptProcessId(order.processId);

      const outcome = await repo.applyPayment({ ...event, generateKey: generateLicenseKey });
      logger.info(
        { orderId: order.id, eventId: event.eventId, outcome: outcome.kind },
        'payment event applied',
      );
      return outcome;
    },

    myLicenses() {
      return repo.listUserLicenses(requireUser().id);
    },

    async adminList(filter) {
      requireRole('ADMIN');
      const licenses = await repo.listLicenses(filter);
      const views: AdminLicenseView[] = [];
      for (const license of licenses) {
        const ownerEmail = license.userId ? await owners.findEmail(license.userId) : null;
        views.push({ license, ownerEmail });
      }
      return views;
    },

    async adminIssue({ userId, durationDays }) {
      requireRole('ADMIN');
      const license = await repo.issueLicense({
        userId,
        durationDays,
        generateKey: generateLicenseKey,
      });
      logger.info({ licenseId: license.id }, 'license issued by admin');
      return license;
    },

    async adminBan(id) {
      requireRole('ADMIN');
      const license = await repo.banLicense(id);
      if (!license) throw notFound('License');
      logger.info({ licenseId: id }, 'license banned');
      return license;
    },

    async adminResetHwid(id) {
      requireRole('ADMIN');
      const license = await repo.resetHwid(id);
      if (!license) throw notFound('License');
      logger.info({ licenseId: id }, 'license hwid reset');
      return license;
    },
  };
  return service;
}
