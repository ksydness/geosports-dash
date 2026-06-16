import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchQuestions } from '@/lib/geosports';

export const dynamic = 'force-dynamic';

type Answer = { lat: number; lng: number; name: string; story?: string };
type Guess = { questionId?: string; answer: Answer };

// Per-question multipliers by slot (Q1..Q5) — matches the live game.
const MULT: Record<string, number> = { '1': 1, '2': 1, '3': 2, '4': 3, '5': 3 };

// Builds a "mixed" practice round for the dashboard's secret game: one question
// per slot (Q1..Q5), each pulled from a random past day, so you practice your
// recall rather than replaying a single day. Pool = whatever the `answers`
// cache currently holds (it grows by one day per daily sync). Nothing is saved
// — scores are just-for-fun.
export async function GET() {
  const { data: rows } = await supabase.from('answers').select('date, guesses');
  if (!rows || !rows.length) return NextResponse.json({ questions: [] });

  // Map questionId -> prompt text from the public questions feed.
  const prompts: Record<string, string> = {};
  try {
    const q = (await fetchQuestions()) as { rounds?: { questions?: { id?: string; prompt?: string }[] }[] };
    for (const round of q?.rounds || [])
      for (const ques of round.questions || [])
        if (ques.id && ques.prompt) prompts[ques.id] = ques.prompt;
  } catch {
    /* prompts feed unavailable — questions without a prompt are skipped below */
  }

  // Bucket every cached question by its slot (the q1..q5 suffix on questionId).
  const bySlot: Record<string, { prompt: string; answer: Answer }[]> = { '1': [], '2': [], '3': [], '4': [], '5': [] };
  for (const row of rows) {
    for (const g of (row.guesses || []) as Guess[]) {
      const id = g.questionId || '';
      const m = id.match(/q(\d)$/);
      if (!m || !bySlot[m[1]]) continue;
      if (!g.answer || typeof g.answer.lat !== 'number' || typeof g.answer.lng !== 'number') continue;
      const prompt = prompts[id];
      if (!prompt) continue; // need the clue text to play
      bySlot[m[1]].push({ prompt, answer: g.answer });
    }
  }

  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const questions = (['1', '2', '3', '4', '5'] as const)
    .filter((slot) => bySlot[slot].length)
    .map((slot) => {
      const q = pick(bySlot[slot]);
      return { slot: Number(slot), multiplier: MULT[slot], prompt: q.prompt, answer: q.answer };
    });

  return NextResponse.json({ questions }, { headers: { 'Cache-Control': 'no-store' } });
}
