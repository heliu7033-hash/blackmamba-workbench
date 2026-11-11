import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {metadata,scanSkills} from '../skills-inventory.mjs';
assert.deepEqual(metadata('---\nname: "test"\ndescription: >\n  first line\n  second line\n---\nSECRET BODY'),{name:'test',description:'first line second line'});
assert.equal(metadata('no frontmatter'),null);
assert.equal(metadata('---\nname: sample\ndescription: first line\n  second line\n---').description,'first line second line');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'mamba-skills-'));
const write=(name,text)=>{const p=path.join(home,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);return p;};
const skill=(name,desc='Test description')=>`---\nname: ${name}\ndescription: ${desc}\n---\nPRIVATE_SKILL_BODY_DO_NOT_EXPOSE`;
try {
  write('.codex/skills/alpha/SKILL.md',skill('alpha'));
  write('.agents/skills/alpha/SKILL.md',skill('alpha'));
  write('.agents/.skill-lock.json',JSON.stringify({skills:{alpha:{source:'example/repo',sourceUrl:'https://example.com/repo'}}}));
  write('.codex/skills/.system/system/SKILL.md',skill('system'));
  write('.codex/skills/pack/skills/nested/SKILL.md',skill('nested'));
  write('.codex/skills/invalid/SKILL.md','---\ndescription: missing name\n---');
  write('.dsh/skills/linked/SKILL.md',skill('linked'));
  fs.symlinkSync(path.join(home,'.dsh/skills/linked'),path.join(home,'.codex/skills/linked'),'junction');
  fs.symlinkSync(path.join(home,'.codex/skills'),path.join(home,'.codex/skills/cycle'),'junction');
  fs.symlinkSync(path.join(home,'missing'),path.join(home,'.codex/skills/broken'),'junction');
  write('secrets/SKILL.md',skill('not-a-skill-root'));
  fs.symlinkSync(path.join(home,'secrets'),path.join(home,'.codex/skills/outside'),'junction');
  write('.codex/config.toml','[plugins."enabled@market"]\nenabled = true\n\n[plugins."disabled@market"]\nenabled = false\n\n[other]\nsecret = "DO_NOT_EXPOSE"\n');
  for(const plugin of ['enabled','cached','disabled']) {
    write(`.codex/plugins/cache/market/${plugin}/1.0/.codex-plugin/plugin.json`,JSON.stringify({name:plugin,version:'1.0',skills:'./skills/'}));
    write(`.codex/plugins/cache/market/${plugin}/1.0/skills/entry/SKILL.md`,skill(plugin));
  }
  fs.symlinkSync(path.join(home,'.codex/plugins/cache/market/enabled/1.0'),path.join(home,'.codex/plugins/cache/market/enabled/latest'),'junction');
  let result=scanSkills({home});
  assert.deepEqual(result.summary,{installedEntries:6,installedNames:5,cachedEntries:2,allEntries:8});
  assert.equal(result.entries.find(x=>x.name==='enabled').state,'configured');
  assert.equal(result.entries.find(x=>x.name==='disabled').state,'disabled');
  assert.equal(result.entries.find(x=>x.name==='cached').state,'cached');
  assert.equal(result.entries.filter(x=>x.name==='alpha').length,2);
  assert.equal(result.entries.find(x=>x.name==='alpha'&&x.group==='shared').provenance.label,'example/repo');
  assert(result.entries.find(x=>x.name==='linked').realPath.endsWith(path.join('.dsh','skills','linked','SKILL.md')));
  assert(!JSON.stringify(result).includes('PRIVATE_SKILL_BODY_DO_NOT_EXPOSE'));
  assert(!JSON.stringify(result).includes('not-a-skill-root'));
  assert(!JSON.stringify(result).includes('DO_NOT_EXPOSE'));
  assert(result.warnings.length>=4);
  write('.codex/skills/new/SKILL.md',skill('fresh'));
  assert.equal(scanSkills({home}).summary.installedEntries,7);
  console.log('PASS: skill metadata, nested skills, duplicates, source evidence, plugin states, symlinks, cycles, restricted roots, fresh rescan, no private bodies/config values');
} finally {fs.rmSync(home,{recursive:true,force:true});}
