// Pass this function to playwright-cli run-code in a fresh, isolated browser.
// Serve a local build with MAMBA_PORT=18772 and a temporary MAMBA_DATA_DIR.
// Never run against a real browser profile: this check sets the test origin's data.
async page => {
 await page.goto('http://127.0.0.1:18772/');
 await page.evaluate(() => localStorage.setItem('blackmamba.command.v1', '[]'));
 const assert = (ok, message) => { if (!ok) throw new Error(message); };
 const state = () => page.evaluate(() => ({palette: document.querySelector('#command-palette').open, editor: document.querySelector('#editor').open, active: document.activeElement.id}));
 await page.reload();
 await page.locator('#command-trigger').click();
 assert((await state()).active === 'command-search', 'initial focus');
 await page.locator('#command-search').fill('剧组流程');
 assert(await page.locator('.command-item:visible').count() === 1, 'search');
 await page.keyboard.press('Enter');
 assert(await page.locator('#workflow-view').isVisible(), 'Enter executes filtered action');
 await page.keyboard.press('Meta+k');
 await page.keyboard.down('Meta'); await page.keyboard.down('k'); await page.keyboard.down('k'); await page.keyboard.up('k'); await page.keyboard.up('Meta');
 assert(!(await state()).palette, 'repeat does not reopen');
 await page.keyboard.press('Control+k');
 await page.locator('#command-search').fill('无匹配命令');
 await page.keyboard.press('Enter');
 assert((await state()).palette, 'empty match stays open');
 await page.keyboard.press('Escape');
 await page.waitForFunction(() => document.activeElement.id === 'command-trigger');
 await page.keyboard.press('Meta+k');
 await page.keyboard.press('Alt+1');
 assert((await state()).editor && !(await state()).palette, 'new opens only editor');
 await page.locator('[name=name]').first().fill('隔离验收未保存');
 await page.keyboard.press('Meta+k');
 assert(!(await state()).palette, 'editor not interrupted');
 await page.keyboard.press('Escape');
 assert(await page.evaluate(() => localStorage.getItem('blackmamba.command.v1')) === '[]', 'cancel preserves storage');
 await page.keyboard.press('Meta+k'); await page.keyboard.press('Alt+2');
 assert(await page.locator('#workflow-view').isVisible(), 'workflow shortcut');
 await page.keyboard.press('Meta+k'); await page.keyboard.press('Alt+3');
 assert(await page.locator('#list-title').textContent() === '制作项目', 'projects shortcut');
 await page.keyboard.press('Meta+k');
 const downloadPromise = page.waitForEvent('download');
 await page.keyboard.press('Alt+4');
 const download = await downloadPromise;
 await download.saveAs('/tmp/mamba-isolated-backup.json');
 assert(!(await state()).palette, 'backup closes');
 await page.keyboard.press('Meta+k'); await page.keyboard.press('Tab');
 assert(await page.locator('.command-item').first().evaluate(el => el === document.activeElement), 'Tab reaches action');
 await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
 assert((await state()).active === '', 'close button reachable');
 await page.keyboard.press('Enter');
 assert(!(await state()).palette, 'close button works');
 return 'PASS: search/Enter, no-match, Meta/Control+K, repeat, Escape/focus, Tab, Alt+1..4, cancel/storage, isolated backup';
}
