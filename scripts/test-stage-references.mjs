import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ui = vm.createContext({});
for (const script of ['stage-content','skill-purposes','workflow-references']) {
  vm.runInContext(fs.readFileSync(new URL('../web/' + script + '.js', import.meta.url), 'utf8'), ui);
}
assert.equal(ui.splitBrief('ordinary project notes')[0].text, 'ordinary project notes');
const notes = 'project intro\n【当前故事与台词】\nscript\n【素材索引】\n01. previous preview\nassets/old.mp4\nhistorical draft\n';
const parts = ui.splitBrief(notes);
assert.equal(parts[1].text, 'script');
const archive = ui.archiveMedia(parts);
assert.equal(archive.length, 1);
assert.equal(archive[0].path, 'assets/old.mp4');
assert.equal(archive[0].note, 'historical draft');
assert.equal(ui.stageRows({stageEntries: [{title:'v1'},null]}).length, 1);
assert.equal(ui.skillPurpose({name:'arbitrary-name',description:'Generate or edit raster images'}),'设计与视觉');
assert.equal(ui.skillPurpose({name:'imagegen',description:''}),'其他');
const references = vm.runInContext('workflowReferences',ui);
assert.equal(new Set(references.map(ref=>ref.url)).size,references.length);
assert(references.every(ref => ref.limits && ref.verification));
assert(references.filter(ref=>ref.candidate).every(ref=>!ref.verification.includes('资料包已独立核验')));
console.log('PASS: legacy notes, archive rows, stage records, purpose from description, reference deduplication and evidence links');
