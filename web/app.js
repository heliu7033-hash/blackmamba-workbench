'use strict';

const KEY = 'blackmamba.command.v1';
const $ = selector => document.querySelector(selector);
const workflow = window.MAMBA_WORKFLOW;
const stages = workflow.stages;
const types = ['项目', '官网', '创意', '智能体'];
const statuses = ['待开始', '进行中', '已完成', '已归档'];
const names = {总览: '工作台首页', 项目: '全部项目', 任务: '本机任务', 剧组流程: '剧组流程', 官网: '官网与链接', 创意: '创意灵感库', 智能体: '智能体阵容', 素材:'本地素材库', 资料:'本地资料', 技能: '已安装技能'};
let items = [];
let view = '总览';
let editing = null;
let timer;
let storageError = false;

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => $('#toast').classList.remove('show'), 3500);
}

function safeURL(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function normalize(item) {
  return initializeWorkflowReceipts({
    ...item,
    stage: phaseFor(item.stage) ? item.stage : 'brief',
    client: typeof item.client === 'string' ? item.client : '',
    nextStep: typeof item.nextStep === 'string' ? item.nextStep : '',
    checks: item.checks && typeof item.checks === 'object' ? item.checks : {}
  });
}

function validate(item) {
  return item && typeof item.id === 'string' && typeof item.name === 'string' && item.name.trim() && item.name.length <= 100 &&
    types.includes(item.type) && statuses.includes(item.status) &&
    ['owner', 'due', 'url', 'notes'].every(key => typeof item[key] === 'string') &&
    item.notes.length <= 10000 && item.owner.length <= 60 &&
    (!item.nextStep || typeof item.nextStep === 'string' && item.nextStep.length <= 2000) &&
    (!item.url || safeURL(item.url)) && (!item.due || /^\d{4}-\d{2}-\d{2}$/.test(item.due)) &&
    (!item.stage || phaseFor(item.stage)) && (!item.client || typeof item.client === 'string');
}

try {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || !data.every(validate)) throw Error('invalid local data');
    items = data.map(normalize);
    if(JSON.stringify(items)!==JSON.stringify(data))localStorage.setItem(KEY,JSON.stringify(items));
  } else {
    items = [];
  }
} catch {
  storageError = true;
  $('#save-state').textContent = '本地数据读取异常，请先导出原始备份';
  setTimeout(() => toast('本地存储异常，已停止写入以保护现有数据。'), 500);
}

function persist(next) {
  if (storageError) {
    toast('本地数据读取异常，已停止写入以保护现有数据。');
    return false;
  }
  try {
    next=next.map(normalize);
    localStorage.setItem(KEY, JSON.stringify(next));
    items = next;
    $('#save-state').textContent = '本地记录已保存 · ' + new Date().toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'});
    render();
    return true;
  } catch {
    toast('保存失败：浏览器存储不可用或已满。请导出备份。');
    return false;
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, action, className = '') {
  const node = el('button', className, text);
  node.type = 'button';
  node.onclick = action;
  return node;
}

function projectStage(item) {
  return phaseFor(item.stage) || stages[0];
}

function stageProgress(item) {
  const done = projectStage(item).checks.filter(check=>checkedAt(item,check)).length;
  return {done, total: projectStage(item).checks.length};
}

function liveProjects() {
  return items.filter(item => item.type === '项目' && item.status !== '已归档');
}

const routes = {
  阶段: {group:'项目', hash:'stage', label:'阶段资料'},
  总览: {group:'总览', hash:'overview', label:'工作台'},
  项目: {group:'项目', hash:'projects', label:'全部项目'},
  剧组流程: {group:'项目', hash:'workflow', label:'制作流程'},
  任务: {group:'项目', hash:'tasks', label:'本机任务'},
  灵感详情: {group:'创意',hash:'inspiration/item',label:'灵感详情'},
  布光拆解: {group:'创意',hash:'inspiration/bottle-lighting',label:'透明瓶布光'},
  创意: {group:'创意', hash:'inspiration', label:'灵感'},
  官网: {group:'官网', hash:'links', label:'官网与链接'},
  智能体: {group:'官网', hash:'agents', label:'智能体'},
  素材: {group:'官网',hash:'media',label:'素材库'},
  资料: {group:'官网',hash:'library',label:'本地资料'},
  技能: {group:'官网', hash:'skills', label:'已安装技能'}
};
const groupNames = {总览:'工作台',项目:'项目',创意:'灵感',官网:'工具'};
function locationView() {
  let hash;
  try { hash = decodeURIComponent(location.hash.slice(1)); } catch { return '总览'; }
  if(hash.startsWith('inspiration/item/'))return '灵感详情';
  if (/^stage\//.test(hash) && phaseFor(hash.slice(6))) return '阶段';
  const legacy = {'workflow-view':'剧组流程','cloud-workbench':'任务','skills-view':'技能','assistant-panel':'智能体',tools:'素材'};
  return Object.keys(routes).find(key => [key,routes[key].hash,routes[key].label,names[key]].includes(hash)) || legacy[hash] || '总览';
}
function routeState(depth) {
  return {depth, project:featuredId || null, stage:inspectedStage || null};
}
function saveRouteContext() {
  history.replaceState(routeState(history.state?.depth || 0),'');
}
function restoreRoute() {
  featuredId = history.state?.project || null;
  inspectedStage = history.state?.stage || null;
  if (location.hash.startsWith('#stage/')) inspectedStage = phaseFor(location.hash.slice(7))?.id;
  if(location.hash.startsWith('#inspiration/item/')){try {activeStudyId=decodeURIComponent(location.hash.slice(18));}catch{activeStudyId='';}}
  navigate(locationView(), false);
}
function navigate(next, push = true) {
  const route = routes[next];
  if (!route) return;
  const hash = next === '阶段' ? 'stage/' + (inspectedStage || 'brief') : next==='灵感详情'?'inspiration/item/'+encodeURIComponent(activeStudyId):route.hash;
  if (push && (next !== view || ['阶段','灵感详情'].includes(next) && location.hash !== '#'+hash)) {
    history.pushState(routeState((history.state?.depth || 0) + 1),'','#' + hash);
  }
  const previousView=view;
  view = next;
  const isStudy=['布光拆解','灵感详情'].includes(next);
  if(!isStudy && !(next==='创意' && ['布光拆解','灵感详情'].includes(previousView))){$('#search').value='';$('#filter').value='';}
  $('#reference-study').hidden=next!=='灵感详情';
  for (const node of document.querySelectorAll('#nav button, #section-nav button')) {
    const primary = node.parentElement.id === 'nav';
    const active = node.dataset.view === (primary ? route.group : next === '阶段' ? '剧组流程' : next);
    node.classList.toggle('selected',active);
    if (active) node.setAttribute('aria-current','page');
    else node.removeAttribute('aria-current');
    if (!primary) node.hidden = routes[node.dataset.view].group !== route.group;
  }
  const grouped = ['项目','官网'].includes(route.group);
  $('#section-nav').hidden = !grouped;
  $('#context-picker').hidden = !['任务','剧组流程'].includes(next);
  $('#crumb').textContent = grouped ? groupNames[route.group] + ' / ' + route.label : route.label;
  $('#nav-back').hidden = !(history.state?.depth || next !== '总览');
  $('#title').textContent = next === '总览' ? '项目工作台' : names[next];
  $('#subtitle').textContent = {
    总览: '', 任务: '',
    项目: '客户、阶段、负责人和当前下一步。',
    剧组流程: '',
    官网: '常用网站、文档与协作入口。',
    创意: '灵感、分镜和视觉参考的收集区。',
    智能体: '记录岗位分工与可复用的任务说明。',
    技能: '本机实际安装文件、来源与插件状态；只读查看。'
  }[next] || '';
  $('#bottle-study').hidden=next!=='布光拆解';
  if(next==='布光拆解'){
    $('#title').textContent='参考资料';
    $('#crumb').textContent='灵感 / 实拍教程';
  }
  $('#stage-content').hidden = next !== '阶段';
  $('#overview').hidden = next !== '总览';
  $('#workflow-view').hidden = next !== '剧组流程';
  $('#assistant-panel').hidden = next !== '智能体';
  $('#cloud-workbench').hidden = next !== '任务';
  document.querySelector('.workspace').hidden = ['总览', '剧组流程', '技能','资料','素材', '任务','阶段','布光拆解','灵感详情'].includes(next);
  $('#media-view').hidden = next !== '素材';
  if(next==='素材') window.MAMBA_MEDIA?.load();
  $('#library-view').hidden = next !== '资料';
  if(next==='资料') renderLibrary();
  $('#skills-view').hidden = next !== '技能';
  $('#inspiration-filters').hidden = next !== '创意';
  $('#add').hidden = ['技能','资料','素材','任务','剧组流程','阶段','布光拆解','灵感详情'].includes(next);
  document.querySelector('.boundary').hidden = true;
  if (next === '技能') window.MAMBA_SKILLS?.load();
  $('#add').textContent = '＋ 新建' + (['总览', '剧组流程', '项目'].includes(next) ? '项目' : next);
  render();
  if (push) window.scrollTo(0,0);
}

function setStageOptions(value = 'brief') {
  const select = $('#stage-select');
  select.replaceChildren(...stages.map(stage => {
    const option = document.createElement('option');
    option.value = stage.id;
    option.textContent = stage.name;
    return option;
  }));
  select.value = (phaseFor(value) || stages[0]).id;
}

function openEditor(type = '项目', item, stageId = 'brief') {
  editing = item?.id || null;
  $('#form').reset();
  const form = $('#form');
  form.elements.type.value = type;
  setStageOptions(item?.stage || stageId);
  if (item) {
    for (const key of ['name', 'type', 'status', 'owner', 'client', 'due', 'url', 'notes', 'nextStep']) {
      form.elements[key].value = item[key] || '';
    }
  }
  $('#production-fields').hidden = type !== '项目';
  form.elements.client.closest('label').hidden = type !== '项目';
  $('#modal-title').textContent = item ? '编辑' + (type === '项目' ? '制作项目' : type) : type === '项目' ? '新建制作项目' : '新建' + type;
  $('#notes-label').firstChild.textContent = type === '项目' ? '项目简报' : '备注 / 背景';
  $('#editor').showModal();
  form.elements.name.focus();
}

function renderRoles() {
  const target = $('#role-strip');
  target.replaceChildren();
  for (const role of workflow.roles) {
    const card = el('article', 'role-card');
    card.append(el('strong', '', role.name), el('span', '', role.role), el('p', '', role.output));
    target.append(card);
  }
}

function projectCard(item, compact = false) {
  const stage = projectStage(item);
  const progress = stageProgress(item);
  const card = el('article', compact ? 'project-stage-card' : 'card');
  const top = el('div', 'card-top');
  top.append(el('span', 'category', stage.short + ' · ' + item.status), el('span', 'badge', progress.done + '/' + progress.total + ' 已完成'));
  card.append(top, el('h3', '', item.name));
  if (item.client) card.append(el('p', 'project-client', '客户 / 品牌：' + item.client));
  if (item.notes) {
    const brief = el('details', 'brief-details');
    brief.append(el('summary', '', '简报、版本与素材索引'));
    const headings = Array.from(item.notes.matchAll(/【([^【】\n]{1,80})】/g));
    if (!headings.length) brief.append(el('p', 'project-brief', item.notes));
    else {
      const intro = item.notes.slice(0,headings[0].index);
      if (intro.trim()) brief.append(el('p','project-brief',intro));
      headings.forEach((match,index) => {
        const section = el('details','note-section');
        section.append(el('summary','',match[1]),
          el('p','project-brief',item.notes.slice(match.index+match[0].length,headings[index+1]?.index)));
        brief.append(section);
      });
    }
    card.append(brief);
  }
  if (item.nextStep) {
    const next = el('div', 'project-next');
    next.append(el('span', '', '下一步'), el('strong', '', item.nextStep));
    card.append(next);
  }
  const meta = el('div', 'card-meta');
  meta.append(el('span', '', item.owner ? '交接负责人：' + item.owner : '负责人待定'), el('span', '', item.due ? '目标日期：' + item.due : '日期待确认'));
  card.append(meta);
  const handoff = el('div', 'handoff');
  handoff.append(el('span', 'handoff-label', '本阶段交接'), el('strong', '', stage.handoff));
  card.append(handoff);
  const list = el('div', 'stage-checks');
  for (const check of stage.checks) list.append(checklistControl(item,check,'check-row'));
  card.append(list);
  const actions = el('div', 'card-actions');
  actions.append(button('编辑项目', () => openEditor('项目', item)));
  if (!compact) {
    const move = document.createElement('select');
    move.setAttribute('aria-label', '切换项目阶段');
    for (const stageOption of stages) {
      const option = document.createElement('option');
      option.value = stageOption.id;
      option.textContent = '移至 ' + stageOption.name;
      move.append(option);
    }
    move.value = stage.id;
    move.onchange = () => persist(items.map(entry => entry.id === item.id ? {...entry, stage: move.value, updatedAt: Date.now()} : entry));
    actions.append(move);
  }
  if (item.url) {
    const link = el('a', '', '打开资料 ↗');
    link.href = safeURL(item.url);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    actions.append(link);
  }
  card.append(actions);
  return card;
}

function renderRecords() {
  if (view === '创意') { renderInspiration(); return; }
  const query = $('#search').value.trim().toLowerCase();
  const filter = $('#filter').value;
  const list = items.filter(item => (view === '总览' || item.type === view) &&
    (filter ? item.status === filter : item.status !== '已归档') &&
    [item.name, item.notes, item.nextStep, item.owner, item.client].some(value => value.toLowerCase().includes(query)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  $('#list-title').textContent = view === '项目' ? '制作项目' : names[view] || '当前项目';
  const target = $('#records');
  target.replaceChildren();
  if (view==='官网' && !filter && ['黑曼巴工作室官网','blackmambastudio.com'].some(s=>s.includes(query))) {
    const official=$('#official-site').cloneNode(true);
    official.removeAttribute('id');official.className='official-bookmark';official.textContent='黑曼巴工作室官网 ↗';
    target.append(official);
    const duplicate=list.findIndex(item=>safeURL(item.url)===official.href);
    if(duplicate>=0){const [saved]=list.splice(duplicate,1);target.append(button('编辑官网记录',()=>openEditor('官网',saved)));}
    if(!list.length)return;
  }
  if (!list.length) {
    const empty = el('div', 'empty');
    empty.append(el('div', 'empty-symbol', '◇'), el('h3', '', query || filter ? '没有匹配记录' : '还没有记录'));
    empty.append(el('p', '', query || filter ? '调整搜索词或状态筛选。' : '新增一条真实记录开始推进。'));
    empty.append(button('＋ 新建' + (view === '项目' ? '制作项目' : view), () => openEditor(view === '项目' ? '项目' : view)));
    target.append(empty);
    return;
  }
  const grid = el('div', 'cards');
  for (const item of list) {
    if (item.type === '项目') {
      grid.append(projectTile(item));
      continue;
    }
    const card = el('article', 'card');
    card.append(el('div', 'card-top'), el('h3', '', item.name), el('p', '', item.notes || '还没有备注。'));
    const actions = el('div', 'card-actions');
    actions.append(button('编辑', () => openEditor(item.type, item)));
    if (item.type === '官网' && safeURL(item.url)) {
      const link = el('a','','打开链接 ↗');
      link.href = safeURL(item.url); link.target = '_blank'; link.rel = 'noopener noreferrer'; actions.prepend(link);
    }
    if (item.type === '智能体') {
      actions.append(button('复制提示词', async () => {
        try {
          await navigator.clipboard.writeText(item.notes || item.name);
          toast('已复制提示词');
        } catch {
          toast('复制受限，请打开记录手动复制');
        }
      }));
    }
    card.append(actions);
    grid.append(card);
  }
  target.append(grid);
}

function render() {
  if(view==='灵感详情')renderReferenceDetail();
  else if (view === '阶段') renderStageContent();
  else if (view === '总览') renderHome();
  else if (view === '剧组流程') { renderProjectPicker(); renderWorkflow(); }
  else if (view === '任务') { renderProjectPicker(); renderTaskContext(); window.MambaTaskBoard?.render(); }
  else if (types.includes(view)) renderRecords();
  if ($('#project-detail').open) renderDetail();
}

document.querySelectorAll('#nav button, #section-nav button').forEach(node => node.onclick = () => navigate(node.parentElement.id==='nav'&&node.dataset.view==='官网'?'素材':node.dataset.view));
$('#add').onclick = () => openEditor(['官网', '创意', '智能体'].includes(view) ? view : '项目');
$('.brand').onclick = event => { event.preventDefault(); navigate('总览'); };
$('#workflow-add').onclick = () => openEditor('项目');
const commandPalette = $('#command-palette');
const commandInput = $('#command-search');
const commandActions = {
  new: () => openEditor('项目'),
  workflow: () => navigate('剧组流程'),
  projects: () => navigate('项目'),
  backup: () => $('#backup').click()
};
for (const [key, route] of Object.entries(routes)) {
  if (['项目','剧组流程','阶段','布光拆解','灵感详情'].includes(key)) continue;
  const item = el('button','command-item');
  item.type = 'button';
  item.dataset.command = route.hash;
  const label = el('span');
  label.append(el('strong','',route.label),el('small','',groupNames[route.group] + ' / ' + names[key]));
  item.append(el('span','command-glyph','↗'),label);
  $('#command-list').append(item);
  commandActions[route.hash] = () => navigate(key);
}
$('#nav-back').onclick = () => {
  if (history.state?.depth) history.back();
  else if(['布光拆解','灵感详情'].includes(view)){history.replaceState(routeState(0),'','#inspiration');navigate('创意',false);}
  else {
    history.replaceState(routeState(0),'','#overview');
    navigate('总览',false);
  }
};
$('#bottle-back').onclick=()=>$('#nav-back').click();
window.addEventListener('popstate',restoreRoute);
window.addEventListener('hashchange',() => { if (view !== locationView()) restoreRoute(); });
const commandKeys = {'1': 'new', '2': 'workflow', '3': 'projects', '4': 'backup'};
function openCommandPalette() {
  if (document.querySelector('dialog[open]')) return;
  commandPalette.showModal();
  commandInput.value = '';
  filterCommands();
  commandInput.focus();
}
function filterCommands() {
  const query = commandInput.value.trim().toLowerCase();
  document.querySelectorAll('.command-item').forEach(item => {
    item.hidden = !item.textContent.toLowerCase().includes(query);
  });
}
$('#command-trigger').onclick = openCommandPalette;
commandInput.oninput = filterCommands;
commandPalette.addEventListener('close', () => {
  queueMicrotask(() => {
    if (!document.querySelector('dialog[open]')) $('#command-trigger').focus();
  });
});
commandInput.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.isComposing) return;
  event.preventDefault();
  if (!event.repeat) document.querySelector('.command-item:not([hidden])')?.click();
});
document.querySelectorAll('.command-item').forEach(item => {
  item.onclick = () => {
    const action = commandActions[item.dataset.command];
    commandPalette.close();
    action?.();
  };
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (event.repeat || event.isComposing) return;
    if (commandPalette.open) commandPalette.close();
    else openCommandPalette();
    return;
  }
  if (!commandPalette.open) return;
  if (event.key === 'Escape' && !event.isComposing) {
    event.preventDefault();
    commandPalette.close();
    return;
  }
  const command = event.altKey && !event.metaKey && !event.ctrlKey ? commandKeys[event.code.replace('Digit', '')] : null;
  if (command) {
    event.preventDefault();
    if (event.repeat || event.isComposing) return;
    commandPalette.close();
    commandActions[command]();
  }
});
$('#search').oninput = renderRecords;
$('#filter').onchange = renderRecords;
$('#close').onclick = $('#cancel').onclick = () => $('#editor').close();
$('#workflow-rules').onclick = $('#guide').onclick = () => $('#help').showModal();
$('#help-close').onclick = () => $('#help').close();
$('#form').elements.type.onchange = () => {
  const isProject = $('#form').elements.type.value === '项目';
  $('#production-fields').hidden = !isProject;
  $('#form').elements.client.closest('label').hidden = !isProject;
};

$('#form').onsubmit = event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const type = String(form.get('type'));
  const url = String(form.get('url')).trim();
  if (url && !safeURL(url)) {
    toast('请填写有效的 http 或 https 链接。');
    return;
  }
  const now = Date.now();
  const old = items.find(item => item.id === editing);
  const item = {
    ...(old || {}), id: editing || crypto.randomUUID(), name: String(form.get('name')).trim(), type,
    status: String(form.get('status')), stage: old && phaseFor(old.stage)?.id === form.get('stage') ? old.stage : String(form.get('stage')), owner: String(form.get('owner')).trim(),
    client: String(form.get('client') || '').trim(), due: String(form.get('due')), url,
    notes: String(form.get('notes')).trim(), nextStep: String(form.get('nextStep')).trim(),
    checks: old?.checks || {}, updatedAt: now
  };
  if (!validate(item)) {
    toast('请检查名称和字段内容。');
    return;
  }
  if (persist(editing ? items.map(entry => entry.id === editing ? item : entry) : [...items, item])) {
    $('#editor').close();
    toast('已保存到本地工作台');
  }
};

$('#backup').onclick = () => {
  const payload = {format: 'blackmamba-command-backup', version: 1, exportedAt: new Date().toISOString(), items};
  const blob = new Blob([storageError ? localStorage.getItem(KEY) || JSON.stringify(payload, null, 2) : JSON.stringify(payload, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const anchor = el('a');
  anchor.href = url;
  anchor.download = '黑曼巴工作台-' + new Date().toISOString().slice(0, 10) + '.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已生成工作台备份文件。');
};

$('#restore').onclick = () => $('#import').click();
$('#import').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5000000) throw Error();
    const backup = JSON.parse(await file.text());
    if (backup.format !== 'blackmamba-command-backup' || backup.version !== 1 || !Array.isArray(backup.items) || !backup.items.every(validate)) throw Error();
    const additions = [];
    for (const source of backup.items) {
      const item = normalize(source);
      const existing = items.find(entry => entry.id === item.id);
      if (existing && JSON.stringify(existing) === JSON.stringify(item)) continue;
      additions.push({...item, id: existing ? crypto.randomUUID() : item.id, updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now()});
    }
    if (!additions.length) {
      toast('备份中的记录已存在。');
      return;
    }
    if (confirm('将导入 ' + additions.length + ' 条记录。已有记录不会被覆盖，继续？')) {
      if (persist([...items, ...additions])) toast('已导入 ' + additions.length + ' 条记录。');
    }
  } catch {
    toast('无法导入：请选择有效的黑曼巴 JSON 备份（小于 5MB）。');
  } finally {
    event.target.value = '';
  }
};

setupHome();
window.addEventListener('DOMContentLoaded',restoreRoute,{once:true});
