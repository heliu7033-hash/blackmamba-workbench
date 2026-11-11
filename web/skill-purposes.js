'use strict';

// Match the stated purpose of each installation. Identical names can describe different work.
const skillPurposes = [
  ['创意与文案', /ad creative|creative concepts|copywriting|导演提案|创意文案/i],
  ['音频与配音', /OmniVoice|语音合成|生成.{0,12}配音|audio mixing|synthesize speech|voice.?over generation/i],
  ['系统与技能管理', /managed (?:Codex Cloud|cloud environment)|setup\/auth|discover and install agent skills|capcut plugin updates|migrate supported instruction|Codex models\/pricing|reusable personal Codex artifact-template|(?:create or update a Codex|install Codex) skill|插件管理|自定义 Skill|manage plugin connections|discover and suggest relevant plugins|in ChatGPT Work mode|a[n]? (?:explicit|custom) pet/i],
  ['开发与测试', /GitHub PR|GitHub pull request|code change|security best-practice|automating a real browser|应用开发与托管|原生 OpenAPI 探索|NDJSON|build an app with|upgrade remotion|site built|website built|remix a site/i],
  ['设计与视觉', /dashboard UI|UI\/UX design intelligence|封面图和配图|raster images|visualizations and interactive tools|generate images(?: and videos|\/videos)/i],
  ['视频与动画', /After Effects|animation|animated background|动画|视频素材包|动效 MP4|讲解视频|beat|video and image segments|to CapCut|motion piece|turn a narrative script|short film|motion graphics|motion videos|kinetic type|edit videos|cinematic product videos|product advertisements|video templates|editing in CapCut|Remotion|animating captions|Mediabunny|character performance|compose a frame|VI \/ 品牌规范用到视频/i],
  ['办公与协作', /\b(?:pdf|word|docx|spreadsheet|presentation|workbook|excel|ppt|document|Google Drive|Google Slides|Google Sheets|Google Docs|issues, projects|ChatGPT Pages|Page\/Space|ChatGPT Space|template)\b|飞书|lark-meeting|会议纪要|日程待办|download any link|演示文稿/i]
];
function skillPurpose(item) {
  const description = (item.description || '').slice(0,300);
  return skillPurposes.find(([,match]) => match.test(description))?.[0] || '其他';
}
