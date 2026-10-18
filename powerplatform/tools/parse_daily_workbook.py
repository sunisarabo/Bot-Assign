#!/usr/bin/env python3
"""parse_daily_workbook.py — อ่านไฟล์เวรรายวัน (แท็บรายทีม) → JSON สำหรับ db/import.js

ต้นทาง: ข้อความ "markdown-table" ของ workbook รายวัน (เช่นได้จาก Google Drive
read_file_content / export) — schema {fileContent: string} หรือข้อความตรง ๆ

  python3 parse_daily_workbook.py 19SEP.json --date 2026-09-19 --src 19SEP > pas_day_2026-09-19.json
  node db/import.js pas_day_2026-09-19.json | psql -d pas

⚠️ ข้อจำกัด (best-effort · ตัวอ่านที่ "ทางการ" คือ rbSaveAllDay ใน Apps Script):
  - text rep ไม่มีชื่อแท็บ → เดา "ทีม" จากลำดับตาราง เทียบลำดับทีมในแท็บ MANPOWER
  - ช่วงงาน (STA/STD/OP/CL) อ่านจากหัวคอลัมน์ของบล็อกไฟลท์ · จับ assignment เมื่อ
    ช่องงาน (Job1..4) ของคนนั้นไม่ว่าง · bucket จาก STATUS/REMARK
"""
import json, sys, re, argparse

ap = argparse.ArgumentParser()
ap.add_argument('input', help='ไฟล์ข้อความ markdown-table (หรือ JSON {fileContent})')
ap.add_argument('--date', required=True, help='YYYY-MM-DD')
ap.add_argument('--src', default='', help='ชื่อไฟล์ต้นทาง (เช่น 19SEP)')
A = ap.parse_args()

raw = open(A.input, encoding='utf-8').read()
try:
    j = json.loads(raw); c = j.get('fileContent', raw) if isinstance(j, dict) else raw
except Exception:
    c = raw
lines = c.split('\n')

def cells(line):
    return [x.strip().replace('\\[merged\\]', '').replace('\\.', '.').replace('\\_', '_').strip()
            for x in line.strip().strip('|').split('|')]

# ---- ลำดับทีมจากแท็บ MANPOWER (Team (XX)) ----
seen = set(); team_order = []
for l in lines:
    m = re.match(r'\|\s*Team\s*\((.+?)\)', l)
    if m:
        t = m.group(1).strip()
        if t not in seen: seen.add(t); team_order.append(t)

def clsbucket(status, remark):
    s = (status or '').upper().strip(); r = (remark or '').upper().strip(); txt = r or s
    if 'SICK' in txt or txt in ('SL', 'MC'): return ('sick', False)
    if 'VAC' in txt or txt in ('AL', 'BL', 'VL', 'ML', 'PL'): return ('vac', False)
    if 'OT OFF' in txt or 'OT-OFF' in txt: return ('ot_off', False)
    if txt.startswith('OFF') or txt == 'X': return ('off', False)
    tr = bool(re.search(r'TRAIN|อบรม|BRIEF|COURSE|MEETING|ประชุม|สัมมนา|OJT|E-?LEARN', r + ' ' + s))
    return ('working', tr)

def tmin(t):
    m = re.match(r'(\d{1,2})[:.](\d{2})', (t or '').strip())
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None

def is_flight(code):
    u = (code or '').upper().replace(' ', '')
    return bool(re.match(r'^[A-Z]{1,2}\d{2,4}', u)) and 'BRIEF' not in u and 'BREIF' not in u

# ---- แยกเป็นตาราง (markdown) ----
tables = []; i = 0
while i < len(lines):
    if re.match(r'^\|(\s*:-+:\s*\|)+\s*$', lines[i]):
        rows = []; j = i + 1
        while j < len(lines) and lines[j].startswith('|'):
            rows.append(cells(lines[j])); j += 1
        tables.append(rows); i = j
    else:
        i += 1

def find_keyrow(rows):
    for idx, r in enumerate(rows):
        up = [x.upper() for x in r]
        if 'NAME' in up and 'SHIFT' in up and 'STATUS' in up and any('JOB' in x.upper() for x in r):
            return idx
    return -1

def header_by_c18(rows, label):
    for r in rows:
        if len(r) > 18 and r[18].strip().upper().startswith(label): return r
    return None

teams = {}; team_tables = 0
for rows in tables:
    k = find_keyrow(rows)
    if k < 0: continue
    team_tables += 1
    code = team_order[team_tables - 1] if team_tables - 1 < len(team_order) else ('T%02d' % team_tables)
    fl_row = header_by_c18(rows, 'FLIGHT'); sta_row = header_by_c18(rows, 'STA'); op_row = header_by_c18(rows, 'OP')
    flights = []
    if fl_row:
        for base in range(19, len(fl_row), 4):
            code_f = (fl_row[base] if base < len(fl_row) else '').strip()
            if not code_f or (code_f == 'หมายเลขไฟลท์' or not re.search(r'\d|BRE?IF|GOM', code_f)): continue
            sta = std = op = cl = ''
            if sta_row and base + 2 < len(sta_row):
                a = re.search(r'(\d{1,2}[:.]\d{2})', sta_row[base] or ''); d = re.search(r'(\d{1,2}[:.]\d{2})', sta_row[base + 2] or '')
                sta = a.group(1) if a else ''; std = d.group(1) if d else ''
            if op_row and base + 2 < len(op_row):
                o = re.search(r'(\d{1,2}[:.]\d{2})', op_row[base] or ''); cc = re.search(r'(\d{1,2}[:.]\d{2})', op_row[base + 2] or '')
                op = o.group(1) if o else ''; cl = cc.group(1) if cc else ''
            flights.append({'base': base, 'code': code_f, 'STA': sta, 'STD': std, 'OP': op, 'CL': cl})
    ppl = []
    for r in rows[k + 1:]:
        if len(r) < 18: continue
        idc = re.sub(r'\D', '', r[0] or ''); name = (r[2] or '').strip()
        if not name or name.startswith('Ex.') or 'ตัวอย่าง' in name: continue
        total = re.sub(r'[^0-9.]', '', r[6] or '')
        bucket, tr = clsbucket(r[16] if len(r) > 16 else '', r[17] if len(r) > 17 else '')
        remark = r[17] if len(r) > 17 else ''
        asg = []
        for f in flights:
            b = f['base']; jobs = [(r[b + n].strip() if len(r) > b + n else '') for n in range(4)]
            jobs = [x for x in jobs if x and x != 'JOB →']
            if jobs:
                asg.append({'flight': f['code'], 'task': ' '.join(jobs)[:30], 'STA': f['STA'], 'STD': f['STD'],
                            'OP': f['OP'], 'CL': f['CL'], 'isFlight': is_flight(f['code'])})
        ppl.append({'id': idc, 'name': name, 'shift': (r[3] or '').strip(), 'shiftStart': tmin(r[4]),
                    'shiftHrs': float(total) if total and total != '.' else 0, 'bucket': bucket, 'ot': 0,
                    'support': ('ซัพ' in remark or 'SUPP' in remark.upper()), 'training': tr, 'remark': remark,
                    'assignments': asg})
    teams.setdefault(code, []).extend(ppl)

out = {'date': A.date, 'sourceFile': A.src or A.date, 'teams': teams}
sys.stdout.write(json.dumps(out, ensure_ascii=False))
tot_ppl = sum(len(v) for v in teams.values()); tot_asg = sum(len(p['assignments']) for v in teams.values() for p in v)
print('team tables=%d teams=%d people=%d assignments=%d' % (team_tables, len(teams), tot_ppl, tot_asg), file=sys.stderr)
