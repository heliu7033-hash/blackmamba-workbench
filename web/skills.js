'use strict';
// Existing cyber design is retained; provenance and limitations stay explicit.
(() => {
  const find = id => document.getElementById(id);
  const labels = {installed:'本地已安装',configured:'插件 · 配置启用',cached:'仅缓存 · 启用未确认',disabled:'插件 · 配置禁用'};
  let inventory = null, loading = false, failed = false, selected = null;
  const make = (tag, cls, text) => {const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  function render() {
    if(!inventory) return;
    const query=find('skills-search').value.trim().toLowerCase(), group=find('skills-source').value, cached=find('skills-cache').checked;
    const matches=inventory.entries.filter(item=>(cached||['installed','configured'].includes(item.state))&&(!group||item.group===group)&&[item.name,item.description,item.source,item.path,skillPurpose(item),item.provenance?.label||''].some(x=>x.toLowerCase().includes(query)));
    const categories = find('skill-categories');
    categories.replaceChildren();
    const countsByPurpose = new Map();
    for (const item of matches) {
      const purpose = skillPurpose(item);
      countsByPurpose.set(purpose,(countsByPurpose.get(purpose) || 0) + 1);
    }
    const purposes = ['全部', ...skillPurposes.map(([name]) => name), '其他'];
    for (const name of purposes) {
      const count = name === '全部' ? matches.length : countsByPurpose.get(name) || 0;
      if (!count && name === '其他' && selected !== name) continue;
      const control = make('button','skill-purpose');
      control.type = 'button';
      control.setAttribute('aria-pressed',String(selected === name));
      control.append(make('span','',name),make('b','',String(count)));
      control.onclick = () => {
        selected = name; render();
        categories.querySelector('[aria-pressed="true"]')?.focus();
      };
      categories.append(control);
    }
    const rows = matches.filter(item => !selected || selected === '全部' || skillPurpose(item) === selected);
    const browsing = selected || query || group || cached;
    const status = (failed?'重新扫描失败，以下为上次结果。':'') +
      (browsing ? '显示 ' + rows.length + ' 个安装位置' : '选择用途或搜索技能') +
      ' · 扫描于 ' + new Date(inventory.scannedAt).toLocaleString('zh-CN');
    find('skills-status').textContent = status;
    const list=find('skills-list');list.replaceChildren();
    if (!browsing) return;
    if(!rows.length) {list.append(make('div','empty','没有匹配的技能。可调整搜索、来源或缓存筛选。'));return;}
    const counts=new Map();for(const item of inventory.entries)counts.set(item.name,(counts.get(item.name)||0)+1);
    for(const item of rows) {
      const card=make('article','skill-card'), head=make('div','skill-card-head');
      head.append(make('h3','',item.name),make('span','skill-state '+item.state,labels[item.state]));
      card.append(head);
      const meta=make('div','skill-meta');meta.append(make('span','',skillPurpose(item)),make('span','',item.source+(item.version?' · v'+item.version:'')));
      if(counts.get(item.name)>1)meta.append(make('span','','同名 '+counts.get(item.name)+' 个位置'));
      card.append(meta);
      const detail=make('details','skill-source'), summary=make('summary','','用途、来源与安装路径');detail.append(summary,make('p','skill-description',item.description||'该文件未提供用途描述。'));
      detail.append(make('p','','安装路径：'+item.path));
      if(item.realPath!==item.path)detail.append(make('p','','实际目标：'+item.realPath));
      if(item.provenance) {
        detail.append(make('p','','来源记录：'+(item.provenance.label||'已记录')));
        if(item.provenance.url) {const a=make('a','','查看安装记录中的源地址 ↗');a.href=item.provenance.url;a.target='_blank';a.rel='noopener noreferrer';detail.append(a);}
        detail.append(make('p','','来源依据：'+item.provenance.evidence));
      } else detail.append(make('p','',item.group==='plugin'?'来源依据：该插件目录内的 .codex-plugin/plugin.json。':'上游下载来源未核实；以上文件路径已实测存在。'));
      card.append(detail);list.append(card);
    }
  }
  async function load(force=false) {
    if(loading || inventory && !force)return;
    loading=true;find('skills-refresh').disabled=true;find('skills-status').textContent=inventory?'正在重新扫描，暂时显示上次结果…':'正在读取本机技能目录…';
    try {
      const res=await fetch('/api/skills',{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!res.ok)throw Error();const data=await res.json();if(!Array.isArray(data.entries)||!data.summary)throw Error();
      inventory=data;failed=false;
      const stats=find('skills-summary');stats.replaceChildren();
      for(const [label,value] of [['已安装 / 配置启用位置',data.summary.installedEntries],['不同技能名称',data.summary.installedNames],['未确认缓存 / 禁用位置',data.summary.cachedEntries]]){const stat=make('div','skill-stat');stat.append(make('strong','',String(value)),make('span','',label));stats.append(stat);}
      find('skills-scope-text').textContent=data.scope+' '+data.execution;
      find('skills-roots').replaceChildren(...data.sources.map(root=>make('li','',root.label+'：'+root.path+(root.exists?'':'（不存在）'))));
      find('skills-warnings').replaceChildren(...data.warnings.map(w=>make('li','skill-warning',w.message+'：'+w.path)));
      render();
    } catch {
      failed=true;
      if(inventory)render();else find('skills-status').textContent='未能读取技能清单。请确认使用本机桌面版，并点击重新扫描；未显示任何模拟数据。';
    } finally {loading=false;find('skills-refresh').disabled=false;}
  }
  find('skills-refresh').onclick=()=>load(true);
  find('skills-search').oninput=render;find('skills-source').onchange=render;find('skills-cache').onchange=render;
  window.MAMBA_SKILLS={load};
})();
