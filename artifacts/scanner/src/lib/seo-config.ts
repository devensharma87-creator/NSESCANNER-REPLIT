export const SEO_BRAND = "Market Scanner by Dev";

export const SEO_SITE_ORIGIN = "https://marketscannerbydev.in";

export const SEO_DEFAULT_TITLE =
  "Market Scanner by Dev | NSE, F&O & Options Analytics for Indian Traders";

export const SEO_DEFAULT_DESCRIPTION =
  "Market Scanner by Dev is an Indian market analytics platform for NSE/BSE traders with equity scanners, F&O signals, option-chain analytics, strategy builder, paper trading, market breadth, and risk dashboards. For educational and research use only.";

export const SEO_DEFAULT_KEYWORDS = [
  "NSE scanner",
  "Indian stock market scanner",
  "F&O scanner India",
  "options strategy builder India",
  "NSE option chain analytics",
  "paper trading India",
  "intraday stock scanner",
  "swing trading scanner India",
  "market breadth India",
  "FII DII data",
];

export const SEO_DEFAULT_OG_IMAGE = "/opengraph.jpg";

export const SEO_LOCALE = "en_IN";

export const SEO_TWITTER_CARD = "summary_large_image";

export function absoluteUrl(pathname: string): string {
  const trimmed = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${SEO_SITE_ORIGIN}${trimmed === "/" ? "/" : trimmed.replace(/\/$/, "")}`;
}

/**
 * Single source of truth for routes that mount the <Seo /> component
 * (and therefore own their own document.title / meta head). The Layout
 * fallback title-writer uses this to skip these paths and avoid racing
 * against Seo's child useEffect during SPA navigation.
 *
 * Add a new entry here whenever you mount <Seo /> on a new page.
 */
export const SEO_MANAGED_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/legal/disclaimer",
  "/legal/methodology",
  "/legal/terms",
  "/legal/privacy",
  "/paper-trading",
  "/paper-reports",
  "/kite",
  "/audit",
  "/status",
  "/admin",
  "/manifesto",
]);

export function isSeoManagedPath(pathname: string): boolean {
  return SEO_MANAGED_PATHS.has(pathname);
}
