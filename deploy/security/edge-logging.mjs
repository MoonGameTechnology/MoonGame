import { readFileSync } from 'node:fs';

const BEGIN = '# BEGIN MOONGAME SECURITY ACCESS',
  END = '# END MOONGAME SECURITY ACCESS';
/** Only the Game site gets this logger. Existing APK, mTLS/operator and bot sites
 * are preserved. Output overrides are for isolated acceptance fixtures. */
export function withEdgeLogging(source, output = '/data/moongame-security/access.log') {
  if (typeof output !== 'string' || !/^\/[A-Za-z0-9_./-]+$/.test(output) || output.includes('..'))
    throw Error('E_SECURITY_EDGE_CONFIG');
  const block = readFileSync(new URL('../caddy/edge.caddy', import.meta.url), 'utf8')
    .trim()
    .replace('/data/moongame-security/access.log', output);
  if (source.includes(BEGIN)) {
    const start = source.indexOf(BEGIN),
      end = source.indexOf(END, start);
    if (end < 0 || source.indexOf(BEGIN, start + BEGIN.length) >= 0)
      throw Error('E_SECURITY_EDGE_CONFIG');
    return source.slice(0, start) + block + source.slice(end + END.length);
  }
  if (/import (?:\/etc\/caddy\/)?security\/edge\.caddy/.test(source))
    return source.replace(/import (?:\/etc\/caddy\/)?security\/edge\.caddy/, block);
  const matches = [...source.matchAll(/^\{\$DOMAIN\}\s*\{/gm)];
  if (matches.length !== 1) throw Error('E_SECURITY_EDGE_CONFIG');
  const at = matches[0].index + matches[0][0].length;
  return source.slice(0, at) + '\n' + block + '\n' + source.slice(at);
}

/** The protected host config imports from the signed Caddy image, so future logger
 * fixes arrive through the normal image pair instead of freezing a copied snippet. */
export function withEdgeImport(source) {
  const expanded = withEdgeLogging(source);
  const start = expanded.indexOf(BEGIN),
    end = expanded.indexOf(END, start);
  return (
    expanded.slice(0, start) +
    'import /etc/caddy/security/edge.caddy' +
    expanded.slice(end + END.length)
  );
}
