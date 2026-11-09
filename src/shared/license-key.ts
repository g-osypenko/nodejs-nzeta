import { randomBytes } from 'node:crypto';

/** Wire format shared by `licenses` (issues keys) and `loader` (validates them). */
export const LICENSE_KEY_PATTERN = /^APP-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

/** APP-XXXX-XXXX-XXXX, 48 random bits. Collisions are handled by the repository (retry on unique violation). */
export function generateLicenseKey(): string {
  const hex = randomBytes(6).toString('hex').toUpperCase();
  return `APP-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export function isExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  return expiresAt !== null && expiresAt <= now;
}
