import {addDays, isDateKey, todayKey} from '../model.js';

export function lastVisitDate(visits, end = todayKey()) {
  return visits.reduce((latest, visit) => visit.type === 'visit' && visit.completed === true &&
    isDateKey(visit.date) && visit.date <= end && (!latest || visit.date > latest) ? visit.date : latest, null);
}

export function summaryDates(start, end, today = todayKey()) {
  if (!isDateKey(start) || !isDateKey(end)) throw Error('시작일과 종료일을 모두 입력해 주세요.');
  if (start > end) throw Error('종료일을 시작일과 같거나 이후로 선택해 주세요.');
  if (end > today) throw Error('오늘까지의 기록만 요약할 수 있어요.');
  // Bound work even if a user briefly enters a four-digit year far in the past.
  if (start < addDays(end, -3659)) throw Error('한 번에 최대 3,660일을 볼 수 있어요. 기간을 나눠 선택해 주세요.');
  const days = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}
