import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { todayET } from '@/lib/dates';

const BASE = 'https://geosports.app';
const MAX_QUESTIONS = 10;
const MIN_QUESTIONS = 5; // a round has 5 questions — don't cache partial fetches

type Guess = { questionId?: string; answer: { lat: number; lng: number; name: string; story?: string } };

// Returns the daily answer key (correct locations + stories) for a given date.
// Served from the Supabase `answers` cache when available; otherwise fetched
// from GeoSports' public guess endpoint and cached. The answer key for a date
// never changes once published, so past dates are immutable.
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 });
  }

  const cacheHeaders = {
    // Past answer keys are immutable; today's gets a short edge cache
    'Cache-Control':
      date < todayET()
        ? 'public, s-maxage=31536000, max-age=3600, immutable'
        : 'public, s-maxage=300, max-age=60',
  };

  // 1. Serve from cache if we have it
  const { data: cached } = await supabase
    .from('answers')
    .select('guesses')
    .eq('date', date)
    .maybeSingle();

  if (cached?.guesses) {
    return NextResponse.json({ date, guesses: cached.guesses }, { headers: cacheHeaders });
  }

  // 2. Fetch from GeoSports. Throwaway anonymous identity — guess endpoint gates
  // question order per clientId, so we walk q0..N sequentially with one disposable id.
  const clientId = `dash-${date}-${Math.random().toString(36).slice(2)}`;
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://geosports.app/',
    Origin: 'https://geosports.app',
  };

  const guesses: Guess[] = [];

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

  // 3. Cache the full answer key (skip partial fetches so a transient failure
  // doesn't get frozen forever)
  if (guesses.length >= MIN_QUESTIONS) {
    const { error: insertError } = await supabase.from('answers').upsert(
      { date, guesses },
      { onConflict: 'date' }
    );
    if (insertError) console.error(`Failed to cache answers for ${date}:`, insertError);
  }

  return NextResponse.json({ date, guesses }, { headers: cacheHeaders });
}
