-- 001_init: schema from spec.md §2. Applied once by `npm run db:migrate`; never edited afterwards.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL CONSTRAINT users_email_key UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY, -- sha256 of the bearer token, the token itself is never stored
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TABLE plans (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  duration_days integer NOT NULL CHECK (duration_days > 0),
  price_cents   integer NOT NULL CHECK (price_cents >= 0)
);
-- Reference data; the same rows are the static data of the prototype (src/shared/db/memory-store.ts).
INSERT INTO plans (id, name, duration_days, price_cents) VALUES
  ('monthly', 'Monthly', 30, 999),
  ('quarterly', 'Quarterly', 90, 2499),
  ('yearly', 'Yearly', 365, 7999);

CREATE TABLE orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id),
  plan_id         text NOT NULL REFERENCES plans (id),
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'FAILED')),
  amount_cents    integer NOT NULL CHECK (amount_cents >= 0),
  idempotency_key text NOT NULL,
  process_id      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  paid_at         timestamptz,
  CONSTRAINT orders_user_idempotency_key UNIQUE (user_id, idempotency_key)
);

CREATE TABLE payment_events (
  event_id    text PRIMARY KEY, -- provider event id: dedupes webhook retries
  order_id    uuid NOT NULL REFERENCES orders (id),
  result      text NOT NULL CHECK (result IN ('SUCCEEDED', 'FAILED')),
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_events_order_id_idx ON payment_events (order_id);

CREATE TABLE licenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL CONSTRAINT licenses_key_key UNIQUE,
  hwid          text,
  status        text NOT NULL DEFAULT 'UNACTIVATED' CHECK (status IN ('UNACTIVATED', 'ACTIVE', 'BANNED')),
  user_id       uuid REFERENCES users (id),
  order_id      uuid CONSTRAINT licenses_order_id_key UNIQUE REFERENCES orders (id), -- one license per order
  duration_days integer NOT NULL CHECK (duration_days > 0),
  activated_at  timestamptz,
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT licenses_term_consistent CHECK ((activated_at IS NULL) = (expires_at IS NULL))
);
CREATE INDEX licenses_user_id_idx ON licenses (user_id);
CREATE INDEX licenses_created_at_idx ON licenses (created_at DESC);
CREATE INDEX licenses_status_created_at_idx ON licenses (status, created_at DESC);

CREATE TABLE user_configs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       text NOT NULL,
  payload    jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_configs_user_name_key UNIQUE (user_id, name)
);
