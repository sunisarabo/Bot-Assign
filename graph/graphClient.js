'use strict';
/* graphClient.js — Microsoft Graph (client-credentials) · อ่าน SharePoint + Excel
 *   ไม่พึ่ง lib (ใช้ global fetch ของ Node 18+)
 *
 * env (Entra app registration + Application permissions: Sites.Read.All, Files.Read.All + admin consent):
 *   GRAPH_TENANT_ID · GRAPH_CLIENT_ID · GRAPH_CLIENT_SECRET
 */
const G = 'https://graph.microsoft.com/v1.0';

async function token() {
  for (const k of ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET']) if (!process.env[k]) throw new Error('missing env ' + k);
  const body = new URLSearchParams({ client_id: process.env.GRAPH_CLIENT_ID, client_secret: process.env.GRAPH_CLIENT_SECRET, grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' });
  const r = await fetch(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body });
  const j = await r.json();
  if (!r.ok) throw new Error('graph auth failed: ' + JSON.stringify(j));
  return j.access_token;
}

let _tok = null;
async function tok() { return (_tok = _tok || token()); }

async function g(path) {
  const t = await tok();
  const r = await fetch(path.startsWith('http') ? path : G + path, { headers: { Authorization: 'Bearer ' + t, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`GET ${path} [${r.status}]: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

// ---- SharePoint ----
// resolve site จาก hostname + server-relative path เช่น ('aotgath.sharepoint.com', '/sites/XXXX')
async function getSite(hostname, sitePath) {
  const j = await g(`/sites/${hostname}:${sitePath}`);
  return j.id;                                  // เช่น "host,siteGuid,webGuid"
}
async function getDefaultDrive(siteId) {
  const j = await g(`/sites/${siteId}/drive`);  // document library หลัก
  return j.id;
}
// list ไฟล์/โฟลเดอร์ใน path (relative to drive root) เช่น '/2025/09.SEP26'
async function listChildren(driveId, folderPath) {
  const p = folderPath && folderPath !== '/' ? `/drives/${driveId}/root:${encodeURI(folderPath)}:/children` : `/drives/${driveId}/root/children`;
  const out = []; let url = G + p;
  while (url) { const j = await g(url); out.push(...(j.value || [])); url = j['@odata.nextLink'] || null; }
  return out;   // แต่ละตัวมี id, name, folder?, file?
}
async function getItemByPath(driveId, filePath) {
  return g(`/drives/${driveId}/root:${encodeURI(filePath)}`);   // ได้ item (มี id)
}

// ---- Excel (workbook API) ----
async function listWorksheets(driveId, itemId) {
  const j = await g(`/drives/${driveId}/items/${itemId}/workbook/worksheets?$select=id,name,position`);
  return j.value || [];        // [{id,name,position}]
}
async function readUsedRange(driveId, itemId, sheetName) {
  const j = await g(`/drives/${driveId}/items/${itemId}/workbook/worksheets('${encodeURIComponent(sheetName)}')/usedRange(valuesOnly=true)?$select=values`);
  return j.values || [];       // 2D array ของค่าเซลล์
}

module.exports = { getSite, getDefaultDrive, listChildren, getItemByPath, listWorksheets, readUsedRange, g };
