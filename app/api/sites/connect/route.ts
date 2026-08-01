import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { supabase } from '@/lib/supabase';
import { encrypt, decrypt } from '@/lib/crypto';
import { fetchGroupInfo } from '@/lib/geosports';
import { backfillGroup } from '@/lib/sync';
import { Site, SITES, isSite } from '@/lib/sites';

// Backfill takes ~20s — allow up to 60s (it runs via waitUntil after respond).
export const maxDuration = 60;

const GROUP_CODE_RE = /^[A-Z0-9]{3,10}$/;

/**
 * Extract the raw session id from a legacy signed-cookie value
 * (`<raw>.<signature>`, possibly URL-encoded). Returns null when the stored
 * token is already raw or doesn't look like a signed value.
 */
function rawTokenInside(stored: string): string | null {
  let t = stored;
  try {
    t = decodeURIComponent(stored);
  } catch {
    // not URL-encoded — use as-is
  }
  const dot = t.indexOf('.');
  if (dot === -1) return null;
  const raw = t.slice(0, dot);
  return /^[A-Za-z0-9]{20,64}$/.test(raw) ? raw : null;
}

/**
 * POST { group_code, site } → connect (or reconnect) a game using a key the
 * dashboard ALREADY has on file for another game. Session tokens are valid
 * across all three sites (shared backend, verified 2026-07-31), so adding a
 * game usually needs no new key at all.
 *
 * Tries each stored "donor" token (active rows first, geosports preferred)
 * against the target site; the first one that authenticates is saved as the
 * target's token and a 30-day backfill is kicked off. If none work (e.g.
 * GeoSports locks tokens to their origin site someday), responds
 * `{ needsKey: true }` so the UI falls back to the paste flow.
 */
export async function POST(req: NextRequest) {
  let body: { group_code?: string; site?: string; dry_run?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const code = (body.group_code || '').trim().toUpperCase();
  if (!GROUP_CODE_RE.test(code)) {
    return NextResponse.json({ error: 'Invalid group code' }, { status: 400 });
  }
  if (!body.site || !isSite(body.site)) {
    return NextResponse.json({ error: 'Invalid site' }, { status: 400 });
  }
  const target: Site = body.site;

  const { data: rows, error } = await supabase
    .from('group_sites')
    .select('site, session_token, active')
    .eq('group_code', code);
  if (error) {
    console.error('sites/connect: group_sites load failed:', error);
    return NextResponse.json({ error: 'Failed to load group' }, { status: 500 });
  }

  // Donor tokens from OTHER sites: active connections first, geosports first
  // within each bucket (it's the flagship and the most likely to be fresh).
  const donors = (rows || [])
    .filter(r => r.site !== target && r.session_token)
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        (a.site === 'geosports' ? -1 : b.site === 'geosports' ? 1 : 0)
    );

  if (donors.length === 0) {
    return NextResponse.json(
      { error: 'No existing key on file for this dashboard — paste a key instead.', needsKey: true },
      { status: 404 }
    );
  }

  for (const donor of donors) {
    let stored: string;
    try {
      stored = decrypt(donor.session_token);
    } catch {
      continue; // corrupt row — try the next donor
    }

    // Legacy cookie VALUES are `<raw>.<domain-signature>` (sometimes
    // URL-encoded) and the signature is site-locked — but the raw session id
    // inside is cross-site. Try the stored token as-is, then the raw part.
    const candidates = [stored];
    const raw = rawTokenInside(stored);
    if (raw) candidates.push(raw);

    for (const candidate of candidates) {
      try {
        // Validates the candidate against the TARGET game (throws if rejected).
        await fetchGroupInfo(code, candidate, target);
      } catch {
        continue; // rejected on the target — try the next candidate/donor
      }

      // Dry run: report that the connect WOULD succeed, but save nothing.
      if (body.dry_run) {
        return NextResponse.json({ ok: true, dryRun: true, site: target, via: donor.site, upgraded: candidate !== stored });
      }

      const { error: upErr } = await supabase.from('group_sites').upsert(
        {
          group_code: code,
          site: target,
          session_token: encrypt(candidate),
          active: true,
        },
        { onConflict: 'group_code,site' }
      );
      if (upErr) {
        console.error('sites/connect: upsert failed:', upErr);
        return NextResponse.json({ error: 'Failed to save connection' }, { status: 500 });
      }

      waitUntil(
        backfillGroup(code, candidate, target).catch(err =>
          console.error(`Instant-connect backfill failed for ${code}/${target}:`, err)
        )
      );

      return NextResponse.json({ ok: true, site: target, via: donor.site, upgraded: candidate !== stored });
    }
  }

  return NextResponse.json(
    {
      error: `This dashboard's existing key did not work for ${SITES[target].label} — paste a ${SITES[target].label} key instead.`,
      needsKey: true,
    },
    { status: 409 }
  );
}
