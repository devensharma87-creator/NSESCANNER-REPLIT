/**
 * Legacy `/indices` route — kept as a stable URL for any external bookmarks
 * or in-app deep links (e.g. stock-detail "view in indices" actions). The
 * full Markets fact-pack now lives inside the Home page (`/`), so this
 * route just redirects there.
 */
import { Redirect } from "wouter";

export default function IndicesRedirect() {
  return <Redirect to="/" />;
}
