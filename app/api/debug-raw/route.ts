import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { decrypt } from '@/lib/crypto';

export const dynamic = 'force-dynamic';
const ACCESS_KEY = 'dbg_2c3bacfdb14affe6026c941df58ca4ff';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('key') !== ACCESS_KEY) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const code = (searchParams.get('code') || '').toUpperCase();
  const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('groups').select('session_token').eq('group_code', code).single();
  if (error || !data) return NextResponse.json({ error: 'group not found' }, { status: 404 });
  const token = decrypt(data.session_token);
  const res = await fetch(`https://geosports.app/api/groups/${code}?date=${date}`, {
    headers: {
      Cookie: `__Secure-geosports.session_token=${token}`,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://geosports.app/',
      'Origin': 'https://geosports.app',
    },
  });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return NextResponse.json({ status: res.status, date, body });
}
