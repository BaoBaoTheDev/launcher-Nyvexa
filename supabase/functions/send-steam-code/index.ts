import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import nodemailer from "npm:nodemailer@6.9.7"
import { Buffer } from "node:buffer"

// Khai báo Buffer toàn cục cho các thư viện Node.js cũ
// @ts-ignore: global Buffer
globalThis.Buffer = Buffer;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { email, purpose } = await req.json()
    const cleanEmail = email.trim().toLowerCase();
    const rawPurpose = String(purpose || 'register').trim().toLowerCase();
    const emailPurpose = rawPurpose === 'forgot_password' || rawPurpose === 'new_device_login'
      ? rawPurpose
      : 'register';
    
    const SMTP_USER = Deno.env.get('SMTP_USER');
    const SMTP_PASS = Deno.env.get('SMTP_PASS');
    
    if (!SMTP_USER || !SMTP_PASS) {
      console.error("[send-steam-code] Thiếu cấu hình SMTP_USER hoặc SMTP_PASS");
      return new Response(JSON.stringify({ error: 'Chưa cấu hình SMTP' }), { status: 500, headers: corsHeaders });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[send-steam-code] Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY');
      return new Response(JSON.stringify({ error: 'Chưa cấu hình Supabase service role cho function OTP' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // 1. Tạo mã 5 ký tự
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // 2. Lưu vào DB trước khi gửi email để tránh gửi mã "ma" khi insert lỗi.
    const otpCode = String(code || '').trim().toUpperCase();
    const { error: insertOtpError } = await supabase
      .from('custom_otps')
      .insert({ email: cleanEmail, code: otpCode });

    if (insertOtpError) {
      console.error('[send-steam-code] Insert OTP thất bại:', insertOtpError.message);
      return new Response(JSON.stringify({ error: 'Không thể tạo mã xác thực. Vui lòng thử lại sau.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Gửi Email
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });

    const isForgotPassword = emailPurpose === 'forgot_password';
    const isNewDeviceLogin = emailPurpose === 'new_device_login';
    const subject = isForgotPassword
      ? `NestG - Mã khôi phục mật khẩu: ${otpCode}`
      : isNewDeviceLogin
        ? `NestG - Xác thực đăng nhập thiết bị mới: ${otpCode}`
        : `NestG - Mã xác thực đăng ký: ${otpCode}`;
    const heading = isForgotPassword
      ? 'KHÔI PHỤC MẬT KHẨU NESTG'
      : isNewDeviceLogin
        ? 'XÁC THỰC ĐĂNG NHẬP THIẾT BỊ MỚI'
        : 'XÁC THỰC ĐĂNG KÝ TÀI KHOẢN NESTG';
    const description = isForgotPassword
      ? 'Vui lòng sử dụng mã bên dưới để xác minh yêu cầu quên mật khẩu và đặt mật khẩu mới:'
      : isNewDeviceLogin
        ? 'Hệ thống phát hiện đăng nhập từ thiết bị mới. Vui lòng dùng mã dưới đây để xác thực đăng nhập:'
        : 'Vui lòng sử dụng mã xác thực dưới đây để hoàn tất quá trình đăng ký:';

    await transporter.sendMail({
      from: `"NestG Launcher" <${SMTP_USER}>`,
      to: cleanEmail,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #1b2838; color: #ffffff; padding: 40px; border-radius: 8px; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #66c0f4; text-align: center; letter-spacing: 2px;">${heading}</h2>
          <p style="font-size: 16px; line-height: 1.6; color: #acb2b8;">Chào bạn,</p>
          <p style="font-size: 16px; line-height: 1.6; color: #acb2b8;">${description}</p>
          <div style="background-color: rgba(0,0,0,0.3); padding: 30px; text-align: center; border-radius: 4px; margin: 30px 0; border: 1px solid #2a475e;">
            <span style="font-size: 42px; font-weight: bold; color: #ffffff; letter-spacing: 15px; font-family: monospace;">${otpCode}</span>
          </div>
          <p style="font-size: 13px; color: #556772; text-align: center;">Mã này sẽ hết hạn sau 10 phút.</p>
        </div>
      `,
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error("[send-steam-code] LỖI:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})