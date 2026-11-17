import test from 'node:test';
import assert from 'node:assert/strict';
import { blankJournal } from '../src/model.js';
import { getDiaryFields, entryAnswers, entryExists, getCustomAnswers, formatDiaryAnswer, parseDiaryValue, buildCustomAnswers, writeBuiltinAnswers } from '../src/data/diaryFields.js';

test('first run is generic and reading templates never mutates shared state', () => {
  const data = blankJournal();
  const before = structuredClone(data);
  const fields = getDiaryFields(data);
  assert.ok(fields.filter(field => field.builtin).every(field => !field.enabled));
  fields[0].enabled = true;
  assert.deepEqual(data, before);
  assert.equal(getDiaryFields(blankJournal())[0].enabled, false);
  assert.equal(getDiaryFields({ diaryBuiltins: { pain: true } })[0].enabled, true);
});

test('zero and false are answers; null and missing are unanswered', () => {
  const entry = { custom: [
    { id: 'energy', label: '활력', type: 'scale', value: 0 },
    { id: 'walk', label: '산책', type: 'boolean', value: false },
    { id: 'hours', label: '수면', type: 'number', value: null },
  ] };
  assert.equal(entryExists(entry), true);
  assert.equal(getCustomAnswers(entry).length, 2);
  assert.deepEqual(entryAnswers(entry).map(formatDiaryAnswer), ['활력 · 0/10', '산책 · X']);
  assert.equal(entryExists({ custom: [{ id: 'a', value: null }] }), false);
  assert.equal(entryExists({ note: '  ' }), false);
  assert.equal(entryExists({ note: '메모만 남김' }), true);
  assert.equal(entryExists({ pain: 0 }), true);
  assert.equal(entryExists({ blood: false }), true);
});

test('legacy records remain visible regardless of template configuration', () => {
  const legacy = { pain: 0, stools: 0, blood: false, note: '' };
  assert.deepEqual(entryAnswers(legacy).map(answer => answer.value), [0, 0, false]);
  assert.equal(entryAnswers(legacy)[0].label, '통증');
  assert.equal(entryExists({ condition: 1 }), true);
});

test('upgrade enables previously answered built-ins including zero and false unless explicitly disabled', () => {
  const data = { entries: { '2026-11-01': { pain: 0, blood: false, stools: null } } };
  assert.deepEqual(getDiaryFields(data).map(field => field.enabled), [true, false, true]);
  data.diaryBuiltins = { pain: false, stools: true };
  assert.deepEqual(getDiaryFields(data).map(field => field.enabled), [false, true, true]);
});

test('editing retains snapshots, disabled and removed answers without mutating history', () => {
  const prior = [
    { id: 'old', label: '이전 이름', type: 'number', value: 0 },
    { id: 'hidden', label: '숨김', type: 'boolean', value: false },
    { id: 'removed', label: '삭제된 템플릿', type: 'scale', value: 3 },
  ];
  const original = structuredClone(prior);
  const fields = [
    { id: 'old', label: '새 이름', type: 'scale', enabled: true },
    { id: 'hidden', label: '숨김', type: 'boolean', enabled: false },
    { id: 'new', label: '새 항목', type: 'scale', enabled: true },
  ];
  const answers = buildCustomAnswers(fields, { old: '12.5', new: '0' }, prior);
  assert.deepEqual(answers[0], { id: 'old', label: '이전 이름', type: 'number', value: 12.5 });
  assert.deepEqual(answers.slice(1, 3), prior.slice(1));
  assert.deepEqual(answers[3], { id: 'new', label: '새 항목', type: 'scale', value: 0 });
  assert.deepEqual(prior, original);
  assert.equal(buildCustomAnswers(fields, { old: '', new: '' }, prior)[0].value, null);
});

test('parsing is explicit for unanswered, O/X and numeric ranges', () => {
  assert.equal(parseDiaryValue('boolean', 'false'), false);
  assert.equal(parseDiaryValue('boolean', 'true'), true);
  assert.equal(parseDiaryValue('scale', ''), null);
  assert.equal(parseDiaryValue('scale', '0'), 0);
  assert.equal(parseDiaryValue('scale', '10'), 10);
  assert.equal(parseDiaryValue('number', '-1.5'), -1.5);
  for (const raw of ['-1', '11', '1.2', 'no', 'Infinity']) assert.throws(() => parseDiaryValue('scale', raw));
  assert.throws(() => parseDiaryValue('boolean', 'no'));
});

test('diary and entry form render generic first run, custom-only and hidden historical answers', async () => {
  const { build } = await import('esbuild');
  const { runInNewContext } = await import('node:vm');
  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const result = await build({
    stdin: { resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx', contents: `
      import React from 'react';
      import {renderToStaticMarkup} from 'react-dom/server';
      import {AppProvider} from './src/core.jsx';
      import {Diary,RecordDialog,Calendar} from './src/features/Records.jsx';
      import {blankJournal,todayKey} from './src/model.js';
      import assert from 'node:assert/strict';
      let data = blankJournal();
      globalThis.localStorage = {getItem:key=>key === 'ongyeol.journal.v1' ? JSON.stringify(data) : null};
      globalThis.location = {hash:'#diary'};
      const render = child => renderToStaticMarkup(<AppProvider>{child}</AppProvider>);
      let form = render(<RecordDialog name="entry"/>);
      assert.ok(!form.includes('type="number"'));
      assert.ok(form.includes('기록 항목 관리'));
      const day = todayKey();
      data.entries[day] = {custom:[{id:'walk',label:'산책 여부',type:'boolean',value:false}]};
      let diary = render(<Diary/>);
      assert.ok(diary.includes('산책 여부 · X'));
      assert.ok(diary.includes('기록 수정'));
      assert.ok(render(<Calendar/>).includes('산책 여부 · X'));
      data.entries[day].pain = 0;
      data.diaryBuiltins = {pain:false};
      form = render(<RecordDialog name="entry"/>);
      assert.ok(form.includes('숨긴 항목의 이전 답변'));
      assert.ok(form.includes('통증 · 0/10'));
      assert.ok(form.includes('산책 여부 · X'));
      assert.ok(!form.includes('type="number"'));
      data.diaryFields = [{id:'walk',label:'템플릿 새 이름',type:'number',enabled:true}];
      form = render(<RecordDialog name="entry"/>);
      assert.ok(form.includes('selected="" value="false"') || form.includes('value="false" selected=""'));
      assert.ok(!form.includes('type="number"'));
    ` }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent', loader: { '.css': 'empty' },
  });
  runInNewContext(result.outputFiles[0].text, {
    require: createRequire(import.meta.url), process, TextEncoder, TextDecoder,
    Buffer, URL, setTimeout, clearTimeout, setImmediate, clearImmediate, console,
  });
});

test('renaming and removing built-ins preserve legacy and newly labelled entries across backup restore', async () => {
  const { validateBackupData } = await import('../src/data/backup.js');
  const d = blankJournal();
  d.diaryBuiltins = { pain:true, stools:true, blood:true };
  const legacy = { pain:0, stools:0, blood:false, condition:null, note:'' };
  d.entries['2026-01-01'] = legacy;
  d.diaryBuiltinNames = { pain:'복통 정도', stools:'화장실 방문', blood:'출혈 여부' };
  const fields = getDiaryFields(d);
  const fresh = { pain:null, stools:null, blood:null, condition:null, note:'' };
  writeBuiltinAnswers(fresh, fields, { pain:'0', stools:'0', blood:'false' });
  d.entries['2026-01-02'] = fresh;
  writeBuiltinAnswers(legacy, fields, { pain:'0', stools:'0', blood:'false' });
  d.diaryBuiltinNames = { pain:null, stools:null, blood:null };
  const copy = validateBackupData(d, { importing:true });
  assert.deepEqual(getDiaryFields(copy), []);
  assert.deepEqual(entryAnswers(copy.entries['2026-01-01']).map(formatDiaryAnswer), ['통증 · 0/10','배변 횟수 · 0','혈변 · X']);
  assert.deepEqual(entryAnswers(copy.entries['2026-01-02']).map(formatDiaryAnswer), ['복통 정도 · 0/10','화장실 방문 · 0','출혈 여부 · X']);
});
