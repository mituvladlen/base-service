-- Base Service schema (idempotent: safe to run on every start)
CREATE TABLE IF NOT EXISTS bases (
  id               TEXT PRIMARY KEY,
  player_id        TEXT NOT NULL UNIQUE,              -- one base per player
  name             TEXT NOT NULL,
  room_id          TEXT NOT NULL DEFAULT 'FAF_CAB',
  level            INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
  storage_capacity INTEGER NOT NULL CHECK (storage_capacity > 0),
  barricades       JSONB NOT NULL DEFAULT '[]'::jsonb,
  facilities       JSONB NOT NULL DEFAULT '[]'::jsonb,
  decorations      JSONB NOT NULL DEFAULT '[]'::jsonb,
  boosters         JSONB NOT NULL DEFAULT '[]'::jsonb,
  kiki             JSONB NOT NULL DEFAULT '{"mood": 50, "interactions": 0, "lastInteractionAt": null}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency ledger for paid / random actions (upgrade, barricade, facility, storage, decoration, Kiki)
CREATE TABLE IF NOT EXISTS base_actions (
  action_id   TEXT PRIMARY KEY,
  base_id     TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_base_actions_base ON base_actions (base_id, created_at DESC);
