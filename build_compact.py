#!/usr/bin/env python3
"""Build a COMPACT single Code.gs for reliable copy-paste into the Apps Script
editor: concatenate the modules, minify the embedded CSS, drop /* */ block
comments and blank lines. Keeps // line comments (URLs use //) and all code
untouched. The individual .gs modules remain the readable source."""
import io, os, re

ORDER = ['RosterReader', 'MasterReader', 'LLReader', 'SLA',
         'AssignCheck', 'RosterBot', 'WebDashboard']
HEADER = ('/** SmartShift Roster Bot — All-in-One (compact). '
          'setupTriggers()=รัน 08:00/14:00 ส่ง Google Chat */\n')

here = os.path.dirname(os.path.abspath(__file__))
parts = []
for name in ORDER:
    p = os.path.join(here, name + '.gs')
    if os.path.exists(p):
        parts.append(io.open(p, encoding='utf-8').read())
code = HEADER + '\n'.join(parts)

# 1) minify the embedded CSS template literal: rbDESIGN_CSS_ = `...`;
def min_css(m):
    css = m.group(1)
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)        # drop CSS comments
    css = re.sub(r'\s*\n\s*', ' ', css)                    # newlines -> space
    css = re.sub(r'\s{2,}', ' ', css)                      # collapse spaces
    css = re.sub(r'\s*([{};:,>])\s*', r'\1', css)          # tighten around punctuation
    css = css.replace('}', '}\n')                          # one rule per line (avoid 1 huge line)
    return 'rbDESIGN_CSS_ = `' + css.strip() + '`;'
code = re.sub(r'rbDESIGN_CSS_ = `(.*?)`;', min_css, code, flags=re.S)

# 2) drop /* ... */ JS block comments (the CSS literal no longer has any)
code = re.sub(r'/\*.*?\*/', '', code, flags=re.S)
# 3) collapse blank lines
code = re.sub(r'\n[ \t]*\n(?:[ \t]*\n)+', '\n\n', code)
code = re.sub(r'[ \t]+\n', '\n', code)

with io.open(os.path.join(here, 'Code.gs'), 'w', encoding='utf-8') as f:
    f.write(code.strip() + '\n')
print('compact Code.gs:', len(code), 'bytes')
