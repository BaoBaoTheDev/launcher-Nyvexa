// @ts-nocheck
import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const cleanEmail = String(body?.email || '').trim().toLowerCase();
    const cleanCode = String(body?.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (!cleanEmail || !cleanCode) {
      return new Response(JSON.stringify({ success: false, valid: false, error: 'Missing email/code' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ success: false, valid: false, error: 'Missing Supabase service role config' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase
      .from('custom_otps')
      .select('id, code, created_at')
      .ilike('email', cleanEmail)
      .order('created_at', { ascending: false });

    if (error || !Array.isArray(data) || data.length === 0) {
      return new Response(JSON.stringify({ success: true, valid: false }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const otpRow = data.find((row) => {
      const rowCode = String(row?.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      return rowCode === cleanCode;
    });

    if (!otpRow?.id) {
      return new Response(JSON.stringify({ success: true, valid: false }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ageMs = Date.now() - new Date(otpRow.created_at).getTime();
    if (!Number.isFinite(ageMs) || ageMs > 10 * 60 * 1000) {
      return new Response(JSON.stringify({ success: true, valid: false, expired: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabase.from('custom_otps').delete().eq('id', otpRow.id);

    return new Response(JSON.stringify({ success: true, valid: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, valid: false, error: String((error as any)?.message || error) }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
