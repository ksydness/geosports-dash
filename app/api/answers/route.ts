import { NextRequest, NextResponse } from 'next/server';

const BASE = 'https://geosports.app';
const MAX_QUESTIONS = 10;

// Returns the daily answer key (correct locations + stories) for a given date by
// querying GeoSports' public guess endpoint. No auth / no played round required —
// answers are available as soon as the round publishes (today or any past date).
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 });
  }

  // Throwaway anonymous identity — guess endpoint gates question order per clientId,
  // so we walk q0..N sequentially with one disposable id.
  const clientId = `dash-${date}-${Math.random().toString(36).slice(2)}`;
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://geosports.app/',
    Origin: 'https://geosports.app',
  };

  const guesses: Array<{ questionId?: string; answer: { lat: number; lng: number; name: string; story?: string } }> = [];

  for (let i = 0; i < MAX_QUESTIONS; i++) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/api/v2/play/guess`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ date, questionIndex: i, guess: { lat: 0, lng: 0 }, clientId }),
      });
    } catch {
      break;
    }
    if (!res.ok) break; // 403 future round / 404 no round / end of questions
    const data = await res.json();
    if (!data?.answer || typeof data.answer.lat !== 'number') break;
    guesses.push({ questionId: data.questionId, answer: data.answer });
  }

  if (guesses.length === 0) {
    return NextResponse.json({ error: 'No answers available for this date' }, { status: 404 });
  }
  return NextResponse.json({ date, guesses });
}
