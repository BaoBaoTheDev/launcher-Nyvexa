    -- Enforce review posting as one-time action for authenticated users

    DROP POLICY IF EXISTS "User can update own review" ON public.reviews;
    DROP POLICY IF EXISTS "User can delete own review" ON public.reviews;

    DROP POLICY IF EXISTS "Anyone can read reviews" ON public.reviews;
    CREATE POLICY "Anyone can read reviews"
        ON public.reviews FOR SELECT
        TO public
        USING (true);

    DROP POLICY IF EXISTS "User can insert own review" ON public.reviews;
    CREATE POLICY "User can insert own review"
        ON public.reviews FOR INSERT
        TO authenticated
        WITH CHECK (auth.uid() = user_id);
