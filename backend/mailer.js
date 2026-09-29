'use strict';
/* mailer.js — ส่งอีเมลแจ้งเตือนผ่าน SMTP มาตรฐาน (ตั้งค่าผ่าน env) → Microsoft 365 ได้ ไม่ผูกเจ้า
 *
 * env (Microsoft 365):
 *   SMTP_HOST=smtp.office365.com
 *   SMTP_PORT=587                 (587 = STARTTLS)
 *   SMTP_USER=notify@yourdomain.com
 *   SMTP_PASS=<app password / secret>
 *   SMTP_FROM="PAS แจ้งเตือน <notify@yourdomain.com>"
 *
 * ไม่ตั้ง SMTP_* → mailer ปิดตัวเอง (isEnabled()=false) · ระบบยังรันได้
 * เป็น SMTP มาตรฐาน → ย้าย Microsoft↔Google↔SMTP อื่น ได้โดยเปลี่ยนแค่ env */
const nodemailer = require('nodemailer');

const CFG = {
  host: process.env.SMTP_HOST || '',
  port: +(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
};

function isEnabled() { return !!(CFG.host && CFG.user && CFG.pass); }

let _t = null;
function transport() {
  if (!_t) {
    _t = nodemailer.createTransport({
      host: CFG.host,
      port: CFG.port,
      secure: CFG.port === 465,       // 465 = TLS ตรง · 587 = STARTTLS
      requireTLS: CFG.port === 587,
      auth: { user: CFG.user, pass: CFG.pass },
    });
  }
  return _t;
}

/** ส่งอีเมล · คืน {ok, id} หรือ throw */
async function send({ to, subject, text, html }) {
  if (!isEnabled()) throw new Error('SMTP not configured');
  const info = await transport().sendMail({ from: CFG.from, to, subject, text, html });
  return { ok: true, id: info.messageId };
}

/** ตรวจการเชื่อมต่อ SMTP (login) โดยไม่ส่งจริง */
async function verify() {
  if (!isEnabled()) return { enabled: false };
  await transport().verify();
  return { enabled: true, ok: true, host: CFG.host, port: CFG.port, from: CFG.from };
}

module.exports = { isEnabled, send, verify, config: () => ({ host: CFG.host, port: CFG.port, from: CFG.from, enabled: isEnabled() }) };
