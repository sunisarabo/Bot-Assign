# Bot-Assign — roster reader & daily report

Reads the daily roster files (all teams, every layout) and produces a manpower
**Dashboard** and a per-employee **Timetable** (flights + times), with an
optional Google Chat summary.

## Files
| File | Role |
|------|------|
| `RosterReader.gs` | Core reader. Header-driven + REMARK-driven parsing of every team (standard layout, TR variant, PORTER, PORTER CREWSIGN, ADMIN DOC, and both SU template generations). `readRosterFromSpreadsheet(ss) → { teams, totals }`. |
| `RosterBot.gs` | Integration: writes the Dashboard + Timetable tabs and posts the Chat summary. Finds today's file on Drive (converts `.xlsx` automatically). |
| `reference_parser.py` | Standalone offline validator / spec: `python3 reference_parser.py <file.xlsx> [TEAM]`. |
| `FINDINGS.md` | Data layouts, column maps, classification rules, SU templates, caveats. |

## Set up in Google Apps Script
1. Create/open the Apps Script project and add **both** `RosterReader.gs` and
   `RosterBot.gs`.
2. Enable the **Drive API** advanced service (used to convert `.xlsx`):
   Extensions → Apps Script → Services → add *Drive API*.
3. Edit `CONFIG_RB` in `RosterBot.gs`:
   - `ROOT_FOLDER_ID` — the year folder that contains the month→day roster files.
   - `OUTPUT_FOLDER_ID` — where the monthly report file should be written.
4. (Optional Chat) Apps Script → Project Settings → Script Properties →
   add `GCHAT_WEBHOOK_REPORT` = your Google Chat incoming webhook URL.

## Test it against a real file first (step A)
The fastest sanity check — no Drive navigation needed:

```js
// In RosterBot.gs, run this from the editor:
testRosterFromId('<roster spreadsheet ID>');
```

It writes a fresh output spreadsheet with **📊 Dashboard** and **🕓 Timetable**
tabs and logs the link. Or, to just log the per-team table:

```js
debugDumpRoster('<roster spreadsheet ID>');   // defined in RosterReader.gs
```

Compare the Dashboard's working / off / sick / leave / OT columns against the
file's MANPOWER sheet. (Note: MANPOWER is hand-typed and sometimes stale; the
reader reflects what the team sheets actually contain — see `FINDINGS.md`.)

## Daily automation
- `runDailyRosterReport()` — finds today's roster on Drive and writes the report.
- `runRosterForDate(year, month, day)` — same, for a specific date.
- Add a time-based trigger on `runDailyRosterReport` (e.g. 06:00).

## What each output shows
- **Dashboard**: per team — Total / Working / OT-Off / Off / Sick / Leave /
  OT people / OT hours / Flights, plus a grand total.
- **Timetable**: per team, each working employee with shift, OT and their
  flights as `FLIGHT [task] open-close` — for spotting overloaded or thin
  schedules.
