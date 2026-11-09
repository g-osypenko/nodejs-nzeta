import { z } from 'zod';
import type { ConfigRow } from '../../shared/db/rows.js';

export const ConfigNameParams = z.object({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Name: 1-64 chars of [A-Za-z0-9_-]'),
});

/** Detection profile of the desktop client. Unknown fields are rejected (strict). */
export const ConfigPayload = z.strictObject({
  sensitivity: z.number().min(0).max(1),
  resolution: z.strictObject({
    width: z.number().int().min(160).max(7680),
    height: z.number().int().min(120).max(4320),
  }),
  smoothing: z.strictObject({
    algorithm: z.enum(['none', 'ema', 'kalman']),
    strength: z.number().min(0).max(1),
  }),
  fpsLimit: z.number().int().min(1).max(480).nullable().default(null),
});
export type ConfigPayload = z.infer<typeof ConfigPayload>;

export const PutConfigBody = z.object({ payload: ConfigPayload });

export interface ConfigSummaryDto {
  name: string;
  updatedAt: string;
}

export interface ConfigDto extends ConfigSummaryDto {
  payload: ConfigRow['payload'];
}

export function toConfigDto(c: ConfigRow): ConfigDto {
  return { name: c.name, payload: c.payload, updatedAt: c.updatedAt.toISOString() };
}
