import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, secure-token, Secure-Token, x-secure-token',
}

function extractIncomingToken(req: Request, body: Record<string, unknown> | null): string {
  const secureToken = req.headers.get('secure-token') || req.headers.get('Secure-Token') || req.headers.get('x-secure-token');
  if (secureToken && secureToken.trim()) return secureToken.trim();

  try {
    const tokenFromQuery = new URL(req.url).searchParams.get('token') || new URL(req.url).searchParams.get('secure_token');
    if (tokenFromQuery && tokenFromQuery.trim()) return tokenFromQuery.trim();
  } catch {
    // ignore
  }

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (authHeader) {
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch?.[1]) return bearerMatch[1].trim();
    if (authHeader.trim()) return authHeader.trim();
  }

  const bodyTokenCandidates = [
    body?.secure_token,
    body?.token,
    body?.SecureToken,
    body?.['secure-token'],
  ];
  for (const candidate of bodyTokenCandidates) {
    const token = String(candidate || '').trim();
    if (token) return token;
  }

  return '';
}

function extractOrderCodeFromDescription(description: string): string | null {
  const raw = String(description || '');
  if (!raw.trim()) return null;
  const match = raw.match(/\bNESTG\D*(\d{6,12})\b/i);
  return match?.[1] || null;
}

function parseIncomingAmount(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  const text = String(raw ?? '').trim();
  if (!text) return NaN;
  const normalized = text
    .replace(/\s+/g, '')
    .replace(/[^0-9,.-]/g, '')
    .replace(/,(?=\d{3}(\D|$))/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : NaN;
}

function normalizeTransactions(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const d = (body as any)?.data;
  if (Array.isArray(d)) return d.filter(Boolean);
  if (d && typeof d === 'object') {
    if (Array.isArray((d as any).records)) return (d as any).records.filter(Boolean);
    return [d as Record<string, unknown>];
  }
  if (Array.isArray((body as any)?.records)) return (body as any).records.filter(Boolean);
  if (Array.isArray((body as any)?.transactions)) return (body as any).transactions.filter(Boolean);
  return [];
}

serve(async (req) => {
  // Xử lý CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // 1. Lấy Token mong đợi từ Secrets
    const EXPECTED_TOKEN = Deno.env.get('CASSO_SECURE_TOKEN')?.trim();
    
    // 2. Log toàn bộ Headers để "bắt bài" Casso
    const allHeaders = Object.fromEntries(req.headers.entries());
    console.log("[casso-webhook] TOÀN BỘ HEADERS NHẬN ĐƯỢC:", JSON.stringify(allHeaders));

    // 3. Thử lấy Token từ nhiều nguồn khác nhau
    const body = await req.json();
    const incomingToken = extractIncomingToken(req, (body && typeof body === 'object') ? body as Record<string, unknown> : null);

    console.log(`[casso-webhook] Token nhận diện được: "${incomingToken}"`);
    console.log(`[casso-webhook] Token mong đợi (từ Secrets): "${EXPECTED_TOKEN}"`);

    // 4. Kiểm tra khớp mã
    if (!EXPECTED_TOKEN) {
      console.error('[casso-webhook] Chưa cấu hình CASSO_SECURE_TOKEN trong Supabase Edge Function secrets.');
      return new Response(JSON.stringify({ error: 'Webhook token is not configured' }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    if (!incomingToken || incomingToken !== EXPECTED_TOKEN) {
      console.error("[casso-webhook] XÁC THỰC THẤT BẠI: Token không khớp hoặc bị thiếu.");
      return new Response(JSON.stringify({ error: 'Unauthorized webhook request' }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log("[casso-webhook] Dữ liệu Body:", JSON.stringify(body));

    const transactions = normalizeTransactions((body && typeof body === 'object') ? body as Record<string, unknown> : {});
    if (!transactions.length) {
      return new Response(JSON.stringify({ message: "Ping OK" }), { headers: corsHeaders });
    }
    
    for (const trans of transactions) {
      const description = String(trans?.description || trans?.content || trans?.memo || '');
      const amount = parseIncomingAmount((trans as any)?.amount ?? (trans as any)?.transferAmount ?? (trans as any)?.creditAmount);
      
      // Tìm mã NESTG XXXXXX
      const orderCodeText = extractOrderCodeFromDescription(description);
      
      if (orderCodeText) {
        const orderCode = Number(orderCodeText);
        if (!Number.isFinite(orderCode) || orderCode <= 0) {
          console.warn(`[casso-webhook] orderCode không hợp lệ từ nội dung: ${orderCodeText}`);
          continue;
        }

        if (!Number.isFinite(amount) || amount <= 0) {
          console.warn(`[casso-webhook] Bỏ qua giao dịch không hợp lệ, amount=${String(trans?.amount)}`);
          continue;
        }

        console.log(`[casso-webhook] Tìm thấy mã đơn: ${orderCode}, Số tiền: ${amount}`);

        const { data: deposit, error: depositError } = await supabase
          .from('deposits')
          .select('id, user_id, amount, order_code, status')
          .eq('order_code', orderCode)
          .maybeSingle();

        if (depositError) {
          console.error('[casso-webhook] Lỗi truy vấn deposits:', depositError.message);
          continue;
        }

        if (deposit) {
          const currentStatus = String(deposit.status || '').toUpperCase();
          if (currentStatus === 'PAID' || currentStatus === 'SUCCESS' || currentStatus === 'COMPLETED') {
            console.log(`[casso-webhook] Đơn ${orderCode} đã xử lý trước đó (${currentStatus}), bỏ qua.`);
            continue;
          }

          const depositAmount = Number(deposit.amount || 0);
          if (Number.isFinite(depositAmount) && depositAmount > 0 && amount < depositAmount) {
            console.warn(`[casso-webhook] Bỏ qua vì amount nhận (${amount}) < amount đơn (${depositAmount}) cho order ${orderCode}`);
            continue;
          }

          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', deposit.user_id)
            .single();

          if (profileError) {
            console.error('[casso-webhook] Lỗi lấy profile:', profileError.message);
            continue;
          }

          const newBalance = (Number(profile?.balance) || 0) + amount;

          const { error: balanceError } = await supabase
            .from('profiles')
            .update({ balance: newBalance })
            .eq('id', deposit.user_id);

          if (balanceError) {
            console.error('[casso-webhook] Lỗi cập nhật balance:', balanceError.message);
            continue;
          }

          const { error: depositUpdateError } = await supabase
            .from('deposits')
            .update({ status: 'PAID' })
            .eq('id', deposit.id);

          if (depositUpdateError) {
            console.error('[casso-webhook] Lỗi cập nhật trạng thái deposit:', depositUpdateError.message);
            continue;
          }
          
          console.log(`[casso-webhook] THÀNH CÔNG: Đã cộng ${amount}đ cho đơn ${orderCode}`);
        } else {
          console.warn(`[casso-webhook] KHÔNG TÌM THẤY đơn cho mã ${orderCode}`);
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error("[casso-webhook] LỖI HỆ THỐNG:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
})