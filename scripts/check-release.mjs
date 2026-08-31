import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
assert.match(pkg.version,/^(?!0\.0\.0(?:-|$))\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/,'Set a real semantic release version');
assert.equal(process.env.GITHUB_REF_NAME,`v${pkg.version}`,'Tag must match package.json');
assert.notEqual(pkg.private,true,'A maintainer must explicitly enable npm publishing in package.json');
console.log('Release version, tag and explicit publishing opt-in verified.');
