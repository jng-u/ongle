import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/model.js';
import {saveMedicine, saveSlots} from '../src/data/drugs.js';
import {scheduledReminders, buildReminderCalendar} from '../src/data/alarms.js';
const day='2026-11-16';
const fresh=()=>({slots:[{id:'s',name:'아침',time:'08:00',from:'2026-01-01'}],meds:[{id:'m',name:'원래 약',dose:'1정',note:'식후',slotIds:['s'],from:'2026-01-01'}],checks:{},reminders:true});
test('actual snapshots and legacy checks survive retrospective corrections without becoming scheduled doses',()=>{
 const d=fresh(); d.meds[0].from=day; d.checks[`${day}|s|m`]=true;
 saveMedicine(d,'m',day,{...d.meds[0],name:'정정 약',dose:'2정'});
 assert.equal(model.actualDosesOn(d,day)[0].name,'원래 약');
 saveMedicine(d,'m','2026-11-17',d.meds.at(-1),{correctStart:true});
 assert.equal(model.dayStats(d,day).actualCount,1);
 assert.equal(model.dayStats(d,day).total,0);
 assert.equal(model.actualDosesOn(d,day)[0].dose,'1정');
});
test('weekly, alternate-day and PRN agree across schedule, stats, web and ICS',()=>{
 const d=fresh(); d.meds[0].schedule={type:'weekdays',days:[1,3]};
 assert.equal(model.dayStats(d,day).total,1);
 assert.equal(scheduledReminders(d,'2026-11-17').length,0);
 d.meds[0].schedule={type:'interval',every:2,anchor:day};
 assert.equal(model.medsOn(d,'2026-11-17').length,0);
 assert.equal(scheduledReminders(d,'2026-11-18').length,1);
 d.meds[0].schedule={type:'prn'};
 model.recordDose(d,day,'s','m',new Date('2026-11-16T00:00:00Z'));
 assert.deepEqual(model.dayStats(d,day),{total:0,done:0,actualCount:1});
 assert.equal(buildReminderCalendar(d,{startDate:day,endDate:'2026-11-20'}).eventCount,0);
});
test('slot removal cannot silently orphan future prescriptions and fails atomically',()=>{
 const d=fresh(); d.meds.push({...d.meds[0],id:'future',from:'2026-12-01'});
 const before=structuredClone(d);
 assert.throws(()=>saveSlots(d,day,[{id:'p',name:'밤',time:'21:00'}],{m:['p']}),/예약|시간/);
 assert.deepEqual(d,before);
});
test('invalid recurrence rejected without mutation',()=>{
 for(const schedule of [{type:'weekdays',days:[]},{type:'weekdays',days:[7]},{type:'interval',every:0,anchor:day},{type:'interval',every:2,anchor:'bad'},{type:'other'}]){
 const d=fresh(), before=structuredClone(d);
 assert.throws(()=>saveMedicine(d,'m',day,{...d.meds[0],schedule})); assert.deepEqual(d,before);
 }
});
test('repeated PRN doses count actual records and retain immutable snapshots after slot and prescription edits',()=>{
 const d=fresh(); d.meds[0].schedule={type:'prn'};
 const at=new Date('2026-11-16T12:00:00Z');
 const first=model.recordDose(d,day,'prn','m',at);
 const second=model.recordDose(d,day,'prn','m',at);
 assert.notEqual(first,second);
 saveMedicine(d,'m',day,{...d.meds[0],name:'다른 이름',dose:'2정'});
 saveSlots(d,day,[],{});
 assert.deepEqual(model.actualDosesOn(d,day).map(d=>d.name),['원래 약','원래 약']);
 assert.deepEqual(model.dayStats(d,day),{total:0,done:0,actualCount:2});
 delete d.checks[first]; assert.equal(model.dayStats(d,day).actualCount,1);
});
test('legacy orphan records remain actual while never creating a scheduled denominator',()=>{
 const d=fresh(); d.meds=[]; d.slots=[]; d.checks[`${day}|old|gone`]=true;
 assert.deepEqual(model.dayStats(d,day),{total:0,done:0,actualCount:1});
 assert.equal(model.actualDosesOn(d,day)[0].legacy,true);
 assert.equal(model.actualDosesOn(d,day)[0].takenAt,'');
});
test('end correction is exclusive, preserves snapshots and later versions, invalid range fails atomically',()=>{
 const d=fresh(); const future={...d.meds[0],from:'2026-12-01',dose:'예약'}; d.meds[0].until=future.from;d.meds.push(future);
 model.recordDose(d,day,'s','m',new Date('2026-11-16T12:00:00Z'));
 saveMedicine(d,'m',day,d.meds[0],{until:'2026-11-18'});
 assert.equal(model.dayStats(d,'2026-11-18').total,0);
 assert.equal(model.actualDosesOn(d,day)[0].dose,'1정');
 assert.deepEqual(d.meds.at(-2),future);
 const before=structuredClone(d);
 for(const until of [day,'bad','2026-12-02','']) {
  assert.throws(()=>saveMedicine(d,'m',day,d.meds.at(-1),{until}));assert.deepEqual(d,before);
 }
});
test('weekly and interval ICS occurrences equal web schedule over DST and month boundaries',()=>{
 const d=fresh();
 for(const schedule of [{type:'weekdays',days:[0,2,6]},{type:'interval',every:2,anchor:'2026-10-31'}]) {
  d.meds[0].schedule=schedule;
  const startDate='2026-10-29',endDate='2026-11-05';
  const {text}=buildReminderCalendar(d,{startDate,endDate});
  const starts=[];
  for(const event of text.split('BEGIN:VEVENT').slice(1)) {
   const start=event.match(/DTSTART:(\d{4})(\d{2})(\d{2})T080000/);
   const end=event.match(/UNTIL=(\d{4})(\d{2})(\d{2})T080000/);
   const first=`${start[1]}-${start[2]}-${start[3]}`, last=end ? `${end[1]}-${end[2]}-${end[3]}` : first;
   for(let date=first; date<=last; date=model.addDays(date,1)) starts.push(date.replaceAll('-',''));
  }
  const expected=[];
  for(let date=startDate;date<=endDate;date=model.addDays(date,1)) if(scheduledReminders(d,date).length) expected.push(date.replaceAll('-',''));
  assert.deepEqual(starts,expected);
 }
});
test('snapshot selectors skip all legacy lookup and preservation enumerates checks once',()=>{
 const d=fresh(); model.recordDose(d,day,'s','m',new Date('2026-11-16T12:00:00Z'));
 const snapshot=d.checks[`${day}|s|m`];
 assert.equal(model.actualDosesOn({checks:d.checks,get meds(){throw Error('snapshot must skip meds');},get slots(){throw Error('snapshot must skip slots');}},day)[0].name,snapshot.name);
 let scans=0;
 d.checks=new Proxy(Object.fromEntries(Array.from({length:100},(_,i)=>[`${model.addDays(day,-i)}|s|m`,true])),{ownKeys(target){scans++;return Reflect.ownKeys(target);}});
 model.preserveDoseSnapshots(d);
 assert.equal(scans,1);
 assert.ok(Object.values(d.checks).every(value=>value.name==='원래 약'));
});
test('shared schedule label describes all canonical schedules',()=>{
 assert.equal(model.scheduleLabel(), '매일');
 assert.equal(model.scheduleLabel({type:'prn'}),'필요시');
 assert.equal(model.scheduleLabel({type:'weekdays',days:[0,3]}),'일·수요일');
 assert.equal(model.scheduleLabel({type:'interval',every:2,anchor:day}),`격일 · ${day} 기준`);
});
test('medicine registration cannot select a slot whose future cutoff would silently lose doses',()=>{
 const d=fresh();d.meds=[];d.slots[0].until='2026-12-01';
 const before=structuredClone(d);
 assert.throws(()=>saveMedicine(d,'new',day,{name:'새 처방',dose:'1정',note:'',slotIds:['s']}),/2026-12-01.*시간|시간.*2026-12-01/);
 assert.deepEqual(d,before);
 saveMedicine(d,'new',day,{name:'새 처방',dose:'1정',note:'',slotIds:['s']},{until:'2026-12-01'});
 assert.equal(model.dayStats(d,'2026-11-30').total,1);
});
