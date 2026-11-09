import { describe, expect, it } from 'vitest';
import { MIGRATION_PHASES, parsePhases } from '../../../src/shared/db/migrations.js';

describe('migration phases CLI (spec §8)', () => {
  it('no --phase flag runs all phases in canonical order', () => {
    expect(parsePhases([])).toEqual(['schema', 'data', 'indexes']);
    expect(parsePhases(['--verbose'])).toEqual([...MIGRATION_PHASES]);
  });

  it('selected phases always run in canonical order, whatever the flag order', () => {
    expect(parsePhases(['--phase=indexes', '--phase=schema'])).toEqual(['schema', 'indexes']);
    expect(parsePhases(['--phase=data'])).toEqual(['data']);
  });

  it('an unknown phase fails instead of silently migrating nothing', () => {
    expect(() => parsePhases(['--phase=seed'])).toThrow('unknown migration phase "seed"');
  });
});
