/*
 * provision-lists.js — สร้าง "ฐานข้อมูล PAS" (SharePoint Lists) ในไซต์
 *   https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA
 *
 * วิธีใช้ (ครั้งเดียว · ใช้สิทธิ์ของคุณเอง · ไม่ต้อง app registration / admin consent):
 *   1) เปิดไซต์ด้านบนใน Edge/Chrome (ล็อกอินบัญชีที่เป็น Owner/Member ของไซต์)
 *   2) กด F12 → แท็บ Console → วางทั้งไฟล์นี้ → Enter
 *   3) รอจนขึ้น "✅ เสร็จ" — รันซ้ำได้ (มีอยู่แล้วจะข้าม ไม่สร้างซ้ำ)
 *
 * สร้าง: 8 Lists (PAS_*) + คอลัมน์ตามชนิด + index (day_key/team/emp_code) + คอลัมน์คำนวณ *_min (HH:MM → นาที)
 *        + โฟลเดอร์ Shared Documents/PAS-Import (ที่วางไฟล์เวร .xlsx ให้ Power Automate นำเข้า)
 *
 * ไฟล์นี้สร้างจาก provision-lists.src.js + lists.def.json ด้วย `node build.js` (อย่าแก้ DEF ด้วยมือ)
 */
(async () => {
  const DEF = /*__DEF__*/ null;

  const site = DEF.site.replace(/\/$/, "");
  if (location.href.toLowerCase().indexOf(site.toLowerCase()) !== 0) {
    console.error("❌ เปิดหน้านี้ก่อนแล้วค่อยรัน: " + site);
    return;
  }
  const sitePath = new URL(site).pathname;                        // /sites/0AAYJ05_KoLORUk9PVA
  const H = { Accept: "application/json;odata=verbose", "Content-Type": "application/json;odata=verbose" };
  const esc = s => String(s).replace(/'/g, "''");
  const xmlEsc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  async function digest() {
    const r = await fetch(site + "/_api/contextinfo", { method: "POST", headers: H, credentials: "include" });
    if (!r.ok) throw new Error("contextinfo " + r.status + " (ล็อกอิน/สิทธิ์ไซต์?)");
    return (await r.json()).d.GetContextWebInformation.FormDigestValue;
  }
  let DIGEST = await digest();

  async function sp(method, path, body, extra) {
    const r = await fetch(site + "/_api" + path, {
      method, credentials: "include",
      headers: Object.assign({}, H, method === "GET" ? {} : { "X-RequestDigest": DIGEST }, extra || {}),
      body: body ? JSON.stringify(body) : undefined
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(method + " " + path + " → " + r.status + " " + (await r.text()).slice(0, 300));
    return r.status === 204 ? {} : r.json().catch(() => ({}));
  }

  // ---------- field XML ----------
  function fieldXml(f) {
    const base = `Name="${f.name}" StaticName="${f.name}" DisplayName="${f.name}"` + (f.indexed ? ` Indexed="TRUE"` : "");
    switch (f.type) {
      case "Text":     return `<Field Type="Text" ${base} MaxLength="255" />`;
      case "Note":     return `<Field Type="Note" ${base} NumLines="4" RichText="FALSE" />`;
      case "Number":   return `<Field Type="Number" ${base} />`;
      case "Boolean":  return `<Field Type="Boolean" ${base}><Default>0</Default></Field>`;
      case "DateOnly": return `<Field Type="DateTime" ${base} Format="DateOnly" />`;
      case "Choice":   return `<Field Type="Choice" ${base} Format="Dropdown"><CHOICES>` +
                         f.choices.map(c => `<CHOICE>${xmlEsc(c)}</CHOICE>`).join("") + `</CHOICES></Field>`;
      default: throw new Error("unknown type " + f.type);
    }
  }
  // HH:MM (หรือ H:MM / HH.MM) → นาที · ว่าง/ผิดรูป = ว่าง
  function minutesXml(src) {
    const n = src + "_min", c = `[${src}]`;
    const sep = `IF(ISERROR(FIND(":",${c})),FIND(".",${c}),FIND(":",${c}))`;
    const formula = `=IF(ISERROR(${sep}),"",VALUE(LEFT(${c},${sep}-1))*60+VALUE(MID(${c},${sep}+1,2)))`;
    return `<Field Type="Calculated" Name="${n}" StaticName="${n}" DisplayName="${n}" ResultType="Number" Decimals="0" ReadOnly="TRUE">` +
           `<Formula>${xmlEsc(formula)}</Formula><FieldRefs><FieldRef Name="${src}" /></FieldRefs></Field>`;
  }

  async function ensureList(L) {
    const lp = `/web/lists/getbytitle('${esc(L.title)}')`;
    let created = false;
    if (!(await sp("GET", lp + "?$select=Id"))) {
      await sp("POST", "/web/lists", { __metadata: { type: "SP.List" }, BaseTemplate: 100, Title: L.title, Description: L.desc || "" });
      created = true;
    }
    // ชื่อแสดงของ Title (คีย์)
    await sp("POST", lp + "/fields/getbyinternalnameortitle('Title')",
      { __metadata: { type: "SP.Field" }, Title: L.titleLabel || "Title", Required: false },
      { "X-HTTP-Method": "MERGE", "IF-MATCH": "*" });

    const have = new Set(((await sp("GET", lp + "/fields?$select=InternalName&$top=500")).d.results || []).map(x => x.InternalName));
    let added = 0;
    const want = [];
    for (const f of L.fields) {
      want.push([f.name, fieldXml(f)]);
      if (f.minutes) want.push([f.name + "_min", minutesXml(f.name)]);
    }
    for (const [name, xml] of want) {
      if (have.has(name)) continue;
      await sp("POST", lp + "/fields/createfieldasxml", {
        parameters: { __metadata: { type: "SP.XmlSchemaFieldCreationInformation" }, SchemaXml: xml, Options: 8 | 16 }  // InternalNameHint + DefaultView
      });
      added++;
    }
    let seeded = 0;
    if (L.seed && L.seed.length) {                                  // แถวตั้งต้น (เช่น วันหยุด) — เพิ่มเฉพาะ day_key ที่ยังไม่มี
      const info = await sp("GET", lp + "?$select=ListItemEntityTypeFullName");
      const type = info.d.ListItemEntityTypeFullName;
      const rows = (await sp("GET", lp + "/items?$select=day_key&$top=5000")).d.results || [];
      const haveKey = new Set(rows.map(r => r.day_key));
      for (const it of L.seed) {
        if (haveKey.has(it.day_key)) continue;
        await sp("POST", lp + "/items", Object.assign({ __metadata: { type } }, it));
        seeded++;
      }
    }
    console.log(`${created ? "🆕" : "✔"} ${L.title}: +${added} คอลัมน์` + (L.seed ? ` · +${seeded} แถวตั้งต้น` : ""));
  }

  async function ensureFolder(rel) {
    const url = sitePath + "/" + rel;
    const f = await sp("GET", `/web/getfolderbyserverrelativeurl('${esc(url)}')?$select=Exists`);
    if (f && f.d && f.d.Exists) { console.log("✔ โฟลเดอร์ " + rel); return; }
    await sp("POST", "/web/folders", { __metadata: { type: "SP.Folder" }, ServerRelativeUrl: url });
    console.log("🆕 โฟลเดอร์ " + rel);
  }

  try {
    for (const L of DEF.lists) { DIGEST = await digest(); await ensureList(L); }
    await ensureFolder(DEF.importFolder);
    console.log("✅ เสร็จ — เปิด Site contents เพื่อดู Lists PAS_*");
  } catch (e) {
    console.error("❌ " + e.message);
  }
})();
