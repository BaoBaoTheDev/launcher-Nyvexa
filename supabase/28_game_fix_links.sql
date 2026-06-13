-- Game fix overrides: direct lua URL per game

CREATE TABLE IF NOT EXISTS public.game_fix_links (
  game_id UUID PRIMARY KEY REFERENCES public.games(id) ON DELETE CASCADE,
  direct_lua_url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.game_fix_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access game_fix_links" ON public.game_fix_links;
CREATE POLICY "Service role full access game_fix_links"
  ON public.game_fix_links
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_game_fix_links_enabled
  ON public.game_fix_links(enabled);
