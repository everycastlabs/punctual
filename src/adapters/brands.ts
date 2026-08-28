/**
 * The brand registry — one engine deployment, several domains.
 *
 * "I'm the tenant" (not multi-tenant): every domain below shares the exact
 * same single-tenant engine, the same D1/KV/R2, the same users and bookings.
 * Nothing here scopes data — it only resolves which skin and which identity
 * (name, colors, fonts, from-address) a given `Host` header gets. That is
 * why this is a plain compiled map, not a KV/D1 lookup: adding a domain is a
 * code change and a redeploy, the same way adding a Cloudflare Custom Domain
 * pointed at this Worker is.
 *
 * Exact-match only, deliberately: an unrecognized `Host` header falls through
 * to `DEFAULT_BRAND` (built from `wrangler.toml`'s own `[vars]`) rather than
 * being reflected into anything. `EngineConfig.baseUrl` gets embedded in
 * magic-link and manage-link emails, so resolving it by matching a known list
 * — rather than trusting whatever `Host` a request happened to carry — is
 * the whole defense against a spoofed header ending up in a link a guest or
 * host actually clicks.
 */

import type { BrandTheme } from '../ports.js'

export interface BrandConfig {
  baseUrl: string
  brandName: string
  legalOperator?: string
  fromEmail: string
  fromName: string
  supportEmail: string
  demoBookingPath?: string
  analyticsId?: string
  theme?: BrandTheme
}

/**
 * Real palettes pulled from each product's own design tokens (scoutsuite-app's
 * `apps/web/app/globals.css`, vcon-store-app-new's
 * `apps/web/src/app/globals.css`) — not eyeballed off a live site.
 *
 * vcon.store's brief already calls for IBM Plex Mono, already vendored for
 * Punctual's own default UI, so it needs no new font files. Scout Suite's
 * Sora/Public Sans are vendored below (`assets/fonts/sora-600.woff2`,
 * `publicsans-{400,600}.woff2`, latin subset) — copied byte-for-byte from
 * scoutsuite-app's own `apps/web/app/fonts/` (fetched there from Google
 * Fonts' CSS2 API per that folder's README), with `OFL-Sora.txt` and
 * `OFL-PublicSans.txt` added alongside, matching every other font here.
 * Only the weights Punctual's own CSS actually uses are vendored — 600 for
 * `--pu-font-display` (h1–h3 only, same as Schibsted Grotesk today), 400
 * and 600 for `--pu-font-ui` (body text; buttons/labels/day-names set
 * weight 600 explicitly) — same "no spare weights" discipline as the
 * default fonts.
 */
const SCOUT_SUITE_FONT_FACES = `
@font-face{font-family:"Sora";font-style:normal;font-weight:600;font-display:optional;
  src:url(/fonts/sora-600.woff2) format("woff2");
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Public Sans";font-style:normal;font-weight:400;font-display:optional;
  src:url(/fonts/publicsans-400.woff2) format("woff2");
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Public Sans";font-style:normal;font-weight:600;font-display:optional;
  src:url(/fonts/publicsans-600.woff2) format("woff2");
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
`

/** IBM Plex Mono is already vendored for Punctual's own default UI, so a brand that only wants that role kept unchanged just omits `fontMono`. */
export const BRANDS: Record<string, BrandConfig> = {
  'cal.scoutsuite.app': {
    baseUrl: 'https://cal.scoutsuite.app',
    brandName: 'Scout Suite',
    fromEmail: 'scheduling@scoutsuite.app',
    fromName: 'Scout Suite',
    supportEmail: 'support@scoutsuite.app',
    theme: {
      tokens: {
        inkPrimary: '#0B2532', // navy, from the Scout Suite logo
        inkSecondary: '#3C4A4F',
        paper: '#FCFCFC',
        paperDim: '#F5F5F5',
        line: '#E4E4E4',
        accent: '#365900', // WCAG-AA-safe dark green, tuned for white-on-fill buttons
        accentStrong: '#294300',
        accentFill: '#365900',
        accentFillHover: '#294300',
        accentTint: '#EDF2E4',
        signal: '#628835',
        danger: '#E54839', // from the Scout Suite logo
        dangerStrong: '#B93326',
        dangerText: '#CF4040',
        dangerTint: '#FBEAE8',
        fontDisplay: '"Sora",system-ui,-apple-system,sans-serif',
        fontUi: '"Public Sans",system-ui,-apple-system,"Segoe UI",sans-serif',
      },
      fontFaces: SCOUT_SUITE_FONT_FACES,
      fontPreloads: ['/fonts/publicsans-400.woff2', '/fonts/publicsans-600.woff2', '/fonts/sora-600.woff2'],
    },
  },
  'cal.vcon.store': {
    baseUrl: 'https://cal.vcon.store',
    brandName: 'vCon Store',
    fromEmail: 'scheduling@vcon.store',
    fromName: 'vCon Store',
    supportEmail: 'support@vcon.store',
    theme: {
      tokens: {
        // Ledger / printed-receipt palette — sharp corners, cream paper, ink.
        inkPrimary: '#1A1208',
        inkSecondary: '#6B5940',
        paper: '#F2EAD3',
        paperDim: '#E8DFC8',
        line: '#C4B499',
        accent: '#1A1208',
        accentStrong: '#000000',
        accentFill: '#1A1208',
        accentFillHover: '#000000',
        accentTint: '#DDD0B6',
        signal: '#1A4A1A',
        danger: '#8B2000',
        dangerStrong: '#6B1800',
        dangerText: '#8B2000',
        dangerTint: '#EAD9C0',
        fontUi: '"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace',
        fontDisplay: '"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace',
        radius: '0px',
        radiusLg: '0px',
      },
      darkBlockCss: `
@media (prefers-color-scheme:dark){
  :root:not([data-theme=light]){
    --pu-paper:#1A1208; --pu-paper-dim:#2E2416; --pu-line:#3D3020;
    --pu-ink-950:#F2EAD3; --pu-ink-500:#A8936E; --pu-green-700:#F2EAD3;
    --pu-green-800:#FFFFFF; --pu-green-tint:#2E2416; --pu-danger-text:#C44020;
    --pu-danger-tint:#3D3020; --pu-warn-text:#FBBF24; --pu-warn-tint:#3A2C12;
    --pu-shadow-sm:0 1px 2px rgba(0,0,0,.4);
    --pu-surface-raised:#221A0E;
    --pu-text-muted:rgba(168,147,110,.72); --pu-text-disabled:rgba(168,147,110,.45);
    --pu-surface-overlay:rgba(0,0,0,.6);
  }
}
:root[data-theme=dark]{
  --pu-paper:#1A1208; --pu-paper-dim:#2E2416; --pu-line:#3D3020;
  --pu-ink-950:#F2EAD3; --pu-ink-500:#A8936E; --pu-green-700:#F2EAD3;
  --pu-green-800:#FFFFFF; --pu-green-tint:#2E2416; --pu-danger-text:#C44020;
  --pu-danger-tint:#3D3020; --pu-warn-text:#FBBF24; --pu-warn-tint:#3A2C12;
  --pu-shadow-sm:0 1px 2px rgba(0,0,0,.4);
  --pu-surface-raised:#221A0E;
  --pu-text-muted:rgba(168,147,110,.72); --pu-text-disabled:rgba(168,147,110,.45);
  --pu-surface-overlay:rgba(0,0,0,.6);
}
`,
    },
  },
}

/**
 * The env shape `resolveBrand` reads for the fallback/default brand — a
 * subset of `src/index.ts`'s `Env`, kept separate so this file doesn't
 * import the Worker entry point.
 */
export interface DefaultBrandEnv {
  BASE_URL: string
  BRAND_NAME?: string
  LEGAL_OPERATOR?: string
  DEMO_BOOKING_PATH?: string
  GA_MEASUREMENT_ID?: string
  FROM_EMAIL?: string
  FROM_NAME?: string
  SUPPORT_EMAIL?: string
}

/**
 * The `wrangler.toml`-driven brand — unchanged from how every field here
 * worked before this registry existed. Any `Host` not in `BRANDS` (the
 * deployment's own `*.workers.dev` URL, a preview deployment, `localhost`
 * during `wrangler dev`) gets this, so a self-hoster who wants exactly one
 * brand never has to touch this file at all.
 */
export function defaultBrand(env: DefaultBrandEnv): BrandConfig {
  return {
    baseUrl: env.BASE_URL,
    brandName: env.BRAND_NAME ?? 'Punctual',
    ...(env.LEGAL_OPERATOR ? { legalOperator: env.LEGAL_OPERATOR } : {}),
    ...(env.DEMO_BOOKING_PATH ? { demoBookingPath: env.DEMO_BOOKING_PATH } : {}),
    ...(env.GA_MEASUREMENT_ID ? { analyticsId: env.GA_MEASUREMENT_ID } : {}),
    fromEmail: env.FROM_EMAIL ?? 'hello@example.com',
    fromName: env.FROM_NAME ?? 'Punctual',
    supportEmail: env.SUPPORT_EMAIL ?? 'hello@example.com',
  }
}

/**
 * `host` is `null` for the two callers with no live request (the queue
 * consumer and the scheduled-tasks cron, see `src/index.ts`) — both fall
 * back to the default brand, same as an unrecognized `Host` does. See
 * `EmailMessage.from`/`fromName` for how a queued booking email still gets
 * the RIGHT brand's from-address despite that.
 */
export function resolveBrand(host: string | null, env: DefaultBrandEnv): BrandConfig {
  if (host) {
    const brand = BRANDS[host.toLowerCase()]
    if (brand) return brand
  }
  return defaultBrand(env)
}
