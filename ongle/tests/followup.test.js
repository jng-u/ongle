import test from 'node:test';
import assert from 'node:assert/strict';
import { followupDate, followupDraft, duplicatePlannedVisit, recentHospitals, storeVisit } from '../src/data/followup.js';

test('month intervals clamp month ends, leap days and year changes from the original date', () => {
  for (const [date, months, expected] of [
    ['2027-01-31', 1, '2027-02-28'], ['2028-01-31', 1, '2028-02-29'],
    ['2028-02-29', 12, '2029-02-28'], ['2026-12-31', 2, '2027-02-28'],
    ['2027-01-31', 2, '2027-03-31'], ['2026-08-31', 1, '2026-09-30'],
  ]) assert.equal(followupDate(date, months, 'months'), expected);
});

test('week intervals retain local dates across leap day, year and daylight saving boundaries', () => {
  assert.equal(followupDate('2024-02-23', 1, 'weeks'), '2024-03-01');
  assert.equal(followupDate('2026-12-28', 2, 'weeks'), '2027-01-11');
  assert.equal(followupDate('2026-03-01', 2, 'weeks'), '2026-03-15');
  assert.equal(followupDate('2026-10-25', 2, 'weeks'), '2026-11-08');
});

test('invalid dates, intervals, units and date overflow do not produce a date', () => {
  for (const date of ['', undefined, '2026-02-29', '2026-13-01']) assert.equal(followupDate(date, 1, 'months'), '');
  for (const amount of [0, -1, 1.5, NaN, Infinity, '3', 1201]) assert.equal(followupDate('2026-01-31', amount, 'months'), '');
  assert.equal(followupDate('2026-01-31', 1, 'years'), '');
  assert.equal(followupDate('9999-12-31', 1, 'months'), '');
  assert.equal(followupDate('9999-12-31', 1, 'weeks'), '');
});

test('next visit allowlists scheduling fields and preserves the completed historical record', () => {
  const source = Object.freeze({ id: 'history', type: 'exam', title: '정기 검사', place: '서울 병원',
    time: '09:30', date: '2026-01-31', note: '이전 결과', completed: true, result: '민감한 결과' });
  const next = followupDraft(source);
  assert.deepEqual(next, { type: 'exam', title: '정기 검사', place: '서울 병원', time: '09:30', date: '', note: '', completed: false });
  const visits = [source];
  const record = { ...next, id: 'next', date: followupDate(source.date, 1, 'months') };
  assert.equal(storeVisit(visits, record), true);
  assert.equal(visits[0], source);
  assert.equal(visits[0].completed, true);
  assert.equal(visits[0].note, '이전 결과');
  assert.equal(visits[1].id, 'next');
  assert.equal(storeVisit(visits, { ...record, id: 'repeat' }), false);
  assert.equal(visits.length, 2);
  assert.deepEqual(followupDraft({}), { type: 'visit', title: '', place: '', time: '', date: '', note: '', completed: false });
});

test('exact planned duplicates are blocked on insert and edit, excluding the record itself', () => {
  const existing = { id: 'one', date: '2027-02-28', type: 'visit', title: '정기 진료', place: '서울 병원', time: '10:30', completed: false };
  const visits = [existing];
  assert.equal(duplicatePlannedVisit(visits, { ...existing }), undefined);
  assert.equal(duplicatePlannedVisit(visits, { ...existing, id: 'two', title: ' 정기  진료 ', place: ' 서울 병원 ' }), existing);
  for (const [key, value] of Object.entries({ date: '2027-03-01', type: 'exam', title: '다른 진료', place: '다른 병원', time: '11:00' })) {
    assert.equal(duplicatePlannedVisit(visits, { ...existing, id: 'two', [key]: value }), undefined);
  }
  assert.equal(duplicatePlannedVisit([{ ...existing, completed: true }], { ...existing, id: 'two' }), undefined);
  assert.equal(duplicatePlannedVisit(visits, { ...existing, id: 'two', completed: true }), undefined);
  assert.equal(storeVisit(visits, { ...existing, note: '수정한 메모' }), true);
  assert.equal(visits.length, 1);
  assert.equal(visits[0].note, '수정한 메모');
  const other = { ...existing, id: 'other', date: '2027-03-01' };
  visits.push(other);
  assert.equal(storeVisit(visits, { ...other, date: existing.date }), false);
  assert.equal(visits[1], other);
});

test('empty and missing optional fields match; recent hospitals are normalized, unique, sorted and bounded', () => {
  const one = { id: 'one', title: '진료', type: 'visit', date: '2027-01-01' };
  assert.equal(duplicatePlannedVisit([one], { ...one, id: 'two', time: '', place: '' }), one);
  const visits = [
    { date: '2026-01-01', place: '이전 병원' }, { date: '2026-11-01', place: ' 서울  병원 ' },
    { date: '2026-10-01', place: '서울 병원' }, { date: '2026-09-01', place: ' ' },
    { date: '2026-11-02', place: '새 병원' },
  ];
  const before = structuredClone(visits);
  assert.deepEqual(recentHospitals(visits), ['새 병원', '서울 병원', '이전 병원']);
  assert.deepEqual(recentHospitals(visits, 2), ['새 병원', '서울 병원']);
  assert.deepEqual(visits, before);
});
