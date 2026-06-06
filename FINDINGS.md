# Roster data — findings & fixes

Analysis of the real daily roster files (`01JUN`, `02JUN`, `03JUN`, `04JUN`) and
the `Roster_06Jun26` PDF, used to make the bot read **every team** correctly.

## The root cause of the bugs

The original assignment script (`detectAndParse`) routed parsing by **sheet
name** (`if name === 'AK' return parseAK`, `if name === 'TR' || 'KE' return
parseTRKE`, `parseCHN`, `parsePVT`, …). Each of those parsers assumed a fixed,
team‑specific column layout. But the real layouts **drift**:

| Team | 01–03 JUN layout | 04 JUN layout |
|------|------------------|---------------|
| TR   | standard `ID·Position·NAME·SHIFT…` | variant `NO·ID·NAME·TIME·SHIFT·OT` |
| AK   | standard | standard |
| CHN  | standard | standard |
| KE   | standard | standard |
| PRIVATE | standard | standard |

`parseAK` / `parseCHN` / `parseTRKE` / `parsePVT` were written for **older**
bespoke layouts, so on these files they read the wrong columns (or nothing).
`parseStandard` would actually have worked for AK/CHN/KE — but name routing
never let it run.

**Fix:** detect the format from the **header row content**, not the sheet name.
One `parseStandard` handles both the standard layout and the TR variant (both
expose `NAME` + (`ID`|`NO`) and a `FLIGHT` block). Only three genuinely
different layouts keep dedicated parsers: `PORTER` (two-column name list),
`PORTER CREWSIGN` (shift/name/remark), `ADMIN DOC` (name + schedule + many
flights).

## The most important data rule

**Attendance is the `REMARK` column — never the shift code.**

A working-looking shift code does **not** mean the person works. Example from
`JQ` / 04 JUN: many staff carry shift `X9` (00:00–09:00) but `REMARK` is
`OFF`, `OFF (NO RQ OT)`, `OFF (CHG WZ GF)` or `OT OFF`. Classifying from the
shift code counted them as working and inflated headcount.

Classification order (REMARK first, shift only when REMARK is blank):

| REMARK (parentheses stripped) | bucket |
|---|---|
| `SICK*`, `SL`, `MC` | sick |
| `VAC*`, `BL`, `AL` | leave |
| `OT OFF*` | ot_off (off day, came in for OT) |
| `ONDUTY*` | working |
| `OFF*`, `X` | off |
| *(blank)* | fall back to shift code |

## Column map (standard sheets)

```
0 ID | 1 Position | 2 NAME | 3 SHIFT | 4 IN | 5 OUT | 6 TotalHrs(sched)
7 reIN | 8 reOUT | 9 reTotal | 10 OT-IN | 11 OT-OUT | 12 OT TotalHrs
13 REMARK | 14 FLIGHT-label | 15+ flight columns (pairs)
```

- **OT hours** = col 12 (`Total Hrs.` under the `OT` group). Accepts `1.5`,
  `3`, `"1:30"` (duration). A `H:MM` with `H > 14` is a clock time, not a
  duration, so it is ignored.
- **Flights**: header row marks each flight column; `STA/STD` are one row below
  the header, `OP/CL` two rows below. Per employee, a non-empty flight cell is
  an assignment carrying the flight's `STA/STD/OP/CL` times — this drives the
  "how many flights, doing what, from when to when" view.

## SU is a special 3-section template

SU does not use the standard layout. Its sheet has three stacked sections and a
staff member appears in several of them:

1. **CHECK-IN COUNTER rotation** — `FLT | TIME | H2 H3 G2…G10`. Staff names fill
   each counter for each time slot; the same person recurs across consecutive
   slots = one long "check-in common" sitting that covers **many** flights.
2. **ARRIVAL & DEPARTURE GATE** — `FLT | STA/STD | GATE MONITOR | ARR | CS |
   GATE AGENT…`. One row per flight → gate roles are **per-flight**.
3. **JOB DETAIL** — `FLT | ROUTE | STA/STD | OP/CLS | SOD | OB | RF | …`. One row
   per flight → job roles per-flight, and supplies each flight's OP/CL times.

`rrParseSU_` reads all three: each staff member gets **one** `CHECK-IN COMMON`
assignment (covering the counter flights, with the counter time span as OP/CL)
plus their per-flight gate/job assignments with STA/STD/OP/CL. Names borrowed
from other teams carry a suffix (`TANADON PVT`, `ANUTTRI JQ`) which is stripped;
flight codes (`SU637`), role words (`SOD`, `CS`, `SPVR`) and `PORTER CS` are
rejected as names. Routed by sheet name `SU` (and `SU REV.xx`).

## OT-hours total caveat (a real surprise in the data)

The per-team flight/job sheets only record OT **duration** for some teams. The
teams whose people are entered as plain `OT OFF`/`Onduty` without an OT-IN/OUT
pair (CHN, QR-on-some-days, KE, TK, Charter, ADMIN, CREWSIGN) legitimately show
`OT hours = 0` from the sheet even though `MANPOWER`'s manual summary lists OT.
That is a **data-entry gap in the source sheets**, not a parser bug — the OT
clock-in/out cells are simply blank. The reader reports exactly what the sheet
contains.

## Verification

`reference_parser.py` is a standalone validator (`python3 reference_parser.py
<file.xlsx> [TEAM]`). Spot checks against `MANPOWER`'s manual table:

| 04 JUN team | parser (working) | MANPOWER |
|---|---|---|
| SQ | 34 | 34 |
| EY | 20 | 20 (actual) |
| TR | 31 | 31 |
| WY | 23 | 22–24 |

`RosterReader.gs` is the Google Apps Script port of the same logic. Call
`readRosterFromSpreadsheet(ss)` (or `debugDumpRoster(ssId)`); it returns
`{ teams, totals }` with `working / ot_off / off / sick / leave / otPeople /
otHours / flights` plus `records[]` carrying each employee's `shift`, `ot` and
`assignments[] {flight, task, STA, STD, OP, CL}` for the scheduling view.
