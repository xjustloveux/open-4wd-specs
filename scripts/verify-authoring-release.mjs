import { verifyPreparedAuthoringRelease } from './authoring-release.mjs';

const index = process.argv.indexOf('--output');
if (index < 0 || !process.argv[index + 1]) throw new Error('usage: node verify-authoring-release.mjs --output <directory>');
const manifest = await verifyPreparedAuthoringRelease(process.argv[index + 1]);
console.log(JSON.stringify(manifest));
