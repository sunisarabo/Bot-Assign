'use strict';
/* readDay.js — หาไฟล์เวรของวันที่กำหนดใน SharePoint แล้วอ่านทุกชีต → parseDay
 *
 * env:
 *   SP_HOSTNAME     เช่น aotgath.sharepoint.com
 *   SP_SITE_PATH    เช่น /sites/0AAYJ05_KoLORUk9PVA
 *   SP_ROOT_FOLDER  โฟลเดอร์ปีที่มีโฟลเดอร์เดือน เช่น /Shared Documents/2025  (default '/2025')
 */
const C = require('./graphClient');
const { parseDay } = require('./parseDay');

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function tokens(iso) {                     // '2026-09-19' → { mon:'SEP', day:'19', dayTok:'19SEP' }
  const [y, m, d] = iso.split('-').map(Number);
  const mon = MON[m - 1], day = String(d);
  return { y, m, mon, day, dayTok: day + mon };  // "19SEP"
}
const norm = (s) => String(s || '').toUpperCase().replace(/[\s._-]/g, '');

async function resolve() {
  const host = process.env.SP_HOSTNAME, sitePath = process.env.SP_SITE_PATH;
  if (!host || !sitePath) throw new Error('missing SP_HOSTNAME / SP_SITE_PATH');
  const siteId = await C.getSite(host, sitePath);
  const driveId = await C.getDefaultDrive(siteId);
  return { siteId, driveId };
}

// หาไฟล์เวรของวันนั้น: root → โฟลเดอร์เดือน (มี MON) → ไฟล์ (ชื่อขึ้นต้น dayTok)
async function findDayItem(driveId, iso, rootFolder) {
  const t = tokens(iso);
  const root = rootFolder || process.env.SP_ROOT_FOLDER || '/2025';
  const months = await C.listChildren(driveId, root);
  // เลือกโฟลเดอร์เดือนที่ชื่อมี MON (เช่น "09.SEP26")
  const monthFolder = months.find((x) => x.folder && norm(x.name).includes(t.mon) && norm(x.name).includes(String(t.m).padStart(2, '0')))
    || months.find((x) => x.folder && norm(x.name).includes(t.mon));
  if (!monthFolder) throw new Error(`ไม่พบโฟลเดอร์เดือน ${t.mon} ใน ${root} (มี: ${months.filter(x => x.folder).map(x => x.name).join(', ')})`);
  const files = await C.listChildren(driveId, `${root}/${monthFolder.name}`);
  // ไฟล์เวร: ชื่อ normalize ขึ้นต้นด้วย dayTok เช่น "19SEP"
  const dt = norm(t.dayTok);
  const file = files.find((x) => x.file && norm(x.name).startsWith(dt))
    || files.find((x) => x.file && norm(x.name).includes(dt));
  if (!file) throw new Error(`ไม่พบไฟล์เวร ${t.dayTok} ใน ${monthFolder.name} (มี: ${files.filter(x => x.file).map(x => x.name).slice(0, 40).join(', ')})`);
  return { file, monthFolder: monthFolder.name };
}

/** อ่านและ parse วันเดียว → { date, sourceFile, teams, manpower } */
async function readDay(iso, opts = {}) {
  const { driveId } = opts.driveId ? opts : await resolve();
  const dId = opts.driveId || driveId;
  const { file } = await findDayItem(dId, iso, opts.rootFolder);
  const ws = await C.listWorksheets(dId, file.id);
  const sheets = [];
  for (const s of ws) {
    try { sheets.push({ name: s.name, rows: await C.readUsedRange(dId, file.id, s.name) }); }
    catch (e) { /* บางชีต (chart/ซ่อน) อ่าน usedRange ไม่ได้ ข้ามได้ */ }
  }
  return parseDay(iso, file.name, sheets);
}

module.exports = { readDay, resolve, findDayItem, tokens };
