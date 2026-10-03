import { readFile } from 'node:fs/promises';
import { checkOperationBackend } from '../src/operations/backend-contract.ts';

const source = process.argv.find((arg) => arg.startsWith('--source='))?.slice('--source='.length)
  ?? 'https://api.arcmira.com/v1/openapi.json';
let document: unknown;
if (source.startsWith('https:')) {
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Could not verify operation backend: HTTP ${response.status}`);
  document = await response.json();
} else document = JSON.parse(await readFile(source, 'utf8'));
checkOperationBackend(document);
console.log('API advertises Premium existing-credit enforcement. Verify deployed behavior before release.');
