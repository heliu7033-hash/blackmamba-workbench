import fs from 'node:fs';
import path from 'node:path';

export function readWebAssets() {
  const types = {'.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml'};
  return Object.fromEntries(fs.readdirSync('web').map(name => {
    const ext = path.extname(name);
    if (!types[ext]) throw Error('Unknown web asset type: ' + name);
    const binary = types[ext].startsWith('image/');
    const body = fs.readFileSync(path.join('web', name), binary ? 'base64' : 'utf8');
    return ['/' + name, {body, binary, type:types[ext] + (binary ? '' : '; charset=utf-8')}];
  }));
}

// Only the local build explicitly adds this pack. Never traverse the task database or user media.
export function readLocalCovers(directory = 'data/card-covers') {
  const assets = {}, index = {};
  const manifest = path.join(directory,'index.json');
  if (fs.existsSync(manifest)) {
    for (const [key,entry] of Object.entries(JSON.parse(fs.readFileSync(manifest,'utf8')))) {
      if (!entry || !/^[a-z0-9-]+\.jpg$/.test(entry.file) || !entry.alt || !entry.label) continue;
      const file = path.join(directory,entry.file);
      if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) continue;
      const route = '/covers/' + entry.file;
      assets[route] = {type:'image/jpeg',binary:true,body:fs.readFileSync(file,'base64')};
      index[key] = {src:route,alt:entry.alt,label:entry.label,source:entry.source,credit:entry.credit};
    }
  }
  assets['/cover-index.json'] = {type:'application/json',body:JSON.stringify(index)};
  return assets;
}
