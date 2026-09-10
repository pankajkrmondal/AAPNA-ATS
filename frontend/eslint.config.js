/**
 * ESLint — the design-system contract, enforced.
 *
 * WHY THIS FILE EXISTS
 * `eslint` has been a devDependency of this project with no config and no script, so
 * it had never run. Meanwhile the codebase accumulated ~1,915 inline style objects,
 * 28 distinct inline font sizes and 12 button treatments across 224 call sites. The
 * design system's rules were real and written down; nothing checked them. That is the
 * difference between a convention and a contract.
 *
 * NO PLUGINS, DELIBERATELY.
 * Every rule below is core `no-restricted-syntax` with an esquery selector. Adding
 * eslint-plugin-react et al. would mean new dependencies for rules we do not need —
 * and the design rules are the point here, not general React linting. Espree parses
 * JSX natively once `ecmaFeatures.jsx` is set.
 *
 * SEVERITY IS A RAMP, NOT A SWITCH.
 * Everything starts at `warn`. Turning these to `error` today would fail the build on
 * 1,915 pre-existing violations and the only rational response would be to delete the
 * config. Instead `npm run lint` reports a count that Stage 5 drives down, and each
 * directory graduates to `error` in the override block below as its routes convert.
 * `src/ui` is already at error — it is new code and has no debt to grandfather.
 */

/** Style properties that must come from a token, not an inline literal. */
const BANNED_STYLE_PROPS = [
  'fontSize', 'fontFamily', 'fontWeight', 'letterSpacing',
  'background', 'backgroundColor', 'boxShadow',
  'borderRadius', 'border', 'height', 'color',
];

const inlineStyleSelector = `JSXAttribute[name.name='style'] ObjectExpression > Property[key.name=/^(${BANNED_STYLE_PROPS.join('|')})$/]`;

const designRules = {
  'no-restricted-syntax': ['warn',
    {
      selector: inlineStyleSelector,
      message:
        'Inline style property: no stylesheet can override this, so a preset, a tenant brand '
        + 'and the density axis can never reach it. Use a class from src/ui or theme/, or pass '
        + 'a data-derived value as a CSS custom property (the --stat-color / --ui-accent pattern).',
    },
    {
      // Raw colour literals. The brand axis works by swapping tokens; a hex is invisible to it.
      selector: "Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
      message:
        'Raw hex colour. Per-organization theming swaps tokens, so a hardcoded colour cannot '
        + 'follow a tenant brand or a theme. Use a token (--brand-*, --text-*, --kpi-*, --status-*).',
    },
    {
      // The specific drift that defeated DM Mono on 30 call sites.
      selector: "Property[key.name='fontFamily'] > Literal[value=/monospace/]",
      message: "Use var(--mono). A bare 'monospace' resolves to the browser default, not DM Mono.",
    },
  ],
};

/**
 * A no-op stand-in for `react-hooks`, whose rules this project does not install.
 *
 * Existing source carries 11 `// eslint-disable-next-line react-hooks/exhaustive-deps`
 * comments. ESLint 9 treats a disable comment naming an unknown rule as an ERROR, so
 * without this every lint run would exit non-zero for reasons that have nothing to do
 * with the design contract — and a lint nobody can get to green is a lint that gets
 * deleted.
 *
 * This registers the rule name so those comments resolve, and does no checking. It is
 * NOT hook linting and does not pretend to be; installing eslint-plugin-react-hooks is
 * a separate, worthwhile change. The stub exists so the design rules are the only
 * signal in the output.
 */
const reactHooksStub = {
  rules: {
    'exhaustive-deps': { create: () => ({}) },
    'rules-of-hooks': { create: () => ({}) },
  },
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', '**/*.min.js'],
  },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooksStub },
    // Those disable comments are now "unused" (the stub reports nothing). Saying so
    // on every one of them would be noise about a stub we introduced.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: designRules,
  },
  {
    /* The component layer is new code with no debt, so it holds the line at `error`.
       If src/ui violates the contract the contract is already lost — everything else
       is built on it. */
    files: [
      'src/ui/**/*.{js,jsx}',
      /* GRADUATED 2026-08-29. Every one of these is at zero, so `error` costs nothing
         today and is the only thing that keeps them there. This is step 6 of the
         rollout recipe, which was written down and then never performed for a single
         group — the whole app sat at `warn` while twelve routes were converted, so any
         of them could have silently regressed and none of the checks would have said
         so. The two files NOT listed are the retired ones (CandidatePipelinePrototype,
         StatCard): nothing renders them, and freezing dead code helps no one. */
      'src/pages/**/*.jsx',
      'src/layouts/**/*.jsx',
      'src/components/**/*.jsx',
      'src/context/**/*.jsx',
      'src/App.jsx',
    ],
    ignores: [
      'src/pages/CandidatePipelinePrototype.jsx',
      'src/components/common/StatCard.jsx',
      'src/pages/design-lab/**',
      'src/components/common/EmailBodyEditor/**',
    ],
    rules: {
      ...designRules,
      'no-restricted-syntax': ['error', ...designRules['no-restricted-syntax'].slice(1)],
    },
  },
  {
    /* Theme files DEFINE the tokens, so hex literals are their whole job. The inline
       -style rule still does not apply to them (they are not JSX). */
    files: ['src/theme/**/*.js'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    /* Email HTML is sent to mail clients, which support neither CSS variables nor a
       stylesheet — inline styles and literal hexes are mandatory there, not a lapse. */
    files: [
      'src/utils/emailPreview.js',
      'src/components/common/EmailBodyEditor/**',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    /* PublicPageShell exports a frozen BRAND object, and its hexes are deliberate: it
       is consumed by the email preview and kept in step with
       backend/src/services/emailLayout.service.js — code that runs OUTSIDE a themed
       React tree, where a CSS variable cannot resolve. Its own rendering uses tokens;
       only the exported constants are literal. Same reason as the email files above,
       so only the raw-hex rule is lifted. */
    files: [
      'src/components/common/PublicPageShell.jsx',
      // ThemeContext holds two hexes as the <meta name="theme-color"> fallback for
      // FIRST PAINT — before any stylesheet has loaded there is no token to read, and
      // an unstyled browser chrome is worse than a stale one. The live path reads
      // --brand-primary / --ink from computed style, so a tenant brand does reach it.
      'src/context/ThemeContext.jsx',
    ],
    rules: {
      'no-restricted-syntax': ['warn',
        ...designRules['no-restricted-syntax'].slice(1).filter(
          (rule) => !String(rule.selector).includes('0-9a-fA-F'),
        ),
      ],
    },
  },
  {
    /* The gallery demonstrates alternatives side by side; showing today's 16px corner
       next to the new one requires writing 16px. Scoped, dev-only, never shipped. */
    files: ['src/pages/design-lab/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];
