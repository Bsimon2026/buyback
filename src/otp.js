'use strict';
// Email one-time codes, sent through Resend.
//
// Flow: /api/otp/request emails a 6-digit code, /api/otp/verify returns a short-lived
// token that the order endpoint records. Codes are stored hashed, never in plain text,
// and are rate-limited per address and per IP.
const crypto = require('node:crypto');

const CODE_TTL_MIN = 10;
const TOKEN_TTL_MIN = 45;
const MAX_ATTEMPTS = 5;
const PER_EMAIL_15MIN = 3;
const PER_IP_HOUR = 12;

const hash = (email, code) => crypto.createHash('sha256').update(`${String(email).toLowerCase()}:${code}`).digest('hex');
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const newToken = () => crypto.randomBytes(24).toString('hex');
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(e || '').trim());

function fromAddress() {
  return process.env.OTP_FROM || 'Sell for Money <onboarding@resend.dev>';
}

function emailHtml(code, name) {
  const who = name ? `Hi ${String(name).split(' ')[0]},` : 'Hello,';
  return `<!doctype html><html><body style="margin:0;background:#F1F6FD;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 22px">
    <div style="background:#fff;border-radius:14px;padding:30px 26px;border:1px solid #D2DEF0">
      <div style="font-size:20px;font-weight:800;color:#001A44;letter-spacing:-.02em">Sell <span style="color:#007DFB">for</span> Money</div>
      <p style="color:#4B5D7A;font-size:14px;margin:14px 0 0">${who}</p>
      <p style="color:#001A44;font-size:15px;line-height:1.6;margin:8px 0 20px">Your verification code is:</p>
      <div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:34px;letter-spacing:.22em;
                  font-weight:700;color:#001A44;background:#F1F6FD;border-radius:10px;padding:16px;text-align:center">${code}</div>
      <p style="color:#4B5D7A;font-size:13px;line-height:1.6;margin:18px 0 0">
        It expires in ${CODE_TTL_MIN} minutes. If you did not ask for a price, ignore this email — nothing happens.</p>
    </div>
    <p style="color:#7C8CA6;font-size:11px;text-align:center;margin-top:16px;line-height:1.7">
      QAMAR ALNAJAH Audio-Visual, Recording Equipment &amp; Accessories Trading L.L.C S.O.C<br>
      TRN 105531719000003 · Shop No. 8, Nad Al Hamar, Dubai</p>
  </div></body></html>`;
}

async function sendCode(email, code, name) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    const err = new Error('Email is not configured: RESEND_API_KEY is missing on the server');
    err.status = 503;
    throw err;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: fromAddress(),
      to: [email],
      subject: `${code} is your Sell for Money code`,
      html: emailHtml(code, name),
      text: `Your Sell for Money verification code is ${code}. It expires in ${CODE_TTL_MIN} minutes.`,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || body.error || `Resend refused the send (${res.status})`);
    err.status = 502;
    err.detail = { provider: 'resend', status: res.status, name: body.name };
    throw err;
  }
  return body;
}

module.exports = { hash, newCode, newToken, validEmail, sendCode,
  CODE_TTL_MIN, TOKEN_TTL_MIN, MAX_ATTEMPTS, PER_EMAIL_15MIN, PER_IP_HOUR };
