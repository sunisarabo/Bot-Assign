#!/usr/bin/env python3
"""
parse_winter_flights.py — อ่าน PDF ตารางบินฤดูหนาว (ภูเก็ต) → flight master CSV
และ --expand ช่วงวัน → per-day movements (ป้อน pas_flight / generator)

ใช้ pdftotext -layout แล้ว parse:
  - section หัวสายการบิน "N. AIRLINE NAME"
  - แถว: เที่ยวบิน(คู่ ARR/DEP เช่น SU278/279) · เส้นทาง(SVO-HKT-SVO) · STA · STD · วันบิน · EFF
  - รองรับ cell รวม (STA เดียว STD หลายค่าตามวัน) + หลายรอบต่อเที่ยว

usage:
  python3 tools/parse_winter_flights.py INTL.pdf DOM.pdf -o winter_flight_master.csv
  python3 tools/parse_winter_flights.py INTL.pdf DOM.pdf --expand --from 2026-11-01 --to 2026-11-30 -o pas_flight_2026-11.csv
"""
import argparse, csv, re, subprocess, datetime, sys, os

FLIGHT_RE = re.compile(r'\b([A-Z][A-Z0-9]?\d{2,4})/(\d{2,5})\b')
ROUTE_RE  = re.compile(r'\b([A-Z]{3}(?:-[A-Z]{3})+)\b')
TIME_RE   = re.compile(r'\b(\d{1,2}:\d{2})(\+1)?\b')
EFF_RE    = re.compile(r'EFF\.?\s*(.+)$')
DOW = {'MON':0,'TUE':1,'WED':2,'THU':3,'FRI':4,'SAT':5,'SUN':6}
MON = {'JAN':1,'FEB':2,'MAR':3,'APR':4,'MAY':5,'JUN':6,'JUL':7,'AUG':8,'SEP':9,'OCT':10,'NOV':11,'DEC':12}


def pdftext(path):
    return subprocess.run(['pdftotext','-layout',path,'-'],capture_output=True,text=True).stdout


DAY_RE = re.compile(r'\b(DAILY|(?:MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z/]*)\b')


def scope_season(text):
    scope = 'DOM' if 'ภายใน' in text else 'INTL'
    m = re.search(r'25\d\d\s*/\s*25\d\d', text)
    season = re.sub(r'\s','',m.group()) if m else '?'
    return scope, season


def parse_days(s):
    """'DAILY' | 'MON/TUE/WED/THUFRI/SAT' → set(weekday 0..6) · จัดการ token 6 ตัวติดกัน (THUFRI)"""
    s = s.strip().upper()
    if not s:
        return set()
    if 'DAILY' in s:
        return set(range(7))
    out = set()
    for tok in re.split(r'[/\s]+', s):
        tok = tok.strip()
        for i in range(0, len(tok), 3):            # ตัดทีละ 3 ตัว (กันติดกัน THUFRI)
            d = tok[i:i+3]
            if d in DOW:
                out.add(DOW[d])
    return out


def parse_eff(note):
    """คืน (from_date, to_date, raw) · เอาวันแรก-วันท้ายสุดที่เจอ (รองรับช่วงซ้อน)"""
    dates = []
    for d, mon, y in re.findall(r'(\d{1,2})\s+([A-Z]{3})\s+(\d{4})', note.upper()):
        if mon in MON:
            try: dates.append(datetime.date(int(y), MON[mon], int(d)))
            except Exception: pass
    if not dates:
        return None, None, note.strip()
    return min(dates), max(dates), note.strip()


def col_x(header, *keys):
    for k in keys:
        i = header.find(k)
        if i >= 0: return i
    return -1


def parse_pdf(path):
    text = pdftext(path)
    scope, season = scope_season(text)
    # 1) เก็บ entry ต่อบรรทัดเนื้อหา (ต่อ section สายการบิน)
    entries = []
    airline = ''
    for raw in text.split('\n'):
        if not raw.strip():
            continue
        m_sec = re.match(r'\s*\d+\.\s+([A-Z][A-Z0-9 .&/\'\-]+)\s*$', raw)
        if m_sec:
            airline = m_sec.group(1).strip(); continue
        if 'เที่ยวบิน' in raw or 'ตารางเที่ยว' in raw or 'ลําดับ' in raw or 'ระหวาง' in raw or 'ภายใน' in raw:
            continue
        fm = FLIGHT_RE.search(raw); rm = ROUTE_RE.search(raw)
        em = EFF_RE.search(raw); note = em.group(0).strip() if em else ''
        body = raw[:em.start()] if em else raw
        times = [mm.group(1)+(mm.group(2) or '') for mm in TIME_RE.finditer(body)]
        dm = DAY_RE.search(body); days = parse_days(dm.group(1)) if dm else set()
        iata = arr = dep = ''
        if fm:
            arr = fm.group(1)
            iata = re.match(r'[A-Z][A-Z0-9]?', arr).group()   # รหัสสาย (IATA) เช่น SU, PG, G9, AK
            dep = iata + fm.group(2)                            # ขาออกใส่รหัสสาย: 279 → SU279
        entries.append({'airline':airline,'fm':bool(fm),'iata':iata,
                        'arr':arr,'dep':dep,'route':rm.group(1) if rm else '',
                        'times':times,'days':days,'note':note})
    # 2) sta/note ของบรรทัดเที่ยวบิน + ชุด index ของเที่ยวบิน
    for e in entries:
        e['sta_line'] = e['times'][0] if (e['fm'] and e['times']) else ''
    flight_idx = {i for i,e in enumerate(entries) if e['fm']}

    def owner_flight(i):
        # orphan เหนือบรรทัดเที่ยว = ของเที่ยวด้านล่าง เฉพาะเมื่อเที่ยวล่างเป็น merged-STA จริง
        # (ไม่มีวันบินของตัวเอง + มี STA บนบรรทัด) ไม่งั้น variant นี้เป็นของเที่ยวด้านบน
        below = entries[i+1] if (i+1) in flight_idx else None
        if below and below['airline']==entries[i]['airline'] and not below['days']:
            return below
        for j in range(i, -1, -1):
            if entries[j]['fm'] and entries[j]['airline']==entries[i]['airline']:
                return entries[j]
        return None

    rows = []
    for i,e in enumerate(entries):
        if not e['days']:
            continue
        own = e if e['fm'] else owner_flight(i)
        if not own:
            continue
        t = e['times']
        if len(t) >= 2:
            sta, std = t[0], t[1]
        elif len(t) == 1:
            sta, std = (own['sta_line'] or ''), t[0]    # STA รวมจากบรรทัดเที่ยวบิน
        else:
            continue
        frm, to, rawnote = parse_eff(e['note'] or own['note'])
        rows.append({'scope':scope,'season':season,'iata':own['iata'],'airline':own['airline'],
                     'arr_flight':own['arr'],'dep_flight':own['dep'],'route':own['route'],
                     'sta':sta,'std':std,'days':''.join('MTWHFSU'[d] for d in sorted(e['days'])),
                     'dowset':e['days'],'eff_from':frm,'eff_to':to,'note':rawnote})
    return rows


def write_master(rows, out):
    with open(out,'w',newline='',encoding='utf-8-sig') as f:
        w=csv.writer(f)
        w.writerow(['scope','season','iata','airline','arr_flight','dep_flight','route','sta','std','days','eff_from','eff_to','note'])
        for r in rows:
            w.writerow([r['scope'],r['season'],r['iata'],r['airline'],r['arr_flight'],r['dep_flight'],r['route'],r['sta'],r['std'],r['days'],
                        r['eff_from'] or '', r['eff_to'] or '', r['note']])
    print('master:', out, len(rows), 'variants')


def origin_dest(route):
    parts = route.split('-') if route else []
    o = parts[0] if parts else ''
    d = parts[-1] if parts else ''
    return o, d


def expand(rows, d_from, d_to, out):
    """ขยายรายวัน → movements (ARR ของขาเข้า + DEP ของขาออก) ต่อวันที่ตรงวันบิน+ช่วง eff"""
    recs=[]
    day=d_from
    while day<=d_to:
        wd=day.weekday()
        for r in rows:
            if wd not in r['dowset']:
                continue
            if r['eff_from'] and day < r['eff_from']:
                continue
            if r['eff_to'] and day > r['eff_to']:
                continue
            o,d = origin_dest(r['route'])
            dk=day.isoformat()
            # ขาเข้า
            if r['sta']:
                recs.append({'pas_flightkey':r['arr_flight']+'_'+dk,'flight_date':dk,'iata':r['iata'],'airline':r['airline'],
                             'flight_no':r['arr_flight'],'direction':'ARR','origin':o,'dest':'HKT',
                             'sta':r['sta'],'std':'','scope':r['scope']})
            # ขาออก
            if r['std']:
                recs.append({'pas_flightkey':r['dep_flight']+'_'+dk,'flight_date':dk,'iata':r['iata'],'airline':r['airline'],
                             'flight_no':r['dep_flight'],'direction':'DEP','origin':'HKT','dest':d,
                             'sta':'','std':r['std'],'scope':r['scope']})
        day+=datetime.timedelta(days=1)
    with open(out,'w',newline='',encoding='utf-8-sig') as f:
        w=csv.DictWriter(f,fieldnames=['pas_flightkey','flight_date','iata','airline','flight_no','direction','origin','dest','sta','std','scope'])
        w.writeheader(); w.writerows(recs)
    print('expanded:', out, len(recs), 'movements', d_from, '→', d_to)


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('pdfs',nargs='+')
    ap.add_argument('-o','--out',default='winter_flight_master.csv')
    ap.add_argument('--expand',action='store_true')
    ap.add_argument('--from',dest='dfrom'); ap.add_argument('--to',dest='dto')
    args=ap.parse_args()
    rows=[]
    for p in args.pdfs:
        r=parse_pdf(p); rows+=r
        sc,se = (r[0]['scope'],r[0]['season']) if r else ('?','?')
        print(os.path.basename(p),'→',len(r),'variants',sc,se)
    if args.expand:
        d1=datetime.date.fromisoformat(args.dfrom); d2=datetime.date.fromisoformat(args.dto)
        expand(rows,d1,d2,args.out)
    else:
        write_master(rows,args.out)


if __name__=='__main__':
    main()
