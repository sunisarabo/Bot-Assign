#!/usr/bin/env python3
"""
build_roster.py — จับ "คนจริงในทีม" ลงกะตามแพทเทิร์นความต้องการรายวัน (ตารางเวรรายเดือน)

อินพุต:
  --req   เวิร์กบุ๊กเดือน (จาก build_int_roster.py --month) ที่มีชีต 'ShiftReq_Daily'
  --reg   ไฟล์ทะเบียนพนักงาน (ชีต 'ทะเบียน': EmpID/Team/Status/FirstNameTH)
  -o      ไฟล์ roster ผลลัพธ์

ผลลัพธ์:
  - 1 ชีต/ทีม: แถว=พนักงาน · คอลัมน์=วันในเดือน · ค่า = M/A/N/OFF
  - 'Coverage' : ต่อทีม×วัน เทียบ target vs assigned vs ขาด (ต่อกะ)
  - 'Teams_NoStaff' : ทีมที่ไม่มีคนในทะเบียน (ต้องใช้ support/charter)

วิธีจับ: เลือก OFF คนที่ทำงานสะสมมากสุดก่อน (เฉลี่ยวันหยุด) · ใส่กะกลางคืนให้คนที่
ได้ N น้อยสุดก่อน (เฉลี่ยกะดึก) · ถ้าคนไม่พอ target จะ scale ลงและแจ้ง "ขาด"
"""
import argparse, csv, os
from collections import defaultdict
from openpyxl import load_workbook, Workbook
from openpyxl.styles import Font, PatternFill, Alignment

# เวลาเข้า-ออกมาตรฐานต่อกะ (นาที) → fallback เมื่อทีมไม่มี shift template
SHIFT_TIME = {'M': (5*60, 14*60), 'A': (13*60, 22*60), 'N': (21*60, 30*60)}

# map ทีมในไฟล์วิเคราะห์ → ชื่อทีม ADV
ST_TEAM_MAP = {'CHN': ['CHN'], 'EY': ['EY'], 'KE': ['KE'], 'PG': ['PG'], 'QR': ['QR'],
               'SQ': ['SQ'], 'TR': ['TR'], 'CHARTER': ['CHARTER'], 'PVT': ['PVT'],
               'JQ/TK': ['JQ', 'TK'], 'SU/AK': ['SU', 'AK'], 'WY/EK': ['EK'], 'WK/SV': ['WY/WK']}


def load_shift_templates(path=None, period='ต.ค.'):
    """อ่าน shift_templates.csv → {my_team: [{code,ss,se,people,night}]} (ลงกะจริงต่อทีม)"""
    path = path or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shift_templates.csv')
    if not os.path.exists(path):
        return {}
    raw = {}
    for r in csv.DictReader(open(path, encoding='utf-8')):
        if r['Period'] != period:
            continue
        st, ln, pp = int(r['StartHour']), int(r['LenHrs']), int(r['People'])
        code = '%02d-%02d' % (st, (st + ln) % 24)
        ss, se = st * 60, (st + ln) * 60
        sh = {'code': code, 'ss': ss, 'se': se, 'people': pp, 'night': (se > 1440 or st < 5)}
        for mt in ST_TEAM_MAP.get(r['Team'], []):
            raw.setdefault(mt, []).append(dict(sh))
    for t in raw:
        raw[t].sort(key=lambda s: s['ss'])
    return raw


def _distribute(nworkers, shifts):
    """แบ่ง nworkers ลงกะตามสัดส่วน people ของ template"""
    tot = sum(s['people'] for s in shifts) or 1
    tgt = [int(nworkers * s['people'] / tot) for s in shifts]
    rem = nworkers - sum(tgt)
    frac = sorted(range(len(shifts)),
                  key=lambda i: -((nworkers * shifts[i]['people'] / tot) - int(nworkers * shifts[i]['people'] / tot)))
    for k in range(rem):
        tgt[frac[k % len(frac)]] += 1
    return tgt


MIN_REST_H = 9              # พักระหว่างกะขั้นต่ำ (ชม.) — "8-9 ชม.ขึ้นไป"
MIN_REST_MIN = MIN_REST_H * 60


def _start_floor(prev, min_rest_min):
    """เวลาเริ่มกะต่ำสุดที่ยอมให้วันนี้ เทียบกะ 'เมื่อวาน' → บังคับ 'หมุนไปข้างหน้า ไม่ย้อน' + พักพอ
    prev=(ss,se) นาที ของกะเมื่อวาน (se อาจ >1440 ถ้าดึกข้ามคืน) · None=เมื่อวานไม่ได้ทำงาน → เริ่มกะไหนก็ได้ (รีเซ็ตรอบ)
    - ไม่ย้อนสเกต: เริ่มวันนี้ ≥ เริ่มเมื่อวาน (เช้า→เช้า/บ่าย/ดึก ได้ · ดึก→เช้า ไม่ได้)
    - พัก: (เริ่มวันนี้+1440) − จบเมื่อวาน ≥ min_rest"""
    if not prev:
        return 0
    ss_prev, se_prev = prev
    return max(ss_prev, se_prev + min_rest_min - 1440)


def _assign_shifts(pool, shifts, targets, yday, night_cnt, min_rest_min):
    """จับคน→กะ แบบ 'หมุนไปข้างหน้า' (เช้า→บ่าย→ดึก) ห้ามย้อน + พัก ≥ min_rest · คุมจำนวนต่อกะตาม targets
    shifts: list {code,ss,se,night} · targets: จำนวนที่ต้องการต่อกะ (index ตรงกับ shifts) · คืน {sid: cell}
    หลักการ: คนที่ 'ติดเพดานสูง' (เมื่อวานเข้าดึก) จัดก่อน กันชนช่องกะดึกที่จำกัด → คนอื่นไหลลงกะเช้าตามจำนวน"""
    order_by_start = sorted(range(len(shifts)), key=lambda i: shifts[i]['ss'])
    cap = list(targets)
    floor = {w: _start_floor(yday.get(w), min_rest_min) for w in pool}
    order = sorted(pool, key=lambda w: (-floor[w], night_cnt[w], w))
    res = {}
    for w in order:
        pick = next((i for i in order_by_start if shifts[i]['ss'] >= floor[w] and cap[i] > 0), None)
        if pick is None:   # ช่องที่เริ่ม ≥ floor เต็ม → ล้นช่องเริ่มต่ำสุดที่ยัง 'ไปข้างหน้า' ได้ (รักษากติกาก่อนจำนวน)
            pick = next((i for i in order_by_start if shifts[i]['ss'] >= floor[w]), None)
        if pick is None:   # ไม่มีกะไหนถึง floor (พักไม่พอทุกกะ) → กะเริ่มช้าสุด (เสียหายน้อยสุด)
            pick = order_by_start[-1]
        cap[pick] -= 1
        s = shifts[pick]
        res[w] = {'sh': s['code'], 'ot': 0, 'bucket': 'WORKING', 'ss': s['ss'], 'se': s['se']}
        if s.get('night'):
            night_cnt[w] += 1
    return res


def celltxt(c):
    """ข้อความในช่องกริด: กะ + เครื่องหมาย ° (เรียกวันหยุด OT) / + (ยืดกะ OT)"""
    if c['sh'] in ('OFF', '-'):
        return c['sh']
    return c['sh'] + ('°' if c['bucket'] == 'OT_OFF' else ('+' if c['ot'] > 0 else ''))

# ทะเบียน team string → ชื่อทีม ADV
REG2TEAM = {
    'CHINA TEAM': 'CHN', 'QR/MH/OM/DE': 'QR', 'TR/6E/QP': 'TR', 'EK/UO/6B/BY/FY': 'EK',
    'EY/DV/AY': 'EY', 'SQ/CX/LY': 'SQ', 'KC/LJ/KE/OZ/NO/AF': 'KE', 'SU/B2/W5': 'SU',
    'TK/VJ/SG/HY/OD': 'TK', 'JQ/IT/IX/AI/N0': 'JQ', 'PG': 'PG',
    'WY/G9/9C/DK': 'WY/WK', 'SV/KA/WK': 'WY/WK', 'AK/QZ/8M': 'AK', 'PVT': 'PVT',
}
SHIFT_FILL = {'M': 'FFF3BF', 'A': 'D0EBFF', 'N': 'E5DBFF', 'OFF': 'F1F3F5'}
SHIFT_FONT = {'M': '996A13', 'A': '1864AB', 'N': '5F3DC4', 'OFF': 'ADB5BD'}
ROYAL = '1D428A'


import datetime as _dt


def _serial_date(v):
    if isinstance(v, _dt.datetime):
        return v.date()
    if isinstance(v, (int, float)) and v > 0:
        return (_dt.date(1899, 12, 30) + _dt.timedelta(days=int(v)))
    return None


def load_staff(reg_path):
    wb = load_workbook(reg_path, read_only=True, data_only=True)
    ws = wb['ทะเบียน']; it = ws.iter_rows(values_only=True)
    h = list(next(it)); ix = {n: i for i, n in enumerate(h)}
    team_staff = defaultdict(list)
    for r in it:
        if r[ix['EmpID']] is None:
            continue
        # รวมคนที่ยัง active และคนที่พ้นสภาพ "ระหว่าง/หลัง" เดือน (จะคุมด้วยวันที่เอง)
        tname = REG2TEAM.get(str(r[ix['Team']] or '').strip())
        if not tname:
            continue
        if str(r[ix['Status']]) != 'Active':
            continue
        resign = _serial_date(r[ix['EndDate']]) if 'EndDate' in ix else None
        start = _serial_date(r[ix['StartDate']]) if 'StartDate' in ix else None
        nick = str(r[ix['FirstNameTH']] or '').strip() or str(r[ix['EmpID']])
        team_staff[tname].append({'id': str(r[ix['EmpID']]), 'nick': nick, 'resign': resign, 'start': start})
    return team_staff


def load_req(req_path):
    wb = load_workbook(req_path, read_only=True, data_only=True)
    ws = wb['ShiftReq_Daily']; it = ws.iter_rows(values_only=True)
    h = list(next(it)); ix = {n: i for i, n in enumerate(h)}
    req = defaultdict(dict)   # team -> date -> (m,a,n)
    dates = []
    for r in it:
        d = r[ix['Date']]; d = d.date() if hasattr(d, 'date') else d
        if d not in dates:
            dates.append(d)
        req[r[ix['Team']]][d] = (int(r[ix['M']]), int(r[ix['A']]), int(r[ix['N']]))
    return req, sorted(set(dates))


EXTEND_OT_H = 3        # ยืดกะ (OT ก่อน/หลัง) ต่อคน
CALLED_OT_H = 9        # เรียกคนวันหยุดมาทำ 1 กะ = OT วันหยุด


def _avail(s, d):
    if s.get('start') and d < s['start']:
        return False
    if s.get('resign') and d > s['resign']:
        return False
    return True


CYCLE = 6          # รอบ: ทำ 4 หยุด 2
ON_IN_CYCLE = 4


LEAVE_BUCKET = {'SL': 'SICK', 'VL': 'VACATION'}     # ที่เหลือ (BL/ML/PL/…) → LEAVE


def load_prev_offsets(path, cycle=CYCLE, sheet='CODE กะงาน'):
    """อ่าน roster เดือนก่อน (ชีต 'CODE กะงาน': รหัส·ชื่อ·[กะ,วันทำงาน/วันหยุด]×วัน)
    → คืน {emp_code: offset} ให้รอบ 4-หยุด-2 ของเดือนใหม่ 'ต่อเนื่อง' จากปลายเดือนก่อน"""
    if not path or not os.path.exists(path):
        return {}
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet] if sheet in wb.sheetnames else wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    hr = next((i for i, r in enumerate(rows[:6]) if r and str(r[0]).strip() == 'รหัส'), 2)
    off = {}
    for r in rows[hr + 2:]:
        if not r or r[0] is None:
            continue
        code = str(r[0]).strip()
        if not code or not code[0].isdigit():
            continue
        work, c = [], 3                                  # คอลัมน์ 'วันทำงาน/วันหยุด' = 3,5,7,…
        while c < len(r):
            fl = str(r[c] or '')
            if 'วัน' in fl or '-' in fl:
                work.append('หยุด' not in fl)
            c += 2
        if not work:
            continue
        last = work[-1]
        cnt = 0
        for v in reversed(work):
            if v == last:
                cnt += 1
            else:
                break
        nxt = (cnt if cnt < 4 else 4) if last else (4 + cnt if cnt < 2 else 0)   # ตำแหน่งถัดไปในรอบ WWWWOO
        off[code] = nxt % cycle
    return off


def roster_team(staff, req_by_date, dates, leave=None, prev_off=None, shifts=None, min_rest_min=MIN_REST_MIN):
    """ตารางเวร 'ทำ 4 หยุด 2 ต่อเนื่อง' (สลับ offset ให้คนครบทุกวัน) + กลบวันขาดด้วยบันได OT
    leave = {emp_id: {date: leave_code}} → คนลาถูกข้าม (ไม่จัดงาน/ไม่นับ off-cycle)
    กะหมุน 'ไปข้างหน้า' (เช้า→ดึก) ห้ามย้อน + พัก ≥ min_rest (ดู _assign_shifts)
    คืน assign[date][id]={'sh','ot','bucket'} + coverage[date]"""
    leave = leave or {}
    prev_off = prev_off or {}
    byid = {s['id']: s for s in staff}
    ids = [s['id'] for s in staff]
    # offset: ต่อจากเดือนก่อนถ้ามี (prev_off) ไม่งั้นกระจาย index%CYCLE
    offset = {sid: prev_off.get(sid, k % CYCLE) for k, sid in enumerate(ids)}
    night_cnt = {i: 0 for i in ids}
    yday = {}          # {sid: (ss, se)} กะ 'เมื่อวาน' ของคนที่ทำงาน (ไม่มี = เมื่อวานหยุด → รีเซ็ตรอบกะ)
    assign, coverage = {}, {}
    for di, d in enumerate(dates):
        av = set(i for i in ids if _avail(byid[i], d) and d not in leave.get(i, {}))
        m, a, n = req_by_date.get(d, (0, 0, 0))
        need = m + a + n
        # 4-on / 2-off baseline
        on = [i for i in ids if i in av and (di + offset[i]) % CYCLE < ON_IN_CYCLE]
        off = [i for i in ids if i in av and i not in on]
        day = {}
        ext_used = called = residual = 0
        if len(on) >= need:
            workers = on
            cm, ca, cn = m, a, n
            extra = len(workers) - need                        # เกินก็ให้ขึ้นงาน (ตามรอบ) กระจายลงกะ
            for k in range(extra):
                b = k % 3
                if b == 0: ca += 1
                elif b == 1: cm += 1
                else: cn += 1
        else:
            shortfall = need - len(on)
            ext_used = min(shortfall, len(on))                 # บันได 1: ยืดกะคนที่อยู่
            called_ids = sorted(off)[:max(0, shortfall - ext_used)]
            called = len(called_ids)                           # บันได 2: เรียกคนวันหยุด
            residual = shortfall - ext_used - called
            off = [i for i in off if i not in called_ids]
            workers = on + called_ids
            cn = min(n, len(workers)); cm = min(m, len(workers) - cn); ca = len(workers) - cn - cm
        # แจกกะ: ถ้ามี template ของทีม → ลงกะจริงตามสัดส่วน · ไม่งั้น fallback M/A/N
        #        ทั้งสองทางหมุน 'ไปข้างหน้า' ไม่ย้อน + พัก ≥ min_rest (เทียบ yday)
        pool = list(workers)
        if shifts:
            tgt = _distribute(len(workers), shifts)
            day = _assign_shifts(pool, shifts, tgt, yday, night_cnt, min_rest_min)
        else:
            fb = [{'code': 'M', 'ss': SHIFT_TIME['M'][0], 'se': SHIFT_TIME['M'][1], 'night': False},
                  {'code': 'A', 'ss': SHIFT_TIME['A'][0], 'se': SHIFT_TIME['A'][1], 'night': False},
                  {'code': 'N', 'ss': SHIFT_TIME['N'][0], 'se': SHIFT_TIME['N'][1], 'night': True}]
            day = _assign_shifts(pool, fb, [cm, ca, cn], yday, night_cnt, min_rest_min)
        for i in set(workers) - set(on):                       # คนถูกเรียกจากวันหยุด → OT_OFF
            if i in day:
                day[i]['bucket'] = 'OT_OFF'; day[i]['ot'] = CALLED_OT_H
        for i in [x for x in on if x in day and day[x]['ot'] == 0][:ext_used]:   # ยืดกะ → OT
            day[i]['ot'] = EXTEND_OT_H
        for i in ids:
            if d in leave.get(i, {}):                           # คนลา → ลงรหัสลา
                lt = leave[i][d]
                assign.setdefault(d, {})[i] = {'sh': lt, 'ot': 0, 'bucket': LEAVE_BUCKET.get(lt, 'LEAVE')}
                continue
            cell = day.get(i)
            if cell:
                assign.setdefault(d, {})[i] = cell
            else:
                avl = i in av
                assign.setdefault(d, {})[i] = {'sh': ('OFF' if avl else '-'), 'ot': 0,
                                               'bucket': ('OFF' if avl else 'X')}
        # จดกะวันนี้ไว้เป็น 'เมื่อวาน' ของวันถัดไป — เฉพาะคนที่ทำงานจริง (WORKING/OT_OFF)
        # คนหยุด/ลา/ยังไม่เข้า = ไม่จด → วันถัดไปรีเซ็ต floor (เริ่มกะไหนก็ได้)
        yday = {}
        for i in ids:
            c = assign[d].get(i)
            if c and c.get('bucket') in ('WORKING', 'OT_OFF') and c.get('ss') is not None:
                yday[i] = (c['ss'], c['se'])
        coverage[d] = {'need': need, 'asg': len(workers), 'ext': ext_used, 'called': called, 'short': max(residual, 0)}
    return assign, coverage


def hdr(ws, n):
    fill = PatternFill('solid', fgColor=ROYAL); font = Font(color='FFFFFF', bold=True)
    for c in range(1, n + 1):
        ws.cell(1, c).fill = fill; ws.cell(1, c).font = font
    ws.freeze_panes = 'C2'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--req', required=True)
    ap.add_argument('--reg', required=True)
    ap.add_argument('-o', '--out', default='Roster.xlsx')
    ap.add_argument('--dataverse', default=None, help='โฟลเดอร์ output CSV pas_duty สำหรับ import')
    ap.add_argument('--leave', default=None, help='CSV วันลา (EmpCode,LeaveDate,LeaveType) → ข้ามคนลา')
    ap.add_argument('--prev', default=None, help='roster เดือนก่อน (.xlsx ชีต CODE กะงาน) → ต่อรอบ 4-หยุด-2')
    ap.add_argument('--min-rest', type=float, default=MIN_REST_H, help='พักระหว่างกะขั้นต่ำ (ชม., ค่าปริยาย %d) — กันหมุนย้อน' % MIN_REST_H)
    args = ap.parse_args()
    min_rest_min = int(args.min_rest * 60)
    duty_rows = []
    prev_off = load_prev_offsets(args.prev) if args.prev else {}
    shift_tmpl = load_shift_templates()
    if shift_tmpl:
        print('shift templates:', len(shift_tmpl), 'teams (ลงกะจริงต่อทีม)')
    if prev_off:
        print('prev-month continuity:', len(prev_off), 'emps')
    leave = {}
    if args.leave and os.path.exists(args.leave):
        for r in csv.DictReader(open(args.leave, encoding='utf-8-sig')):
            try:
                dd = __import__('datetime').date.fromisoformat(str(r['LeaveDate'])[:10])
            except Exception:
                continue
            leave.setdefault(str(r['EmpCode']).strip(), {})[dd] = str(r.get('LeaveType', 'PL')).strip() or 'PL'
        print('leave loaded:', sum(len(v) for v in leave.values()), 'day-records')

    team_staff = load_staff(args.reg)
    req, dates = load_req(args.req)
    WD = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา']

    wb = Workbook(); wb.remove(wb.active)
    cov = wb.create_sheet('Coverage')
    cov.append(['Team', 'Date', 'DOW', 'ต้องการ', 'จัดได้', 'ยืดกะ(ext)', 'เรียกวันหยุด(OT)', 'ยังขาด'])

    teams_with = [t for t in req if team_staff.get(t)]
    order = sorted(teams_with, key=lambda t: -len(team_staff[t]))
    for t in order:
        staff = team_staff[t]
        assign, coverage = roster_team(staff, req[t], dates, leave, prev_off, shift_tmpl.get(t), min_rest_min)
        ws = wb.create_sheet(t.replace('/', '-')[:28])
        head = ['รหัส', 'ชื่อ'] + ['%d\n%s' % (d.day, WD[d.weekday()]) for d in dates]
        ws.append(head)
        for s in staff:
            row = [s['id'], s['nick']] + [celltxt(assign[d][s['id']]) for d in dates]
            ws.append(row)
            for d in dates:
                c = assign[d][s['id']]
                st, en = c.get('ss'), c.get('se')
                duty_rows.append([d.isoformat(), s['id'], s['nick'], t, c['bucket'],
                                  ('' if c['sh'] in ('OFF', '-') else c['sh']),
                                  st if st is not None else '', en if en is not None else '', c['ot']])
        # ระบายสีกะ
        for ri in range(2, 2 + len(staff)):
            for ci in range(3, 3 + len(dates)):
                v = str(ws.cell(ri, ci).value or '')
                base = v.rstrip('°+')
                ws.cell(ri, ci).fill = PatternFill('solid', fgColor=SHIFT_FILL.get(base, 'FFFFFF'))
                ws.cell(ri, ci).font = Font(color=SHIFT_FONT.get(base, '000000'), bold=('°' in v or '+' in v))
                ws.cell(ri, ci).alignment = Alignment(horizontal='center')
        hdr(ws, len(head))
        ws.column_dimensions['A'].width = 9; ws.column_dimensions['B'].width = 14
        for ci in range(3, 3 + len(dates)):
            ws.column_dimensions[ws.cell(1, ci).column_letter].width = 5
        ws.row_dimensions[1].height = 30
        # coverage rows
        for d in dates:
            cv = coverage[d]
            cov.append([t, d, WD[d.weekday()], cv['need'], cv['asg'], cv['ext'], cv['called'], cv['short']])

    # เน้นแดงช่องยังขาด (คอลัมน์ 12)
    for ri in range(2, cov.max_row + 1):
        if (cov.cell(ri, 8).value or 0) > 0:
            cov.cell(ri, 8).fill = PatternFill('solid', fgColor='FFC9C9')
    hdr(cov, 12)
    for col in cov.columns:
        cov.column_dimensions[col[0].column_letter].width = 10

    ns = wb.create_sheet('Teams_NoStaff')
    ns.append(['Team', 'หมายเหตุ'])
    for t in req:
        if not team_staff.get(t):
            ns.append([t, 'ไม่มีพนักงานประจำในทะเบียน — ต้องใช้ support/charter/outsource'])
    hdr(ns, 2); ns.column_dimensions['A'].width = 12; ns.column_dimensions['B'].width = 60

    # เรียง Coverage ไว้หน้าสุด
    wb.move_sheet('Coverage', -(len(wb.sheetnames) - 1))
    wb.save(args.out)

    if args.dataverse:
        os.makedirs(args.dataverse, exist_ok=True)
        fp = os.path.join(args.dataverse, 'pas_duty_roster.csv')
        with open(fp, 'w', newline='', encoding='utf-8-sig') as fh:
            w = csv.writer(fh)
            w.writerow(['pas_name', 'pas_work_date', 'EmpCode(pas_employee)', 'pas_emp_name', 'Team(pas_team)',
                        'pas_bucket', 'pas_shift_code', 'pas_shift_start', 'pas_shift_end', 'pas_ot_hours'])
            for r in duty_rows:
                w.writerow([r[1] + '_' + r[0]] + r)   # pas_name = EmpCode_date (คีย์ต่อแถว)
        print('dataverse pas_duty:', fp, '(%d rows)' % len(duty_rows))
    tot_short = sum(1 for ri in range(2, cov.max_row + 1) if (cov.cell(ri, 8).value or 0) > 0)
    tot_ot = sum((cov.cell(ri, 6).value or 0) + (cov.cell(ri, 7).value or 0) for ri in range(2, cov.max_row + 1))
    print('saved', args.out)
    print('teams rostered:', len(teams_with), '| team-days residual-short:', tot_short, '| OT slots (ext+called):', tot_ot)
    print('teams w/o staff:', [t for t in req if not team_staff.get(t)])


if __name__ == '__main__':
    main()
