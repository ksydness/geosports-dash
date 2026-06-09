import { NextResponse } from 'next/server';
import { fetchQuestions } from '@/lib/geosports';

export async function GET() {
  try {
    const data = await fetchQuestions();
    if (!data) return NextResponse.json({ rounds: [] });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ rounds: [] });
  }
}
