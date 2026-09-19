// TypeScript port of the SLA coverage logic from SLA.gs
// (slaAirlineOf_, slaReq_, slaPhaseOf_, slaCollectFlights_).
import { SLA_RQ, SLA_ALIAS, AIRLINE_SYS } from '../constants';
import type { RosterResult, FlightCoverage, Phase } from '../types';

export function slaAirlineOf(flight: string): string {
  const s = String(flight || '').trim().toUpperCase();
  let m = s.match(/^([0-9A-Z]{2})\s*\d/);
  if (m) return m[1];
  m = s.match(/([A-Z]{1,3})\s*\d/);
  return m ? m[1] : 'DEFAULT';
}

export function isFlight(name: string): boolean {
  const s = String(name || '').trim().toUpperCase();
  if (!s) return false;
  if (/^(COUNTER|GATE|CHECK|ZONE|BELT|PIER|STBY|STAND|POOL|OFFICE|BRIEF|NIL|OFF\b)/.test(s)) return false;
  return /[A-Z]{1,3}\s*\d{2,4}/.test(s);
}

export function isSupportFlight(name: string): boolean {
  return /SUU?PP?ORT/i.test(String(name || ''));
}

export function systemOf(airline: string): string {
  return AIRLINE_SYS[String(airline || '').toUpperCase()] || '';
}

export function slaReq(airline: string): Record<Phase | 'total', number> {
  const c = String(airline || '').toUpperCase();
  const rq = SLA_RQ[c] || (SLA_ALIAS[c] && SLA_RQ[SLA_ALIAS[c]]);
  if (rq) return { SUP: rq[0], CI: rq[1], ARR: rq[2], GATE: rq[3], total: rq[4] };
  return { SUP: 2, CI: 4, ARR: 1, GATE: 2, total: 8 }; // DEFAULT
}

export function phaseOf(task: string): Phase {
  const u = String(task || '').toUpperCase();
  if (!u) return 'CI';
  if (/SUP|SPVR|^SOD|SM\b|MONITOR|CREW|^CS\b|CRW/.test(u)) return 'SUP';
  if (/ARR|MEET|^AC\b|^RF\b|ESCORT|BIR/.test(u)) return 'ARR';
  if (/GATE|^GM|^GC|BOARD|^B\b|BGO|BOCO|MAAS|PFD|GBD|^D\b|DEPART/.test(u)) return 'GATE';
  return 'CI';
}

function skipTeam(team: string): boolean {
  const t = String(team || '').toUpperCase();
  return t.includes('PORTER') || t.includes('CREWSIGN') || t.includes('CREW SIGN') ||
    (t.includes('ADMIN') && t.includes('DOC'));
}

export function collectFlights(res: RosterResult): FlightCoverage[] {
  const flights: Record<string, FlightCoverage> = {};
  const phases: Phase[] = ['SUP', 'CI', 'GATE', 'ARR'];

  const add = (team: string, rec: { name: string; assignments: { flight: string; task: string; STA: string; STD: string; OP: string; CL: string }[] }) => {
    (rec.assignments || []).forEach((a) => {
      const key = String(a.flight || '').trim();
      if (!key || isSupportFlight(key)) return;
      if (!flights[key]) {
        flights[key] = {
          flight: key, airline: slaAirlineOf(key), teamList: '',
          STA: a.STA || '', STD: a.STD || '', OP: a.OP || '', CL: a.CL || '',
          assigned: { SUP: 0, CI: 0, GATE: 0, ARR: 0, total: 0 },
          req: { SUP: 0, CI: 0, GATE: 0, ARR: 0, total: 0 },
          short: {}, shortTotal: 0, ok: false,
        };
      }
      const f = flights[key];
      if (!f.teamList.split(',').includes(team)) f.teamList = f.teamList ? f.teamList + ',' + team : team;
      if (!f.STA && a.STA) f.STA = a.STA;
      if (!f.STD && a.STD) f.STD = a.STD;
      if (!f.OP && a.OP) f.OP = a.OP;
      if (!f.CL && a.CL) f.CL = a.CL;
      const ph = phaseOf(a.task);
      f.assigned[ph]++;
      f.assigned.total++;
    });
  };

  Object.keys(res.teams).forEach((t) => {
    if (skipTeam(t)) return;
    (res.teams[t].records || []).forEach((r) => {
      if (r.bucket === 'working' || r.bucket === 'ot_off') add(t, r);
    });
  });

  return Object.keys(flights).map((k) => {
    const f = flights[k];
    f.req = slaReq(f.airline);
    f.short = {};
    phases.forEach((ph) => {
      const d = f.req[ph] - f.assigned[ph];
      if (d > 0) f.short[ph] = d;
    });
    f.shortTotal = Math.max(0, f.req.total - f.assigned.total);
    f.ok = Object.keys(f.short).length === 0 && f.shortTotal === 0;
    return f;
  }).sort((a, b) => String(a.STD || a.STA || 'zz').localeCompare(String(b.STD || b.STA || 'zz')));
}
