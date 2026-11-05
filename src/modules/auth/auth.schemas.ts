import { z } from 'zod';
import type { UserRow } from '../../shared/db/rows.js';

export const CredentialsBody = z.object({
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  password: z.string().min(8).max(128),
});
export type Credentials = z.infer<typeof CredentialsBody>;

export interface UserDto {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

export function toUserDto(user: UserRow): UserDto {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}
