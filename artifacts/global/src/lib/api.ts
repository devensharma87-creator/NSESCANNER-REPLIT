import { setBaseUrl } from "@workspace/api-client-react";

/**
 * The api-server is mounted on the same proxy under `/api/*`. Same-origin →
 * no base URL prefix is required. Calling `setBaseUrl(null)` makes every
 * generated client emit relative paths.
 */
export function configureApiClient(): void {
  setBaseUrl(null);
}
