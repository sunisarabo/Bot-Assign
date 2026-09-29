#!/usr/bin/env node
/* create-tables.js — สร้างตาราง Dataverse จาก tables.def.json ผ่าน Dataverse Web API
 *   idempotent: มีอยู่แล้ว = ข้าม · รันซ้ำได้ · ไม่พึ่ง lib (ใช้ global fetch ของ Node 18+)
 *
 * env (จาก Entra app registration ที่เพิ่มเป็น Application user ใน Dataverse + role System Customizer):
 *   DATAVERSE_URL   = https://<org>.crm.dynamics.com
 *   TENANT_ID       = <tenant guid>
 *   CLIENT_ID       = <app id>
 *   CLIENT_SECRET   = <secret>
 *   SOLUTION        = (ทางเลือก) unique name ของ solution ที่จะให้ table ไปอยู่
 *
 * ใช้:
 *   node powerplatform/create-tables.js --dry-run     # ดูแผน ไม่ยิงเน็ต
 *   node powerplatform/create-tables.js               # สร้างจริง
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry-run');
const DEF = JSON.parse(fs.readFileSync(path.join(__dirname, 'tables.def.json'), 'utf8'));
const LANG = DEF.languageCode || 1033;
const BASE = (process.env.DATAVERSE_URL || '').replace(/\/$/, '');
const API = BASE + '/api/data/v9.2';
const SOLUTION = process.env.SOLUTION || '';

const label = (t) => ({ '@odata.type': 'Microsoft.Dynamics.CRM.Label', LocalizedLabels: [{ '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel', Label: t, LanguageCode: LANG }] });
const req = (v) => ({ Value: v || 'None' });
let plan = [];

// ---------- auth ----------
async function token() {
  for (const k of ['DATAVERSE_URL', 'TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET']) if (!process.env[k]) throw new Error('missing env ' + k);
  const body = new URLSearchParams({ client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET, grant_type: 'client_credentials', scope: BASE + '/.default' });
  const r = await fetch(`https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body });
  const j = await r.json();
  if (!r.ok) throw new Error('auth failed: ' + JSON.stringify(j));
  return j.access_token;
}
let TOKEN = '';
function headers(extra) {
  return Object.assign({ Authorization: 'Bearer ' + TOKEN, 'OData-MaxVersion': '4.0', 'OData-Version': '4.0', Accept: 'application/json', 'Content-Type': 'application/json' }, SOLUTION ? { 'MSCRM.SolutionUniqueName': SOLUTION } : {}, extra || {});
}
async function api(method, urlPath, payload) {
  const res = await fetch(API + urlPath, { method, headers: headers(), body: payload ? JSON.stringify(payload) : undefined });
  return res;
}
async function exists(urlPath) { const r = await api('GET', urlPath); return r.status === 200; }
async function post(urlPath, payload, what) {
  if (DRY) { plan.push('POST ' + urlPath + '  → ' + what); return null; }
  const r = await api('POST', urlPath, payload);
  if (!r.ok && r.status !== 204) { const t = await r.text(); throw new Error(`create ${what} failed [${r.status}]: ${t}`); }
  console.log('  ✓ created', what);
  return r.headers.get('OData-EntityId');
}

// ---------- attribute builders ----------
function primaryAttr(p) {
  return { '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata', SchemaName: p.schema, IsPrimaryName: true, MaxLength: 200, FormatName: { Value: 'Text' }, RequiredLevel: req('None'), DisplayName: label(p.display) };
}
function attr(c, optSetId) {
  const A = { SchemaName: c.schema, RequiredLevel: req('None'), DisplayName: label(c.display) };
  switch (c.type) {
    case 'string': return { ...A, '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata', MaxLength: c.maxLength || 200, FormatName: { Value: 'Text' } };
    case 'memo':   return { ...A, '@odata.type': 'Microsoft.Dynamics.CRM.MemoAttributeMetadata', MaxLength: c.maxLength || 2000, Format: 'Text' };
    case 'int':    return { ...A, '@odata.type': 'Microsoft.Dynamics.CRM.IntegerAttributeMetadata', Format: 'None', MinValue: c.min ?? -2147483648, MaxValue: c.max ?? 2147483647 };
    case 'decimal':return { ...A, '@odata.type': 'Microsoft.Dynamics.CRM.DecimalAttributeMetadata', Precision: c.precision ?? 2, MinValue: c.min ?? -100000000000, MaxValue: c.max ?? 100000000000 };
    case 'boolean':return { ...A, '@odata.type': 'Microsoft.Dynamics.CRM.BooleanAttributeMetadata', DefaultValue: false, OptionSet: { '@odata.type': 'Microsoft.Dynamics.CRM.BooleanOptionSetMetadata', TrueOption: { Value: 1, Label: label('Yes') }, FalseOption: { Value: 0, Label: label('No') } } };
    case 'dateonly':return { ...A, '@odata.type': 'Microsoft.Dynamics.CRM.DateTimeAttributeMetadata', Format: 'DateOnly', DateTimeBehavior: { Value: 'DateOnly' } };
    case 'choice': return { ...A, '@odata.type': 'Microsoft.Dynamics.CRM.PicklistAttributeMetadata', 'GlobalOptionSet@odata.bind': `/GlobalOptionSetDefinitions(${optSetId})` };
    default: throw new Error('unknown type ' + c.type);
  }
}

// ---------- steps ----------
const optSetIds = {};
async function ensureOptionSets() {
  console.log('# Global option sets');
  for (const os of DEF.optionSets) {
    if (!DRY && await exists(`/GlobalOptionSetDefinitions(Name='${os.name}')?$select=MetadataId`)) {
      const r = await api('GET', `/GlobalOptionSetDefinitions(Name='${os.name}')?$select=MetadataId`);
      optSetIds[os.name] = (await r.json()).MetadataId; console.log('  · exists', os.name); continue;
    }
    const payload = { '@odata.type': 'Microsoft.Dynamics.CRM.OptionSetMetadata', Name: os.name, OptionSetType: 'Picklist', IsGlobal: true, DisplayName: label(os.name),
      Options: os.options.map((o, i) => ({ Value: 100000000 + i, Label: label(o) })) };
    const loc = await post('/GlobalOptionSetDefinitions', payload, 'optionset ' + os.name);
    if (loc) { const m = loc.match(/\(([^)]+)\)/); optSetIds[os.name] = m && m[1]; }
    else optSetIds[os.name] = '<dry>';
  }
}
async function ensureTables() {
  console.log('# Tables + columns');
  for (const t of DEF.tables) {
    const ln = t.schema.toLowerCase();
    if (DRY || !(await exists(`/EntityDefinitions(LogicalName='${ln}')?$select=LogicalName`))) {
      await post('/EntityDefinitions', { '@odata.type': 'Microsoft.Dynamics.CRM.EntityMetadata', SchemaName: t.schema, DisplayName: label(t.display), DisplayCollectionName: label(t.displayCollection), OwnershipType: 'UserOwned', HasActivities: false, HasNotes: false, Attributes: [primaryAttr(t.primary)] }, 'table ' + t.schema);
    } else console.log('  · exists', t.schema);
    for (const c of t.columns) {
      const cln = c.schema.toLowerCase();
      if (!DRY && await exists(`/EntityDefinitions(LogicalName='${ln}')/Attributes(LogicalName='${cln}')?$select=LogicalName`)) { continue; }
      await post(`/EntityDefinitions(LogicalName='${ln}')/Attributes`, attr(c, optSetIds[c.optionSet]), `${t.schema}.${c.schema}`);
    }
  }
}
async function ensureRelationships() {
  console.log('# Relationships (lookups)');
  for (const rel of DEF.relationships) {
    if (!DRY) {
      const r = await api('GET', `/RelationshipDefinitions?$select=SchemaName&$filter=SchemaName eq '${rel.schemaName}'`);
      if (r.status === 200 && ((await r.json()).value || []).length) { console.log('  · exists', rel.schemaName); continue; }
    }
    const payload = { '@odata.type': 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata', SchemaName: rel.schemaName,
      ReferencedEntity: rel.referenced.toLowerCase(), ReferencingEntity: rel.referencing.toLowerCase(),
      CascadeConfiguration: { Assign: 'NoCascade', Share: 'NoCascade', Unshare: 'NoCascade', Reparent: 'NoCascade', Delete: rel.cascadeDelete ? 'Cascade' : 'RemoveLink', Merge: 'NoCascade' },
      Lookup: { '@odata.type': 'Microsoft.Dynamics.CRM.LookupAttributeMetadata', SchemaName: rel.lookup.schema, RequiredLevel: req('None'), DisplayName: label(rel.lookup.display) } };
    await post('/RelationshipDefinitions', payload, 'relationship ' + rel.schemaName);
  }
}
async function ensureKeys() {
  console.log('# Alternate keys');
  for (const k of DEF.keys) {
    const ln = k.entity.toLowerCase();
    if (!DRY) {
      const r = await api('GET', `/EntityDefinitions(LogicalName='${ln}')/Keys?$select=SchemaName&$filter=SchemaName eq '${k.name}'`);
      if (r.status === 200 && ((await r.json()).value || []).length) { console.log('  · exists', k.name); continue; }
    }
    await post(`/EntityDefinitions(LogicalName='${ln}')/Keys`, { '@odata.type': 'Microsoft.Dynamics.CRM.EntityKeyMetadata', SchemaName: k.name, DisplayName: label(k.display), KeyAttributes: k.attributes }, 'key ' + k.name);
  }
}

(async () => {
  console.log(DRY ? '=== DRY RUN (ไม่ยิงเน็ต) ===' : '=== สร้างตาราง Dataverse: ' + BASE + (SOLUTION ? ' · solution ' + SOLUTION : '') + ' ===');
  if (!DRY) { TOKEN = await token(); console.log('auth ok'); }
  await ensureOptionSets();
  await ensureTables();
  await ensureRelationships();
  await ensureKeys();
  if (DRY) { console.log('\n--- แผน ' + plan.length + ' ขั้น ---'); plan.forEach(p => console.log('  ' + p)); }
  console.log('\n✅ เสร็จ' + (DRY ? ' (dry-run)' : '') + ' · ตาราง ' + DEF.tables.length + ' · option set ' + DEF.optionSets.length + ' · relationship ' + DEF.relationships.length + ' · key ' + DEF.keys.length);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
