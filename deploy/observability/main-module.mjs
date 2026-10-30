import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Node resolves the main module URL, while argv keeps a deployment symlink.
 * Imports and node -e must remain free of CLI side effects. */
export function isMainModule(url) {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
}
