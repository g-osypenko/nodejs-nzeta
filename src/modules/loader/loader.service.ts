import { AppError } from '../../shared/errors.js';
import { isExpired } from '../../shared/license-key.js';
import { logger } from '../../shared/logger.js';
import type { LoaderLicense, LoaderRepository } from './loader.repository.js';

export interface HandshakeResult {
  action: 'BOUND' | 'AUTHENTICATED';
  expiresAt: Date | null;
}

export interface LoaderService {
  handshake(licenseKey: string, hwid: string): Promise<HandshakeResult>;
}

export function createLoaderService({ repo }: { repo: LoaderRepository }): LoaderService {
  const assertUsable = (license: LoaderLicense, now: Date): void => {
    if (license.status === 'BANNED') throw new AppError('KEY_BANNED', 'License is banned');
    if (isExpired(license.expiresAt, now)) throw new AppError('KEY_EXPIRED', 'License has expired');
  };

  const service: LoaderService = {
    async handshake(licenseKey, hwid) {
      const now = new Date();
      let license = await repo.findByKey(licenseKey);
      if (!license) throw new AppError('KEY_NOT_FOUND', 'License key not found');
      assertUsable(license, now);

      if (license.hwid === null) {
        const bound = await repo.bindHwid(licenseKey, hwid, now);
        if (bound) {
          logger.info({ licenseKey }, 'license bound to hwid');
          return { action: 'BOUND', expiresAt: bound.expiresAt };
        }
        // Lost the race to a concurrent first activation: re-read and judge against the winner.
        license = await repo.findByKey(licenseKey);
        if (!license) throw new AppError('KEY_NOT_FOUND', 'License key not found');
        assertUsable(license, now);
      }

      if (license.hwid !== hwid && license.status !== 'ACTIVE') {
        logger.warn({ licenseKey }, 'hwid mismatch');
        throw new AppError('HWID_MISMATCH', 'License is bound to another device');
      }
      return { action: 'AUTHENTICATED', expiresAt: license.expiresAt };
    },
  };
  return service;
}
