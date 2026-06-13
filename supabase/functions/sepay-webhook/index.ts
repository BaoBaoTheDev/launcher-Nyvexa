import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sepay-signature, x-sepay-timestamp',
}

/**
 * SePay webhook payload (transferType=in cho giao dịch tiền vào):
 * {
 *   "id": 92704,
 *   "gateway": "MBBank",
 *   "transactionDate": "2023-03-25 14:02:37",
 *   "accountNumber": "0364663787",
 *   "code": "ORDER123",
 *   "content": "NYV1234567890",
 *   "transferType": "in",
 *   "transferAmount": 100000,
 *   "referenceCode": "MBVCB.3278907687",
 *   "description": "MUA VAT TU"
 * }
 *
 * SePay HMAC-SHA256 verification:
 *   Headers:
 *     x-sepay-signature: sha256=<hex_hmac>
 *     x-sepay-timestamp: <unix_seconds>
 *   HMAC = HMAC-SHA256(secret, "<timestamp>.<raw_body>")
 *
 * Set secret: supabase secrets set SEPAY_WEBHOOK_SECRET=<secret>
 */

function extractOrderCode(content: string, code?: string): string | null {
  const codeStr = String(code || '').trim();
  if (codeStr && /^\d{6,20}$/.test(codeStr)) {
    return codeStr;
  }
  const raw = String(content || '');
  const match = raw.match(/NYV(\d{6,20})/i);
  return match?.[1] || null;
}

/** HMAC-SHA256 → hex string */
async function computeHmacSha256(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time string comparison */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const SECRET = Deno.env.get('SEPAY_WEBHOOK_SECRET')?.trim();

    if (!SECRET) {
      console.error('[sepay-webhook] Thiếu cấu hình SEPAY_WEBHOOK_SECRET');
      return new Response(JSON.stringify({ error: 'Webhook not configured' }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const rawBody = await req.text();

    // SePay headers
    const signatureHeader = (
      req.headers.get('x-sepay-signature') ||
      req.headers.get('X-Sepay-Signature') ||
      ''
    ).trim();
    const timestamp = (
      req.headers.get('x-sepay-timestamp') ||
      req.headers.get('X-Sepay-Timestamp') ||
      ''
    ).trim();

    console.log('[sepay-webhook] Headers:', JSON.stringify(Object.fromEntries(req.headers.entries())));

    if (!signatureHeader) {
      console.error('[sepay-webhook] Thiếu header x-sepay-signature');
      return new Response(JSON.stringify({ error: 'Missing signature' }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    // Strip "sha256=" prefix nếu có
    const signature = signatureHeader.replace(/^sha256=/i, '').toLowerCase();

    // Thử các signed-payload format khác nhau (SePay có thể dùng 1 trong các format sau):
    //   1. timestamp + "." + rawBody  (Stripe-style)
    //   2. rawBody only
    const candidates = [
      `${timestamp}.${rawBody}`,
      rawBody,
    ];

    let matched = false;
    for (const payload of candidates) {
      const expected = (await computeHmacSha256(SECRET, payload)).toLowerCase();
      if (safeEqual(signature, expected)) {
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Log expected để debug (chỉ log một lần với format chính)
      const debugExpected = (await computeHmacSha256(SECRET, `${timestamp}.${rawBody}`)).toLowerCase();
      console.error('[sepay-webhook] Signature không khớp');
      console.error('[sepay-webhook]   Expected (timestamp.body):', debugExpected);
      console.error('[sepay-webhook]   Received:', signature);
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    // Parse JSON sau khi đã verify
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    console.log('[sepay-webhook] Body:', JSON.stringify(body));

    // Chỉ xử lý giao dịch tiền vào
    const transferType = String(body?.transferType || '').toLowerCase();
    if (transferType && transferType !== 'in') {
      return new Response(JSON.stringify({ message: 'Bỏ qua giao dịch tiền ra' }), { headers: corsHeaders });
    }

    const amount = Number(body?.transferAmount ?? body?.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      console.warn('[sepay-webhook] Amount không hợp lệ:', body?.transferAmount);
      return new Response(JSON.stringify({ message: 'Invalid amount' }), { status: 400, headers: corsHeaders });
    }

    const orderCodeText = extractOrderCode(
      String(body?.content || body?.description || ''),
      String(body?.code || ''),
    );
    if (!orderCodeText) {
      console.warn('[sepay-webhook] Không tìm thấy mã đơn trong content:', body?.content);
      return new Response(JSON.stringify({ message: 'Không có mã đơn' }), { headers: corsHeaders });
    }

    const orderCode = Number(orderCodeText);
    if (!Number.isFinite(orderCode) || orderCode <= 0) {
      return new Response(JSON.stringify({ message: 'orderCode không hợp lệ' }), { headers: corsHeaders });
    }

    console.log(`[sepay-webhook] Tìm thấy mã đơn: ${orderCode}, Số tiền: ${amount}`);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: deposit, error: depositError } = await supabase
      .from('deposits')
      .select('id, user_id, amount, pay_amount, order_code, status, discount_code_id, discount_amount')
      .eq('order_code', orderCode)
      .maybeSingle();

    if (depositError) {
      console.error('[sepay-webhook] Lỗi truy vấn deposits:', depositError.message);
      return new Response(JSON.stringify({ error: depositError.message }), { status: 500, headers: corsHeaders });
    }

    if (!deposit) {
      console.warn(`[sepay-webhook] Không tìm thấy đơn cho mã ${orderCode}`);
      return new Response(JSON.stringify({ message: 'Không tìm thấy đơn' }), { headers: corsHeaders });
    }

    const currentStatus = String(deposit.status || '').toUpperCase();
    if (currentStatus === 'PAID' || currentStatus === 'SUCCESS' || currentStatus === 'COMPLETED') {
      console.log(`[sepay-webhook] Đơn ${orderCode} đã xử lý trước đó (${currentStatus})`);
      return new Response(JSON.stringify({ message: 'Đã xử lý' }), { headers: corsHeaders });
    }

    // ── So sánh với pay_amount (số tiền user thực sự cần trả sau giảm giá),
    //    fallback về amount nếu pay_amount NULL (record cũ không có discount)
    const expectedPay = Number(deposit.pay_amount ?? deposit.amount ?? 0);
    if (Number.isFinite(expectedPay) && expectedPay > 0 && amount < expectedPay) {
      console.warn(`[sepay-webhook] Bỏ qua vì amount nhận (${amount}) < pay_amount (${expectedPay}) cho order ${orderCode}`);
      return new Response(JSON.stringify({ message: 'Số tiền không đủ' }), { headers: corsHeaders });
    }

    // Số tiền cộng vào ví = amount của gói nạp (KHÔNG phải số tiền chuyển khoản)
    const creditAmount = Number(deposit.amount || 0);

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('balance')
      .eq('id', deposit.user_id)
      .single();

    if (profileError) {
      console.error('[sepay-webhook] Lỗi lấy profile:', profileError.message);
      return new Response(JSON.stringify({ error: profileError.message }), { status: 500, headers: corsHeaders });
    }

    const newBalance = (Number(profile?.balance) || 0) + creditAmount;

    const { error: balanceError } = await supabase
      .from('profiles')
      .update({ balance: newBalance })
      .eq('id', deposit.user_id);

    if (balanceError) {
      console.error('[sepay-webhook] Lỗi cập nhật balance:', balanceError.message);
      return new Response(JSON.stringify({ error: balanceError.message }), { status: 500, headers: corsHeaders });
    }

    const { error: depositUpdateError } = await supabase
      .from('deposits')
      .update({ status: 'PAID' })
      .eq('id', deposit.id);

    if (depositUpdateError) {
      console.error('[sepay-webhook] Lỗi cập nhật trạng thái deposit:', depositUpdateError.message);
      return new Response(JSON.stringify({ error: depositUpdateError.message }), { status: 500, headers: corsHeaders });
    }

    // ── Nếu có dùng discount code → ghi redemption + tăng current_uses ──
    const discountCodeId = deposit.discount_code_id as string | null;
    if (discountCodeId) {
      try {
        await supabase.from('discount_code_redemptions').insert({
          code_id: discountCodeId,
          user_id: deposit.user_id,
          order_type: 'deposit',
          order_id: deposit.id,
          order_amount: creditAmount,
          discount_amount: Number(deposit.discount_amount || 0),
        });

        const { data: codeRow } = await supabase
          .from('discount_codes')
          .select('current_uses')
          .eq('id', discountCodeId)
          .maybeSingle();
        const newUses = (Number(codeRow?.current_uses) || 0) + 1;
        await supabase.from('discount_codes').update({ current_uses: newUses }).eq('id', discountCodeId);
      } catch (e) {
        console.warn('[sepay-webhook] Lỗi ghi redemption (không chặn):', e);
      }
    }

    console.log(`[sepay-webhook] ✅ Cộng ${creditAmount}đ cho user ${deposit.user_id} (order ${orderCode}, paid ${amount}đ). Balance: ${newBalance}`);

    return new Response(JSON.stringify({
      success: true,
      orderCode,
      amount: creditAmount,
      newBalance,
    }), { headers: corsHeaders });

  } catch (error) {
    console.error('[sepay-webhook] LỖI HỆ THỐNG:', error?.message || error);
    return new Response(JSON.stringify({ error: String(error?.message || error) }), { status: 500, headers: corsHeaders });
  }
})
