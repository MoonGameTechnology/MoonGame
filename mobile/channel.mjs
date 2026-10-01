// Packaging channel — WHERE the packaged APK takes its updates from (RUS-3,
// rustore-sector-zero-release-roadmap.md). One knob, `VOID_CHANNEL`, read by every
// packaging step, so the native bridge, the Gradle dependencies and the build identity
// baked into the web layer can never disagree:
//
//   github  (default) — the dev/player lanes: the in-app updater checks the rolling
//                       GitHub release; MainActivity carries the VoidNative.open bridge.
//   rustore           — the store build: RuStore In-App Updates SDK + the VoidRuStore
//                       bridge (patch-rustore.mjs). NO GitHub lane and no links to
//                       third-party APKs — the store forbids them.
//
// The channel is independent of the HTML profile (dev / player / Sector Zero): it says
// how the APK is updated, not what game it ships. An unknown value FAILS the build — a
// typo must never silently ship the GitHub lane inside a store APK.
export const CHANNELS = ['github', 'rustore'];

export function packagingChannel(env = process.env) {
  const raw = env.VOID_CHANNEL;
  if (raw === undefined || raw === '') return 'github';
  if (!CHANNELS.includes(raw)) {
    throw new Error(`VOID_CHANNEL must be one of: ${CHANNELS.join(', ')} — got "${raw}"`);
  }
  return raw;
}
