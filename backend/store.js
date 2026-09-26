'use strict';
/* store.js — เก็บ session + OIDC login-state ใน Postgres (รองรับหลาย instance)
 *   แทน in-memory Map เดิม · ลบของหมดอายุแบบ lazy + best-effort cleanup
 *   ถ้าจะย้ายไป Redis: เปลี่ยนเฉพาะไฟล์นี้ (interface เดิม) */
const db = require('./db');

// ---- session ----
async function putSession(sid, s, ttlMs) {
  await db.query(
    `INSERT INTO web_session(sid,sub,email,name,expires_at) VALUES($1,$2,$3,$4, now() + ($5||' milliseconds')::interval)
     ON CONFLICT (sid) DO UPDATE SET sub=EXCLUDED.sub,email=EXCLUDED.email,name=EXCLUDED.name,expires_at=EXCLUDED.expires_at`,
    [sid, s.sub || null, s.email || null, s.name || null, String(ttlMs)]);
}
async function getSession(sid) {
  const r = await db.query(`SELECT sub,email,name FROM web_session WHERE sid=$1 AND expires_at > now()`, [sid]);
  return r.rows[0] || null;
}
async function delSession(sid) { await db.query(`DELETE FROM web_session WHERE sid=$1`, [sid]); }

// ---- oidc login state ----
async function putPending(state, code_verifier, nonce) {
  await db.query(`INSERT INTO oidc_login(state,code_verifier,nonce) VALUES($1,$2,$3) ON CONFLICT (state) DO NOTHING`, [state, code_verifier, nonce]);
}
async function takePending(state, maxAgeMs) {
  const r = await db.query(
    `DELETE FROM oidc_login WHERE state=$1 AND created_at > now() - ($2||' milliseconds')::interval
     RETURNING code_verifier, nonce`, [state, String(maxAgeMs)]);
  return r.rows[0] || null;
}

// ---- best-effort cleanup ----
async function cleanup() {
  try {
    await db.query(`DELETE FROM web_session WHERE expires_at < now()`);
    await db.query(`DELETE FROM oidc_login WHERE created_at < now() - interval '30 minutes'`);
  } catch (e) { /* prototype: เงียบได้ */ }
}

module.exports = { putSession, getSession, delSession, putPending, takePending, cleanup };
