import { useEffect } from "react";
import {
  SEO_BRAND,
  SEO_DEFAULT_DESCRIPTION,
  SEO_DEFAULT_KEYWORDS,
  SEO_DEFAULT_OG_IMAGE,
  SEO_DEFAULT_TITLE,
  SEO_LOCALE,
  SEO_TWITTER_CARD,
  absoluteUrl,
} from "@/lib/seo-config";

export interface SeoProps {
  /** Page-specific title; brand suffix is appended automatically unless `titleExact` is true. */
  title?: string;
  /** When true, use `title` verbatim without appending the brand suffix. */
  titleExact?: boolean;
  description?: string;
  /** Path used for canonical + og:url. Defaults to current `window.location.pathname`. */
  path?: string;
  keywords?: string[];
  /** When true, emits `noindex,nofollow` so the page is excluded from search results. */
  noindex?: boolean;
  /** Override the OG/Twitter image (relative to site origin or absolute URL). */
  image?: string;
  /** og:type — defaults to "website". */
  ogType?: "website" | "article";
}

function setMeta(attr: "name" | "property", key: string, value: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]`,
  );
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", value);
}

function setLink(rel: string, href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Declarative <head> manager. Mount inside any page to override the default
 * SEO metadata baked into `index.html`. Strictly metadata-only — never
 * touches application state, networking, or trading logic.
 *
 * Title-ownership contract: every route that mounts <Seo /> MUST also be
 * listed in `SEO_MANAGED_PATHS` (in `lib/seo-config.ts`). The Layout
 * fallback title-writer reads that allowlist and skips those paths, so this
 * component is the single deterministic owner of `document.title` on those
 * routes (no race against parent useEffect ordering).
 */
export function Seo(props: SeoProps): null {
  const {
    title,
    titleExact = false,
    description = SEO_DEFAULT_DESCRIPTION,
    path,
    keywords = SEO_DEFAULT_KEYWORDS,
    noindex = false,
    image = SEO_DEFAULT_OG_IMAGE,
    ogType = "website",
  } = props;

  useEffect(() => {
    const resolvedPath =
      path ?? (typeof window !== "undefined" ? window.location.pathname : "/");
    const canonical = absoluteUrl(resolvedPath);

    const fullTitle = title
      ? titleExact
        ? title
        : `${title} | ${SEO_BRAND}`
      : SEO_DEFAULT_TITLE;

    document.title = fullTitle;

    setMeta("name", "description", description);
    setMeta("name", "keywords", keywords.join(", "));
    const robotsValue = noindex
      ? "noindex,nofollow"
      : "index,follow,max-image-preview:large";
    setMeta("name", "robots", robotsValue);
    // Mirror to the Google-specific directive too. `index.html` ships with a
    // hardcoded `googlebot=index,follow` baseline meant for the public landing;
    // without this mirror, a noindex Seo would leave googlebot=index intact and
    // weaken defense-in-depth on owner-only pages.
    setMeta("name", "googlebot", robotsValue);

    setLink("canonical", canonical);

    const imageUrl = image.startsWith("http") ? image : absoluteUrl(image);

    setMeta("property", "og:title", fullTitle);
    setMeta("property", "og:description", description);
    setMeta("property", "og:url", canonical);
    setMeta("property", "og:type", ogType);
    setMeta("property", "og:site_name", SEO_BRAND);
    setMeta("property", "og:locale", SEO_LOCALE);
    setMeta("property", "og:image", imageUrl);

    setMeta("name", "twitter:card", SEO_TWITTER_CARD);
    setMeta("name", "twitter:title", fullTitle);
    setMeta("name", "twitter:description", description);
    setMeta("name", "twitter:image", imageUrl);
  }, [title, titleExact, description, path, keywords, noindex, image, ogType]);

  return null;
}
