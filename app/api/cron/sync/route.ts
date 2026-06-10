import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { AuthError } from '@/lib/geosports';
import { syncGroup } from '@/lib/sync';
import { todayET } from '@/lib/dates';

export async function GET(req: NextRequest) {
  // Vercel cron sends Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: groups, error } = await supabase
    .from('groups')
    .select('group_code, session_token')
    .eq('active', true);

  if (error || !groups) {
    return NextResponse.json({ error: 'Failed to fetch groups' }, { status: 500 });
  }

  const results: { group_code: string; synced?: number; error?: string; deactivated?: boolean }[] = [];

  for (const group of groups) {
    try {
      const synced = await syncGroup(group.group_code, group.session_token);
      results.push({ group_code: group.group_code, synced });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      // syncGroup already deactivated the group on AuthError
      results.push({
        group_code: group.group_code,
        error: message,
        deactivated: err instanceof AuthError,
      });
    }
  }

  return NextResponse.json({ date: todayET(), results });
}
