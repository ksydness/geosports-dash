// GeoSports scoring, replicated locally for the dashboard's secret practice game.
//
// The live game scores each guess server-side (`/api/v2/play/guess`) as a
// distance-only curve: raw points 0-100 based purely on how many miles your
// tap is from the answer. We sampled that endpoint densely and baked the
// (miles -> raw points) curve below so the easter-egg game scores identically
// without calling GeoSports at play time. Values are exact at the sample
// points and linearly interpolated between them (rounded to an integer, as
// the real game returns integers).

const EARTH_RADIUS_MI = 3958.8;
const ANTIPODE_MI = 12450; // ~half Earth's circumference -> 0 points

// [milesOff, rawPoints], ascending by miles. Sampled from the live endpoint.
const CURVE: [number, number][] = [
  [0, 100], [50, 96], [100, 93], [150, 90], [200, 86], [250, 83], [300, 80],
  [350, 77], [400, 75], [450, 72], [500, 69], [550, 68], [600, 66], [650, 64],
  [700, 62], [750, 61], [800, 59], [850, 58], [900, 58], [950, 57], [1000, 56],
  [1100, 55], [1200, 54], [1300, 53], [1400, 52], [1500, 50], [1600, 49],
  [1800, 47], [2000, 45], [2200, 43], [2400, 41], [2600, 39], [2800, 37],
  [3000, 36], [3200, 34], [3400, 32], [3600, 31], [3800, 30], [4000, 28],
  [4200, 27], [4400, 26], [4600, 25], [4800, 23], [5000, 22], [5200, 21],
  [5400, 20], [5600, 20], [5800, 19], [6000, 18], [6500, 16], [7000, 14],
  [7500, 13], [8000, 11], [8500, 10], [9000, 9], [9500, 8], [10000, 7],
  [10500, 6], [11000, 6], [11500, 5], [12000, 4], [ANTIPODE_MI, 0],
];

/** Per-question multipliers for slots Q1..Q5 (perfect day = 1,000). */
export const MULTIPLIERS = [1, 1, 2, 3, 3];

/** Great-circle distance in miles between two lat/lng points. */
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLng = (lng2 - lng1) * toR;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Convert miles-off to raw points (0-100), matching the live GeoSports curve. */
export function milesToRawScore(miles: number): number {
  if (miles <= 0) return 100;
  if (miles >= ANTIPODE_MI) return 0;
  for (let i = 0; i < CURVE.length - 1; i++) {
    const [m1, p1] = CURVE[i];
    const [m2, p2] = CURVE[i + 1];
    if (miles >= m1 && miles <= m2) {
      return Math.round(p1 + ((miles - m1) / (m2 - m1)) * (p2 - p1));
    }
  }
  return 0;
}

/** Color + emoji tier for a raw score (matches GeoSports' how-it-works page). */
export function scoreTier(raw: number): { color: string; emoji: string } {
  if (raw >= 100) return { color: '#22c55e', emoji: '🟢' }; // perfect (glows)
  if (raw >= 90) return { color: '#4ade80', emoji: '🟢' };  // great
  if (raw >= 50) return { color: '#facc15', emoji: '🟡' };  // ballpark
  if (raw >= 1) return { color: '#f87171', emoji: '🔴' };   // miles off
  return { color: '#374151', emoji: '⚫' };                 // antipodal
}

/** Points along the great circle between two points, as [lng, lat] for GeoJSON. */
export function greatCirclePoints(
  lat1: number, lng1: number, lat2: number, lng2: number, n = 64
): number[][] {
  const toR = Math.PI / 180, toD = 180 / Math.PI;
  const p1 = lat1 * toR, l1 = lng1 * toR, p2 = lat2 * toR, l2 = lng2 * toR;
  const d =
    2 * Math.asin(Math.sqrt(
      Math.sin((p2 - p1) / 2) ** 2 +
      Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2
    ));
  if (d === 0) return [[lng1, lat1], [lng2, lat2]];
  const out: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    out.push([Math.atan2(y, x) * toD, Math.atan2(z, Math.sqrt(x * x + y * y)) * toD]);
  }
  return out;
}
