'use strict';
let libraryMode='palettes',libraryOffset=0,libraryRequest=0;
async function renderLibrary(){
  const request=++libraryRequest, palette=libraryMode==='palettes';
  $('#lib-kind').hidden=palette;
  $('#lib-palettes').setAttribute('aria-pressed',String(palette));$('#lib-documents').setAttribute('aria-pressed',String(!palette));
  $('#lib-note').textContent=palette?'本地编者整理的配色建议，比例取自资料色卡。':'仅检索本地目录元数据。作者、奖项与版权归属须回原文核对。';
  const params=new URLSearchParams({mode:libraryMode,q:$('#lib-search').value,kind:$('#lib-kind').value,page:String(libraryOffset)});
  const target=$('#lib-results');target.replaceChildren();$('#lib-state').textContent='正在读取本地索引…';$('#lib-pager').hidden=true;
  try{
    const response=await fetch('/api/local-library?'+params);if(!response.ok)throw Error();
    const data=await response.json();if(request!==libraryRequest)return;
    if(!data.available){$('#lib-state').textContent='本机尚未配置资料索引。';return;}
    libraryOffset=data.page;target.className=palette?'palette-grid':'document-results';
    const kinds={method:'方法资料',reference:'参考资料',novel:'小说'};
    for(const row of data.rows){
      const card=el('article','library-card');card.append(el('h3','',row.title));
      if(palette){
        const bar=el('div','palette-strip');bar.setAttribute('aria-label',row.colors.join('、'));
        row.colors.forEach((color,i)=>{const chip=el('span');chip.style.backgroundColor=color;chip.style.flex=String(row.ratios[i]||1);chip.title=color;bar.append(chip);});card.append(bar,el('small','',row.colors.join('  ')));
      }
      card.append(el('p','study-note',[row.english,kinds[row.kind],row.category].filter(Boolean).join(' · ')));
      const link=el('a','','打开本地原文 ↗');link.href='/local-document/'+encodeURIComponent(row.id);
      if(!window.webkit?.messageHandlers && !navigator.userAgent.includes('MambaDesktop')){link.removeAttribute('href');link.textContent='请在桌面工作台打开原文';}
      if(palette)card.append(button('加入项目',()=>editPalette(row)));
      card.append(link);target.append(card);
    }
    $('#lib-state').textContent=data.total?'共 '+data.total+' 项 · 第 '+(data.page+1)+' / '+Math.ceil(data.total/data.size)+' 页':'没有匹配的本地资料。';
    $('#lib-pager').hidden=data.total<=data.size;
    $('#lib-prev').disabled=data.page===0;$('#lib-next').disabled=(data.page+1)*data.size>=data.total;
  }catch{if(request===libraryRequest)$('#lib-state').textContent='本地索引暂不可用。';}
}
document.addEventListener('DOMContentLoaded',()=>{
  for(const mode of ['palettes','documents'])$('#lib-'+mode).onclick=()=>{libraryMode=mode;libraryOffset=0;$('#lib-search').value='';renderLibrary();};
  $('#lib-search').oninput=$('#lib-kind').onchange=()=>{libraryOffset=0;renderLibrary();};
  $('#lib-prev').onclick=()=>{libraryOffset--;renderLibrary();};$('#lib-next').onclick=()=>{libraryOffset++;renderLibrary();};
});

function openPaletteLibrary(){
  libraryMode='palettes';libraryOffset=0;$('#lib-search').value='';navigate('资料');
}

function paletteRoles(scheme){
  return scheme.colors.map((hex,i)=>({hex,ratio:scheme.ratios[i]}))
    .sort((a,b)=>b.ratio-a.ratio)
    .map((c,i,list)=>({...c,role:i===0?'主色':i===list.length-1?'点缀色':'辅色'}));
}

function projectPalette(project){
  const scheme=project.colorReference,box=stageBlock('项目色彩参考');
  if(!scheme || !Array.isArray(scheme.colors) || !Array.isArray(scheme.ratios)){
    box.append(button('选择导演色卡',openPaletteLibrary));return box;
  }
  box.append(el('strong','',scheme.title),el('p','study-note','按资料建议占比分配主色、辅色与点缀色。'));
  const rows=paletteRoles(scheme),chips=el('div','project-colors');
  for(const {role,hex,ratio} of rows){
    const chip=el('div'),swatch=el('span','color-swatch');swatch.style.backgroundColor=hex;
    chip.append(swatch,el('small','',role+' · '+Math.round(ratio*100)+'%'),el('code','',hex));
    chips.append(chip);
  }
  const brief=[project.name+' · '+scheme.title,...rows.map(c=>c.role+' '+c.hex+' '+Math.round(c.ratio*100)+'%'),scheme.usage].filter(Boolean).join('\n');
  box.append(chips,el('p','stage-text',scheme.usage || '尚未填写用途说明。'));
  const actions=el('div','detail-shortcuts');box.append(actions);
  addCopyAction(actions,'复制 HEX',rows.map(c=>c.hex).join(' '));addCopyAction(actions,'复制色彩简报',brief);
  actions.append(button('编辑用途',()=>editPalette(scheme,project.id)),button('更换色卡',openPaletteLibrary),
    button('移除色卡',()=>{
      if(!confirm('移除本项目的「'+scheme.title+'」色卡？'))return;
      const next=items.map(item=>{if(item.id!==project.id)return item;const {colorReference,...rest}=item;return {...rest,updatedAt:Date.now()};});
      if(persist(next))toast('已移除项目色卡');
    }));
  return box;
}

function editPalette(row,fixedProject){
  const dialog=$('#palette-editor'),form=el('form'),projectLabel=el('label','','所属项目'),picker=el('select'),noteLabel=el('label','','用途说明'),note=el('textarea');
  const projects=items.filter(p=>p.type==='项目' && (p.status!=='已归档' || p.id===fixedProject));
  if(!projects.length){toast('请先创建或选择一个制作项目');return;}
  for(const p of projects){const option=el('option','',p.name);option.value=p.id;picker.append(option);}
  picker.value=fixedProject || contextProject()?.id || projects[0].id;
  if(!picker.value)picker.value=projects[0].id;
  picker.disabled=Boolean(fixedProject);note.maxLength=800;note.rows=3;
  const state=el('p','study-note');
  function update(){
    const previous=projects.find(p=>p.id===picker.value)?.colorReference;
    state.textContent=previous && previous.id!==row.id?'将替换「'+previous.title+'」':'本次选择仅用于此项目。';
    note.value=previous?.id===row.id?previous.usage || '':'';
  }
  picker.onchange=update;update();projectLabel.append(picker);noteLabel.append(note);
  const actions=el('div','modal-actions'),save=el('button','primary','保存项目色卡');save.type='submit';
  actions.append(button('取消',()=>dialog.close()),save);
  form.append(el('h2','',row.title),el('p','',row.colors.join(' · ')),projectLabel,state,noteLabel,actions);
  form.onsubmit=event=>{
    event.preventDefault();const id=picker.value;
    const {id:source,title,english,category,colors,ratios}=row;
    const colorReference={id:source,title,english,category,colors,ratios,usage:note.value.trim()};
    if(persist(items.map(p=>p.id===id?{...p,colorReference,updatedAt:Date.now()}:p))){dialog.close();toast('项目色卡已保存');}
  };
  dialog.replaceChildren(form);dialog.showModal();
}
