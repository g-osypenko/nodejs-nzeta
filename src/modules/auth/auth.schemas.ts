import { z } from 'zod';
import type { UserRow } from '../../shared/db/rows.js';

const Email = z
  .email()
  .max(254)
  .transform((e) => e.toLowerCase());

export const CredentialsBody = z.object({
  email: Email,
  password: z.string().min(8).max(128),
});

/** Passwordless sign-in (ADR 0011). */
export const CodeRequestBody = z.object({ email: Email });
export const CodeVerifyBody = z.object({
  email: Email,
  code: z.string().regex(/^\d{6}$/, 'The code is 6 digits'),
});
/** Link token: 32 random bytes as base64url (43 chars); bounded so garbage is not hashed. */
export const LinkVerifyBody = z.object({ token: z.string().min(16).max(128) });
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
