-- Steam Account Linking
-- Links Steam accounts to launcher user accounts for verification

CREATE TABLE IF NOT EXISTS steam_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    steam_id VARCHAR(64) NOT NULL,
    persona_name VARCHAR(255),
    avatar_url TEXT,
    linked_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Each user can only have one linked Steam account
    CONSTRAINT steam_links_user_id_unique UNIQUE (user_id),
    -- Each Steam account can only be linked once
    CONSTRAINT steam_links_steam_id_unique UNIQUE (steam_id)
);

-- RLS: Users can only see their own link
ALTER TABLE steam_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own steam link"
    ON steam_links FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own steam link"
    ON steam_links FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own steam link"
    ON steam_links FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own steam link"
    ON steam_links FOR DELETE
    USING (auth.uid() = user_id);

-- Admin can see all links
CREATE POLICY "Admins can view all steam links"
    ON steam_links FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('admin', 'manager')
        )
    );

CREATE POLICY "Admins can insert steam links"
    ON steam_links FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('admin', 'manager')
        )
    );

CREATE POLICY "Admins can delete steam links"
    ON steam_links FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('admin', 'manager')
        )
    );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_steam_links_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER steam_links_updated_at
    BEFORE UPDATE ON steam_links
    FOR EACH ROW
    EXECUTE FUNCTION update_steam_links_updated_at();

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_steam_links_user_id ON steam_links(user_id);
CREATE INDEX IF NOT EXISTS idx_steam_links_steam_id ON steam_links(steam_id);

-- Add comment for documentation
COMMENT ON TABLE steam_links IS 'Links Steam accounts to launcher user accounts for game ownership verification';
COMMENT ON COLUMN steam_links.steam_id IS 'SteamID64 of the linked account';
COMMENT ON COLUMN steam_links.persona_name IS 'Steam display name at time of linking';
COMMENT ON COLUMN steam_links.avatar_url IS 'Steam avatar URL at time of linking';
