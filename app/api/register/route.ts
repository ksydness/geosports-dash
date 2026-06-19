import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { supabase } from '@/lib/supabase';
import { encrypt } from '@/lib/crypto';
import { fetchGroupInfo, extractGroupName } from '@/lib/geosports';
import { backfillGroup } from '@/lib/sync';
import { Site, SITES, SITE_KEYS, isSite } from '@/lib/sites';

// Backfill takes ~20s per site — allow up to 60s.
export const maxDuration = 60;

const GROUP_CODE_RE = /^[A-Z0-9]{3,10}$/;

/**
 * Register (or update) a group across one or more sites.
 *
 * Body accepts either:
 *   { group_code, tokens: { geosports?, geohistory?, geofooty? }, email? }
 *   { group_code, session_token, site? }   // legacy single-token (defaults to geosports)
 *
 * Each provided token is validated against its site, then stored per-site in
 * group_sites. Existing sites not mentioned are left untouched — so this also
 * powers "add another game later" and "update an expired token".
 */
export async function POST(req: NextRequest) {
  let body: {
    group_code?: string;
    session_token?: string;
    site?: string;
    tokens?: Record<string, string>;
    email?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { group_code, session_token, email } = body;
  if (!group_code) {
    return NextResponse.json({ error: 'group_code is required' }, { status: 400 });
  }

  const code = group_code.trim().toUpperCase();
  if (!GROUP_CODE_RE.test(code)) {
    return NextResponse.json(
      { error: 'Invalid group code — expected 3-10 letters/numbers' },
      { status: 400 }
    );
  }

  // Normalise to a { site -> token } map.
  const tokens: Partial<Record<Site, string>> = {};
  if (body.tokens && typeof body.tokens === 'object') {
    for (const [k, v] of Object.entries(body.tokens)) {
      if (isSite(k) && typeof v === 'string' && v.trim()) tokens[k] = v.trim();
    }
  }
  if (session_token && session_token.trim()) {
    const legacySite = body.site && isSite(body.site) ? body.site : 'geosports';
    tokens[legacySite] = session_token.trim();
  }

  const providedSites = Object.keys(tokens) as Site[];
  if (providedSites.length === 0) {
    return NextResponse.json(
      { error: 'Provide at least one site session token' },
      { status: 400 }
    );
  }

  // Validate every provided token against its site, collecting the group name.
  // Prefer the geosports name, else the first site that returns one.
  let groupName: string | null = null;
  for (const site of providedSites) {
    try {
      const info = await fetchGroupInfo(code, tokens[site]!, site);
      const name = extractGroupName(info);
      if (name && (site === 'geosports' || !groupName)) groupName = name;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `Failed to verify ${SITES[site].label} credentials`;
      return NextResponse.json({ error: message, site }, { status: 401 });
    }
  }
  groupName = groupName || code;

  // Upsert the group row (shared metadata). Only overwrite the legacy
  // session_token column when a geosports token was provided.
  const groupRow: Record<string, unknown> = {
    group_code: code,
    group_name: groupName,
    active: true,
  };
  if (email?.trim()) groupRow.email = email.trim();
  if (tokens.geosports) groupRow.session_token = encrypt(tokens.geosports);

  const { error: groupErr } = await supabase
    .from('groups')
    .upsert(groupRow, { onConflict: 'group_code' });
  if (groupErr) {
    console.error('Supabase groups upsert error:', groupErr);
    return NextResponse.json({ error: 'Failed to save group' }, { status: 500 });
  }

  // Upsert each provided site connection (re-activates on token update).
  const siteRows = providedSites.map(site => ({
    group_code: code,
    site,
    session_token: encrypt(tokens[site]!),
    active: true,
  }));
  const { error: sitesErr } = await supabase
    .from('group_sites')
    .upsert(siteRows, { onConflict: 'group_code,site' });
  if (sitesErr) {
    console.error('Supabase group_sites upsert error:', sitesErr);
    return NextResponse.json({ error: 'Failed to save site connections' }, { status: 500 });
  }

  // Backfill each provided site in the background.
  for (const site of providedSites) {
    waitUntil(
      backfillGroup(code, tokens[site]!, site).catch(err =>
        console.error(`Registration backfill failed for ${code}/${site}:`, err)
      )
    );
  }

  return NextResponse.json({
    group_code: code,
    group_name: groupName,
    connected: providedSites,
    url: `/g/${code}`,
  });
}

// Expose the canonical site list for the UI (label/accent/emoji/cookie name).
export async function GET() {
  return NextResponse.json({
    sites: SITE_KEYS.map(k => ({
      key: k,
      label: SITES[k].label,
      base: SITES[k].base,
      cookieName: SITES[k].cookieNames[0],
      accent: SITES[k].accent,
      emoji: SITES[k].emoji,
    })),
  });
}
