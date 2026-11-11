'use strict';

// Public source ships without studio reference material.
const studioReferences = [...workflowReferences];
const inspirationTypes = ['全部','创意策略','品牌案例','短视频钩子','文案表达','导演提案','制作专题','AI制作工作流','产品实拍技法','广告机制','交付规范','待核验候选','我的记录'];
let inspirationCategory = '全部';

function renderInspiration() {
  const query = $('#search').value.trim().toLowerCase(), status = $('#filter').value;
  $('#list-title').textContent = '创意灵感库';
  const filters = $('#inspiration-filters'), grid = el('div','idea-grid');
  filters.replaceChildren();
  for (const category of inspirationTypes) {
    const filter = button(category,() => {
      inspirationCategory = category; renderInspiration();
      $('#inspiration-filters [aria-pressed="true"]').focus();
    });
    filter.setAttribute('aria-pressed',String(category === inspirationCategory)); filters.append(filter);
  }
  filters.append(button('导演色卡 ↗',openPaletteLibrary));
  const personal = items.filter(t => t.type === '创意' && (status ? t.status === status : t.status !== '已归档'));
  const curated = status ? [] : studioReferences;
  const priority=['bottle-lighting','heineken-macro','bfi-posters','dyson-wireframe'];
  const entries=[...priority.map(id=>curated.find(r=>r.id===id)).filter(Boolean),...personal.map(personalReference),...curated.filter(r=>!priority.includes(r.id))];
  for (const ref of entries) {
    const matchesCategory=ref.candidate ? inspirationCategory==='待核验候选' : inspirationCategory==='全部' || inspirationCategory===ref.category || ref.relatedCategories?.includes(inspirationCategory);
    if(!matchesCategory || ![ref.question,ref.title,ref.original,ref.method,ref.insight,ref.finding,ref.category,ref.kind,ref.source].some(v=>String(v||'').toLowerCase().includes(query)))continue;
    const card=el('article','idea-card reference-card'),body=el('div','reference-copy');
    card.dataset.study=ref.id;
    const control=button(studyAction(ref),()=>openStudy(ref),'study-open');
    body.append(el('span','idea-category',ref.kind+(ref.candidate?' · 待核验':'')),el('h3','',ref.question),el('p','',ref.insight),control);
    card.append(studyArt(ref),body);grid.append(card);
  }
  $('#records').replaceChildren(grid);
  if (!grid.children.length) grid.append(el('p','home-empty','此分类暂无匹配记录'));
}

function studySource(source) {
  const link = el('a','',source.name + ' ↗');
  link.href = safeURL(source.url); link.target = '_blank'; link.rel = 'noopener noreferrer';
  return link;
}

function personalReference(item){
  return {id:'mine-'+item.id,title:item.name,question:item.name.endsWith('？')?item.name:'「'+item.name+'」可以怎么用？',kind:'个人灵感',category:'我的记录',source:item.owner || '本机记录',url:item.url,
    insight:(item.notes||item.nextStep||'尚未填写收获，可在详情中补充。').split(/[\n。]/)[0].slice(0,100),finding:item.notes,application:item.nextStep,item};
}
const studyActions={'消费者研究':'看研究发现','短片研究':'看短片拆解','实拍教程':'看布光拆解','海报系列案例':'看六张海报的做法','产品摄影案例':'看微距拍法','CG 制作拆解':'看预演对照','广告检查表':'打开检查表','交付指南':'看交付检查','导演提案指南':'看提案结构','提案写作指南':'看产品出场页','创作者访谈':'看创作访谈','个人灵感':'打开我的记录'};
function studyAction(ref){return ref.candidate?'查看待核验线索':studyActions[ref.kind] || (/教程|指南/.test(ref.kind)?'看操作方法':/案例/.test(ref.kind)?'看案例拆解':'看创作方法');}
function studyArt(ref){
  return cardArt(ref.item?.id || ref.url,ref.title,ref.category,ref.item && thumbnails(ref.item)[0]);
}
let activeStudyId='';
function resolveStudy(id){return studioReferences.find(r=>r.id===id) || items.filter(x=>x.type==='创意').map(personalReference).find(r=>r.id===id);}
function openStudy(ref){
  activeStudyId=ref.id;
  navigate('灵感详情');
  const title=$('#title');title.tabIndex=-1;title.focus({preventScroll:true});
}
function renderReferenceDetail(){
  const ref=resolveStudy(activeStudyId),page=$('#reference-study');page.replaceChildren();
  if(!ref){$('#title').textContent='未找到这条灵感';page.append(button('返回灵感库',()=>navigate('创意')));return;}
  $('#title').textContent=ref.question;$('#crumb').textContent='灵感 / '+ref.kind;
  const lead=el('div','reference-lead'),notes=el('div','reference-reading');
  const name=ref.candidate?'当前线索':ref.item?'记录原文':/研究/.test(ref.kind)?'研究发现':/指南|教程|检查表|写作/.test(ref.kind)?'原文方法':'案例做法';
  notes.append(el('h2','',name),el('p','',ref.finding || '尚未填写原文。'),el('h2','','工作室怎么用'),el('p','',ref.application || '尚未填写用途。'));
  lead.append(studyArt(ref),notes);page.append(lead);
  if(ref.steps){
    const steps=el('details','study-sources');steps.append(el('summary','','展开八项制作记录'));
    for(const step of ref.steps){const row=el('section');row.append(el('h3','',step.name+' · '+step.level),el('p','',step.claim),el('small','','待核实 · '+step.missing+'（来源 '+step.sources.map(i=>i+1).join('、')+'）'));steps.append(row);}
    page.append(steps);
  }
  if(ref.item){
    const picker=el('input');picker.type='file';picker.accept='image/*,video/*';picker.multiple=true;picker.hidden=true;
    picker.onchange=()=>addPreviews(ref.item.id,Array.from(picker.files));page.append(button('添加素材预览',()=>picker.click()),picker,button('编辑记录',()=>openEditor('创意',ref.item)));
  }
  const evidence=el('footer','reference-evidence');evidence.append(el('h2','','来源与核验'),el('p','',ref.source));
  if(ref.sources)for(const [i,src] of ref.sources.entries()){const entry=el('p');entry.append(studySource({...src,name:(i+1)+'. '+src.name}),el('small','',src.note));evidence.append(entry);}
  else if(safeURL(ref.url))evidence.append(studySource({name:ref.original || ref.title,url:ref.url}));
  if(ref.verification || ref.limits)evidence.append(el('p','',[ref.verification,ref.limits].filter(Boolean).join(' ')));
  if(!['heineken-macro','bfi-posters','dyson-wireframe'].includes(ref.id))coverCredit(evidence,ref.item?.id || ref.url,ref.item && thumbnails(ref.item)[0]);
  evidence.append(button('← 返回灵感库',()=>$('#nav-back').click()));page.append(evidence);
}
