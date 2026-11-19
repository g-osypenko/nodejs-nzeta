/**
 * `npm run dev:pay -- <orderId> [FAILED]` — local stand-in for the payment provider: sends the
 * signed-by-secret webhook that a real provider would send after a payment, so the purchase flow
 * (order → PAID → license key) can be clicked through on localhost. Uses WEBHOOK_SECRET from .env.
 */
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

async function main(): Promise<void> {
  const [orderId, result = 'SUCCEEDED'] = process.argv.slice(2);
  const secret = process.env['WEBHOOK_SECRET'];
  if (!orderId) throw new Error('usage: npm run dev:pay -- <orderId> [FAILED]');
  if (!secret) throw new Error('WEBHOOK_SECRET is not set (see .env.example)');
  const port = process.env['PORT'] ?? '3000';
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/payments/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': secret },
    body: JSON.stringify({ eventId: `dev_${randomUUID()}`, orderId, result }),
  });
  process.stdout.write(`${res.status} ${await res.text()}\n`);
  if (!res.ok) process.exit(1);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
