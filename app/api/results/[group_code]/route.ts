import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { decrypt } from '@/lib/crypto';

const BASE = 'https://geosports.app';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ group_code: string }> }
) {
  const { group_code } = await params;
  const code = group_code.toUpperCase();
  const date = req.nextUrl.searchParams.get('date');

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 });
  }

  const { data: group, error } = await supabase
    .from('groups')
    .select('session_token, active')
    .eq('group_code', code)
    .single();

  if (error || !group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  let token: string;
  try {
    token = decrypt(group.session_token);
  } catch {
    return NextResponse.json({ error: 'Could not decrypt session token' }, { status: 500 });
  }

  const upstream = await fetch(`${BASE}/api/results/daily?date=${date}`, {
    headers: {
      Cookie: `__Secure-geosports.session_token=${token}`,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://geosports.app/',
      Origin: 'https://geosports.app',
    },
  });

  if (upstream.status === 404) {
    return NextResponse.json({ error: 'No results found for this date' }, { status: 404 });
  }
  if (upstream.status === 401 || upstream.status === 403) {
    return NextResponse.json({ error: 'Session token expired' }, { status: 401 });
  }
  if (!upstream.ok) {
    return NextResponse.json({ error: `Upstream error ${upstream.status}` }, { status: 502 });
  }

  const data = await upstream.json();
  return NextResponse.json(data);
}
