'use strict';
// การเชื่อมต่อ PostgreSQL (มาตรฐาน · ตั้งค่าได้ผ่าน env DATABASE_URL → ย้ายโฮสต์ได้)
// TLS: Azure Database for PostgreSQL บังคับ SSL → เปิดเมื่อ DATABASE_URL มี sslmode=require หรือ PGSSL=1
//   ปกติ verify ใบรับรอง (Azure ใช้ DigiCert ที่ Node เชื่อถืออยู่แล้ว)
//   PGSSLROOTCERT=/path/ca.pem  ระบุ CA เอง · PGSSL_INSECURE=1  ปิด verify (ไม่แนะนำ · เฉพาะ dev)
const fs = require('fs');
const { Pool } = require('pg');

const cs = process.env.DATABASE_URL || 'postgres://localhost/pas';
let ssl = false;
if (/sslmode=require/i.test(cs) || process.env.PGSSL === '1') {
  ssl = { rejectUnauthorized: process.env.PGSSL_INSECURE !== '1' };
  if (process.env.PGSSLROOTCERT) { try { ssl.ca = fs.readFileSync(process.env.PGSSLROOTCERT, 'utf8'); } catch (e) { console.error('PGSSLROOTCERT read failed:', e.message); } }
}

const pool = new Pool({
  connectionString: cs,
  ssl,
  max: +(process.env.PG_POOL_MAX || 8),
  idleTimeoutMillis: 30000,
});
module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
