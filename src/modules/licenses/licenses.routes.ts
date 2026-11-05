import type { FastifyPluginAsync } from 'fastify';
import {
  AdminListQuery,
  CreateOrderBody,
  IdempotencyKeyHeader,
  IdParams,
  IssueLicenseBody,
  toLicenseDto,
  toOrderDto,
  toPlanDto,
  WebhookBody,
} from './licenses.schemas.js';
import type { LicensesService } from './licenses.service.js';

export function licensesRoutes(licenses: LicensesService): FastifyPluginAsync {
  return async (app) => {
    // --- shop ---
    app.get('/plans', async () => (await licenses.listPlans()).map(toPlanDto));

    app.post('/orders', async (request, reply) => {
      const key = IdempotencyKeyHeader.parse(request.headers['idempotency-key']);
      const { planId } = CreateOrderBody.parse(request.body);
      const { order, created } = await licenses.createOrder(planId, key);
      return reply.code(created ? 201 : 200).send(toOrderDto(order));
    });

    app.get('/orders/:id', async (request) => {
      const { id } = IdParams.parse(request.params);
      return toOrderDto(await licenses.getOrder(id));
    });

    app.post('/payments/webhook', async (request) => {
      const secret = request.headers['x-webhook-secret'];
      const outcome = await licenses.handleWebhook(
        typeof secret === 'string' ? secret : '',
        WebhookBody.parse(request.body),
      );
      return { received: true, outcome: outcome.kind };
    });

    app.get('/licenses', async () => (await licenses.myLicenses()).map(toLicenseDto));

    // --- admin ---
    app.get('/admin/licenses', async (request) => {
      const views = await licenses.adminList(AdminListQuery.parse(request.query));
      return views.map((v) => ({ ...toLicenseDto(v.license), ownerEmail: v.ownerEmail }));
    });

    app.post('/admin/licenses', async (request, reply) => {
      const license = await licenses.adminIssue(IssueLicenseBody.parse(request.body));
      return reply.code(201).send(toLicenseDto(license));
    });

    app.post('/admin/licenses/:id/ban', async (request) => {
      const { id } = IdParams.parse(request.params);
      return toLicenseDto(await licenses.adminBan(id));
    });

    app.post('/admin/licenses/:id/reset-hwid', async (request) => {
      const { id } = IdParams.parse(request.params);
      return toLicenseDto(await licenses.adminResetHwid(id));
    });
  };
}
