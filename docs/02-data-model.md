# Data Model — PostgreSQL

**Conventions**

- IDs: `uuid` (UUIDv7, generated client- or server-side). PKs are never auto-increment.
- Timestamps: `timestamptz`, UTC. Column suffixes: `_at`.
- Money: `bigint` minor units (paise) + `currency char(3)`. Never floats.
- Tenancy: every tenant-owned table has `cafe_id uuid not null references cafes(id)`; composite indexes lead with `cafe_id`.
- Enums: Postgres enums for stable sets; `text` + check constraint where the set may grow (event types).
- Soft delete only where required (`menu_items.deleted_at`); everything else is state-machine based.
- Redis is ephemeral-only (queues, pub/sub fan-out, rate limits, idempotency cache, presence) — see [01-architecture §4.4](01-architecture.md). Nothing below is stored exclusively in Redis.

---

## 1. Tenancy & Org

```sql
tenants        (id pk, name, status, created_at)
cafes          (id pk, tenant_id fk→tenants, name, timezone text, currency char(3),
                address jsonb, status active|suspended, created_at)
users          (id pk, cafe_id fk, email citext unique per cafe, password_hash,
                role owner|manager|staff|kitchen, name, status, last_login_at)
pc_tiers       (id pk, cafe_id fk, name, description)          -- Standard / Premium / Racing
```

## 2. PCs & Agents

```sql
pcs                    (id pk, cafe_id fk, name text,            -- "PC-07"
                        tier_id fk→pc_tiers null,
                        status online|offline|maintenance|disabled,
                        hardware_fingerprint text, agent_version text,
                        last_heartbeat_at timestamptz, created_at,
                        unique(cafe_id, name))

device_credentials     (pc_id pk fk→pcs, token_hash sha256, paired_at,
                        revoked_at null, rotated_at)

pairing_codes          (id pk, pc_id fk, code text, expires_at, used_at null)

pc_health_snapshots    (id pk, pc_id fk, captured_at,
                        cpu_pct real, ram_pct real, gpu_pct real, disk_pct real,
                        disk_free_bytes bigint, net_rx_bps bigint, net_tx_bps bigint,
                        uptime_s int, current_game_id fk null, agent_status text)
                        -- retention: 30d raw → hourly rollup

pc_configurations      (id pk, pc_id fk, version int,            -- monotonic; pushed via SSE
                        config jsonb,                            -- lockdown flags, warnings, launcher theme
                        published_at)

superadmin_verifiers   (id pk, pc_id fk, verifier blob,          -- DPAPI-encrypted Argon2id params+hash
                        version int, synced_at)
```

## 3. Games & Deployment

```sql
games                  (id pk, cafe_id fk, name, icon_url, category text,
                        executable_path text, launch_args text,
                        platform steam|epic|riot|ea|battlenet|standalone,
                        enabled bool, display_order int, created_at)

game_versions          (id pk, game_id fk, version text,         -- semver-ish label
                        manifest_url text,                       -- served by master PC on LAN
                        manifest_hash text, size_bytes bigint,
                        status draft|published|deprecated,
                        published_at)

pc_game_installations  (id pk, pc_id fk, game_id fk,
                        installed_version fk→game_versions null,
                        install_path text, state not_installed|installing|ready|failed,
                        last_verified_at,
                        unique(pc_id, game_id))

game_deployments       (id pk, cafe_id fk, game_id fk,
                        target_version fk→game_versions,
                        master_pc_id fk→pcs,
                        policy jsonb,                            -- idle-only, maintenance window, limits
                        status queued|running|completed|failed|cancelled,
                        created_by fk→users, created_at)

game_deployment_targets(id pk, deployment_id fk, pc_id fk,
                        state queued|downloading|verifying|installing|ready|paused|failed|offline,
                        progress_pct real, bytes_transferred bigint,
                        error text null, started_at, finished_at)
```

Deployment targets transition per the state machine in [04-pc-agent §7](04-pc-agent.md); cloud rows are updated from agent progress reports.

## 4. Sessions

```sql
sessions               (id pk, cafe_id fk, pc_id fk,
                        customer_id fk null,                     -- null = guest
                        started_at timestamptz, expires_at timestamptz,
                        ended_at timestamptz null,
                        planned_minutes int, extended_minutes int default 0,
                        price_amount bigint, currency,           -- snapshot at start
                        pricing_breakdown jsonb,
                        status scheduled|active|expired|ended|cancelled,
                        origin admin|launcher|superadmin_offline,
                        created_by fk→users null,                -- null if launcher/offline
                        idempotency_key text unique null)        -- offline event dedupe

session_events         (id pk, session_id fk, type started|extended|ended|cancelled|
                                              paused|resumed|transferred|expired,
                        actor_type user|pc|system|customer, actor_id text,
                        occurred_at, payload jsonb)

pricing_rules          (id pk, cafe_id fk, tier_id fk null,
                        name, day_of_week int[], start_time time, end_time time,
                        hourly_rate bigint, priority int,        -- higher wins overlap
                        active bool)
```

Session price = integral of matching rule rates over `[started_at, started_at + total_minutes]`, snapshotted at start and re-snapshotted on extension (delta recorded in `session_events.payload`).

## 5. Offline Sync

```sql
offline_events         (id pk,                                   -- == agent's UUIDv7 event_id (global dedupe)
                        cafe_id fk, pc_id fk,
                        seq bigint,                              -- per-PC monotonic
                        type text check (type in (...)),         -- SESSION_STARTED, SESSION_EXTENDED, ...
                        occurred_at timestamptz,                 -- agent local time
                        payload jsonb,
                        state accepted|duplicate|conflicted,
                        conflict_reason text null,
                        applied_session_id fk null,
                        received_batch_id fk null,
                        received_at,
                        unique(pc_id, seq))

reconciliation_batches (id pk, pc_id fk, agent_version,
                        last_server_seq bigint,                  -- agent's view of server ack point
                        event_count int, received_at)
```

`offline_events.id` is the global idempotency key: replays hit the PK and return `duplicate` without side effects.

## 6. Commands

```sql
pc_commands            (id pk, cafe_id fk, pc_id fk,
                        type start_session|extend_session|end_session|lock|unlock|
                             launch_game|restart|shutdown|refresh_config|
                             enter_maintenance|request_health|deployment_control,
                        payload jsonb,
                        requires_confirm bool, confirmed_by fk null,
                        status pending|sent|applied|failed|expired,
                        issued_by fk→users, issued_at,
                        delivered_at, acked_at, ack_payload jsonb,
                        expires_at)                              -- default issued_at + 60s
```

Delivery via SSE `command` event; ack via REST. Worker expires stale `pending/sent` commands.

## 7. Food

```sql
menu_categories        (id pk, cafe_id fk, name, display_order, available bool)
menu_items             (id pk, cafe_id fk, category_id fk, name, description,
                        image_url, base_price bigint, currency,
                        prep_minutes int, available bool, deleted_at null)
menu_variants          (id pk, item_id fk, name, price_delta bigint, available bool)   -- size etc.
menu_addons            (id pk, item_id fk, name, price bigint, available bool)

orders                 (id pk, cafe_id fk, pc_id fk null, session_id fk null,
                        customer_id fk null,
                        number int,                              -- per-café daily sequence
                        status placed|accepted|preparing|ready|delivered|completed|cancelled,
                        total_amount bigint, currency,
                        source launcher|admin|customer_web,
                        placed_at, cancelled_reason text null)

order_items            (id pk, order_id fk, menu_item_id fk, variant_id fk null,
                        name_snapshot text, unit_price bigint, qty int,
                        addons jsonb, line_total bigint)

order_status_history   (id pk, order_id fk, from_status, to_status,
                        actor_type, actor_id, changed_at)
```

Order totals are computed server-side from item snapshots; the launcher cart is advisory only.

## 8. Customers, Wallet, Loyalty, Memberships (V1 minimal, Phase 2 full)

```sql
customers              (id pk, cafe_id fk, phone text null, email citext null,
                        name, auth_method none|password|otp, password_hash null,
                        status, created_at,
                        check (phone is not null or email is not null or auth_method='none'))

wallets                (id pk, customer_id fk unique, currency)
wallet_transactions    (id pk, wallet_id fk, type credit|debit,
                        subtype topup|promo|refund|adjustment|payment,
                        amount bigint, balance_after bigint,     -- derived, stored for audit speed
                        reference_type text null, reference_id uuid null,
                        idempotency_key text unique, created_at) -- append-only

memberships            (id pk, cafe_id fk, name, price bigint, benefits jsonb, active bool)
customer_memberships   (id pk, customer_id fk, membership_id fk, starts_at, ends_at, status)

loyalty_accounts       (id pk, customer_id fk unique, points_balance bigint)
loyalty_transactions   (id pk, account_id fk, type earn|redeem|expire|adjust,
                        points int, reason text, reference_id uuid null, created_at)

reservations           (id pk, cafe_id fk, pc_id fk, customer_id fk,
                        start_at, end_at, price bigint, status held|confirmed|cancelled|fulfilled)
```

Wallet/loyalty mutations go through ledger services that enforce `balance_after` continuity inside a transaction.

## 9. Payments

```sql
payments               (id pk, cafe_id fk, session_id fk null, order_id fk null,
                        customer_id fk null, method cash|upi|card|online|wallet,
                        amount bigint, currency,
                        status pending|success|failed|refunded|partially_refunded,
                        external_ref text null,                  -- UPI txn id etc.
                        idempotency_key text unique, created_at)

payment_transactions   (id pk, payment_id fk, type charge|refund|partial_refund,
                        amount bigint, created_at, actor_id, note)  -- append-only
```

## 10. Notifications & Audit

```sql
notifications          (id pk, cafe_id fk, audience admin|customer|kitchen,
                        user_id fk null, pc_id fk null,
                        type text, severity info|warning|critical,
                        title, body, read_at null, created_at)

audit_logs             (id bigserial pk,                         -- append-only; no updates ever
                        event_id uuid,                           -- UUIDv7, dedupe across retries
                        cafe_id fk null,                         -- null for platform-level actions
                        actor_type user|pc|system|customer|superadmin_local,
                        actor_id text, actor_role text null,
                        action text,                             -- ADMIN_LOGIN, SESSION_STARTED, ...
                        source online|offline|local,
                        pc_id fk null, entity_type text null, entity_id uuid null,
                        metadata jsonb, occurred_at,
                        unique(event_id))
```

---

## 11. Indexing & Integrity Notes

- Hot paths get covering composites:
  - `sessions (cafe_id, status, expires_at)` — expiry sweep + dashboard
  - `sessions (pc_id, status)` — PC detail view
  - `orders (cafe_id, status, placed_at desc)` — kitchen queue
  - `pc_commands (pc_id, status, issued_at desc)`
  - `audit_logs (cafe_id, occurred_at desc)`, `(action, occurred_at desc)`
- FK integrity everywhere; no cascading deletes on ledgers — ledgers are never deleted.
- Expiry sweep uses `SELECT ... WHERE status='active' AND expires_at < now() FOR UPDATE SKIP LOCKED` so api replicas/workers can run concurrently without double-expiring.
- Retention jobs: health snapshots 30 d raw / 13 mo rollups; notifications 90 d; audit logs retained indefinitely (compliance).
