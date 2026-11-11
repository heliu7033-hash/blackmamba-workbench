import fs from 'node:fs';
import path from 'node:path';

export function libraryPage(data, params) {
  let index;
  try {index=JSON.parse(fs.readFileSync(path.join(data,'local-library','catalog.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT')return {available:false};throw error;}
  const mode=params.get('mode')==='documents'?'documents':'palettes';
  const query=(params.get('q') || '').trim().toLowerCase();
  const kind=params.get('kind') || 'research';
  let rows=index[mode].filter(row=>{
    if(mode==='documents' && (kind==='research' ? row.kind==='novel' : kind!=='all' && row.kind!==kind)) return false;
    return [row.title,row.english,row.category].some(text=>text?.toLowerCase().includes(query));
  });
  if(mode==='palettes' && !query) {
    const groups=Map.groupBy(rows,row=>row.category), sorted=[];
    for(let i=0;sorted.length<rows.length;i++)for(const group of groups.values())if(group[i])sorted.push(group[i]);
    rows=sorted;
  }
  const size=mode==='palettes'?12:30;
  const page=Math.max(0,Math.min(Math.ceil(rows.length/size)-1,Number.parseInt(params.get('page'),10)||0));
  return {available:true,total:rows.length,page,size,rows:rows.slice(page*size,(page+1)*size)};
}
