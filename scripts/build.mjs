import fs from 'node:fs';
import {readWebAssets} from './web-assets.mjs';

const manifestPath = '.openai/hosting.json';
function readManifest() {
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`云端打包缺少 ${manifestPath}。请恢复本项目原始 Sites 清单。本机工作台使用 npm run build。`);
  }
  const manifest = JSON.parse(raw);
  if (typeof manifest?.project_id !== 'string' || !manifest.project_id.trim() || manifest.static != null || !manifest.d1) {
    throw new Error('云端打包需要包含 project_id 和 D1 绑定的 Worker 托管清单。请核对本项目原始配置。');
  }
  return raw;
}

function buildCloud() {
  const manifest = readManifest();
  const assets = readWebAssets();
  assets['/cover-index.json'] = {type:'application/json',body:'{}'};
  const worker = 'const ASSETS=' + JSON.stringify(assets) + ';\n' + fs.readFileSync('worker/index.js', 'utf8');
  const staging = fs.mkdtempSync('dist-staging-');
  try {
    fs.mkdirSync(`${staging}/server`);
    fs.mkdirSync(`${staging}/.openai`);
    fs.writeFileSync(`${staging}/server/index.js`, worker);
    fs.writeFileSync(`${staging}/${manifestPath}`, manifest);
    fs.cpSync('drizzle', `${staging}/.openai/drizzle`, {recursive: true});
    fs.rmSync('dist', {recursive: true, force: true});
    fs.renameSync(staging, 'dist');
  } finally {
    fs.rmSync(staging, {recursive: true, force: true});
  }
  console.log('已生成云端包 dist/');
}

try {
  buildCloud();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
