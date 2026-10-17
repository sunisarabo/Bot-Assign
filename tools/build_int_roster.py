#!/usr/bin/env python3
"""
build_int_roster.py — จากตารางบิน turnaround master → Assignment/Roster/Sizing ตามทีม

อินพุต : HKT Winter Turnaround Master (ชีต 'Flight_Schedule') — 1 แถว/turnaround
เอาต์พุต: เวิร์กบุ๊ก Excel + (ออปชัน) CSV สำหรับ import เข้า Dataverse

ใช้:
  python3 tools/build_int_roster.py INPUT.xlsx -o OUT.xlsx [--sector INT] [--month 2026-11] [--dataverse DIR]

ปรับได้ที่ค่าคงที่ด้านล่าง: TEAMS (airline→team), MANNING (คน/ไฟลท์), BANDS (ช่วงกะ)
rerun ได้ทุกครั้งที่ตารางบินอัปเดต
"""
import argparse, csv, datetime, math, os
from collections import defaultdict, Counter
from openpyxl import load_workbook, Workbook
from openpyxl.styles import Font, PatternFill

# ───────── CONFIG (แก้ที่นี่) ─────────
# ทีม → สายการบิน (อิง ADV_TEAMS ในระบบ PAS + การจัดทีมที่ยืนยันแล้ว)
TEAMS = [
    ('JQ',    ['AI', 'IX', 'JQ', 'IT', 'VS']),                 # +VS
    ('AK',    ['AK', 'QZ', '8M']),
    ('SQ',    ['SQ', 'CX', 'LY', 'IZ']),                       # +IZ
    ('ZF',    ['ZF', 'LO', 'HH', 'EO', 'N4', 'G2', 'H4', 'S7', 'C6', 'WZ', 'HB']),
    ('EK',    ['UO', 'EK', 'FY', '6B', 'BY', 'KU']),           # +KU
    ('QR',    ['QR', 'MH', 'DE', 'OM']),
    ('CHN',   ['CA', '3U', 'MU', 'FM', 'HU', 'HO', 'HX', 'AQ', 'CZ', 'ZH', 'PN', '9H', 'OQ', 'BK', 'GX', 'MF']),  # +MF
    ('KE',    ['KC', 'KE', 'OZ', 'NO', 'AF', 'LJ', 'OV']),
    ('TR',    ['TR', '6E', 'QP', '3K']),
    ('PG',    ['PG']),
    ('SU',    ['SU', 'W5', 'B2']),
    ('TK',    ['OD', 'VJ', 'SG', 'HY', 'TK', 'N0', 'VN']),
    ('EY',    ['EY', 'DV', 'AY']),
    ('WY/WK', ['WY', 'G9', '9C', 'DK', 'SV', 'WK', 'KA']),
    ('DOM',   ['TG', 'VZ', 'FD', 'SL']),
]
A2T = {a: n for n, al in TEAMS for a in al}

# กฎกำลังพลต่อไฟลท์ [SUP, CI, ARR, GATE, TOTAL] (จาก SLA_RQ + ประมาณการ 7 สายที่เพิ่ม)
MANNING = {
    '3K':[1,4,1,1,8],'3U':[1,4,1,1,8],'6B':[1,5,2,1,10],'6E':[1,5,1,1,9],'8L':[1,4,1,1,8],'8M':[1,3,1,1,7],
    '9C':[1,5,1,1,9],'9H':[1,4,1,1,8],'AF':[1,9,1,1,13],'AI':[1,6,1,1,9],'AK':[1,4,1,1,8],'AQ':[1,3,1,1,7],
    'AY':[1,5,1,1,9],'B2':[1,6,1,1,10],'BY':[1,5,2,1,10],'C6':[1,4,1,1,8],'CA':[1,6,1,1,10],'CX':[1,6,2,1,11],
    'CZ':[1,6,1,1,10],'DE':[1,6,2,1,11],'DK':[1,4,1,1,8],'DV':[1,4,1,1,8],'EK':[1,7,4,1,14],'EO':[1,6,1,1,10],
    'EY':[1,7,1,1,12],'FM':[1,4,1,1,8],'FY':[1,3,1,1,6],'G2':[1,6,1,1,10],'G8':[1,4,1,1,8],'G9':[1,4,1,1,8],
    'H4':[1,5,1,1,9],'HB':[1,3,1,1,7],'HH':[1,4,1,1,8],'HO':[1,4,1,1,8],'HU':[1,6,1,1,10],'HX':[1,5,1,1,9],
    'HY':[1,5,1,1,8],'IT':[1,4,1,1,7],'IX':[1,4,1,1,7],'JQ':[1,7,1,1,10],'KC':[1,5,1,1,9],'KE':[1,8,1,1,11],
    'KY':[1,3,1,1,7],'LJ':[1,4,1,1,8],'LO':[1,6,1,1,10],'LY':[1,7,4,1,14],'MH':[1,4,1,1,8],'MU':[1,4,1,1,8],
    'N0':[1,5,1,1,9],'N4':[1,6,1,1,10],'NO':[1,6,1,1,10],'OD':[1,4,1,1,7],'OM':[1,4,1,1,8],'OQ':[1,4,1,1,8],
    'OV':[1,4,1,1,8],'OZ':[1,6,1,1,10],'PG':[1,0,1,2,8],'PN':[1,4,1,1,8],'QP':[1,5,1,1,9],'QR':[1,11,3,1,17],
    'QZ':[1,4,1,1,8],'S7':[1,4,1,1,8],'SG':[1,4,1,1,7],'SQ':[1,4,1,1,8],'SU':[1,8,1,1,12],'SV':[1,7,2,1,12],
    'TK':[1,8,4,1,15],'TR':[1,5,1,1,10],'U6':[1,4,1,1,8],'UO':[1,4,2,1,8],'VJ':[1,4,1,1,8],'VN':[1,7,1,1,10],
    'W5':[1,7,2,1,12],'WK':[1,6,2,1,11],'WY':[1,7,1,1,11],'WZ':[1,6,1,1,10],'ZF':[1,6,1,1,10],'ZH':[1,4,1,1,8],
    # ─ ประมาณการ (ยังไม่เป็นทางการ) ─
    'MF':[1,4,1,1,8],'VZ':[1,4,1,1,7],'FD':[1,4,1,1,8],'SL':[1,4,1,1,8],
    'KU':[1,7,2,1,11],'VS':[1,8,2,1,12],'IZ':[1,6,3,1,11],
}
MAN_DEF = [1, 4, 1, 1, 8]

# สูตรตำแหน่งจริงต่อทีม (manning_positions.csv) → คาดหวังคน/ไฟลท์ แยกเฟส CI/GATE/ARR
FORMULA_TEAM_MAP = {'WYWK': 'WY/WK', 'PVTLP': 'PVT'}
TEAM_POS_MIN = 5.0          # ทีมที่ข้อมูลสูตรรวม < ค่านี้ → fallback SLA_RQ


def load_team_pos(path=None):
    path = path or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'manning_positions.csv')
    if not os.path.exists(path):
        return {}
    tp = defaultdict(lambda: {'CI': 0.0, 'GATE': 0.0, 'ARR': 0.0, 'positions': []})
    with open(path, encoding='utf-8') as fh:
        for r in csv.DictReader(fh):
            t = FORMULA_TEAM_MAP.get(r['Team'], r['Team'])
            cnt, pct, ph = float(r['Count']), float(r['PctFlights']), r['Phase']
            tp[t][ph] += cnt * pct
            tp[t]['positions'].append((r['Position'], int(float(r['Count'])), pct, ph, r.get('Desc', '')))
    return dict(tp)


TEAM_POS = load_team_pos()

# ช่วงกะ (นาทีจากเที่ยงคืน · N พันข้ามวันถึง 06:00 = 1800) — ซ้อนกัน 1 ชม.เพื่อ handover
BANDS = [('M', 5*60, 14*60), ('A', 13*60, 22*60), ('N', 21*60, 30*60)]

# หน้าต่างงานจริงต่อเฟส (นาที) — ใช้สร้าง interval ถ่วงน้ำหนักด้วย "คนเฉพาะเฟส"
# CI (เช็คอิน) เปิดก่อน STD · ปิดก่อนขึ้นเครื่อง · GATE+SUP ช่วงบอร์ดดิ้ง · ARR ช่วงเครื่องเข้า
CI_OPEN, CI_CLOSE = 180, 45          # เช็คอิน: STD-180 .. STD-45
GATE_LEAD, GATE_TAIL = 60, 15        # บอร์ด/คุมงาน: STD-60 .. STD+15
ARR_LEAD, ARR_TAIL = 10, 45          # ขาเข้า: STA-10 .. STA+45
WD_TH = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์', 'อาทิตย์']   # Monday=0
ROYAL = '1D428A'


def mins_from_midnight(dt, base_date):
    return (dt - datetime.datetime(base_date.year, base_date.month, base_date.day)).total_seconds() / 60.0


def peak_weight(intervals):
    """peak ของผลรวม weight ที่ซ้อนกัน; intervals = [(lo,hi,w)]"""
    ev = []
    for lo, hi, w in intervals:
        ev.append((lo, w)); ev.append((hi, -w))
    ev.sort(key=lambda x: (x[0], x[1]))
    cur = mx = 0
    for _, w in ev:
        cur += w; mx = max(mx, cur)
    return mx


def band_peak(intervals, bs, be):
    """peak ภายในช่วง [bs,be) (คลิปช่วงงานเข้ากรอบกะ); รองรับ N ที่พันข้ามวันด้วยสำเนา +1440"""
    clip = []
    for lo, hi, w in intervals:
        for off in (0, 1440):           # เผื่อช่วงงานของวันก่อนที่ยังค้างถึงเช้า
            a, b = max(lo, bs - off), min(hi, be - off)
            if b > a:
                clip.append((a + off, b + off, w))
    return peak_weight(clip)


def load_flights(path, sector):
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb['Flight_Schedule']
    it = ws.iter_rows(values_only=True)
    H = list(next(it)); ix = {n: i for i, n in enumerate(H)}
    out = []
    for r in it:
        if sector and r[ix['Sector']] != sector:
            continue
        g = lambda n: r[ix[n]]
        out.append({
            'date': g('Date').date() if isinstance(g('Date'), datetime.datetime) else g('Date'),
            'airline': g('Airline'), 'code': g('Code'),
            'arr': g('Flt_Arr'), 'dep': g('Flt_Dep'), 'route': g('Route'),
            'type': str(g('Type') or ''), 'sta': g('STA'), 'std': g('STD'),
            'ground_min': g('Ground_Min'), 'gs': g('Ground_Start'), 'ge': g('Ground_End'),
            'ac': g('AC_Type'), 'region': g('Region'), 'conf': g('Confidence'),
            'arr_mvt': int(g('Arr_Mvt') or 0), 'dep_mvt': int(g('Dep_Mvt') or 0),
        })
    return out


def hhmm(dt):
    return dt.strftime('%H:%M') if isinstance(dt, datetime.datetime) else ''


def to_min(dt):
    return dt.hour * 60 + dt.minute if isinstance(dt, datetime.datetime) else None


def team_of(code):
    return A2T.get(code, 'UNASSIGNED')


def manning(code):
    return MANNING.get(code, MAN_DEF)


def phase_weights(code):
    """คืน (ci_w, gate_w, arr_w) = 'จำนวนคนจริง/ไฟลท์' แยกเฟส (จาก SLA_RQ = headcount จริง)
    *ไม่ใช้* สูตรตำแหน่ง (manning_positions) เพราะนั่นนับ 'บทบาท' ที่ 1 คนทำหลายตำแหน่งต่อเนื่อง
    → สูตรตำแหน่งใช้ทำ 'ชิพ Assignment' แทน (pas_team_position)"""
    sup, ci, arr, gate, _ = manning(code)
    return float(ci), float(sup + gate), float(arr)


def flight_work_intervals(f):
    """ช่วงงานจริงต่อเฟส → [(lo,hi,คน)] นาทีจากเที่ยงคืนของวันนั้น
    turnaround: ARR@STA + CI(ก่อนออก) + GATE(บอร์ด) · one-way: เฉพาะฝั่งที่มี"""
    ci_w, gate_w, arr_w = phase_weights(f['code'])
    sta = mins_from_midnight(f['sta'], f['date']) if isinstance(f['sta'], datetime.datetime) else None
    std = mins_from_midnight(f['std'], f['date']) if isinstance(f['std'], datetime.datetime) else None
    is_turn = f['type'] == 'Turnaround'
    arr_only = f['type'] == 'Arrival only'
    out = []
    if (is_turn or arr_only) and sta is not None and arr_w > 0:
        out.append((sta - ARR_LEAD, sta + ARR_TAIL, arr_w))
    if (is_turn or not (is_turn or arr_only)) and std is not None:
        if ci_w > 0:
            out.append((std - CI_OPEN, std - CI_CLOSE, ci_w))            # เช็คอิน
        if gate_w > 0:
            out.append((std - GATE_LEAD, std + GATE_TAIL, gate_w))       # บอร์ด + คุมงาน
    return out


def sheet_header(ws, n):
    fill = PatternFill('solid', fgColor=ROYAL); font = Font(color='FFFFFF', bold=True)
    for c in range(1, n + 1):
        ws.cell(1, c).fill = fill; ws.cell(1, c).font = font
    ws.freeze_panes = 'A2'


def autosize(ws, cap=44):
    for col in ws.columns:
        w = max((len(str(c.value)) if c.value is not None else 0) for c in col)
        ws.column_dimensions[col[0].column_letter].width = min(max(w + 2, 8), cap)


def build(flights, out_path, month=None):
    wb = Workbook(); wb.remove(wb.active)

    # 1) Assignment รายไฟลท์
    a = wb.create_sheet('INT_Assignment')
    cols = ['Date', 'Team', 'Airline', 'Code', 'Flt_Arr', 'Flt_Dep', 'Route', 'Type', 'STA', 'STD', 'Ground_Min', 'AC_Type', 'Region', 'Confidence']
    a.append(cols)
    for f in sorted(flights, key=lambda f: (str(f['date']), team_of(f['code']), hhmm(f['sta']))):
        a.append([f['date'], team_of(f['code']), f['airline'], f['code'], f['arr'], f['dep'], f['route'],
                  f['type'], hhmm(f['sta']), hhmm(f['std']), f['ground_min'], f['ac'], f['region'], f['conf']])
    sheet_header(a, len(cols)); autosize(a)

    # 2) Roster รายวัน + 3) Sizing รายวัน (รวม loop)
    agg = defaultdict(lambda: {'turn': 0, 'ow': 0, 'mvt': 0, 'man': 0, 'ivs': []})
    for f in flights:
        k = (f['date'], team_of(f['code'])); A = agg[k]
        if f['type'] == 'Turnaround':
            A['turn'] += 1
        else:
            A['ow'] += 1
        A['mvt'] += f['arr_mvt'] + f['dep_mvt']
        for lo, hi, w in flight_work_intervals(f):
            A['ivs'].append((lo, hi, w)); A['man'] += w

    r = wb.create_sheet('INT_Roster_Daily')
    rc = ['Date', 'Team', 'Turnarounds', 'OneWay', 'Flights', 'Movements', 'Peak_OnGround']
    r.append(rc)
    for (d, t), A in sorted(agg.items(), key=lambda kv: (str(kv[0][0]), kv[0][1])):
        r.append([d, t, A['turn'], A['ow'], A['turn'] + A['ow'], A['mvt'],
                  peak_weight([(lo, hi, 1) for lo, hi, _ in A['ivs']])])
    sheet_header(r, len(rc)); autosize(r)

    s = wb.create_sheet('INT_Sizing_Daily')
    sc = ['Date', 'Team', 'Flights', 'Manning_Total'] + [b[0] + '_req' for b in BANDS] + ['Peak_Concurrent']
    s.append(sc)
    for (d, t), A in sorted(agg.items(), key=lambda kv: (str(kv[0][0]), kv[0][1])):
        reqs = [math.ceil(band_peak(A['ivs'], bs, be)) for _, bs, be in BANDS]
        s.append([d, t, A['turn'] + A['ow'], round(A['man']), *reqs, math.ceil(peak_weight(A['ivs']))])
    sheet_header(s, len(sc)); autosize(s)

    # 4) สรุปต่อทีมทั้งฤดู
    tsum = defaultdict(list)
    for (d, t), A in agg.items():
        tsum[t].append((A['man'], A['turn'] + A['ow'], peak_weight(A['ivs'])))
    ts = wb.create_sheet('INT_Team_Sizing_Summary')
    tc = ['Team', 'Days', 'Avg_Flights/day', 'Avg_Manning/day', 'Peak_Manning_day', 'Avg_PeakConcurrent']
    ts.append(tc)
    for t, lst in sorted(tsum.items(), key=lambda kv: -sum(x[0] for x in kv[1]) / len(kv[1])):
        nd = len(lst)
        ts.append([t, nd, round(sum(x[1] for x in lst) / nd, 1), round(sum(x[0] for x in lst) / nd, 1),
                   max(x[0] for x in lst), round(sum(x[2] for x in lst) / nd, 1)])
    sheet_header(ts, len(tc)); autosize(ts)

    # 5) Team_Airlines (mapping ที่ใช้)
    ta = wb.create_sheet('Team_Airlines'); ta.append(['Team', 'Airlines (this scope)', 'Flights'])
    tcnt = Counter(); tair = defaultdict(set)
    for f in flights:
        t = team_of(f['code']); tcnt[t] += 1; tair[t].add(f['code'])
    for t, n in tcnt.most_common():
        ta.append([t, ' '.join(sorted(tair[t])), n])
    sheet_header(ta, 3); autosize(ta)

    wb.save(out_path)
    return agg


def build_month(flights, agg, out_path, ym):
    """เวิร์กบุ๊กเฉพาะเดือน: ความต้องการกะรายวัน + แพทเทิร์นรายสัปดาห์ (ชุดชิพกะ)"""
    y, m = int(ym[:4]), int(ym[5:7])
    mflts = [f for f in flights if f['date'].year == y and f['date'].month == m]
    if not mflts:
        return None
    wb = Workbook(); wb.remove(wb.active)

    # Shift_Chips (นิยามกะ)
    sc = wb.create_sheet('Shift_Chips')
    sc.append(['Chip', 'ชื่อ', 'เวลา', 'หมายเหตุ'])
    labels = {'M': ('เช้า', '05:00–14:00'), 'A': ('บ่าย', '13:00–22:00'), 'N': ('ดึก', '21:00–06:00')}
    for b, bs, be in BANDS:
        sc.append([b, labels[b][0], labels[b][1], 'ซ้อน 1 ชม. ส่งเวร'])
    sheet_header(sc, 4); autosize(sc)

    # ShiftReq_Daily (หัวคน/กะ/ทีม รายวันของเดือน)
    srd = wb.create_sheet('ShiftReq_Daily')
    cols = ['Date', 'DOW', 'Team', 'Flights'] + [b[0] for b, _, _ in BANDS] + ['PeakDay']
    srd.append(cols)
    byday = defaultdict(lambda: {'flts': 0, 'ivs': []})
    for f in mflts:
        k = (f['date'], team_of(f['code'])); byday[k]['flts'] += 1
        for lo, hi, w in flight_work_intervals(f):
            byday[k]['ivs'].append((lo, hi, w))
    for (d, t), A in sorted(byday.items(), key=lambda kv: (str(kv[0][0]), kv[0][1])):
        reqs = [math.ceil(band_peak(A['ivs'], bs, be)) for _, bs, be in BANDS]
        srd.append([d, WD_TH[d.weekday()], t, A['flts'], *reqs, math.ceil(peak_weight(A['ivs']))])
    sheet_header(srd, len(cols)); autosize(srd)

    # Shift_Pattern_Weekly (ชุดชิพกะ: ต่อทีม × วันในสัปดาห์ → หัวคนที่ควรมี = max ของเดือน)
    pat = defaultdict(lambda: defaultdict(lambda: [0] * len(BANDS)))   # team -> weekday -> [M,A,N] max
    patflt = defaultdict(lambda: defaultdict(list))
    for (d, t), A in byday.items():
        wd = d.weekday()
        reqs = [math.ceil(band_peak(A['ivs'], bs, be)) for _, bs, be in BANDS]
        for i, v in enumerate(reqs):
            pat[t][wd][i] = max(pat[t][wd][i], v)
        patflt[t][wd].append(A['flts'])
    sp = wb.create_sheet('Shift_Pattern_Weekly')
    hdr = ['Team', 'DOW'] + [b[0] for b, _, _ in BANDS] + ['Total_Headcount', 'Avg_Flights']
    sp.append(hdr)
    for t in [n for n, _ in TEAMS if n in pat]:
        for wd in range(7):
            if wd not in pat[t]:
                continue
            man = pat[t][wd]
            avgf = round(sum(patflt[t][wd]) / len(patflt[t][wd]), 1)
            sp.append([t, WD_TH[wd], *man, sum(man), avgf])
    sheet_header(sp, len(hdr)); autosize(sp)

    wb.save(out_path)
    return out_path


def write_dataverse(flights, outdir, scope):
    os.makedirs(outdir, exist_ok=True)
    # pas_flight: 1 แถว/ไฟลท์ (turnaround = TURN, one-way = ARR/DEP)
    fp = os.path.join(outdir, 'pas_flight_%s.csv' % scope.lower())
    with open(fp, 'w', newline='', encoding='utf-8-sig') as fh:
        w = csv.writer(fh)
        w.writerow(['pas_name', 'pas_flight_date', 'pas_airline_iata', 'pas_direction',
                    'pas_sta', 'pas_std', 'pas_aircraft_type', 'Team(helper)'])
        for f in flights:
            direction = 'TURN' if f['type'] == 'Turnaround' else ('ARR' if f['type'] == 'Arrival only' else 'DEP')
            name = f['arr'] or f['dep']
            w.writerow([name, f['date'].isoformat(), f['code'], direction,
                        to_min(f['sta']) if to_min(f['sta']) is not None else '',
                        to_min(f['std']) if to_min(f['std']) is not None else '',
                        f['ac'] or '', team_of(f['code'])])
    # team↔airline map (เผื่อทำตาราง/คอลัมน์ mapping ใน Dataverse)
    mp = os.path.join(outdir, 'team_airline_map.csv')
    with open(mp, 'w', newline='', encoding='utf-8-sig') as fh:
        w = csv.writer(fh); w.writerow(['Team', 'Airline'])
        for n, al in TEAMS:
            for a in al:
                w.writerow([n, a])
    return fp, mp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input')
    ap.add_argument('-o', '--out', default='INT_RosterAssignment.xlsx')
    ap.add_argument('--sector', default='INT')
    ap.add_argument('--month', default=None, help='YYYY-MM → เพิ่มเวิร์กบุ๊กกะเฉพาะเดือน')
    ap.add_argument('--dataverse', default=None, help='โฟลเดอร์ output CSV สำหรับ import')
    args = ap.parse_args()

    flights = load_flights(args.input, args.sector)
    print('flights (%s): %d' % (args.sector, len(flights)))
    unmapped = Counter(f['code'] for f in flights if team_of(f['code']) == 'UNASSIGNED')
    if unmapped:
        print('UNASSIGNED:', dict(unmapped))
    agg = build(flights, args.out)
    print('saved', args.out)
    if args.month:
        mout = args.out.replace('.xlsx', '_%s.xlsx' % args.month)
        if build_month(flights, agg, mout, args.month):
            print('saved month workbook', mout)
    if args.dataverse:
        fp, mp = write_dataverse(flights, args.dataverse, args.sector)
        print('dataverse:', fp, mp)


if __name__ == '__main__':
    main()
