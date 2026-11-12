/**
 * Release check. A CHANGELOG entry can carry a marker such as <date the API refusal is live> for a fact known only
 * on the day of the release. Every release workflow (deploy, publish and the Tessl publish) runs this before it ships
 * anything, and it fails while any marker is left.
 *
 *   node --experimental-strip-types scripts/check-release.ts [CHANGELOG path]
 */
import { readFileSync } from 'node:fs';

const MARKER = /<date[^>]*>/g;

const path = process.argv[2] ?? new URL('../CHANGELOG.md', import.meta.url);
const markers = readFileSync(path, 'utf8').match(MARKER) ?? [];
if (markers.length > 0) {
  console.error(`The release check failed. The CHANGELOG still holds ${markers.join(', ')}. Write the date in its place before release.`);
  process.exit(1);
}
console.log('The release check passed. The CHANGELOG holds no unfilled date marker.');
