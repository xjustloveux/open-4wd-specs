import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateHistoryIndexes } from './history-ledger.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const result = generateHistoryIndexes(repoRoot, { check });

console.log(JSON.stringify({ mode: check ? 'check' : 'write', ...result }, null, 2));
if (!result.ok) process.exit(1);
