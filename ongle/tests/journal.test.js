import test from 'node:test';
import assert from 'node:assert/strict';
import {addDays,blankJournal,checkKey,dayStats,demoJournal,isDateKey,slotsOn} from '../src/model.js';
import {referenceResponse} from '../server/reference.js';

test('a slot or prescription change tomorrow cannot move yesterday’s confirmed dose',()=>{
  const data=blankJournal();
  data.meds=[{id:'a',from:'2026-03-01',until:'2026-04-01',slotIds:['morning']},{id:'a',from:'2026-04-01',slotIds:['noon','evening']}];
  data.checks[checkKey('2026-03-31','morning','a')]=true;
  assert.deepEqual(dayStats(data,'2026-03-31'),{total:1,done:1,actualCount:1});
  assert.deepEqual(dayStats(data,'2026-04-01'),{total:2,done:0,actualCount:0});
  data.slots.find(s=>s.id==='evening').until='2026-04-02';
  assert.equal(slotsOn(data,'2026-04-01').length,3);
  assert.deepEqual(dayStats(data,'2026-04-02'),{total:1,done:0,actualCount:0});
});
test('demo is opt-in, isolated, and relative to the local calendar',()=>{
  const real=blankJournal(),sample=demoJournal('2024-03-01');
  assert.equal(addDays('2024-03-01',-1),'2024-02-29');
  assert.equal(isDateKey('2025-02-29'),false);
  assert.equal(isDateKey('2024-02-29'),true);
  assert.ok(sample.entries['2024-02-29']);assert.deepEqual(real.entries,{});
  sample.slots[0].time='03:00';assert.equal(real.slots[0].time,'08:00');
});
test('public reference endpoint accepts only a known ID and never forwards records or an arbitrary URL',async()=>{
  const seen=[], lookup=async id=>{seen.push(id);return {id};};
  for(const q of ['id=https://example.org','id=mayo-crp&value=2','id=mayo-crp&id=mayo-crp','note=x']){
    const res=await referenceResponse(new Request('https://example.invalid/api/lab-reference?'+q),lookup);
    assert.equal(res.status,400);
  }
  const post=await referenceResponse(new Request('https://example.invalid/api/lab-reference?id=mayo-crp',{method:'POST'}),lookup);assert.equal(post.status,405);
  assert.deepEqual(seen,[]);
  const ok=await referenceResponse(new Request('https://example.invalid/api/lab-reference?id=mayo-crp'),lookup);assert.equal(ok.status,200);assert.deepEqual(seen,['mayo-crp']);
  const fail=await referenceResponse(new Request('https://example.invalid/api/lab-reference?id=mayo-crp'),async()=>{throw Error('unverified');});assert.equal(fail.status,503);
});
