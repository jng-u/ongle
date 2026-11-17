/** Local production smoke test. Build first. Requires Playwright and its Chromium browser. */
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import app from '../dist/server/index.js';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const journalKey = 'ongyeol.journal.v1';
const passphrase = 'synthetic-test-password';
const server = createServer(async (req, res) => {
  try {
    const result = await app.fetch(new Request(new URL(req.url, 'http://localhost'), {method:req.method, headers:req.headers}));
    res.writeHead(result.status, Object.fromEntries(result.headers));
    res.end(Buffer.from(await result.arrayBuffer()));
  } catch { res.writeHead(500); res.end(); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch();
  const context = await browser.newContext({viewport:{width:390,height:844}, timezoneId:'Asia/Seoul'});
  const page = await context.newPage();
  const uncaught = [];
  page.on('pageerror', error => uncaught.push(error.message));
  page.setDefaultTimeout(10000);
  const form = page.getByRole('dialog');
  const go = async name => { await page.goto(origin + '/#' + name); await page.locator('main').waitFor(); };
  const journal = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), journalKey);
  const openDiary = async (p=page) => {
    await p.goto(origin + '/#diary');
    await p.getByRole('button', {name:/기록 남기기|기록 수정/}).first().click();
  };
  const saveNote = async note => {
    await openDiary(); await form.locator('textarea').fill(note);
    await form.getByRole('button', {name:'저장',exact:true}).click();
    await form.waitFor({state:'hidden'});
  };
  await saveNote('합성 테스트');
  await page.reload();
  assert.equal(Object.values((await journal()).entries)[0].note, '합성 테스트');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await go('diary'); await page.getByText('합성 테스트', {exact:true}).first().waitFor();
  await go('meds'); await page.getByRole('button', {name:'약 추가',exact:true}).first().click();
  await form.locator('#medicine-search').fill('펜타사'); await form.locator('.medicine-result button').first().waitFor();
  await context.setOffline(false); await page.keyboard.press('Escape');
  console.log('PASS: offline relaunch, persisted diary, local drug search');

  const exportFile = async () => {
    await go('settings');
    const fields = page.locator('form').filter({hasText:'암호화 파일로 저장'});
    await fields.locator('input[type=password]').nth(0).fill(passphrase);
    await fields.locator('input[type=password]').nth(1).fill(passphrase);
    const download = page.waitForEvent('download');
    await fields.getByRole('button', {name:'백업 파일 저장'}).click();
    return readFile(await (await download).path());
  };
  const restore = async bytes => {
    await go('settings');
    const fields = page.locator('form').filter({hasText:'백업 파일 불러오기'});
    await fields.locator('input[type=file]').setInputFiles({name:'test.json',mimeType:'application/json',buffer:bytes});
    await fields.locator('input[type=password]').fill(passphrase);
    await fields.getByRole('button', {name:/복원 미리보기/}).click();
    await page.locator('.backup-consent input').check();
    await page.getByRole('button', {name:'현재 기록 교체하기'}).click();
    await page.waitForFunction(key => Object.values(JSON.parse(localStorage.getItem(key)).entries)[0].note === '합성 테스트', journalKey);
  };
  const backup = await exportFile();
  assert.ok(!backup.toString().includes('합성 테스트'));
  await saveNote('바뀐 메모'); await restore(backup);
  await openDiary();
  const tab = await context.newPage();
  await openDiary(tab);
  await form.locator('textarea').fill('첫 번째 창에서 변경');
  await form.getByRole('button', {name:'저장', exact:true}).click();
  await tab.waitForFunction(key => Object.values(JSON.parse(localStorage.getItem(key)).entries)[0].note === '첫 번째 창에서 변경', journalKey);
  const otherForm = tab.getByRole('dialog');
  await otherForm.locator('.records-moods button').first().click();
  await otherForm.getByRole('button', {name:'저장', exact:true}).click(); await otherForm.waitFor({state:'hidden'});
  assert.equal(Object.values((await journal()).entries)[0].note, '첫 번째 창에서 변경');
  await tab.close();
  await saveNote('가'.repeat(20001)); assert.ok((await exportFile()).length > 20000);
  await page.evaluate(key => localStorage.setItem(key,'{'), journalKey);
  await page.reload(); await restore(backup);
  console.log('PASS: encrypted backup, normal and damaged journal restore, long notes, two-tab merge');

  for (const [name, mode] of [['테스트 정기약','daily'], ['테스트 필요시약','prn']]) {
    await go('meds'); await page.getByRole('button',{name:'약 추가',exact:true}).first().click();
    await form.getByPlaceholder('약 봉투에 적힌 이름').fill(name);
    await form.getByPlaceholder('예: 2정, 1포, 5mL').fill('1정');
    await form.getByLabel('복약 주기').selectOption(mode);
    if (mode !== 'prn') await form.getByRole('checkbox',{name:/아침/}).check();
    await form.getByRole('button',{name:'저장',exact:true}).click(); await form.waitFor({state:'hidden'});
  }
  await go('today'); await page.getByRole('button',{name:/아침 테스트 정기약 복용 체크/}).click();
  await page.locator('.prn-doses button').first().click();
  assert.equal(Object.keys((await journal()).checks).length,2);
  await go('meds'); await page.getByRole('button',{name:'테스트 정기약 수정'}).click();
  await form.getByRole('checkbox',{name:/저녁/}).check(); await form.getByRole('checkbox',{name:/아침/}).uncheck();
  await form.getByRole('button',{name:'저장',exact:true}).click(); await form.waitFor({state:'hidden'});

  await go('settings'); await page.getByRole('button',{name:'요약 보기'}).click();
  await form.getByLabel('요약 기간').selectOption('custom');
  const day = Object.keys((await journal()).entries)[0];
  await form.getByLabel('시작일').fill(day); await form.getByLabel('종료일').fill(day);
  await form.getByLabel('복용 당시 약과 용량 포함').check();
  const report = form.locator('.summary-sheet');
  assert.match(await report.innerText(), /기록 2회/);
  assert.match(await report.innerText(), /아침 08:00 · 테스트 정기약 1정/);
  assert.match(await report.innerText(), /필요시\s+· 테스트 필요시약 1정/);
  assert.equal(await report.textContent(), await page.locator('.ongle-print-sheet .summary-sheet').textContent());
  assert.ok((await page.pdf({format:'A4'})).length > 1000);
  await form.getByLabel('시작일').fill('');
  assert.equal(await form.getByRole('button',{name:/요약 인쇄/}).isDisabled(), true);
  assert.deepEqual(uncaught, []);
  console.log('PASS: actual doses survive schedule edits; PRN, custom dates and print');
} finally {
  try { await browser?.close(); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
