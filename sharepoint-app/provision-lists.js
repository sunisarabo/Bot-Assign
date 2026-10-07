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
  const DEF = {"site":"https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA","importFolder":"Shared Documents/PAS-Import","lists":[{"title":"PAS_Teams","desc":"ทีม (master)","titleLabel":"team","fields":[{"name":"label_th","type":"Text"},{"name":"dept","type":"Choice","choices":["PSA","LL"]},{"name":"is_float","type":"Boolean"}]},{"title":"PAS_Employees","desc":"พนักงาน (master)","titleLabel":"emp_code","fields":[{"name":"name_th","type":"Text"},{"name":"name_en","type":"Text"},{"name":"team","type":"Text","indexed":true},{"name":"position","type":"Text"},{"name":"source","type":"Choice","choices":["HKT","BKK","GLOBEX","OUTSOURCE"]},{"name":"status","type":"Choice","choices":["ACTIVE","RESIGNED"]}]},{"title":"PAS_Manpower","desc":"สรุปกำลังคนรายทีม/วัน","titleLabel":"key (date|team)","fields":[{"name":"day_key","type":"Text","indexed":true},{"name":"work_date","type":"DateOnly","indexed":true},{"name":"team","type":"Text","indexed":true},{"name":"total","type":"Number"},{"name":"working","type":"Number"},{"name":"sick","type":"Number"},{"name":"annual","type":"Number"},{"name":"training","type":"Number"},{"name":"ot_hours","type":"Number"},{"name":"util_pct","type":"Number"}]},{"title":"PAS_Duty","desc":"เวรรายคน/วัน","titleLabel":"key (date|team|emp)","fields":[{"name":"day_key","type":"Text","indexed":true},{"name":"work_date","type":"DateOnly","indexed":true},{"name":"team","type":"Text","indexed":true},{"name":"emp_code","type":"Text","indexed":true},{"name":"emp_name","type":"Text"},{"name":"bucket","type":"Choice","choices":["WORKING","OT_OFF","OFF","SICK","VACATION","LEAVE","TRAINING"]},{"name":"shift_code","type":"Text"},{"name":"shift_start","type":"Text","minutes":true},{"name":"shift_hours","type":"Number"},{"name":"ot_hours","type":"Number"},{"name":"duty_min","type":"Number"},{"name":"busy_min","type":"Number"},{"name":"util_pct","type":"Number"},{"name":"source_file","type":"Text"}]},{"title":"PAS_Assignment","desc":"งาน/ไฟลท์ที่มอบหมายรายคน","titleLabel":"flight_code","fields":[{"name":"day_key","type":"Text","indexed":true},{"name":"work_date","type":"DateOnly","indexed":true},{"name":"team","type":"Text","indexed":true},{"name":"emp_code","type":"Text","indexed":true},{"name":"emp_name","type":"Text"},{"name":"task","type":"Text"},{"name":"sta","type":"Text","minutes":true},{"name":"std","type":"Text","minutes":true},{"name":"counter_open","type":"Text","minutes":true},{"name":"counter_close","type":"Text","minutes":true},{"name":"win_lo","type":"Number"},{"name":"win_hi","type":"Number"},{"name":"is_flight","type":"Boolean"}]},{"title":"PAS_Flights","desc":"ตารางบิน","titleLabel":"flight_no","fields":[{"name":"day_key","type":"Text","indexed":true},{"name":"flight_date","type":"DateOnly","indexed":true},{"name":"airline_iata","type":"Text","indexed":true},{"name":"direction","type":"Choice","choices":["ARR","DEP","TURN"]},{"name":"sta","type":"Text","minutes":true},{"name":"std","type":"Text","minutes":true},{"name":"aircraft_type","type":"Text"},{"name":"gate","type":"Text"}]},{"title":"PAS_Porter","desc":"งาน Porter / Wheelchair","titleLabel":"flight_no","fields":[{"name":"day_key","type":"Text","indexed":true},{"name":"work_date","type":"DateOnly","indexed":true},{"name":"airline_iata","type":"Text"},{"name":"porter_names","type":"Note"},{"name":"service","type":"Choice","choices":["WCHR","WCHS","WCHC","MAAS","AVIH","ETC"]},{"name":"is_arrival","type":"Boolean"},{"name":"pickup_at","type":"Text","minutes":true},{"name":"delivered_at","type":"Text","minutes":true}]},{"title":"PAS_PreWC","desc":"จอง Wheelchair ล่วงหน้า","titleLabel":"flight_no","fields":[{"name":"day_key","type":"Text","indexed":true},{"name":"work_date","type":"DateOnly","indexed":true},{"name":"airline_iata","type":"Text"},{"name":"routing","type":"Text"},{"name":"direction","type":"Choice","choices":["ARR","DEP","TURN"]},{"name":"service","type":"Choice","choices":["WCHR","WCHS","WCHC","MAAS","AVIH","ETC"]},{"name":"qty","type":"Number"},{"name":"sta","type":"Text","minutes":true},{"name":"std","type":"Text","minutes":true}]},{"title":"PAS_ImportLog","desc":"คิว/ประวัติการนำเข้าไฟล์เวร (1 แถว/ไฟล์)","titleLabel":"file_path","fields":[{"name":"file_id","type":"Text","indexed":true},{"name":"file_name","type":"Text"},{"name":"status","type":"Choice","choices":["Pending","Running","Done","Skipped","Error"],"indexed":true},{"name":"day_key","type":"Text","indexed":true},{"name":"date_source","type":"Text"},{"name":"teams","type":"Number"},{"name":"duty","type":"Number"},{"name":"assignment","type":"Number"},{"name":"message","type":"Note"},{"name":"last_seen","type":"Text"}]}],"rosterRoot":"Shared Documents/"};

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
    console.log(`${created ? "🆕" : "✔"} ${L.title}: +${added} คอลัมน์`);
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
