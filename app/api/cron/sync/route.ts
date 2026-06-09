import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { decrypt } from '@/lib/crypto';
import { fetchDayScores } from '@/lib/geosports';

export async function GET(req: NextRequest) {
  // Vercel cron sends Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: groups, error } = await supabase
    .from('groups')
    .select('group_code, session_token')
    .eq('active', true);

  if (error || !groups) {
    return NextResponse.json({ error: 'Failed to fetch groups' }, { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const results: { group_code: string; synced?: number; error?: string }[] = [];

  for (const group of groups) {
    try {
      const token = decrypt(group.session_token);
      const played = await fetchDayScores(group.group_code, token, today);

      if (played && played.length > 0) {
        await supabase.from('scores').upsert(
          played.map(s => ({
            group_code: group.group_code,
            date: today,
            username: s.username,
            score: s.score,
            raw_scores: s.rawScores ?? null,
          })),
          { onConflict: 'group_code,date,username' }
        );
      }

      await supabase
        .from('groups')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('group_code', group.group_code);

      results.push({ group_code: group.group_code, synced: played?.length ?? 0 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';

      // Deactivate group if session has expired
      if (message.includes('Not authenticated') || message.includes('Invalid session')) {
        await supabase
          .from('groups')
          .update({ active: false })
          .eq('group_code', group.group_code);
      }

      results.push({ group_code: group.group_code, error: message });
    }
  }

  return NextResponse.json({ date: today, results });
}
