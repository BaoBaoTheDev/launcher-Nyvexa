-- Persist richer Steam metadata so website game detail can render without direct Steam API access.
ALTER TABLE public.games
ADD COLUMN IF NOT EXISTS detailed_description TEXT,
ADD COLUMN IF NOT EXISTS about_the_game TEXT,
ADD COLUMN IF NOT EXISTS pc_requirements_minimum TEXT,
ADD COLUMN IF NOT EXISTS pc_requirements_recommended TEXT,
ADD COLUMN IF NOT EXISTS screenshots_json JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS movies_json JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.games.detailed_description IS 'Fallback HTML description for website game detail.';
COMMENT ON COLUMN public.games.about_the_game IS 'Fallback about-the-game HTML from Steam metadata.';
COMMENT ON COLUMN public.games.pc_requirements_minimum IS 'Fallback minimum PC requirements HTML/text.';
COMMENT ON COLUMN public.games.pc_requirements_recommended IS 'Fallback recommended PC requirements HTML/text.';
COMMENT ON COLUMN public.games.screenshots_json IS 'Fallback screenshots payload copied from Steam metadata.';
COMMENT ON COLUMN public.games.movies_json IS 'Fallback trailer/movie payload copied from Steam metadata.';
