import { NextRequest, NextResponse } from 'next/server';
import { fetchMyGroups } from '@/lib/geosports';
import { Site, isSite, DEFAULT_SITE } from '@/lib/sites';

/**
 * POST { site, token } → validate a session key against its game and return
 * the caller's groups so the connect flow can offer a group picker instead of
 * making users find their group code.
 *
 * Stateless: nothing is stored — registration happens later via /api/register.
 */
export async function POST(req: NextRequest) {
  let body: { site?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const site: Site = body.site && isSite(body.site) ? body.site : DEFAULT_SITE;
  const token = (body.token || '').trim();
  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  try {
    const groups = await fetchMyGroups(token, site);
    return NextResponse.json({
      site,
      groups: groups.map(g => ({ code: g.code, name: g.name, memberCount: g.memberCount })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not verify session key';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
