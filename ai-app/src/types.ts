// Data model mirrors RosterReader.gs `readRosterFromSpreadsheet(ss)` output.

export type Bucket = 'working' | 'ot_off' | 'off' | 'sick' | 'vac';
export type OtType = 'PRE' | 'POST' | null;

export interface Assignment {
  flight: string;
  task: string;
  STA: string;
  STD: string;
  OP: string;
  CL: string;
}

export interface RosterRecord {
  team: string;
  id: string;
  name: string;
  pos: string;
  posGroup: string;
  shift: string;
  shiftTime: string;
  shiftStart: number | null;
  shiftHrs: number;
  bucket: Bucket;
  ot: number;
  otType: OtType;
  otTime: string;
  re?: string;
  assignments: Assignment[];
}

// Aggregate counters (rrNewAgg_)
export interface Agg {
  staff: number;
  working: number;
  ot_off: number;
  off: number;
  sick: number;
  leave: number;
  otPeople: number;
  otHours: number;
  otPre: number;
  otPreHrs: number;
  otPost: number;
  otPostHrs: number;
  otOffHrs: number;
  flights: number;
  records?: RosterRecord[];
}

export interface RosterResult {
  teams: Record<string, Agg>;
  positions: Record<string, Agg>;
  totals: Agg;
}

// SLA flight coverage (slaCollectFlights_)
export type Phase = 'SUP' | 'CI' | 'GATE' | 'ARR';

export interface FlightCoverage {
  flight: string;
  airline: string;
  teamList: string;
  STA: string;
  STD: string;
  OP: string;
  CL: string;
  assigned: Record<Phase | 'total', number>;
  req: Record<Phase | 'total', number>;
  short: Partial<Record<Phase, number>>;
  shortTotal: number;
  ok: boolean;
}
