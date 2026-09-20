// ---------- station art: 16×16 pixel sprites, Game Boy Colour style ----------
// Every sprite is 16 rows of 16 characters. "." is transparent; "0".."3" index that sprite's own
// four-colour palette, the way a GBC sprite gets one palette of four. No image files: a sprite is
// painted once onto a 16×16 canvas and cached as a data URL, then scaled up with
// `image-rendering: pixelated`, so the single index.html stays the only thing the site serves.
//
// Each module tile fills its whole 16×16 cell, plate and all — tile-based, like an overworld map —
// so colour 1 is the module's rim and you can tell the modules apart at a glance.

const OUT = "#0B1020"; // the shared near-black outline every sprite is drawn against

export const SPRITE_PALETTES = {
  floor: [OUT, "#1B2340", "#141B33", "#3E4F82"],
  locked: [OUT, "#161B2E", "#0F1426", "#2A3358"],
  dock: [OUT, "#3E4F82", "#7E8AA8", "#DDE3F5"],
  sm_solar: [OUT, "#7A4A00", "#E09A0C", "#FFDE7A"],
  sm_reactor: [OUT, "#0B5A3A", "#22A86B", "#7BE8A8"],
  sm_garden: [OUT, "#1E5E1E", "#4FB04F", "#B6F06B"],
  sm_scope: [OUT, "#14496B", "#3C9BD6", "#9BE0F7"],
  sm_dish: [OUT, "#3A2A6B", "#7A5CD6", "#C3B4F7"],
  sm_quarters: [OUT, "#6B1E4A", "#D64F8F", "#F7B4D2"],
};

export const STATION_SPRITES = {
  // an earned but empty plot: a bare deck plate with a bolt in each corner
  floor: [
    "0000000000000000",
    "0111111111111110",
    "0132222222222310",
    "0122222222222210",
    "0122222222222210",
    "0122222222222210",
    "0122222222222210",
    "0122222222222210",
    "0122222222222210",
    "0122222222222210",
    "0122222222222210",
    "0122222222222210",
    "0122222222222210",
    "0132222222222310",
    "0111111111111110",
    "0000000000000000",
  ],
  // not yet earned: the same plate gone dark, with a padlock on it
  locked: [
    "0000000000000000",
    "0111111111111110",
    "0122222222222210",
    "0122222222222210",
    "0122220000222210",
    "0122220220222210",
    "0122220220222210",
    "0122220220222210",
    "0122000000002210",
    "0122033333302210",
    "0122033003302210",
    "0122033003302210",
    "0122033333302210",
    "0122000000002210",
    "0111111111111110",
    "0000000000000000",
  ],
  // the Dock — an airlock hatch, the one room every station starts with; crew arrive through it
  dock: [
    "0000000000000000",
    "0111111111111110",
    "0100000000000010",
    "0102222002222010",
    "0102333003332010",
    "0102300003003010",
    "0102303303303010",
    "0102303303303010",
    "0102300003003010",
    "0102333003332010",
    "0102222002222010",
    "0100000000000010",
    "0111100110011110",
    "0111100000011110",
    "0111111111111110",
    "0000000000000000",
  ],
  // ☀️ Solar Array — a panel of cells over a squat mount
  sm_solar: [
    "0000000000000000",
    "0111111111111110",
    "0100000000000010",
    "0102332332332010",
    "0102332332332010",
    "0100000000000010",
    "0102332332332010",
    "0102332332332010",
    "0100000000000010",
    "0111122222211110",
    "0111112222111110",
    "0111111221111110",
    "0111111221111110",
    "0111100000011110",
    "0111111111111110",
    "0000000000000000",
  ],
  // 🔋 Power Core — a lit orb held in a square housing
  sm_reactor: [
    "0000000000000000",
    "0111111111111110",
    "0100000000000010",
    "0102222222222010",
    "0102200000022010",
    "0102033333302010",
    "0120333333330210",
    "0120333333330210",
    "0120333333330210",
    "0120333333330210",
    "0102033333302010",
    "0102200000022010",
    "0102222222222010",
    "0111000000001110",
    "0111111111111110",
    "0000000000000000",
  ],
  // 🌱 Hydroponics — a sprout under a glass dome
  sm_garden: [
    "0000000000000000",
    "0111111111111110",
    "0100000000000010",
    "0100330000330010",
    "0103333003333010",
    "0103333223333010",
    "0100333223330010",
    "0100003223000010",
    "0100000220000010",
    "0100000220000010",
    "0100000220000010",
    "0102222222222010",
    "0102333333332010",
    "0111022222201110",
    "0111111111111110",
    "0000000000000000",
  ],
  // 🔭 Observatory — a tube out of a dome, pointed up and out
  sm_scope: [
    "0000000000000000",
    "0111111111111110",
    "0100000000000010",
    "0100000000330010",
    "0100000003332010",
    "0100000033322010",
    "0100000333220010",
    "0100003332200010",
    "0100033322000010",
    "0100333220000010",
    "0100022222220010",
    "0102333333333010",
    "0102333333333010",
    "0111000000001110",
    "0111111111111110",
    "0000000000000000",
  ],
  // 📡 Comms Dish — a parabola on a stubby mast
  sm_dish: [
    "0000000000000000",
    "0111111111111110",
    "0100000000000010",
    "0100033333300010",
    "0100332222330010",
    "0103322002233010",
    "0103320000233010",
    "0103322002233010",
    "0100332222330010",
    "0100003333000010",
    "0100000220000010",
    "0100002222000010",
    "0100022222200010",
    "0111000000001110",
    "0111111111111110",
    "0000000000000000",
  ],
  // 🛏️ Crew Quarters — a habitat can with a lit window
  sm_quarters: [
    "0000000000000000",
    "0111111111111110",
    "0111000000001110",
    "0110222222220110",
    "0102233333322010",
    "0102330000332010",
    "0102303333032010",
    "0102303333032010",
    "0102330000332010",
    "0102233333322010",
    "0110222222220110",
    "0111000000001110",
    "0111022002201110",
    "0111100000011110",
    "0111111111111110",
    "0000000000000000",
  ],
};

// The crew: one astronaut drawn twice — legs apart, legs together — which is the whole Game Boy walk
// cycle. Colour 1 is the suit's shade and 2 the suit itself, so a crew member is this sprite in their
// own colour, the way a GBC game recolours one sprite for every trainer. 3 is the helmet.
export const CREW_FRAMES = [
  [
    "................",
    "......0000......",
    ".....033330.....",
    "....03333330....",
    "....03300030....",
    "....03000030....",
    "....03333330....",
    ".....000000.....",
    "....02222220....",
    "...0122222210...",
    "...0102222010...",
    "....01222210....",
    ".....011110.....",
    ".....01..10.....",
    ".....00..00.....",
    "................",
  ],
  [
    "................",
    "......0000......",
    ".....033330.....",
    "....03333330....",
    "....03300030....",
    "....03000030....",
    "....03333330....",
    ".....000000.....",
    "....02222220....",
    "...0122222210...",
    "...0102222010...",
    "....01222210....",
    ".....011110.....",
    "......0110......",
    "......0000......",
    "................",
  ],
];

// darken a hex colour by a factor — the suit's shadow side is the crew colour at 55%
const shade = (hex, f) => {
  const n = parseInt(String(hex).replace("#", ""), 16);
  if (Number.isNaN(n)) return "#000000";
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, "0");
  return "#" + c((n >> 16) & 255) + c((n >> 8) & 255) + c(n & 255);
};

// Both frames side by side on one 32×16 strip, so a CSS steps(2) animation on background-position
// walks it. Cached per colour: a family of six is six canvases, not six per render.
const crewCache = new Map();
export function crewURL(color) {
  const key = String(color || "#35E0FF").toLowerCase();
  if (crewCache.has(key)) return crewCache.get(key);
  if (typeof document === "undefined") return "";
  const pal = [OUT, shade(key, 0.55), key, "#F7F7E8"];
  const c = document.createElement("canvas");
  c.width = 32; c.height = 16;
  const g = c.getContext("2d");
  if (!g) return "";
  CREW_FRAMES.forEach((rows, f) => rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === ".") continue;
      g.fillStyle = pal[Number(ch)] || pal[0];
      g.fillRect(f * 16 + x, y, 1, 1);
    }
  }));
  let url = "";
  try { url = c.toDataURL("image/png"); } catch (e) { url = ""; }
  crewCache.set(key, url);
  return url;
}

// A sprite is painted once and kept as a data URL — six modules plus two plate states, so the whole
// board is eight <img> sources however many plots are on screen.
const spriteCache = new Map();
export function spriteURL(name) {
  if (spriteCache.has(name)) return spriteCache.get(name);
  const rows = STATION_SPRITES[name];
  const pal = SPRITE_PALETTES[name];
  if (!rows || !pal || typeof document === "undefined") return "";
  const c = document.createElement("canvas");
  c.width = 16; c.height = 16;
  const g = c.getContext("2d");
  if (!g) return "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === ".") continue;
      g.fillStyle = pal[Number(ch)] || pal[0];
      g.fillRect(x, y, 1, 1);
    }
  });
  let url = "";
  try { url = c.toDataURL("image/png"); } catch (e) { url = ""; }
  spriteCache.set(name, url);
  return url;
}

// every sprite is exactly 16×16 — a typo in the tables above would otherwise show as a torn tile
export function checkSprites() {
  const bad = [];
  Object.entries(STATION_SPRITES).forEach(([k, rows]) => {
    if (rows.length !== 16) bad.push(`${k}: ${rows.length} rows`);
    rows.forEach((r, i) => { if (r.length !== 16) bad.push(`${k} row ${i}: ${r.length} chars`); });
    if (!SPRITE_PALETTES[k]) bad.push(`${k}: no palette`);
  });
  CREW_FRAMES.forEach((rows, f) => {
    if (rows.length !== 16) bad.push(`crew frame ${f}: ${rows.length} rows`);
    rows.forEach((r, i) => { if (r.length !== 16) bad.push(`crew frame ${f} row ${i}: ${r.length} chars`); });
  });
  return bad;
}
