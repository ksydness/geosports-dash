// Deterministic mock data for the demo dashboard.
// No real player names or scores — purely illustrative.

export interface DemoScore {
  date: string;
  username: string;
  score: number;
  rawScores: number[];
}

const PLAYERS = [
  { name: 'Alex',   skill: 0.88 },
  { name: 'Jordan', skill: 0.80 },
  { name: 'Sam',    skill: 0.73 },
  { name: 'Riley',  skill: 0.67 },
  { name: 'Casey',  skill: 0.60 },
  { name: 'Morgan', skill: 0.52 },
];

const MULTIPLIERS = [1, 1, 2, 3, 3];

// Simple seeded pseudo-random (no external deps)
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function generateDemoData(): DemoScore[] {
  const scores: DemoScore[] = [];
  const today = new Date();
  // Generate 35 days of history so all tabs have data
  for (let dayOffset = 34; dayOffset >= 0; dayOffset--) {
    const d = new Date(today);
    d.setDate(today.getDate() - dayOffset);
    const dateStr = toDateStr(d);

    PLAYERS.forEach((player, pi) => {
      // Seed combines player index, day offset, and a salt so each is unique
      const rand = seeded((pi + 1) * 97 + dayOffset * 13 + 42);

      // ~15% chance the player skips a day (more for lower-skill players)
      const skipChance = 0.10 + (1 - player.skill) * 0.12;
      if (rand() < skipChance) return;

      // Raw score per question: normally distributed around skill × 100
      const raw = MULTIPLIERS.map((_, qi) => {
        const base = player.skill * 100;
        // add some noise scaled by question index
        const noise = (rand() - 0.5) * 35 + (rand() - 0.5) * 20;
        // Every few days a player aces or tanks a question
        const lucky = rand() < 0.12 ? (rand() < 0.5 ? 40 : -40) : 0;
        return clamp(Math.round(base + noise + lucky), 0, 100);
      });

      const score = raw.reduce((sum, r, i) => sum + r * MULTIPLIERS[i], 0);

      scores.push({ date: dateStr, username: player.name, score, rawScores: raw });
    });
  }
  return scores;
}

export const DEMO_GROUP_NAME = 'The Globetrotters';

// Demo map data — 5 fake geo questions with answer locations
export interface DemoGuess {
  answer: { lat: number; lng: number; name: string; story: string };
}

export const DEMO_QUESTIONS = [
  'Where is the Eiffel Tower located?',
  'Where is the Great Wall of China?',
  'Where is the Amazon River mouth?',
  'Where is Machu Picchu?',
  'Where is Mount Kilimanjaro?',
];

export const DEMO_GUESSES: DemoGuess[] = [
  { answer: { lat: 48.8584, lng: 2.2945, name: 'Paris, France', story: 'The Eiffel Tower was built in 1889 as the entrance arch for the 1889 World\'s Fair.' } },
  { answer: { lat: 40.4319, lng: 116.5704, name: 'Mutianyu, China', story: 'The Great Wall stretches over 13,000 miles and was built over many centuries to protect Chinese states.' } },
  { answer: { lat: -0.1667, lng: -50.0, name: 'Marajó Island, Brazil', story: 'The Amazon River discharges about 20% of all fresh water that flows into the world\'s oceans.' } },
  { answer: { lat: -13.1631, lng: -72.545, name: 'Machu Picchu, Peru', story: 'Machu Picchu was built by the Inca emperor Pachacuti in 1450 and abandoned during the Spanish conquest.' } },
  { answer: { lat: -3.0674, lng: 37.3556, name: 'Kilimanjaro, Tanzania', story: 'At 5,895 m, Kilimanjaro is Africa\'s highest peak and the world\'s tallest free-standing mountain.' } },
];
