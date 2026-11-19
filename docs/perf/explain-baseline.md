# EXPLAIN ANALYZE: baseline

- Версія застосунку (`/version`): `27b5c460cef8d429612ab3ac30c002cae61e58d8` · дата 2026-11-09T09:58:39.212Z
- Дані: 2000 користувачів, 200000 ліцензій (`db:seed`); SQL перехоплено з репозиторіїв, а не скопійовано
- Відтворити: `make explain` (стенд піднятий `make load`)

## Таблиці

| Таблиця           | Рядків (оцінка) | Розмір з індексами |
| :---------------- | --------------: | -----------------: |
| licenses          |         200 000 |              60 MB |
| sessions          |          26 275 |            7584 kB |
| users             |           2 001 |             592 kB |
| user_configs      |              50 |             104 kB |
| plans             |              -1 |              32 kB |
| orders            |              -1 |              24 kB |
| schema_migrations |              -1 |              32 kB |
| payment_events    |              -1 |              24 kB |

## Підсумок

| Запит                                           | Execution Time, мс | Верхній вузол плану                                                                          |
| :---------------------------------------------- | -----------------: | :------------------------------------------------------------------------------------------- |
| loader.findByKey (handshake, кожен запит)       |              0.030 | `Index Scan using licenses_key_key on licenses  (cost=0.42..8.44 rows=1 width=50) (actual t` |
| loader.bindHwid (перший handshake ключа)        |              0.062 | `Update on licenses  (cost=0.42..8.45 rows=1 width=86) (actual time=0.010..0.010 rows=0 loo` |
| auth.findSessionUser (кожен запит з токеном)    |              0.037 | `Nested Loop  (cost=0.69..16.74 rows=1 width=40) (actual time=0.018..0.018 rows=1 loops=1)`  |
| auth.findUserByEmail (login)                    |              0.017 | `Index Scan using users_email_key on users  (cost=0.28..8.29 rows=1 width=135) (actual time` |
| licenses.listUserLicenses (мої ліцензії)        |              0.267 | `Sort  (cost=365.83..366.09 rows=103 width=118) (actual time=0.236..0.238 rows=100 loops=1)` |
| configs.find (кабінет)                          |              0.022 | `Seq Scan on user_configs  (cost=0.00..5.75 rows=1 width=249) (actual time=0.007..0.009 row` |
| admin listLicenses offset 0                     |              0.166 | `Limit  (cost=0.71..4.23 rows=50 width=137) (actual time=0.051..0.101 rows=50 loops=1)`      |
| admin listLicenses offset 100 000               |             25.230 | `Limit  (cost=7052.10..7055.62 rows=50 width=137) (actual time=25.139..25.152 rows=50 loops` |
| admin listLicenses offset 199 950               |             47.884 | `Limit  (cost=14099.96..14103.48 rows=50 width=137) (actual time=47.781..47.793 rows=50 loo` |
| admin listLicenses status=ACTIVE offset 100 000 |             26.254 | `Limit  (cost=8160.83..8164.91 rows=50 width=137) (actual time=26.172..26.185 rows=50 loops` |

## Плани

### loader.findByKey (handshake, кожен запит)

```sql
SELECT key, hwid, status, expires_at FROM licenses WHERE key = $1
```

```text
Index Scan using licenses_key_key on licenses  (cost=0.42..8.44 rows=1 width=50) (actual time=0.020..0.020 rows=1 loops=1)
  Index Cond: (key = 'APP-0000-0001-86A1'::text)
  Buffers: shared hit=4
Planning:
  Buffers: shared hit=20
Planning Time: 0.143 ms
Execution Time: 0.030 ms
```

### loader.bindHwid (перший handshake ключа)

```sql
UPDATE licenses
          SET hwid = $1,
              status = 'ACTIVE',
              activated_at = COALESCE(activated_at, $2),
              expires_at = COALESCE(expires_at, $3::timestamptz + make_interval(days => duration_days))
          WHERE key = $4 AND hwid IS NULL AND status <> 'BANNED'
          RETURNING key, hwid, status, expires_at
```

```text
Update on licenses  (cost=0.42..8.45 rows=1 width=86) (actual time=0.010..0.010 rows=0 loops=1)
  Buffers: shared hit=4
  ->  Index Scan using licenses_key_key on licenses  (cost=0.42..8.45 rows=1 width=86) (actual time=0.010..0.010 rows=0 loops=1)
        Index Cond: (key = 'APP-0000-0001-86A0'::text)
        Filter: ((hwid IS NULL) AND (status <> 'BANNED'::text))
        Rows Removed by Filter: 1
        Buffers: shared hit=4
Planning:
  Buffers: shared hit=17
Planning Time: 0.106 ms
Execution Time: 0.062 ms
```

### auth.findSessionUser (кожен запит з токеном)

```sql
SELECT u.id, u.email, u.role
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > $2
```

```text
Nested Loop  (cost=0.69..16.74 rows=1 width=40) (actual time=0.018..0.018 rows=1 loops=1)
  Buffers: shared hit=7
  ->  Index Scan using sessions_pkey on sessions s  (cost=0.41..8.43 rows=1 width=16) (actual time=0.008..0.009 rows=1 loops=1)
        Index Cond: (token_hash = '61fe9d06844996a443330a4e1f474877cdba02b789defc08d5f2bc6eebbfdd32'::text)
        Filter: (expires_at > '2026-11-09 09:58:39.004+00'::timestamp with time zone)
        Buffers: shared hit=4
  ->  Index Scan using users_pkey on users u  (cost=0.28..8.29 rows=1 width=40) (actual time=0.008..0.008 rows=1 loops=1)
        Index Cond: (id = s.user_id)
        Buffers: shared hit=3
Planning:
  Buffers: shared hit=132
Planning Time: 0.737 ms
Execution Time: 0.037 ms
```

### auth.findUserByEmail (login)

```sql
SELECT * FROM users WHERE email = $1
```

```text
Index Scan using users_email_key on users  (cost=0.28..8.29 rows=1 width=135) (actual time=0.009..0.009 rows=1 loops=1)
  Index Cond: (email = 'seed-1500@lch.local'::text)
  Buffers: shared hit=3
Planning:
  Buffers: shared hit=6
Planning Time: 0.061 ms
Execution Time: 0.017 ms
```

### licenses.listUserLicenses (мої ліцензії)

```sql
SELECT * FROM licenses WHERE user_id = $1 ORDER BY created_at DESC
```

```text
Sort  (cost=365.83..366.09 rows=103 width=118) (actual time=0.236..0.238 rows=100 loops=1)
  Sort Key: created_at DESC
  Sort Method: quicksort  Memory: 37kB
  Buffers: shared hit=102
  ->  Bitmap Heap Scan on licenses  (cost=5.09..362.39 rows=103 width=118) (actual time=0.018..0.215 rows=100 loops=1)
        Recheck Cond: (user_id = '767a2c4d-f79e-4842-b986-d922fcfcc583'::uuid)
        Heap Blocks: exact=100
        Buffers: shared hit=102
        ->  Bitmap Index Scan on licenses_user_id_idx  (cost=0.00..5.07 rows=103 width=0) (actual time=0.013..0.013 rows=100 loops=1)
              Index Cond: (user_id = '767a2c4d-f79e-4842-b986-d922fcfcc583'::uuid)
              Buffers: shared hit=2
Planning:
  Buffers: shared hit=14
Planning Time: 0.091 ms
Execution Time: 0.267 ms
```

### configs.find (кабінет)

```sql
SELECT * FROM user_configs WHERE user_id = $1 AND name = $2
```

```text
Seq Scan on user_configs  (cost=0.00..5.75 rows=1 width=249) (actual time=0.007..0.009 rows=1 loops=1)
  Filter: ((user_id = '767a2c4d-f79e-4842-b986-d922fcfcc583'::uuid) AND (name = 'perf-profile'::text))
  Rows Removed by Filter: 49
  Buffers: shared hit=5
Planning:
  Buffers: shared hit=19
Planning Time: 0.164 ms
Execution Time: 0.022 ms
```

### admin listLicenses offset 0

```sql
SELECT l.*, u.email AS owner_email
        FROM licenses l LEFT JOIN users u ON u.id = l.user_id

        ORDER BY l.created_at DESC
        LIMIT $1 OFFSET $2
```

```text
Limit  (cost=0.71..4.23 rows=50 width=137) (actual time=0.051..0.101 rows=50 loops=1)
  Buffers: shared hit=158
  ->  Nested Loop Left Join  (cost=0.71..14659.48 rows=207885 width=137) (actual time=0.051..0.099 rows=50 loops=1)
        Buffers: shared hit=158
        ->  Index Scan using licenses_created_at_idx on licenses l  (cost=0.42..8871.65 rows=207885 width=118) (actual time=0.012..0.016 rows=50 loops=1)
              Buffers: shared hit=8
        ->  Memoize  (cost=0.29..0.31 rows=1 width=35) (actual time=0.001..0.001 rows=1 loops=50)
              Cache Key: l.user_id
              Cache Mode: logical
              Hits: 0  Misses: 50  Evictions: 0  Overflows: 0  Memory Usage: 8kB
              Buffers: shared hit=150
              ->  Index Scan using users_pkey on users u  (cost=0.28..0.30 rows=1 width=35) (actual time=0.001..0.001 rows=1 loops=50)
                    Index Cond: (id = l.user_id)
                    Buffers: shared hit=150
Planning:
  Buffers: shared hit=16
Planning Time: 0.176 ms
Execution Time: 0.166 ms
```

### admin listLicenses offset 100 000

```sql
SELECT l.*, u.email AS owner_email
        FROM licenses l LEFT JOIN users u ON u.id = l.user_id

        ORDER BY l.created_at DESC
        LIMIT $1 OFFSET $2
```

```text
Limit  (cost=7052.10..7055.62 rows=50 width=137) (actual time=25.139..25.152 rows=50 loops=1)
  Buffers: shared hit=14650
  ->  Nested Loop Left Join  (cost=0.71..14659.48 rows=207885 width=137) (actual time=0.045..23.203 rows=100050 loops=1)
        Buffers: shared hit=14650
        ->  Index Scan using licenses_created_at_idx on licenses l  (cost=0.42..8871.65 rows=207885 width=118) (actual time=0.009..5.970 rows=100050 loops=1)
              Buffers: shared hit=8650
        ->  Memoize  (cost=0.29..0.31 rows=1 width=35) (actual time=0.000..0.000 rows=1 loops=100050)
              Cache Key: l.user_id
              Cache Mode: logical
              Hits: 98050  Misses: 2000  Evictions: 0  Overflows: 0  Memory Usage: 288kB
              Buffers: shared hit=6000
              ->  Index Scan using users_pkey on users u  (cost=0.28..0.30 rows=1 width=35) (actual time=0.000..0.000 rows=1 loops=2000)
                    Index Cond: (id = l.user_id)
                    Buffers: shared hit=6000
Planning:
  Buffers: shared hit=14
Planning Time: 0.151 ms
Execution Time: 25.230 ms
```

### admin listLicenses offset 199 950

```sql
SELECT l.*, u.email AS owner_email
        FROM licenses l LEFT JOIN users u ON u.id = l.user_id

        ORDER BY l.created_at DESC
        LIMIT $1 OFFSET $2
```

```text
Limit  (cost=14099.96..14103.48 rows=50 width=137) (actual time=47.781..47.793 rows=50 loops=1)
  Buffers: shared hit=23273
  ->  Nested Loop Left Join  (cost=0.71..14659.48 rows=207885 width=137) (actual time=0.042..43.891 rows=200000 loops=1)
        Buffers: shared hit=23273
        ->  Index Scan using licenses_created_at_idx on licenses l  (cost=0.42..8871.65 rows=207885 width=118) (actual time=0.008..11.128 rows=200000 loops=1)
              Buffers: shared hit=17273
        ->  Memoize  (cost=0.29..0.31 rows=1 width=35) (actual time=0.000..0.000 rows=1 loops=200000)
              Cache Key: l.user_id
              Cache Mode: logical
              Hits: 198000  Misses: 2000  Evictions: 0  Overflows: 0  Memory Usage: 288kB
              Buffers: shared hit=6000
              ->  Index Scan using users_pkey on users u  (cost=0.28..0.30 rows=1 width=35) (actual time=0.000..0.000 rows=1 loops=2000)
                    Index Cond: (id = l.user_id)
                    Buffers: shared hit=6000
Planning:
  Buffers: shared hit=14
Planning Time: 0.232 ms
Execution Time: 47.884 ms
```

### admin listLicenses status=ACTIVE offset 100 000

```sql
SELECT l.*, u.email AS owner_email
        FROM licenses l LEFT JOIN users u ON u.id = l.user_id
        WHERE l.status = $1
        ORDER BY l.created_at DESC
        LIMIT $2 OFFSET $3
```

```text
Limit  (cost=8160.83..8164.91 rows=50 width=137) (actual time=26.172..26.185 rows=50 loops=1)
  Buffers: shared hit=14874
  ->  Nested Loop Left Join  (cost=0.71..14391.57 rows=176356 width=137) (actual time=0.042..24.257 rows=100050 loops=1)
        Buffers: shared hit=14874
        ->  Index Scan using licenses_created_at_idx on licenses l  (cost=0.42..9391.36 rows=176356 width=118) (actual time=0.009..7.755 rows=100050 loops=1)
              Filter: (status = 'ACTIVE'::text)
              Rows Removed by Filter: 6086
              Buffers: shared hit=9174
        ->  Memoize  (cost=0.29..0.31 rows=1 width=35) (actual time=0.000..0.000 rows=1 loops=100050)
              Cache Key: l.user_id
              Cache Mode: logical
              Hits: 98150  Misses: 1900  Evictions: 0  Overflows: 0  Memory Usage: 274kB
              Buffers: shared hit=5700
              ->  Index Scan using users_pkey on users u  (cost=0.28..0.30 rows=1 width=35) (actual time=0.000..0.000 rows=1 loops=1900)
                    Index Cond: (id = l.user_id)
                    Buffers: shared hit=5700
Planning:
  Buffers: shared hit=14
Planning Time: 0.130 ms
Execution Time: 26.254 ms
```
