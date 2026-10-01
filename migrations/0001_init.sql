-- Listings. Only the public columns are ever shown or exported;
-- email and token_hash never leave the database.
CREATE TABLE listings (
  id            TEXT PRIMARY KEY,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'active', 'hidden')),
  setting       TEXT NOT NULL CHECK (setting IN ('public', 'home')),
  place         TEXT NOT NULL,
  address       TEXT,
  city          TEXT NOT NULL,
  region        TEXT NOT NULL,
  country       TEXT NOT NULL,
  day           TEXT NOT NULL,
  time          TEXT NOT NULL,
  timezone      TEXT NOT NULL,
  languages     TEXT,
  meal          TEXT NOT NULL,
  children      TEXT NOT NULL,
  accessibility TEXT,
  notes         TEXT,
  email         TEXT NOT NULL,
  token_hash    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  published_at  TEXT,
  confirmed_at  TEXT,
  reminded_at   TEXT
);

CREATE INDEX idx_listings_browse    ON listings (status, country, region, city);
CREATE INDEX idx_listings_email     ON listings (email);
CREATE INDEX idx_listings_confirmed ON listings (status, confirmed_at);
CREATE INDEX idx_listings_created   ON listings (status, created_at);

-- Removals by custodians. Published with the reason; no personal data.
CREATE TABLE removals (
  id         TEXT NOT NULL,
  city       TEXT NOT NULL,
  region     TEXT NOT NULL,
  country    TEXT NOT NULL,
  reason     TEXT NOT NULL,
  removed_at TEXT NOT NULL
);

-- Daily counters for rate limits. Old rows are purged by the daily job.
CREATE TABLE counters (
  key   TEXT NOT NULL,
  day   TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, day)
);
