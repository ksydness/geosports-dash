import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { supabase } from '@/lib/supabase';
import { encrypt } from '@/lib/crypto';
import { fetchGroupInfo } from '@/lib/geosports';
import { backfillGroup } from '@/lib/sync';

// Backfill takes ~20s — allow up to 60s (Vercel default 10s would kill it mid-run)
export const maxDuration = 60;

const GROUP_CODE_RE = /^[A-Z0-9]{3,10}$/;

export async function POST(req: NextRequest) {
  let body: { group_code?: string; session_token?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { group_code, session_token, email } = body;

  if (!group_code || !session_token) {
    return NextResponse.json(
      { error: 'group_code and session_token are required' },
      { status: 400 }
    );
  }

  const code = group_code.trim().toUpperCase();
  const token = session_token.trim();

  if (!GROUP_CODE_RE.test(code)) {
    return NextResponse.json(
      { error: 'Invalid group code — expected 3-10 letters/numbers' },
      { status: 400 }
    );
  }

  // Validate credentials and fetch group info from GeoSports
  let groupData;
  try {
    groupData = await fetchGroupInfo(code, token);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to verify credentials';
    return NextResponse.json({ error: message }, { status: 401 });
  }

  // Extract group name — try several possible field names
  const raw = groupData as Record<string, unknown>;
  const groupName =
    (raw.name as string) ||
    (raw.groupName as string) ||
    (raw.group_name as string) ||
    (raw.title as string) ||
    (raw.groupTitle as string) ||
    (raw.group_title as string) ||
    (raw.label as string) ||
    code;

  const encryptedToken = encrypt(token);

  const { error: upsertError } = await supabase.from('groups').upsert(
    {
      group_code: code,
      group_name: groupName,
      session_token: encryptedToken,
      email: email?.trim() || null,
      active: true,
    },
    { onConflict: 'group_code' }
  );

  if (upsertError) {
    console.error('Supabase upsert error:', upsertError);
    return NextResponse.json({ error: 'Failed to save group' }, { status: 500 });
  }

  // Backfill last 30 days in the background — doesn't block the response
  waitUntil(
    backfillGroup(code, token).catch(err =>
      console.error(`Registration backfill failed for ${code}:`, err)
    )
  );

  return NextResponse.json({
    group_code: code,
    group_name: groupName,
    url: `/g/${code}`,
  });
}
