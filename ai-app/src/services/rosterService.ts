// Builds the aggregate roster result from raw records — mirrors
// RosterReader.gs `rrAddBucket_` / `rrNewAgg_` / `readRosterFromSpreadsheet`.
import type { Agg, RosterRecord, RosterResult } from '../types';
import { SAMPLE_RECORDS } from '../data/sampleRoster';

export function newAgg(): Agg {
  return {
    staff: 0, working: 0, ot_off: 0, off: 0, sick: 0, leave: 0,
    otPeople: 0, otHours: 0, otPre: 0, otPreHrs: 0, otPost: 0, otPostHrs: 0,
    otOffHrs: 0, flights: 0,
  };
}

function addBucket(agg: Agg, r: RosterRecord) {
  if (r.bucket === 'working') agg.working++;
  else if (r.bucket === 'ot_off') agg.ot_off++;
  else if (r.bucket === 'off') agg.off++;
  else if (r.bucket === 'sick') agg.sick++;
  else if (r.bucket === 'vac') agg.leave++;
  if (r.ot > 0) {
    agg.otPeople++;
    agg.otHours += r.ot;
    if (r.bucket === 'ot_off') agg.otOffHrs += r.ot;
    else if (r.otType === 'PRE') { agg.otPre++; agg.otPreHrs += r.ot; }
    else { agg.otPost++; agg.otPostHrs += r.ot; }
  }
  agg.flights += r.assignments ? r.assignments.length : 0;
  agg.staff++;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function roundAgg(a: Agg): Agg {
  a.otHours = round1(a.otHours);
  a.otPreHrs = round1(a.otPreHrs);
  a.otPostHrs = round1(a.otPostHrs);
  a.otOffHrs = round1(a.otOffHrs);
  return a;
}

export function buildResult(records: RosterRecord[]): RosterResult {
  const teams: Record<string, Agg> = {};
  const positions: Record<string, Agg> = {};
  const totals = newAgg();

  records.forEach((r) => {
    if (!teams[r.team]) {
      teams[r.team] = newAgg();
      teams[r.team].records = [];
    }
    teams[r.team].records!.push(r);
    addBucket(teams[r.team], r);
    if (!positions[r.posGroup]) positions[r.posGroup] = newAgg();
    addBucket(positions[r.posGroup], r);
    addBucket(totals, r);
  });

  Object.values(teams).forEach(roundAgg);
  Object.values(positions).forEach(roundAgg);
  roundAgg(totals);
  return { teams, positions, totals };
}

// Load roster for a date. If VITE_ROSTER_ENDPOINT is set, fetch JSON from the
// deployed Apps Script web app (expected to return RosterRecord[] or RosterResult);
// otherwise fall back to the bundled sample data so the app runs standalone.
export async function loadRoster(iso: string): Promise<RosterResult> {
  const endpoint = (import.meta as any).env?.VITE_ROSTER_ENDPOINT as string | undefined;
  if (endpoint) {
    try {
      const url = endpoint + (endpoint.includes('?') ? '&' : '?') + 'date=' + iso + '&format=json';
      const resp = await fetch(url);
      const data = await resp.json();
      if (Array.isArray(data)) return buildResult(data as RosterRecord[]);
      if (data && data.teams && data.totals) return data as RosterResult;
    } catch (e) {
      console.warn('roster endpoint failed, using sample data', e);
    }
  }
  return buildResult(SAMPLE_RECORDS);
}
