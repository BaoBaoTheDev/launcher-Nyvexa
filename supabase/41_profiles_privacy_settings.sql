-- Add profile privacy settings used by Edit Profile -> Privacy tab
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS privacy_show_summary BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS privacy_show_status BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS privacy_show_owned_games BOOLEAN NOT NULL DEFAULT TRUE;
