-- Add registry_id column for storing the raw registry value
-- This replaces the need to calculate SteamID64

ALTER TABLE steam_links ADD COLUMN IF NOT EXISTS registry_id VARCHAR(64);

-- Make steam_id nullable to allow inserts with only registry_id
ALTER TABLE steam_links ALTER COLUMN steam_id DROP NOT NULL;

-- Drop old steam_id constraint
ALTER TABLE steam_links DROP CONSTRAINT IF EXISTS steam_links_steam_id_unique;

-- Drop any existing registry_id constraint (handle both old and new naming)
DO $$ BEGIN
   ALTER TABLE steam_links DROP CONSTRAINT IF EXISTS steam_links_registry_id_key;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
   ALTER TABLE steam_links DROP CONSTRAINT IF EXISTS steam_links_registry_id_unique;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Add new unique constraint on registry_id
ALTER TABLE steam_links ADD CONSTRAINT steam_links_registry_id_key UNIQUE (registry_id);

-- Index for registry_id lookups
CREATE INDEX IF NOT EXISTS idx_steam_links_registry_id ON steam_links(registry_id);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
