/**
 * ZTP-1.1 — which build is running, readable from outside without logging into the host.
 *
 * `image.yml` bakes the commit into the image (`--build-arg GIT_SHA`), the runtime stage
 * exposes it as the `GIT_SHA` env var, and `/health` reports it. Only a SHORT hex sha
 * ever leaves the process: the env var is external input, so anything that is not a
 * plain commit id (a typo, a path, a token pasted into the wrong variable) is dropped,
 * not echoed — `/health` stays the contentless probe of audit F-13 plus one commit id.
 */
const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;

/** Length of the reported id — the same 12 chars `image.yml` uses for `:sha-<12>`. */
export const BUILD_VERSION_LENGTH = 12;

export function buildVersion(raw: string | undefined): string | undefined {
  const value = raw?.trim() ?? '';
  if (!COMMIT_SHA.test(value)) return undefined;
  return value.slice(0, BUILD_VERSION_LENGTH).toLowerCase();
}
