import test from 'node:test';
import assert from 'node:assert/strict';
import {lastVisitDate, summaryDates} from '../src/data/summaryRange.js';

test('지난 진료는 완료된 진료 기준이며 예약과 검사는 제외한다', () => {
  const visits = [
    {date:'2024-02-26', type:'visit', completed:true},
    {date:'2024-02-27', type:'visit', completed:true},
    {date:'2024-02-28', type:'exam', completed:true},
    {date:'2024-02-29', type:'visit', completed:false},
    {date:'2024-03-02', type:'visit', completed:true},
  ];
  assert.equal(lastVisitDate(visits,'2024-03-01'),'2024-02-27');
  assert.equal(lastVisitDate([], '2024-03-01'),null);
});
test('직접 선택한 기간은 윤일과 양끝을 포함하며 잘못된 기간은 인쇄하지 않는다', () => {
  assert.deepEqual(summaryDates('2024-02-28','2024-03-01','2024-03-01'),['2024-02-28','2024-02-29','2024-03-01']);
  assert.deepEqual(summaryDates('2024-03-01','2024-03-01','2024-03-01'),['2024-03-01']);
  for(const [start,end] of [['','2024-03-01'],['2024-02-31','2024-03-01'],['2024-03-01','2024-02-29'],['2024-02-28','2024-03-02'],['1900-01-01','2024-03-01']])
    assert.throws(()=>summaryDates(start,end,'2024-03-01'));
});
