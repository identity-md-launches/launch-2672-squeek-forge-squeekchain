// Browser validation only. Playwright lives OUTSIDE the repository; it is never a site dependency.
// API snapshots below are fetched from the public sources at run time, and stored only in scratch.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath=process.env.SQUEEK_PLAYWRIGHT;
const {chromium,webkit}=await import(modulePath?pathToFileURL(modulePath).href:'playwright');
const root=resolve('.');
const out=join(root,'test/scratch/interaction');
await mkdir(out,{recursive:true});
const urls={status:'https://api.squeekchain.com/v1/status',settlements:'https://api.squeekchain.com/v1/settlements?range=24h',economy:'https://api.squeekchain.com/v1/economy/state'};
const fixtures={};
for (const [key,url] of Object.entries(urls)) {
  const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
  assert.ok(response.ok,`Public fixture ${key}: HTTP ${response.status}`);
  fixtures[key]=await response.json();
  await writeFile(join(out,`${key}.json`),JSON.stringify(fixtures[key],null,2));
}
const clone=x=>JSON.parse(JSON.stringify(x));
const fmt=x=>BigInt(x).toLocaleString('en-US');
const results=[];
const record=(name,detail)=>{results.push({name,passed:true,detail});console.log('PASS',name,detail||'');};
const server=createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    assert.ok(pathname.startsWith('/preview/'));
    const file=join(root,'dist',pathname.slice('/preview/'.length)||'index.html');
    assert.ok(file.startsWith(join(root,'dist')+'/'));
    const data=await readFile(file);
    res.writeHead(200,{'Content-Type':file.endsWith('.png')?'image/png':'text/html; charset=utf-8'});res.end(data);
  } catch {res.writeHead(404);res.end('Not found');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const url=`http://127.0.0.1:${server.address().port}/preview/`;
const browser=await chromium.launch({headless:true});
try {
  // One real network pass, without interception, tests CORS and the <10-second initial load.
  const live=await browser.newPage({viewport:{width:390,height:844}});
  const liveErrors=[],liveConsole=[];
  live.on('pageerror',e=>liveErrors.push(e.message));
  live.on('console',m=>{if(m.type()==='error')liveConsole.push(m.text());});
  const start=Date.now();await live.goto(url);
  await live.waitForFunction(()=>['idle','spinning'].includes(document.body.dataset.state),null,{timeout:9500});
  const loaded=Date.now()-start;
  const actual=await live.evaluate(()=>Object.fromEntries(['work','height','progress','rpm','speed','minted','rounds','day-work','settlement-count'].map(id=>[id,document.getElementById(id).textContent])));
  for (const value of Object.values(actual)) assert.ok(value && value!=='…',`Live value: ${value}`);
  assert.equal(liveErrors.length,0,JSON.stringify(liveErrors));assert.equal(liveConsole.length,0,JSON.stringify(liveConsole));
  await live.screenshot({path:join(out,'390-live.png')});
  record('live CORS + complete initial values',`${loaded} ms; zero page/console errors; ${JSON.stringify(actual)}`);
  await live.close();

  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  const uncaught=[];page.on('pageerror',e=>uncaught.push(e.message));
  await page.clock.install();
  let payload=clone(fixtures);
  const modes={status:'valid',settlements:'valid',economy:'valid'};
  const counts={status:0,settlements:0,economy:0};
  let releases=[];
  await context.route('https://api.squeekchain.com/**',async route=>{
    const key=route.request().url().includes('/economy/')?'economy':route.request().url().includes('/settlements')?'settlements':'status';
    counts[key]++;
    const mode=modes[key];
    if(mode==='abort') return route.abort('internetdisconnected');
    if(mode==='hold') await new Promise(done=>releases.push(done));
    if(mode==='hang') return;
    return route.fulfill({status:mode==='http'?503:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:mode==='empty'?'{}':mode==='json'?'{':JSON.stringify(payload[key])});
  });
  const ready=()=>page.waitForFunction(()=>!document.getElementById('refresh').disabled);
  const refresh=async()=>{await page.locator('#refresh').click();await ready();};
  const text=id=>page.locator('#'+id).textContent();
  const state=()=>page.locator('body').getAttribute('data-state');
  const snapshot=()=>page.evaluate(()=>({work:document.getElementById('work').textContent,minted:document.getElementById('minted').textContent,rounds:document.getElementById('rounds').textContent,day:document.getElementById('day-work').textContent,chart:document.getElementById('work-chart').toDataURL(),hours:document.getElementById('hour-table').textContent,recent:document.getElementById('settlements').textContent}));
  await page.goto(url);await ready();
  assert.equal(await text('work'),fmt(payload.status.measurement.cumulativeWorkUnits));
  assert.equal(await text('progress'),Math.floor(Number(payload.status.builder.anchor.blockProgress)/1e9*100)+'%');
  assert.equal(await page.locator('.station').count(),5);
  assert.ok((await page.locator('#refresh').boundingBox()).y<844);
  assert.ok((await page.locator('#workshop').boundingBox()).y<844);
  record('initial parse + first phone screen','Five smiths, visible product and refresh action; anchor progress uses floor.');

  const recent=payload.settlements.recentSettlements;
  assert.ok(recent.length>0,'Real fixture has recentSettlements');
  assert.equal(await page.locator('.settlement-row').count(),Math.min(5,recent.length));
  const topRecent=[...recent].sort((a,b)=>Date.parse(b.blockTimestamp)-Date.parse(a.blockTimestamp))[0];
  const first=await page.locator('.settlement-row').first().textContent();
  for (const value of ['#'+fmt(topRecent.settledThroughRound),'+'+fmt(topRecent.workAdded),fmt(topRecent.completedBlockCount)]) assert.ok(first.includes(value),value);
  assert.equal(await page.locator('.settlement-row time').first().getAttribute('datetime'),topRecent.blockTimestamp);
  await page.locator('#show-more').click();assert.equal(await page.locator('.settlement-row').count(),recent.length);
  await page.locator('#show-more').click();assert.equal(await page.locator('.settlement-row').count(),5);
  record('true recent settlements + expand/collapse',`${recent.length} real records; exact round, work, blocks, timestamp.`);

  await page.locator('#rank-yan').click();
  assert.equal(await page.locator('#smith-yan').getAttribute('aria-pressed'),'true');
  assert.ok((await text('selection-note')).includes('演示分配'));
  await page.locator('#smith-li').click();assert.equal(await page.locator('#rank-li').getAttribute('aria-pressed'),'true');
  const allocation=await page.evaluate(()=>{
    const buckets=validateSettlements(JSON.parse(localStorage.getItem('squeek-forge-cache-v1')).raw.settlements).buckets;
    const a=allocate(buckets),b=allocate(buckets);
    return {a:a.map(s=>s.work.toString()),b:b.map(s=>s.work.toString()),sum:a.reduce((n,s)=>n+s.work,0n).toString(),total:buckets.reduce((n,b)=>n+b.work,0n).toString()};
  });
  assert.deepEqual(allocation.a,allocation.b);assert.equal(allocation.sum,allocation.total);
  const ranks=await page.locator('#rank-list').textContent();await refresh();assert.equal(await page.locator('#rank-list').textContent(),ranks);
  record('smith selection + deterministic conservation',`Same buckets reproduce ranks; assigned work sums to ${allocation.total}.`);

  await page.locator('#rank-yan').focus();
  await page.evaluate(()=>renderRanks());
  assert.equal(await page.evaluate(()=>document.activeElement.id),'rank-yan');
  await page.evaluate(()=>{const original=smiths;smiths=smiths.map(s=>({...s,work:s.id==='yan'?0n:999999n}));renderRanks();smiths=original;renderRanks();});
  assert.equal(await page.evaluate(()=>document.activeElement.id),'rank-yan');
  record('ranking refresh preserves keyboard focus','Focus survives unchanged rows and real reordering.');

  await page.locator('#work-chart').focus();await page.keyboard.press('Home');
  const firstStamp=payload.settlements.buckets[0].startAt;
  assert.equal(await page.locator('#chart-inspector time').getAttribute('datetime'),firstStamp);
  await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#chart-inspector time').getAttribute('datetime'),payload.settlements.buckets[1].startAt);
  await page.locator('#hour-next').click();assert.equal(await page.locator('#chart-inspector time').getAttribute('datetime'),payload.settlements.buckets[2].startAt);
  await page.locator('summary').click();assert.equal(await page.locator('#hour-table tr').count(),24);
  await page.locator('summary').click();
  record('chart keyboard + controls + accessible table','Home, ArrowRight, next hour and native disclosure show exact API startAt.');
  const chartBox=await page.locator('#work-chart').boundingBox();
  const slot=(chartBox.width-51)/24;
  await page.mouse.move(chartBox.x+43+8.5*slot,chartBox.y+80);
  assert.equal(await page.locator('#chart-inspector time').getAttribute('datetime'),payload.settlements.buckets[8].startAt);
  await page.locator('#work-chart').dispatchEvent('pointerdown',{pointerType:'touch',clientX:chartBox.x+43+4.5*slot,clientY:chartBox.y+80});
  assert.equal(await page.locator('#chart-inspector time').getAttribute('datetime'),payload.settlements.buckets[4].startAt);
  record('chart pointer + touch','Mouse hover and touch select the corresponding real hourly bucket.');

  const before=await snapshot();
  for (const key of ['status','settlements','economy']) {
    modes[key]='empty';await refresh();assert.equal(await state(),'error');
    assert.equal(await text('status-message'),'数据拉取失败，10 秒后重试');
    const after=await snapshot();
    assert.equal(after.work,before.work);assert.equal(after.minted,before.minted);assert.equal(after.day,before.day);assert.equal(after.hours,before.hours);assert.equal(after.chart,before.chart);
    modes[key]='valid';await refresh();
  }
  record('HTTP 200 {} validation, each endpoint','All three reject missing required fields, extinguish FORGE, preserve valid values and canvas.');

  modes.status='empty';payload.economy.supply.totalMintedBaseUnits=(BigInt(payload.economy.supply.totalMintedBaseUnits)+1000000000000000000n).toString();
  await refresh();assert.equal(await text('work'),before.work);assert.notEqual(await text('minted'),before.minted);
  modes.status='valid';modes.settlements='empty';payload.status.measurement.cumulativeWorkUnits=(BigInt(payload.status.measurement.cumulativeWorkUnits)+100n).toString();
  await refresh();assert.equal(await text('work'),fmt(payload.status.measurement.cumulativeWorkUnits));assert.equal(await text('day-work'),before.day);
  modes.settlements='valid';modes.economy='empty';payload.settlements.summary.workAdded=(BigInt(payload.settlements.summary.workAdded)+1n).toString();
  await refresh();assert.equal(await text('day-work'),fmt(payload.settlements.summary.workAdded));
  modes.economy='valid';await refresh();
  record('independent endpoint updates','Status/economy/settlements can update while another endpoint retains its previous cache.');

  const protectedState=await snapshot();
  modes.status='json';modes.settlements='abort';modes.economy='http';await refresh();
  assert.equal(await state(),'error');const failures=await snapshot();
  for(const key of ['work','minted','day','hours','chart'])assert.equal(failures[key],protectedState[key],key);
  assert.equal(await page.locator('.status-light').evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'390-error.png')});
  record('JSON parse + transport + HTTP failure','No uncaught errors; unchanged numbers and canvas; offline state and recovery control visible.');

  const oldLabels=await text('hour-table');const oldRange=await text('chart-range');
  await page.clock.setSystemTime(new Date(Date.now()+7200000));
  await refresh();assert.equal(await text('hour-table'),oldLabels);assert.equal(await text('chart-range'),oldRange);
  const calls=counts.status;await page.clock.fastForward(10020);await ready();assert.equal(counts.status,calls+1);
  record('cross-hour caching + automatic retry','Clock advanced two hours; all 24 startAt labels stay fixed. Retry triggers after 10 seconds.');
  for(const key of Object.keys(modes))modes[key]='valid';await refresh();assert.notEqual(await state(),'error');
  record('recovery after failures','A successful retry restores truthful IDLE/SPINNING state.');

  payload.status.measurement.coreStatus='SPINNING';payload.status.measurement.rpmMilli=60000;payload.status.builder.anchor.blockProgress='129999999';
  await refresh();assert.equal(await state(),'spinning');assert.equal(await text('progress'),'12%');
  const period=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--spin-duration'));
  assert.equal(period,'1s');
  assert.equal(await page.locator('.grinding-wheel').first().evaluate(e=>getComputedStyle(e).animationName),'spin');
  payload.status.measurement.rpmMilli=120000;await refresh();
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--spin-duration')),'0.5s');
  await page.locator('#motion').click();assert.equal(await page.locator('.grinding-wheel').first().evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.locator('#motion').click();await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.grinding-wheel').first().evaluate(e=>getComputedStyle(e).animationName),'none');
  assert.equal(await page.locator('.status-light').evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  payload.status.measurement.coreStatus='IDLE';await refresh();assert.equal(await page.locator('.grinding-wheel').first().evaluate(e=>getComputedStyle(e).animationName),'none');
  record('rpm-linked motion, pause, reduced motion, IDLE','60 rpm = 1s; 120 rpm = 0.5s; pause/reduced-motion/IDLE stop all scene loops.');

  const realRecords=payload.settlements.recentSettlements;payload.settlements.recentSettlements=[];await refresh();
  assert.ok((await text('recent-kind')).includes('按小时汇总'));assert.ok(!(await text('settlements')).includes('#'));
  payload.settlements.recentSettlements=realRecords;payload.settlements.buckets=undefined;await refresh();
  assert.ok((await text('recent-kind')).includes('真实单笔'));assert.ok((await text('chart-range')).includes('小时缓存'));
  payload.settlements=clone(fixtures.settlements);await refresh();
  record('honest fallback + missing hourly data','Hourly fallback only for empty recentSettlements; recent-only payload preserves explicitly marked chart cache.');

  const malformed=clone(payload.settlements);malformed.recentSettlements=[{}];payload.settlements=malformed;
  const protectedRecent=await text('settlements');await refresh();assert.equal(await state(),'error');assert.equal(await text('settlements'),protectedRecent);
  payload.settlements=clone(fixtures.settlements);await refresh();
  record('malformed nonempty recent array','Rejected instead of disguising hourly buckets as individual settlements.');

  for(const width of [1440,390,320,560,561,590,760,900,901,1000,1120,1121,390]) {
    await page.setViewportSize({width,height:844});
    const measured=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,smiths:[...document.querySelectorAll('.station')].map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}))}));
    assert.equal(measured.scroll,width,JSON.stringify(measured));
    for(const s of measured.smiths){assert.ok(s.left>=0 && s.right<=width,JSON.stringify(s));}
  }
  record('responsive + immediate desktop-to-phone resize','No horizontal overflow at 320, 390, 560, 561, 590, 760, 900, 901, 1000, 1120, 1121, 1440; all five workstations stay inside the viewport.');

  // A pending request disables duplicate refreshes. Release the route without any real waiting.
  modes.status='hold';await page.locator('#refresh').click();
  await page.waitForFunction(()=>document.getElementById('refresh').disabled);
  assert.equal(await page.locator('#refresh').getAttribute('aria-busy'),'true');
  const pending=counts.status;await page.locator('#refresh').dispatchEvent('click');assert.equal(counts.status,pending);
  releases.forEach(done=>done());releases=[];modes.status='valid';await ready();
  record('pending refresh lock','Button exposes busy state and duplicate requests are suppressed.');

  // Reload from localStorage while ALL responses are invalid: saved data remains, never marked live.
  const saved=await text('work');for(const key of Object.keys(modes))modes[key]='empty';
  await page.reload();await ready();assert.equal(await text('work'),saved);assert.equal(await state(),'error');
  for(const key of Object.keys(modes))modes[key]='valid';await refresh();
  assert.equal(uncaught.length,0,JSON.stringify(uncaught));
  record('validated persisted cache + no uncaught exceptions','Reload with invalid endpoints keeps last valid numbers and reports failure.');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.keyboard.press('Tab');
  await page.locator('#refresh').focus();
  assert.equal(await page.locator('#refresh').evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
  await page.keyboard.press('Enter');await ready();
  record('keyboard refresh + focus','Refresh activates with Enter and has a visible solid focus outline.');
  await page.locator('#refresh').blur();await page.screenshot({path:join(out,'390-final.png')});
  if (process.env.SQUEEK_AXE) {
    const {default:AxeBuilder}=await import(pathToFileURL(process.env.SQUEEK_AXE).href);
    for (const width of [390,1440]) {
      await page.setViewportSize({width,height:844});
      const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
      await writeFile(join(out,`axe-${width}.json`),JSON.stringify(audit,null,2));
      assert.equal(audit.violations.length,0,JSON.stringify(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))));
    }
    record('automated accessibility audit','axe: no WCAG A/AA violations at 390 or 1440. This is not a screen-reader certification.');
  }
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:join(out,'1440-final.png'),fullPage:true});
  await context.close();

  const filePage=await browser.newPage();
  await filePage.goto(pathToFileURL(join(root,'index.html')).href);
  await filePage.waitForFunction(()=>['idle','spinning'].includes(document.body.dataset.state),null,{timeout:9500});
  record('direct file opening','Root index.html fetches public data under file://, without a server or compilation.');await filePage.close();
  let webkitResult;
  try {
    const wk=await webkit.launch({headless:true});
    const p=await wk.newPage({viewport:{width:390,height:844}});await p.goto(url);
    await p.waitForFunction(()=>['idle','spinning'].includes(document.body.dataset.state),null,{timeout:9500});
    await p.locator('#refresh').click();await p.waitForFunction(()=>!document.getElementById('refresh').disabled);
    webkitResult='PASS: WebKit initial load and refresh';await wk.close();
  } catch(e) {webkitResult='NOT VERIFIED: WebKit could not launch; missing host libraries.';}
  console.log(webkitResult);
  await writeFile(join(out,'results.json'),JSON.stringify({date:new Date().toISOString(),checks:results,webkit:webkitResult},null,2));
  console.log(`${results.length} interaction checks passed.`);
} finally {await browser.close();await new Promise(done=>server.close(done));}
