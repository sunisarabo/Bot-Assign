#!/usr/bin/env python3
"""Concatenate the individual .gs modules into the single Code.gs (manual
copy-paste bundle). clasp pushes the modules separately; Code.gs is only the
all-in-one for pasting into the Apps Script editor by hand."""
import io, os

ORDER = ['RosterReader', 'MasterReader', 'LLReader', 'WeeklyFlight', 'SLA', 'AirlineSupport',
         'AssignCheck', 'AutoPlan', 'AdvancePlan', 'OTDashboard', 'WorkHours', 'DutyImport', 'RosterBot', 'WebDashboard']
HEADER = ('/**\n'
          ' * SmartShift Roster Bot — All-in-One (AOTGA design web app)\n'
          ' * setupTriggers() = รันทุกวัน 08:00 และ 14:00 ส่งเข้า Google Chat\n'
          ' */\n')

here = os.path.dirname(os.path.abspath(__file__))
out = [HEADER]
for name in ORDER:
    path = os.path.join(here, name + '.gs')
    if not os.path.exists(path):
        continue
    with io.open(path, encoding='utf-8') as f:
        body = f.read()
    out.append('\n\n// ===== ' + name + '.gs =====\n\n' + body)

with io.open(os.path.join(here, 'Code.gs'), 'w', encoding='utf-8') as f:
    f.write(''.join(out) + '\n')
print('Code.gs rebuilt from:', ', '.join(n for n in ORDER
      if os.path.exists(os.path.join(here, n + '.gs'))))
