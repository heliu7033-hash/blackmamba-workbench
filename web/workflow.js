'use strict';
window.MAMBA_WORKFLOW = {
  sections: [
    {id:'brief', name:'客户简报', short:'简报', owner:'制片助手 · 制片统筹', handoff:'已确认的项目简报', checks:['商业目标与受众已确认','产品卖点与真实属性已核对','平台、时长、画幅与交付规格已确认','预算、档期与审批人已确认','客户提供素材及授权已登记']},
    {id:'creative', name:'创意与导演方案', short:'导演方案', owner:'导演 · 导演 / 创意', handoff:'锁定脚本、分镜与声音意图', checks:['核心创意与情绪转折已说明','台词、旁白和时长已核对','分镜有镜号、时长、景别和动作','产品还原与视觉参考已确认','素材需求与音乐情绪线已交接']},
    {id:'preproduction', name:'前期筹备', short:'前期', owner:'制片助手统筹 · 导演导演', handoff:'拍摄计划与测试结果', checks:['拍摄日期、场地与通告已确认','器材、灯光、道具和人员已核对','场地、肖像、音乐与素材授权已核对','关键镜头和安全镜头已列入拍摄单','样品、反光、景深或 AI 合成测试已复核']},
    {id:'production', name:'拍摄 / 制作', short:'拍摄', owner:'导演 · 导演 / 摄影', handoff:'拍摄素材与现场记录', checks:['按拍摄单完成关键镜头','产品颜色、包装和标签保持准确','补拍空镜、底板、干净产品镜头与声音','记录素材卡、镜头备注和现场问题','完成双份素材备份并核对文件']},
    {id:'edit', name:'素材整理与粗剪', short:'粗剪', owner:'剪辑 · 项目协作', handoff:'可播放粗剪与时间码反馈表', checks:['素材按场次、镜号和内容整理','同步声音并筛选可用镜头','粗剪故事顺序与真实时长成立','提交带版本号的可播放预览','反馈按时间码、问题和责任人整理']},
    {id:'finish', name:'精剪与画面包装', short:'精剪', owner:'剪辑 · 导演复核', handoff:'锁画版本与图像包装', checks:['客户 / 导演反馈逐条确认','画面节奏、转场和产品镜头通过','颜色符合品牌 VI 且不篡改产品色','字幕、图形、片尾和安全区通过','锁画前确认所有修改已回写']},
    {id:'sound', name:'配乐、混音与总验', short:'声音 / 总验', owner:'音乐协作 · 制片助手统筹', handoff:'总验通过的母版', checks:['音乐结构、速度、高潮和停顿符合情绪线','音乐来源、授权范围与使用平台已登记','人声、音乐、音效层次与避让已检查','同步、黑帧、水印、字幕和音量已检查','总验问题清零或标记客户待确认']},
    {id:'delivery', name:'交付、归档与复盘', short:'交付', owner:'制片助手 · 制片统筹', handoff:'客户交付包与可追溯归档', checks:['按平台编码、帧率、画幅和命名导出','实际播放成片并核对画面与声音','交付链接、版本和客户确认已记录','工程、授权、素材清单与最终文件已归档','复盘记录成本、问题和可复用经验']}
  ],
  roles: [
    {name:'制片助手', role:'总管 / 制片统筹', output:'项目简报 · 派工目标 · 依赖 · 版本核验 · 交付验收'},
    {name:'导演', role:'导演兼创意文案', output:'核心创意 · 脚本 · 分镜 · 素材需求 · 音乐情绪线'},
    {name:'剪辑协作', role:'剪辑 / 包装', output:'素材整理 · 粗剪时间码 · 精剪 · 字幕包装 · 工程'},
    {name:'音乐协作', role:'BGM / 混音', output:'配乐结构 · 来源授权 · 音效 · 最终混音'}
  ]
};

// Each checkbox and record keeps its original section key in backups and local storage.
const phaseDefinitions = [
  ['brief','创意方案',['brief','creative'],'项目简报、脚本与分镜'],
  ['preproduction','素材制作',['preproduction','production'],'准备事项、实拍与生成素材'],
  ['edit','剪辑后期',['edit','finish','sound'],'剪辑版本、画面与声音总验'],
  ['delivery','交付归档',['delivery'],'交付物、验收记录与归档']
];
window.MAMBA_WORKFLOW.stages = phaseDefinitions.map(([id,name,sections,handoff]) => {
  const checks = sections.flatMap(key => {
    const section = window.MAMBA_WORKFLOW.sections.find(s => s.id === key);
    return section.checks.map((label,index) => ({key,index,label}));
  });
  return {id,name,short:name,sections,checks,handoff};
});
function phaseFor(id) {
  return window.MAMBA_WORKFLOW.stages.find(phase => phase.sections.includes(id));
}
function checkedAt(project, check) {
  return project?.checks?.[check.key]?.[check.index] === true;
}
function checklistControl(project, check, className) {
  const row = el('label',className), input=el('input');
  input.type='checkbox'; input.checked=checkedAt(project,check); input.disabled=!project;
  input.onchange=()=>{
    const current=items.find(p=>p.id===project.id);
    if (!current) return;
    const checks={...current.checks},values=[...(checks[check.key]||[])];
    values[check.index]=input.checked;checks[check.key]=values;
    if (!persist(items.map(p=>p.id===project.id?{...p,checks,updatedAt:Date.now()}:p))) input.checked=!input.checked;
    else {
      const selector='input[data-check="'+check.key+'-'+check.index+'"]';
      const replacement=[...document.querySelectorAll(selector)].find(n=>!n.closest('[hidden]') && (!n.closest('dialog') || n.closest('dialog').open));
      if(replacement){let details=replacement.closest('details');while(details){details.open=true;details=details.parentElement?.closest('details');}replacement.focus({preventScroll:true});}
    }
  };
  input.dataset.check=check.key+'-'+check.index;row.append(input,el('span','',check.label));return row;
}
