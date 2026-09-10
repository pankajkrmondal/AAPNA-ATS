/**
 * Font packs — the typography axis of the design system.
 *
 * Before this file a font change meant editing four places that had no idea about
 * each other: the Google Fonts <link> in index.html, the `--font`/`--font-heading`/
 * `--mono` tokens in theme/index.css, the `fontFamily`/`fontFamilyCode` literals in
 * theme/themeConfig.js, and 36 hardcoded stacks scattered through JSX. A pack now
 * owns all of it — families, the weights actually loaded, the stylesheet URL, and
 * the type scale those families are set at.
 *
 * WHY THE SCALE LIVES HERE AND NOT IN THE PRESET
 * A type scale is not portable across families. Sora at 15px and system-ui at 15px
 * do not have the same x-height, and a ramp tuned for one reads wrong on the other.
 * Binding the scale to the pack means swapping the font swaps the numbers tuned for
 * it, which is the only way a font swap can be a one-line change and still look
 * deliberate. A preset picks a *mood*; a font pack picks a *voice and its metrics*.
 *
 * THE 12px FLOOR
 * The app previously set type at 9–13px — 194 uses of 11px, 57 of 10px, 21 of 9px,
 * plus half-pixel sizes (9.5/10.5/11.5/12.5/13.5). That is the single biggest reason
 * it read cramped and dated regardless of how good the surfaces were. No role here
 * goes below 12px, and no pack may add one.
 *
 * ADDING A PACK
 * Copy an entry, change `families`/`stacks`/`href`, tune `scale`. Every role listed
 * in the default pack must be present — resolveTokens emits one CSS variable trio
 * per role and a missing role leaves a dangling var(). See docs/design Part III.
 */

/**
 * @typedef {object} TypeRole
 * @property {string} size    CSS length, or a clamp() for fluid roles
 * @property {number} weight
 * @property {string} tracking  letter-spacing
 * @property {number} lh        unitless line-height
 */

/**
 * The role vocabulary, in the order it is emitted. Every pack's `scale` is checked
 * against this list at resolve time, so a typo surfaces as a console warning during
 * development rather than as an invisible dangling variable in production.
 */
export const TYPE_ROLES = [
  'display', 'title1', 'title2', 'title3', 'headline',
  'body', 'callout', 'subhead', 'footnote', 'caption',
  'metricLg', 'metricMd', 'metricSm',
];

/**
 * Inter + Sora + DM Mono — what the app already loads. Sora carries display and
 * headings, Inter carries text, DM Mono carries numbers.
 *
 * The negative tracking on the large roles is what makes big type read as designed
 * rather than merely big; the positive tracking on `caption` is the opposite move,
 * because uppercase micro-labels need air between letters to stay legible.
 */
const interSora = {
  id: 'inter-sora',
  name: 'Inter + Sora',
  description: 'The current pairing. Geometric display over a neutral text face.',
  families: { display: 'Sora', body: 'Inter', mono: 'DM Mono' },
  stacks: {
    display: "'Sora', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    // Inter has no separate small optical cut, so this is the body stack. The role
    // still exists on every pack so components can reference it unconditionally.
    small: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    mono: "'DM Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  },
  href: 'https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&family=Inter:wght@300;400;500;600;700&family=Sora:wght@100..800&display=swap',
  scale: {
    // Fluid so the large title behaves on a 1366-wide laptop and on a 27" panel.
    display: { size: 'clamp(30px, 2.7vw, 44px)', weight: 800, tracking: '-0.035em', lh: 1.1 },
    title1: { size: '32px', weight: 800, tracking: '-0.03em', lh: 1.15 },
    title2: { size: '24px', weight: 700, tracking: '-0.02em', lh: 1.2 },
    title3: { size: '20px', weight: 700, tracking: '-0.015em', lh: 1.3 },
    headline: { size: '17px', weight: 600, tracking: '-0.01em', lh: 1.35 },
    body: { size: '15px', weight: 400, tracking: '0', lh: 1.55 },
    callout: { size: '14px', weight: 400, tracking: '0', lh: 1.5 },
    subhead: { size: '13px', weight: 500, tracking: '0', lh: 1.45 },
    footnote: { size: '12px', weight: 400, tracking: '0', lh: 1.4 },
    caption: { size: '12px', weight: 600, tracking: '0.05em', lh: 1.35 },
    metricLg: { size: '44px', weight: 800, tracking: '-0.035em', lh: 1 },
    metricMd: { size: '32px', weight: 800, tracking: '-0.03em', lh: 1.05 },
    metricSm: { size: '24px', weight: 800, tracking: '-0.02em', lh: 1.1 },
  },
};

/**
 * A single-family pack. Proves the resolver does not assume three distinct families,
 * and is the shape most modern product UIs actually ship.
 *
 * Figtree stands in for Geist here because Geist is not on Google Fonts and this app
 * has no self-hosted font pipeline — same brief (neutral geometric grotesque with a
 * true mono companion), same one-line swap if a self-hosted pipeline arrives later.
 * Sizes run marginally larger than the Sora pack: Figtree's x-height is smaller, so
 * matching optical size means adding a point at the text roles.
 */
const figtree = {
  id: 'figtree',
  name: 'Figtree',
  description: 'One family across display and text. Neutral, contemporary, dense.',
  families: { display: 'Figtree', body: 'Figtree', mono: 'JetBrains Mono' },
  stacks: {
    display: "'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    body: "'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    small: "'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  },
  href: 'https://fonts.googleapis.com/css2?family=Figtree:wght@300..900&family=JetBrains+Mono:wght@400;500;700&display=swap',
  scale: {
    display: { size: 'clamp(31px, 2.8vw, 45px)', weight: 800, tracking: '-0.03em', lh: 1.1 },
    title1: { size: '33px', weight: 800, tracking: '-0.028em', lh: 1.15 },
    title2: { size: '25px', weight: 700, tracking: '-0.02em', lh: 1.2 },
    title3: { size: '20px', weight: 700, tracking: '-0.015em', lh: 1.3 },
    headline: { size: '17px', weight: 600, tracking: '-0.008em', lh: 1.35 },
    body: { size: '15px', weight: 400, tracking: '0', lh: 1.55 },
    callout: { size: '14px', weight: 400, tracking: '0', lh: 1.5 },
    subhead: { size: '13px', weight: 500, tracking: '0', lh: 1.45 },
    footnote: { size: '12px', weight: 400, tracking: '0', lh: 1.4 },
    caption: { size: '12px', weight: 600, tracking: '0.045em', lh: 1.35 },
    metricLg: { size: '46px', weight: 800, tracking: '-0.03em', lh: 1 },
    metricMd: { size: '33px', weight: 800, tracking: '-0.026em', lh: 1.05 },
    metricSm: { size: '25px', weight: 800, tracking: '-0.02em', lh: 1.1 },
  },
};

/**
 * The native OS face — SF Pro on Apple, Segoe UI Variable on Windows 11, Roboto on
 * Android. THE DEFAULT PACK.
 *
 * WHY THIS IS A STACK AND NOT A WEBFONT, AND WHY IT CANNOT BE ONE
 * SF Pro is licensed to Apple platforms and Segoe UI to Windows. Neither may be
 * self-hosted or served from a CDN, so there is no version of this that downloads.
 * The native stack is the only sanctioned route, and it is also the better one: an
 * app set in the OS's own UI face reads as part of the system rather than as a web
 * page wearing a costume.
 *
 * THE CONSEQUENCE, STATED SO IT IS A CHOICE AND NOT A SURPRISE
 * The product renders in a different typeface per platform. A screenshot taken on
 * Windows will not match one taken on a Mac. For an internal ATS whose operators are
 * on Windows that is the right trade — but any pixel-comparison test has to be
 * pinned to one platform, and a design review has to say which one it was done on.
 *
 * STACK ORDER IS LOAD-BEARING
 * `Segoe UI Variable *` does not exist on macOS, so the stack falls through to
 * `-apple-system` and lands on SF Pro. `-apple-system` is not a recognised family on
 * Windows, so it is skipped and Segoe wins. Each OS therefore resolves its own face
 * with no UA sniffing and no JS. `Inter` sits near the end as the closest available
 * match for anything that is neither — it was designed as an SF-alike, so a Linux or
 * older-Windows user gets something in the same key rather than Arial.
 *
 * OPTICAL SIZES ARE THE POINT
 * Segoe UI Variable ships as three cuts and using them is most of what makes this
 * pack look considered rather than merely "system-ui". Display is drawn for large
 * sizes (tighter spacing, finer joins), Text for reading, Small for captions (looser
 * spacing, sturdier strokes so 12px stays legible). Apple's SF does the same thing
 * automatically via optical sizing, so naming SF Pro Display/Text mirrors it.
 */
const systemNative = {
  id: 'system-native',
  name: 'Native (SF / Segoe)',
  description: 'The OS UI face — SF Pro on Apple, Segoe UI Variable on Windows. No download.',
  families: { display: 'Segoe UI Variable Display / SF Pro', body: 'Segoe UI Variable Text / SF Pro', mono: 'Cascadia / SF Mono' },
  stacks: {
    display: "'Segoe UI Variable Display', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Inter, Roboto, system-ui, sans-serif",
    body: "'Segoe UI Variable Text', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, Roboto, system-ui, sans-serif",
    // The third optical cut. Applied by the .t-caption / .t-footnote roles only.
    small: "'Segoe UI Variable Small', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, Roboto, system-ui, sans-serif",
    mono: "ui-monospace, 'SF Mono', SFMono-Regular, 'Cascadia Mono', Consolas, 'Segoe UI Mono', Menlo, monospace",
  },
  href: null,
  /**
   * Retuned for SF and Segoe, which are spaced tighter out of the box than Sora.
   * Carrying Sora's -0.04em display tracking over to them looked cramped rather than
   * confident, so the large roles come back toward -0.02em. Weights drop a step for
   * the same reason: Segoe UI Variable's 700 is optically heavier than Sora's 800,
   * and SF's 700 likewise, so asking for 800 here produces a smear at display size.
   */
  scale: {
    display: { size: 'clamp(30px, 2.8vw, 44px)', weight: 700, tracking: '-0.02em', lh: 1.1 },
    title1: { size: '32px', weight: 700, tracking: '-0.018em', lh: 1.16 },
    title2: { size: '24px', weight: 600, tracking: '-0.014em', lh: 1.22 },
    title3: { size: '20px', weight: 600, tracking: '-0.01em', lh: 1.3 },
    headline: { size: '17px', weight: 600, tracking: '-0.006em', lh: 1.35 },
    body: { size: '15px', weight: 400, tracking: '0', lh: 1.55 },
    callout: { size: '14px', weight: 400, tracking: '0', lh: 1.5 },
    subhead: { size: '13px', weight: 500, tracking: '0', lh: 1.45 },
    footnote: { size: '12px', weight: 400, tracking: '0.005em', lh: 1.4 },
    // Uppercase micro-labels need air between letters or they set solid; the Small
    // optical cut plus positive tracking is what keeps 12px caps readable.
    caption: { size: '12px', weight: 600, tracking: '0.055em', lh: 1.35 },
    metricLg: { size: '46px', weight: 700, tracking: '-0.022em', lh: 1 },
    metricMd: { size: '33px', weight: 700, tracking: '-0.018em', lh: 1.05 },
    metricSm: { size: '25px', weight: 700, tracking: '-0.014em', lh: 1.1 },
  },
};

export const FONT_PACKS = {
  'system-native': systemNative,
  'inter-sora': interSora,
  figtree,
};

/**
 * Inter + Sora is the shipped default as of 2026-08-31; native and figtree stay
 * switchable for comparison.
 *
 * Note what this ALSO moves: a pack carries its `scale`, not just its `stacks`, so
 * changing this line retunes weight, tracking and the three metric sizes app-wide
 * (46/33/25 -> 44/32/24). That is the intent — see the header on why a scale is not
 * portable across families — but it is why `scripts/verify/composition.mjs`'s RAMP is
 * keyed to whichever pack is default here, and has to move with this line.
 *
 * index.html's static <link> has always fetched this pack's stylesheet; until now
 * nothing rendered it.
 */
export const DEFAULT_FONT_PACK_ID = 'inter-sora';
export const FONT_STORAGE_KEY = 'ats_font_pack';

/**
 * Resolves which pack to use: a localStorage override, else the default. A function
 * rather than a constant for the same reason `resolveBrandId` is — a tenant or user
 * preference becomes another source here without touching callers.
 * @returns {string} a key of FONT_PACKS
 */
export function resolveFontPackId() {
  try {
    const stored = localStorage.getItem(FONT_STORAGE_KEY);
    if (stored && FONT_PACKS[stored]) return stored;
  } catch {
    /* storage unavailable (private mode) */
  }
  return DEFAULT_FONT_PACK_ID;
}

/** @param {string} id @returns {object} the pack, falling back to the default */
export function getFontPack(id) {
  return FONT_PACKS[id] || FONT_PACKS[DEFAULT_FONT_PACK_ID];
}

/**
 * Swaps the Google Fonts <link> to the active pack's stylesheet.
 *
 * The link is created once and its href mutated thereafter, rather than removed and
 * re-added: replacing the element drops the already-parsed faces for a frame and the
 * whole page reflows into the fallback and back. Mutating href lets the browser keep
 * painting the old faces until the new sheet is ready.
 *
 * A pack with `href: null` (the system pack) removes the link entirely — there is
 * nothing to fetch, and leaving a stale sheet loaded would keep webfonts in memory
 * that nothing renders.
 *
 * The href is also mirrored into localStorage so the anti-FOUC script in index.html
 * can restore it before first paint. Caching the resolved URL rather than teaching
 * that inline script about FONT_PACKS is what keeps the pack definitions in this one
 * file — the alternative is duplicating every URL into the HTML, where it would
 * drift the first time a pack changed.
 *
 * @param {object} pack a FONT_PACKS entry
 */
export const FONT_LINK_ID = 'ats-font-pack';
export const FONT_HREF_STORAGE_KEY = 'ats_font_href';

export function applyFontStylesheet(pack) {
  let link = document.getElementById(FONT_LINK_ID);

  try {
    localStorage.setItem(FONT_HREF_STORAGE_KEY, pack.href || '');
  } catch {
    /* storage unavailable — costs a font flash on reload, nothing more */
  }

  if (!pack.href) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== pack.href) link.setAttribute('href', pack.href);
}

export default FONT_PACKS;
