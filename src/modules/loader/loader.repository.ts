import type { LicenseStatus } from '../../shared/db/rows.js';

/** Narrow read model of a license for the hot handshake path (ADR 0003: loader does not import licenses). */
export interface LoaderLicense {
  key: string;
  hwid: string | null;
  status: LicenseStatus;
  expiresAt: Date | null;
}

export interface LoaderRepository {
  findByKey(key: string): Promise<LoaderLicense | null>;
  /**
   * Atomic compare-and-set: binds `hwid` only if the license still has no HWID and is not banned;
   * starts the term on first activation. Returns `null` if another request won the race.
   */
  bindHwid(key: string, hwid: string, now: Date): Promise<LoaderLicense | null>;
}
