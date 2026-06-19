import { NextRequest, NextResponse } from 'next/server';
import { fetchQuestions } from '@/lib/geosports';
import { DEFAULT_SITE, isSite } from '@/lib/sites';

export async function GET(req: NextRequest) {
  const siteParam = req.nextUrl.searchParams.get('site');
  const site = siteParam && isSite(siteParam) ? siteParam : DEFAULT_SITE;
  try {
    const data = await fetchQuestions(site);
    if (!data) return NextResponse.json({ rounds: [] });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ rounds: [] });
  }
}
