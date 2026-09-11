import { GoogleGenAI } from '@google/genai';
import type { RosterResult } from '../types';
import { collectFlights } from './sla';

const API_KEY = process.env.API_KEY || '';

export const hasApiKey = (): boolean => !!API_KEY;

// Compact, token-cheap snapshot of the roster for grounding the model.
export function buildRosterContext(res: RosterResult, dateStr: string): string {
  const T = res.totals;
  const lines: string[] = [];
  lines.push(`วันที่: ${dateStr}`);
  lines.push(
    `รวม: พนักงาน ${T.staff} · มาทำงาน ${T.working + T.ot_off} · OFF ${T.off} · ป่วย ${T.sick} · ลา ${T.leave} · OT ${T.otPeople} คน (${T.otHours}h) · ไฟลท์ ${T.flights}`,
  );
  lines.push('— ทีม (working/total, OT h) —');
  Object.keys(res.teams).forEach((t) => {
    const b = res.teams[t];
    lines.push(`  ${t}: ${b.working + b.ot_off}/${b.staff}, OT ${b.otHours}h`);
  });
  lines.push('— ตำแหน่ง —');
  Object.keys(res.positions).forEach((p) => {
    const b = res.positions[p];
    lines.push(`  ${p}: ${b.working + b.ot_off}/${b.staff}`);
  });
  const flights = collectFlights(res);
  const short = flights.filter((f) => !f.ok);
  lines.push(`— ไฟลท์รวม ${flights.length}, คนไม่ครบ SLA ${short.length} —`);
  short.slice(0, 25).forEach((f) => {
    const parts = (['SUP', 'CI', 'GATE', 'ARR'] as const)
      .filter((ph) => f.short[ph])
      .map((ph) => `${ph}-${f.short[ph]}`);
    lines.push(`  ${f.flight} (${f.airline}) ${f.STD || f.STA} ส่ง ${f.assigned.total}/${f.req.total} ขาด ${parts.join(' ')}`);
  });
  return lines.join('\n');
}

const SYSTEM_INSTRUCTION = `คุณคือผู้ช่วยวางแผนกำลังพล (manpower) ของ AOTGA ฝ่ายบริการผู้โดยสาร (PSA).
ตอบเป็นภาษาไทย กระชับ ตรงประเด็น อ้างอิงเฉพาะข้อมูลใน "ข้อมูลกำลังพลวันนี้" ที่ให้มา.
ถ้าข้อมูลไม่พอให้บอกตรง ๆ อย่าเดาตัวเลข. เมื่อแนะนำการจัดคน ให้คำนึงถึง SLA ของแต่ละสายการบิน
(SUP/Check-in/Gate/Arrival) และระบบเช็คอินที่พนักงานต้องรู้.`;

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

export async function askGemini(
  history: ChatTurn[],
  question: string,
  rosterContext: string,
): Promise<string> {
  if (!API_KEY) {
    throw new Error('ยังไม่ได้ตั้งค่า GEMINI_API_KEY — ใส่ใน .env.local แล้วรันใหม่');
  }
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const contents = [
    ...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: 'user' as const, parts: [{ text: question }] },
  ];
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents,
    config: {
      systemInstruction: `${SYSTEM_INSTRUCTION}\n\n=== ข้อมูลกำลังพลวันนี้ ===\n${rosterContext}`,
      temperature: 0.3,
    },
  });
  return response.text ?? '';
}
