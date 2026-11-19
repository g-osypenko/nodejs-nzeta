-- 002_login_challenges: passwordless sign-in by an emailed code or link (ADR 0011).
-- Expand-only: the previous release keeps working (it never reads login_challenges, and a user
-- without a password simply fails its password check with INVALID_CREDENTIALS).

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE login_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL CHECK (email = lower(email)),
  code_hash   text NOT NULL, -- sha256 of the 6-digit code; the code itself is never stored
  token_hash  text NOT NULL CONSTRAINT login_challenges_token_hash_key UNIQUE, -- sha256 of the link token
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz, -- set on success and when a newer challenge supersedes this one
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Newest challenge of an email (verify, resend cooldown, hourly limit). The table is new and
-- empty, so a plain index inside the schema transaction locks nothing that is in use.
CREATE INDEX login_challenges_email_created_at_idx ON login_challenges (email, created_at DESC);
