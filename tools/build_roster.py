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

# เวลาเข้า-ออกมาตรฐานต่อกะ (นาที) → เขียนลง pas_duty ตอน import
SHIFT_TIME = {'M': (5*60, 14*60), 'A': (13*60, 22*60), 'N': (21*60, 30*60)}


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


def roster_team(staff, req_by_date, dates):
    """ตารางเวร 'ทำ 4 หยุด 2 ต่อเนื่อง' (สลับ offset ให้คนครบทุกวัน) + กลบวันขาดด้วยบันได OT
    คืน assign[date][id]={'sh','ot','bucket'} + coverage[date]"""
    byid = {s['id']: s for s in staff}
    ids = [s['id'] for s in staff]
    offset = {sid: k % CYCLE for k, sid in enumerate(ids)}     # กระจายวันหยุดให้ไม่ตรงกันหมด
    night_cnt = {i: 0 for i in ids}
    assign, coverage = {}, {}
    for di, d in enumerate(dates):
        av = set(i for i in ids if _avail(byid[i], d))
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
        # แจกกะ: N ก่อน (เฉลี่ยดึก) แล้ว M, A
        pool = sorted(workers, key=lambda i: (night_cnt[i], i))
        for i in pool[:cn]:
            day[i] = {'sh': 'N', 'ot': 0, 'bucket': 'WORKING'}; night_cnt[i] += 1
        rest = [i for i in pool if i not in day]
        for i in rest[:cm]:
            day[i] = {'sh': 'M', 'ot': 0, 'bucket': 'WORKING'}
        for i in rest[cm:cm + ca]:
            day[i] = {'sh': 'A', 'ot': 0, 'bucket': 'WORKING'}
        for i in set(workers) - set(on):                       # คนถูกเรียกจากวันหยุด → OT_OFF
            if i in day:
                day[i]['bucket'] = 'OT_OFF'; day[i]['ot'] = CALLED_OT_H
        for i in [x for x in on if x in day and day[x]['ot'] == 0][:ext_used]:   # ยืดกะ → OT
            day[i]['ot'] = EXTEND_OT_H
        for i in ids:
            cell = day.get(i)
            if cell:
                assign.setdefault(d, {})[i] = cell
            else:
                avl = i in av
                assign.setdefault(d, {})[i] = {'sh': ('OFF' if avl else '-'), 'ot': 0,
                                               'bucket': ('OFF' if avl else 'X')}
        coverage[d] = {'tgt': (m, a, n), 'asg': (cm, ca, cn), 'ext': ext_used, 'called': called, 'short': max(residual, 0)}
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
    args = ap.parse_args()
    duty_rows = []

    team_staff = load_staff(args.reg)
    req, dates = load_req(args.req)
    WD = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา']

    wb = Workbook(); wb.remove(wb.active)
    cov = wb.create_sheet('Coverage')
    cov.append(['Team', 'Date', 'DOW', 'Tgt_M', 'Tgt_A', 'Tgt_N', 'Asg_M', 'Asg_A', 'Asg_N', 'ยืดกะ(ext)', 'เรียกวันหยุด(OT)', 'ยังขาด'])

    teams_with = [t for t in req if team_staff.get(t)]
    order = sorted(teams_with, key=lambda t: -len(team_staff[t]))
    for t in order:
        staff = team_staff[t]
        assign, coverage = roster_team(staff, req[t], dates)
        ws = wb.create_sheet(t.replace('/', '-')[:28])
        head = ['รหัส', 'ชื่อ'] + ['%d\n%s' % (d.day, WD[d.weekday()]) for d in dates]
        ws.append(head)
        for s in staff:
            row = [s['id'], s['nick']] + [celltxt(assign[d][s['id']]) for d in dates]
            ws.append(row)
            for d in dates:
                c = assign[d][s['id']]
                st, en = SHIFT_TIME.get(c['sh'], (None, None))
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
            cv = coverage[d]; (tm, ta, tn) = cv['tgt']; (am, aa, an) = cv['asg']
            cov.append([t, d, WD[d.weekday()], tm, ta, tn, am, aa, an, cv['ext'], cv['called'], cv['short']])

    # เน้นแดงช่องยังขาด (คอลัมน์ 12)
    for ri in range(2, cov.max_row + 1):
        if (cov.cell(ri, 12).value or 0) > 0:
            cov.cell(ri, 12).fill = PatternFill('solid', fgColor='FFC9C9')
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
    tot_short = sum(1 for ri in range(2, cov.max_row + 1) if (cov.cell(ri, 12).value or 0) > 0)
    tot_ot = sum((cov.cell(ri, 10).value or 0) + (cov.cell(ri, 11).value or 0) for ri in range(2, cov.max_row + 1))
    print('saved', args.out)
    print('teams rostered:', len(teams_with), '| team-days residual-short:', tot_short, '| OT slots (ext+called):', tot_ot)
    print('teams w/o staff:', [t for t in req if not team_staff.get(t)])


if __name__ == '__main__':
    main()
