CREATE TABLE devices (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1, pulse_ms INTEGER NOT NULL DEFAULT 800,
 secret_cipher TEXT, secret_hash TEXT, registration_id TEXT,
 enrollment_hash TEXT, enrollment_expires INTEGER,
 qr_revision INTEGER NOT NULL DEFAULT 1,
 last_seen INTEGER, next_seq INTEGER NOT NULL DEFAULT 0,
 cooldown_until INTEGER NOT NULL DEFAULT 0, boot_id TEXT,
 created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE bookings (
 id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
 user_id TEXT NOT NULL, user_email TEXT NOT NULL,
 starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
 approved INTEGER NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0,
 revoked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
 CHECK(ends_at > starts_at)
);
--> statement-breakpoint
CREATE INDEX bookings_access ON bookings(device_id, user_id, starts_at, ends_at);
--> statement-breakpoint
CREATE TABLE commands (
 id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
 booking_id TEXT NOT NULL REFERENCES bookings(id), user_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, seq INTEGER NOT NULL,
 issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 pulse_ms INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
 delivered_at INTEGER, acknowledged_at INTEGER, boot_id TEXT,
 UNIQUE(device_id, seq), UNIQUE(user_id, idempotency_key)
);
--> statement-breakpoint
CREATE INDEX commands_delivery ON commands(device_id,status,expires_at);
--> statement-breakpoint
CREATE TABLE request_nonces (
 device_id TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL,
 PRIMARY KEY(device_id, nonce)
);
--> statement-breakpoint
CREATE TABLE rate_limits (
 scope TEXT PRIMARY KEY, window_started INTEGER NOT NULL, count INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE audit (
 id TEXT PRIMARY KEY, device_id TEXT, user_id TEXT,
 event TEXT NOT NULL, command_id TEXT, created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX audit_device ON audit(device_id,created_at);
