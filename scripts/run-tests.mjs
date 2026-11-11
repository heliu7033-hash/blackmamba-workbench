import {spawnSync} from 'node:child_process';
import {findTool} from '../runtime-platform.mjs';
const tests=['test-platform.mjs','test-skills.mjs','test-skills-ui.mjs','test-cloud-preflight.mjs','test-workflow.mjs','test-project-tree.mjs','test-production-records.mjs','test-postproduction.mjs','test-workflow-handoffs.mjs','test-production-materials.mjs','test-stage-references.mjs','build-local.mjs','test-local.mjs','test-server.py','test-mcp.mjs','test-creative.mjs','test-media.mjs','test-resolve-media.py'];
for(const file of tests){
  const executable=file.endsWith('.py')?findTool('python3'):process.execPath;
  if(!executable)throw Error('Python is required for tests');
  const result=spawnSync(executable,['scripts/'+file],{stdio:'inherit',env:process.env,windowsHide:true});
  if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
}
