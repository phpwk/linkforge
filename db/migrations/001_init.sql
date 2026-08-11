-- 001_init.sql
-- Core schema for LinkForge. Kept intentionally small: one table,
-- one index that actually matters for the hot path (lookup by code).

CREATE TABLE IF NOT EXISTS links (
    id           BIGSERIAL PRIMARY KEY,
    code         VARCHAR(16)  NOT NULL UNIQUE,
    original_url TEXT         NOT NULL,
    clicks       BIGINT       NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Lookups on the redirect path are by code; the UNIQUE constraint
-- above already gives us a btree index, so nothing extra is needed
-- for that. This index supports the "recent links" listing.
CREATE INDEX IF NOT EXISTS idx_links_created_at ON links (created_at DESC);
