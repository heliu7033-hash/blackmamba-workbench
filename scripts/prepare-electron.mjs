import fs from 'node:fs';
import path from 'node:path';
import {readWebAssets} from './web-assets.mjs';
const dest='build/electron-app';fs.rmSync(dest,{recursive:true,force:true});fs.mkdirSync(dest,{recursive:true});
// Allow-list: never copy data/, local-dist/, credentials, or the caller's media.
const files=['server.mjs','runtime-platform.mjs','creative-chat.mjs','creative-providers.mjs','production-materials.mjs','media-library.mjs','storyboards.mjs','skills-inventory.mjs','local-library.mjs','drizzle/0000_groovy_starjammers.sql','scripts/resolve-media.py','desktop/electron/main.cjs','desktop/electron/preload.cjs','desktop/electron/smoke.cjs','skills/studio-storyboards/SKILL.md','skills/studio-storyboards/scripts/engine.mjs','skills/studio-storyboards/scripts/composition.jsx','LICENSE'];
for(const file of files){const target=path.join(dest,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);}
const pkg=JSON.parse(fs.readFileSync('package.json'));fs.writeFileSync(path.join(dest,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,description:pkg.description,author:'Black Mamba Studio',license:'MIT',main:'desktop/electron/main.cjs'}));
fs.mkdirSync(path.join(dest,'local-dist'));
fs.writeFileSync(path.join(dest,'local-dist/worker.mjs'),'const ASSETS='+JSON.stringify({...readWebAssets(),'/cover-index.json':{type:'application/json',body:'{}'}})+';\n'+fs.readFileSync('worker/index.js','utf8'));
console.log('Prepared source-only Electron runtime');
