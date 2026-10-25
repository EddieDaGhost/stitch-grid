/**
 * The yarn palette.
 *
 * These 45 hex values are the ONE place in the codebase where a literal colour is
 * allowed. Everything else reads a CSS variable. The difference: these aren't theme,
 * they're *content* — each one stands for a physical ball of yarn sitting in a shop.
 * A theme may not recolour them any more than it may rename a colour the user bought.
 *
 * Names are deliberately generic. Brand colour names are trademarks, and a palette
 * pinned to one manufacturer's range rots the moment they discontinue a shade. The
 * entry shape leaves room for a `brand` field if that ever changes.
 *
 * `letter` is the chart symbol. Crochet charts are followed printed, often in black
 * and white, and often by someone who can't reliably tell Sage from Moss at a glance —
 * so every cell can carry its letter. Letters rather than a symbol font on purpose:
 * ZapfDingbats needs no /Encoding entry and silently renders letters if you give it
 * one, and that class of bug isn't worth the prettier glyph.
 *
 * Ids are permanent. Ownership, saved projects and shared links record a colour by id,
 * so renaming one changes what somebody else's saved chart means.
 */

export const PALETTE = [
  // --- Neutrals: the backbone of most blankets, and the hardest to match well.
  { id: 'snow', name: 'Snow', hex: '#F7F5F0', groups: ['neutral'] },
  { id: 'cream', name: 'Cream', hex: '#F2E8D5', groups: ['neutral'] },
  { id: 'ecru', name: 'Ecru', hex: '#E4D7BC', groups: ['neutral'] },
  { id: 'oatmeal', name: 'Oatmeal', hex: '#D3C4A6', groups: ['neutral'] },
  { id: 'linen', name: 'Linen', hex: '#BCAE93', groups: ['neutral'] },
  { id: 'fog', name: 'Fog', hex: '#B7BDC2', groups: ['neutral'] },
  { id: 'silver', name: 'Silver', hex: '#969DA5', groups: ['neutral'] },
  { id: 'slate', name: 'Slate', hex: '#656E77', groups: ['neutral'] },
  { id: 'charcoal', name: 'Charcoal', hex: '#3A4046', groups: ['neutral'] },
  { id: 'ink', name: 'Ink', hex: '#1D2023', groups: ['neutral'] },

  // --- Pastels: nursery blankets, which is a large share of what gets made.
  { id: 'blush', name: 'Blush', hex: '#F4CFCF', groups: ['pastel'] },
  { id: 'peach', name: 'Peach', hex: '#F8D5B6', groups: ['pastel'] },
  { id: 'butter', name: 'Butter', hex: '#F5E8AC', groups: ['pastel'] },
  { id: 'mint', name: 'Mint', hex: '#C2E5CE', groups: ['pastel'] },
  { id: 'sky', name: 'Sky', hex: '#BDD9ED', groups: ['pastel'] },
  { id: 'periwinkle', name: 'Periwinkle', hex: '#C4C8E9', groups: ['pastel'] },
  { id: 'lilac', name: 'Lilac', hex: '#DCC7E4', groups: ['pastel'] },
  { id: 'shell', name: 'Shell', hex: '#F1DDD3', groups: ['pastel'] },

  // --- Warms.
  { id: 'cherry', name: 'Cherry', hex: '#C6303A', groups: ['warm'] },
  { id: 'crimson', name: 'Crimson', hex: '#8C1F2D', groups: ['warm'] },
  { id: 'coral', name: 'Coral', hex: '#EE7B5E', groups: ['warm'] },
  { id: 'tangerine', name: 'Tangerine', hex: '#E8843C', groups: ['warm'] },
  { id: 'marigold', name: 'Marigold', hex: '#EFA92C', groups: ['warm'] },
  { id: 'mustard', name: 'Mustard', hex: '#C99524', groups: ['warm'] },
  { id: 'lemon', name: 'Lemon', hex: '#F1D74B', groups: ['warm'] },
  { id: 'rose', name: 'Rose', hex: '#D87B95', groups: ['warm'] },
  /*
    Pumpkin and Fuchsia are here because the warms above are all slightly *softened* —
    every one of them reads as a yarn shade rather than as an ink. That is right for a
    photograph and wrong for a logo, which is painted in saturated colour on purpose.
    Measured against the palette as it stood, a sports orange (#C83803) landed on
    Terracotta at a CIEDE2000 distance of 9.9 and a bright pink (#E6007E) on Cherry at
    18.6 — a chart in the wrong colour, not a near miss, since about 2.3 is the point
    where two colours stop looking the same. Both shades are ordinary solid worsted
    acrylic; nothing here asks for a yarn that is hard to buy.
  */
  { id: 'pumpkin', name: 'Pumpkin', hex: '#DC4810', groups: ['warm'] },
  { id: 'fuchsia', name: 'Fuchsia', hex: '#D4257F', groups: ['warm'] },

  // --- Earths. Skin tones live here too, which is why there are four of them.
  { id: 'terracotta', name: 'Terracotta', hex: '#B05C40', groups: ['earth'] },
  { id: 'rust', name: 'Rust', hex: '#94462A', groups: ['earth'] },
  { id: 'camel', name: 'Camel', hex: '#B08556', groups: ['earth'] },
  { id: 'chocolate', name: 'Chocolate', hex: '#5A3A2A', groups: ['earth'] },

  // --- Greens.
  { id: 'sage', name: 'Sage', hex: '#9BAE8C', groups: ['green'] },
  { id: 'grass', name: 'Grass', hex: '#6BA444', groups: ['green'] },
  { id: 'moss', name: 'Moss', hex: '#6D7E4D', groups: ['green'] },
  { id: 'forest', name: 'Forest', hex: '#2E5C39', groups: ['green'] },
  // The clean green of a football shirt. Grass is yellower and Moss is greyer, and a
  // kelly green landed 14 away from either — far enough to read as the wrong colour.
  { id: 'shamrock', name: 'Shamrock', hex: '#17874A', groups: ['green'] },

  // --- Cools.
  { id: 'seafoam', name: 'Seafoam', hex: '#7FC6B4', groups: ['cool'] },
  { id: 'turquoise', name: 'Turquoise', hex: '#34A7C3', groups: ['cool'] },
  { id: 'teal', name: 'Teal', hex: '#2B7977', groups: ['cool'] },
  { id: 'denim', name: 'Denim', hex: '#3E5F82', groups: ['cool'] },
  { id: 'navy', name: 'Navy', hex: '#22314D', groups: ['cool'] },
  { id: 'plum', name: 'Plum', hex: '#6C3460', groups: ['cool'] },
  // Royal and Violet, for the same reason as Pumpkin: Denim is a dusty mid blue and
  // Plum is a muted aubergine, so a bright royal and a true purple had nothing to land
  // on. Both are staple solid shades.
  { id: 'royal', name: 'Royal', hex: '#1A47A0', groups: ['cool'] },
  { id: 'violet', name: 'Violet', hex: '#542A90', groups: ['cool'] },
]

/**
 * Subsets a user can restrict matching to. `ids: null` means the whole palette.
 * Neutrals and pastels are the two people actually ask for by name — a greyscale
 * portrait and a baby blanket — so they're the two that ship.
 */
export const SUBSETS = [
  { id: 'all', label: 'All colours', groups: null },
  { id: 'neutrals', label: 'Neutrals', groups: ['neutral'] },
  { id: 'pastels', label: 'Pastels', groups: ['pastel', 'neutral'] },
]

const BY_ID = new Map(PALETTE.map((entry, index) => [entry.id, index]))

/** @returns {number} palette index, or -1 if the id is unknown. */
export function paletteIndex(id) {
  const index = BY_ID.get(id)
  return index === undefined ? -1 : index
}

/** @returns {number[]} the palette indices a subset allows, always non-empty. */
export function subsetIndices(subsetId) {
  const subset = SUBSETS.find((s) => s.id === subsetId) ?? SUBSETS[0]
  if (!subset.groups) return PALETTE.map((_, i) => i)
  const allowed = PALETTE.map((entry, i) =>
    entry.groups.some((g) => subset.groups.includes(g)) ? i : -1,
  ).filter((i) => i >= 0)
  // A subset that matched nothing would make the whole tool unusable. Fall back.
  return allowed.length ? allowed : PALETTE.map((_, i) => i)
}

/** Chart letters: A..Z, then AA, AB, ... Enough for any palette we'd ever ship. */
export function chartLetter(n) {
  let out = ''
  let i = n
  do {
    out = String.fromCharCode(65 + (i % 26)) + out
    i = Math.floor(i / 26) - 1
  } while (i >= 0)
  return out
}

/**
 * A hex somebody typed -> `#RRGGBB`, or null if it cannot be read as a colour.
 *
 * Forgiving on the way in and strict on the way out: a leading `#` is optional because
 * half the world copies colours with it and half without, and the three-digit shorthand
 * is accepted because it is what a person writes from memory. Uppercase on the way out
 * so the same colour typed two ways is one value — these strings end up in a settings
 * key and in a cache key, and `#aabbcc` and `#AABBCC` must not be two of anything.
 */
export function normalizeHex(value) {
  if (typeof value !== 'string') return null
  const body = value.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(body)) {
    return `#${body.split('').map((c) => c + c).join('').toUpperCase()}`
  }
  if (/^[0-9a-fA-F]{6}$/.test(body)) return `#${body.toUpperCase()}`
  return null
}

const STOCK_HEX = new Map(PALETTE.map((entry) => [entry.id, entry.hex.toUpperCase()]))

/** The stock shade of a palette id, uppercased. `null` for an unknown id. */
export function stockHex(id) {
  return STOCK_HEX.get(id) ?? null
}

/**
 * The colour this yarn is actually being crocheted in: the user's hex if they have
 * given one, the shop shade otherwise. The ONE place the UI should read a hex from, so
 * a swatch, a dropdown row and the chart can never disagree about what Pumpkin looks
 * like today.
 */
export function yarnHex(id, customHex) {
  return normalizeHex(customHex?.[id]) ?? stockHex(id) ?? '#000000'
}
