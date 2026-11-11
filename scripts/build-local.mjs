import fs from 'node:fs';
import {readWebAssets, readLocalCovers} from './web-assets.mjs';

fs.mkdirSync('local-dist', {recursive:true});
fs.writeFileSync('local-dist/worker.mjs', 'const ASSETS=' + JSON.stringify({...readWebAssets(), ...readLocalCovers()}) + ';\n' + fs.readFileSync('worker/index.js','utf8'));
