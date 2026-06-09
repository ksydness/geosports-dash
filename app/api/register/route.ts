import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { supabase } from '@/lib/supabase';
import { encrypt } from '@/lib/crypto';
import { fetchGroupInfo, fetchDayScores } from '@/lib/geosports';

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

  // Validate credentials and fetch group info from GeoSports
  let groupData;
  try {
    groupData = await fetchGroupInfo(code, token);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to verify credentials';
    return NextResponse.json({ error: message }, { status: 401 });
  }

  // Extract group name — try several possible field names
  const groupName =
    groupData.name ||
    groupData.groupName ||
    groupData.group_name ||
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
  waitUntil(backfillGroup(code, token));

  return NextResponse.json({
    group_code: code,
    group_name: groupName,
    url: `/g/${code}`,
  });
}

async function backfillGroup(groupCode: string, sessionToken: string) {
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);

    try {
      const played = await fetchDayScores(groupCode, sessionToken, date);
      if (!played || played.length === 0) continue;

      await supabase.from('scores').upsert(
        played.map(s => ({
          group_code: groupCode,
          date,
          username: s.username,
          score: s.score,
          raw_scores: s.rawScores ?? null,
        })),
        { onConflict: 'group_code,date,username' }
      );
    } catch (err) {
      console.error(`Backfill error for ${groupCode} on ${date}:`, err);
    }

    // Polite delay between requests
    await new Promise(r => setTimeout(r, 300));
  }

  // Mark last synced
  await supabase
    .from('groups')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('group_code', groupCode);
}
