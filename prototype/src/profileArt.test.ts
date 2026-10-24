import { build } from 'esbuild';
import { expect, it } from 'vitest';

// The page build inlines SVG medals as data URLs (prototype/build.mjs), and the reward
// windows and the profile put those URLs into src="…" and url('…'): a raw quote mark cut
// the URL and the medal showed as a broken image.
it('the inlined medal art carries no raw quote marks', async () => {
  const out = await build({
    stdin: {
      contents: "export { CONTRIBUTION_MEDAL, TUTORIAL_MEDAL } from './profileArt';",
      resolveDir: __dirname,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'cjs',
    loader: { '.webp': 'empty', '.svg': 'dataurl' },
  });
  const module = { exports: {} as Record<string, string> };
  new Function('module', 'exports', out.outputFiles[0]!.text)(module, module.exports);
  for (const url of [module.exports.CONTRIBUTION_MEDAL!, module.exports.TUTORIAL_MEDAL!]) {
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
    expect(url).not.toMatch(/["']/);
  }
});
