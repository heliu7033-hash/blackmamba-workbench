import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('./build.mjs', import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mamba-cloud-preflight-'));
try {
  const output = path.join(cwd, 'dist');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'previous'), 'keep');
  const result = spawnSync(process.execPath, [script], {cwd, encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /缺少 .openai\/hosting.json/);
  assert.deepEqual(fs.readdirSync(output), ['previous']);
  assert.equal(fs.readFileSync(path.join(output, 'previous'), 'utf8'), 'keep');
  console.log('PASS: missing hosting manifest preserves previous build');
} finally {
  fs.rmSync(cwd, {recursive: true, force: true});
}
