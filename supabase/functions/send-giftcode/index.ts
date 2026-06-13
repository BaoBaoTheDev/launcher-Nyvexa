// @ts-nocheck

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import nodemailer from "npm:nodemailer@6.9.7";
import { Buffer } from "node:buffer";

// @ts-ignore: global Buffer
globalThis.Buffer = Buffer;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function base64UrlToString(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = pad ? normalized + "=".repeat(4 - pad) : normalized;
  return atob(padded);
}

function getJwtRoleFromAuthHeader(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const payloadJson = base64UrlToString(parts[1]);
    const payload = JSON.parse(payloadJson);
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Prevent public abuse: only allow calls using a service_role JWT.
    // (Supabase verifies JWT signature by default unless deployed with --no-verify-jwt.)
    const role = getJwtRoleFromAuthHeader(req.headers.get("authorization"));
    if (role !== "service_role") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const code = String(body?.code || "").trim().toUpperCase();
    const gameName = body?.gameName ? String(body.gameName) : "";

    if (!email || !code) {
      return new Response(JSON.stringify({ error: "Missing email/code" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SMTP_USER = Deno.env.get("SMTP_USER");
    const SMTP_PASS = Deno.env.get("SMTP_PASS");

    if (!SMTP_USER || !SMTP_PASS) {
      console.error("[send-giftcode] Missing SMTP_USER/SMTP_PASS");
      return new Response(JSON.stringify({ error: "Chưa cấu hình SMTP" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: `"NestG" <${SMTP_USER}>`,
      to: email,
      subject: "NestG - Mã kích hoạt trò chơi",
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #1b2838; color: #ffffff; padding: 40px; border-radius: 8px; max-width: 640px; margin: 0 auto;">
          <h2 style="color: #66c0f4; text-align: center; letter-spacing: 2px;">MÃ KÍCH HOẠT NESTG</h2>
          <p style="font-size: 16px; line-height: 1.6; color: #acb2b8;">Cảm ơn bạn đã mua hàng trên NestG.</p>
          ${gameName ? `<p style="font-size: 14px; line-height: 1.6; color: #acb2b8;">Trò chơi: <b style=\"color:#fff\">${gameName}</b></p>` : ""}
          <div style="background-color: rgba(0,0,0,0.3); padding: 18px; text-align: center; border-radius: 6px; margin: 24px 0; border: 1px solid #2a475e;">
            <div style="font-size: 12px; color: #8f98a0; margin-bottom: 10px; letter-spacing: 1px;">GIFT CODE</div>
            <div style="font-size: 18px; font-weight: bold; color: #66c0f4; letter-spacing: 4px; font-family: monospace;">${code}</div>
          </div>
          <p style="font-size: 13px; color: #acb2b8; line-height: 1.6;">Mã này chỉ dùng được <b>1 lần</b> trên NestG Launcher: Mở Launcher → Kích hoạt mã quà tặng.</p>
          <p style="font-size: 13px; color: #acb2b8; line-height: 1.6; margin-top: 10px;">
            Hướng dẫn sử dụng key NestG:
            <a href="https://www.nestg.cloud/blog/huong-dan-su-dung-key-nestg" style="color:#66c0f4; text-decoration: underline;">https://www.nestg.cloud/blog/huong-dan-su-dung-key-nestg</a>
          </p>
        </div>
      `,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[send-giftcode] ERROR:", (error as any)?.message || error);
    return new Response(JSON.stringify({ error: (error as any)?.message || "Error" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
