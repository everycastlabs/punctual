-- Instance settings, scoped per domain — one shared Worker answering several
-- branded `Host` headers needs its own homepage identity/content per domain,
-- not one global row set. `domain = ''` is the default/global scope: every
-- setting written before this migration lands there unchanged, and it is
-- also where a single-brand self-hosted deployment's settings live forever,
-- since `resolveBrand`'s own fallback for an unrecognized `Host` uses the
-- same empty-string convention.
--
-- SQLite has no ALTER TABLE for a primary key, so this is the standard
-- rebuild: new table, copy forward, drop, rename (forward-only and
-- additive, ADR-0006 §4 — no existing row is lost, every one just gains an
-- explicit domain).

CREATE TABLE instance_settings_new (
  domain     TEXT NOT NULL DEFAULT '',
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (domain, key)
);

INSERT INTO instance_settings_new (domain, key, value, updated_at)
SELECT '', key, value, updated_at FROM instance_settings;

DROP TABLE instance_settings;
ALTER TABLE instance_settings_new RENAME TO instance_settings;
