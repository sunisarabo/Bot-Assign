'use strict';
// การเชื่อมต่อ PostgreSQL (มาตรฐาน · ตั้งค่าได้ผ่าน env DATABASE_URL → ย้ายโฮสต์ได้)
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost/pas',
  max: 8,
  idleTimeoutMillis: 30000,
});
module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
