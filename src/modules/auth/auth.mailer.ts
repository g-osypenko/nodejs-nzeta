import type { Mailer } from '@lch/auth-core';
import { logger } from '../../shared/logger.js';

/**
 * Delivery of the sign-in email (ADR 0011). Real sending (Brevo) needs a domain with
 * SPF/DKIM/DMARC; until then the letter goes to the log or to an in-process outbox.
 */

export interface SentMail {
  to: string;
  code: string;
  link: string;
  expiresAt: Date;
}

/** The link of the letter opens the SPA, which POSTs the token; `#` keeps it out of server logs. */
export function signInLink(appBaseUrl: string, token: string): string {
  return `${appBaseUrl}/login/verify#token=${encodeURIComponent(token)}`;
}

/** Development: the letter is a log line — the code is read from the terminal. */
export function createConsoleMailer(appBaseUrl: string): Mailer {
  return {
    async sendLoginCode({ email, code, linkToken, expiresAt }): Promise<void> {
      logger.info(
        {
          mailTo: email,
          code,
          link: signInLink(appBaseUrl, linkToken),
          expiresAt: expiresAt.toISOString(),
        },
        'sign-in email (console mailer, not sent)',
      );
    },
  };
}

/** Tests and smoke: letters are kept in memory so a scenario can read the code it was sent. */
export function createMemoryMailer(appBaseUrl: string): { mailer: Mailer; outbox: SentMail[] } {
  const outbox: SentMail[] = [];
  return {
    outbox,
    mailer: {
      async sendLoginCode({ email, code, linkToken, expiresAt }): Promise<void> {
        outbox.push({ to: email, code, link: signInLink(appBaseUrl, linkToken), expiresAt });
      },
    },
  };
}
