import type { MemoryStore } from '../../shared/db/memory-store.js';
import type { LicenseRow } from '../../shared/db/rows.js';
import type { LoaderLicense, LoaderRepository } from './loader.repository.js';

const toLoaderLicense = (l: LicenseRow): LoaderLicense => ({
  key: l.key,
  hwid: l.hwid,
  status: l.status,
  expiresAt: l.expiresAt,
});

export function createMemoryLoaderRepository(store: MemoryStore): LoaderRepository {
  const byKey = (key: string): LicenseRow | undefined =>
    [...store.licenses.values()].find((l) => l.key === key);

  const repository: LoaderRepository = {
    async findByKey(key) {
      const row = byKey(key);
      return row ? toLoaderLicense(row) : null;
    },

    async bindHwid(key, hwid, now) {
      // Check-and-write without an await in between == atomic on the single JS thread.
      const row = byKey(key);
      if (!row || row.hwid !== null || row.status === 'BANNED') return null;
      const bound: LicenseRow = {
        ...row,
        hwid,
        status: 'ACTIVE',
        activatedAt: row.activatedAt ?? now,
        expiresAt: row.expiresAt ?? new Date(now.getTime() + row.durationDays * 86_400_000),
      };
      store.licenses.set(row.id, bound);
      return toLoaderLicense(bound);
    },
  };
  return repository;
}
