# AOTGA Manpower Dashboard — React + Gemini (AI Studio style)

A standalone web app that mirrors the Apps Script `WebDashboard.gs` roster
dashboard, rebuilt as a React + TypeScript (Vite) app with a **Gemini AI
assistant** that reasons over the day's roster.

It uses the same data model (`readRosterFromSpreadsheet` output), the same SLA
coverage logic (`SLA.gs`), and the same corporate design system as the Apps
Script dashboard.

## Tabs
- **▦ Dashboard** — KPI hero (Total / Working / OFF / OT OFF / OT people / OT
  hours), Working-vs-Total per team, status doughnut, OT-by-type charts, and
  per-team / per-position manpower tables.
- **☰ Timetable** — every employee with shift, OT and assigned flights; searchable.
- **✈ Flights & SLA** — each flight's assigned vs required headcount per phase
  (SUP / Check-in / Gate / Arrival), with shortage flags.
- **🤖 AI Assistant** — Gemini `gemini-2.5-flash` chat grounded on a compact
  snapshot of the roster (Thai). Ask "which flights are short", "which team has
  the most OT", "who is free to support".

## Run
```bash
cd ai-app
npm install
cp .env.example .env.local      # add your GEMINI_API_KEY
npm run dev
```

Get a Gemini key at https://aistudio.google.com/apikey. The dashboard works
without a key; only the AI Assistant tab needs it.

## Data source
By default the app runs on bundled **sample data** (`src/data/sampleRoster.ts`)
so it works offline / in AI Studio.

To show **real** roster data, deploy an Apps Script endpoint that returns the
roster as JSON (an array of `RosterRecord` or a `{ teams, positions, totals }`
object) and set `VITE_ROSTER_ENDPOINT` in `.env.local`. The app calls
`<endpoint>?date=YYYY-MM-DD&format=json`. A minimal Apps Script handler:

```js
function doGet(e) {
  var date = e.parameter.date ? rbDateFromIso_(e.parameter.date) : new Date();
  var res = readRosterFromSpreadsheet(rbOpenTodayRoster_(date).ss);
  var records = [];
  Object.keys(res.teams).forEach(function (t) {
    res.teams[t].records.forEach(function (r) { records.push(r); });
  });
  return ContentService.createTextOutput(JSON.stringify(records))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## Project layout
```
src/
  App.tsx                 top-level state (date, tab, roster load)
  constants.ts            CI palette, SLA_RQ, AIRLINE_SYS
  types.ts                RosterRecord / Agg / FlightCoverage
  data/sampleRoster.ts    bundled sample roster
  services/
    rosterService.ts      aggregation (rrAddBucket_ port) + loader
    sla.ts                SLA coverage (slaCollectFlights_ port)
    geminiService.ts      Gemini chat + roster-context builder
  components/             AppBar, WeekNav, Tabs, Dashboard, Timetable,
                          FlightsSLA, AiAssistant
```
