import { useMemo, useRef, useState } from 'react';
import type { RosterResult } from '../types';
import { askGemini, buildRosterContext, hasApiKey, type ChatTurn } from '../services/geminiService';

const SUGGESTIONS = [
  'วันนี้ไฟลท์ไหนคนไม่ครบ SLA บ้าง?',
  'ทีมไหนมี OT เยอะที่สุด และกี่ชั่วโมง?',
  'ใครว่างพอจะไปช่วยไฟลท์ที่ขาดคนได้บ้าง?',
  'สรุปภาพรวมกำลังพลวันนี้ให้หน่อย',
];

export default function AiAssistant({ res, dateStr }: { res: RosterResult; dateStr: string }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  const context = useMemo(() => buildRosterContext(res, dateStr), [res, dateStr]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setError('');
    setInput('');
    const history = turns;
    setTurns([...history, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const answer = await askGemini(history, q, context);
      setTurns((prev) => [...prev, { role: 'model', text: answer || '(ไม่มีคำตอบ)' }]);
    } catch (e: any) {
      setError(e?.message || 'เกิดข้อผิดพลาดในการเรียก Gemini');
    } finally {
      setBusy(false);
      requestAnimationFrame(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      });
    }
  };

  return (
    <div className="tablecard" style={{ padding: '18px 20px' }}>
      <div className="tablecard__hd" style={{ padding: 0, marginBottom: 14 }}>
        <h3>🤖 AI Assistant · ถามเรื่องกำลังพล (Gemini)</h3>
      </div>

      {!hasApiKey() && (
        <div className="apiwarn">
          ⚠️ ยังไม่ได้ตั้งค่า <b>GEMINI_API_KEY</b> — สร้างไฟล์ <code>.env.local</code> ใส่
          <code> GEMINI_API_KEY=...</code> แล้วรัน <code>npm run dev</code> ใหม่. ขอ key ได้ที่
          aistudio.google.com/apikey
        </div>
      )}

      <div className="suggest">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => send(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>

      <div className="chatwrap">
        <div className="chatlog" ref={logRef}>
          {turns.length === 0 && (
            <div className="msg model">
              สวัสดีครับ ผมช่วยวิเคราะห์กำลังพล/การจัดเวรของ {dateStr} ได้
              ลองถามจากปุ่มด้านบนหรือพิมพ์คำถามได้เลย
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={'msg ' + t.role}>
              {t.text}
            </div>
          ))}
          {busy && (
            <div className="msg model">
              <span className="spin" /> กำลังคิด…
            </div>
          )}
          {error && <div className="msg err">{error}</div>}
        </div>

        <form
          className="chatform"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            placeholder="พิมพ์คำถามเกี่ยวกับกำลังพล…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
          />
          <button className="btn btn--accent" type="submit" disabled={busy || !input.trim()}>
            ส่ง
          </button>
        </form>
      </div>
    </div>
  );
}
