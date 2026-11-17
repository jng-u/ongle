package kr.ongyeol.journal;

import java.time.*;
import java.util.*;

/** Standalone behavioral regression tests, no Android runtime dependency. */
final class AlarmPlanTest {
    private static int count;
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static void check(boolean value) {
        count++;
        if (!value) throw new AssertionError("Alarm check " + count);
    }
    private static AlarmPlan.Entry slot(String id, String from, String until, String time) {
        return new AlarmPlan.Entry(id, from, until, time, Collections.emptyList());
    }
    private static AlarmPlan.Entry med(String from, String until) {
        return new AlarmPlan.Entry("med", from, until, "", Arrays.asList("morning"));
    }
    private static long at(String time) { return LocalDateTime.parse(time).atZone(SEOUL).toInstant().toEpochMilli(); }
    public static void main(String[] args) {
        AlarmPlan p = new AlarmPlan();
        p.enabled = true;
        p.slots.add(slot("morning", "2026-01-01", null, "08:00"));
        p.meds.add(med("2026-01-01", null));
        long now = at("2026-11-16T07:00");
        check(p.next(now, SEOUL).at == at("2026-11-16T08:00"));
        p.checks.add("2026-11-16|morning|med");
        check(p.next(now, SEOUL).date.equals("2026-11-17"));
        p.checks.add("2026-11-17|morning|med");
        check(p.next(now, SEOUL).date.equals("2026-11-18"));
        p.meds.add(new AlarmPlan.Entry("other", "2026-01-01", null, "", Arrays.asList("morning")));
        check(p.next(now, SEOUL).date.equals("2026-11-16")); // one checked medicine cannot suppress another
        p.meds.remove(p.meds.size() - 1);
        p.checks.clear();
        p.sent.add("2026-11-16|morning");
        p.slots.add(slot("morning", "2026-11-16", null, "09:00"));
        check(p.next(now, SEOUL).at == at("2026-11-17T09:00")); // editing cannot repeat a sent slot
        p.sent.clear();
        check(p.next(now, SEOUL).at == at("2026-11-16T09:00"));
        p.meds.add(med("2026-11-16", "2026-11-16"));
        check(p.next(now, SEOUL) == null); // stopped latest version must not revive January's version
        p.meds.add(med("2030-01-01", "2030-01-02"));
        check(p.next(now, SEOUL).date.equals("2030-01-01")); // no arbitrary scheduling horizon
        check(p.next(at("2030-01-02T00:00"), SEOUL) == null); // exclusive end
        p.enabled = false;
        check(p.next(now, SEOUL) == null);
        p.enabled = true;
        p.meds.clear(); p.meds.add(med("2026-01-01", null));
        check(p.next(now, SEOUL).at != p.next(now, ZoneId.of("UTC")).at); // local wall time follows timezone
        check(p.next(at("2026-11-16T10:00"), SEOUL).date.equals("2026-11-17")); // no previous-time catchup on sync
        p.meds.clear();
        check(p.next(now, SEOUL) == null); // deleting meds cancels the last alarm
        p.meds.add(med("2026-01-01", null));
        p.slots.clear(); p.slots.add(slot("morning", "2026-01-01", null, "02:30"));
        ZoneId ny = ZoneId.of("America/New_York");
        long dstMorning = LocalDate.of(2027, 3, 14).atStartOfDay(ny).toInstant().toEpochMilli();
        check(p.next(dstMorning, ny).at == LocalDate.of(2027, 3, 14).atTime(3,30).atZone(ny).toInstant().toEpochMilli());
        recurrenceChecks();
        candidateSearchChecks();
        System.out.println("AlarmPlan: " + count + " behavioral checks passed");
    }
    private static AlarmPlan recurring(String from, String until, String type, List<Integer> days, String anchor) {
        AlarmPlan p = new AlarmPlan(); p.enabled = true;
        p.slots.add(slot("morning", "2020-01-01", null, "08:00"));
        p.meds.add(new AlarmPlan.Entry("med", from, until, "", Arrays.asList("morning"), type, days, anchor));
        return p;
    }
    private static void recurrenceChecks() {
        long now = at("2026-11-16T09:00"); // Monday after alarm time
        AlarmPlan weekly = recurring("2020-01-01", null, "weekdays", Arrays.asList(0), null);
        check(weekly.next(now, SEOUL).date.equals("2026-11-22")); // Sunday = JS day zero
        weekly.checks.add("2026-11-22|morning|med");
        weekly.sent.add("2026-11-29|morning");
        check(weekly.next(now, SEOUL).date.equals("2026-12-06"));
        AlarmPlan future = recurring("2030-01-01", null, "weekdays", Arrays.asList(1), null);
        check(future.next(now, SEOUL).date.equals("2030-01-07")); // boundary itself is Tuesday
        AlarmPlan ended = recurring("2026-11-17", "2026-11-22", "weekdays", Arrays.asList(0), null);
        check(ended.next(now, SEOUL) == null); // recurrence on exclusive end
        AlarmPlan alternate = recurring("2026-11-17", null, "interval", Collections.emptyList(), "2026-11-16");
        check(alternate.on(LocalDate.parse("2026-11-17"), SEOUL).isEmpty());
        check(alternate.next(now, SEOUL).date.equals("2026-11-18")); // from must not reset anchor
        alternate.checks.add("2026-11-18|morning|med");
        check(alternate.next(now, SEOUL).date.equals("2026-11-20"));
        alternate.meds.add(new AlarmPlan.Entry("med", "2026-11-19", null, "", Arrays.asList("morning"),
                "interval", Collections.emptyList(), "2026-11-16"));
        check(alternate.next(now, SEOUL).date.equals("2026-11-20")); // version edit retains phase
        AlarmPlan beforeAnchor = recurring("2026-11-01", null, "interval", Collections.emptyList(), "2026-11-18");
        check(beforeAnchor.on(LocalDate.parse("2026-11-16"), SEOUL).size() == 1);
        AlarmPlan prn = recurring("2020-01-01", null, "prn", Collections.emptyList(), null);
        check(prn.next(now, SEOUL) == null);
        prn.meds.add(med("2019-01-01", null));
        check(prn.next(now, SEOUL) == null); // PRN latest cannot revive daily history
        AlarmPlan changed = recurring("2020-01-01", null, "daily", Collections.emptyList(), null);
        changed.meds.add(new AlarmPlan.Entry("med", "2026-11-17", null, "", Arrays.asList("morning"),
                "weekdays", Arrays.asList(0), null));
        check(changed.next(now, SEOUL).date.equals("2026-11-22"));
    }

    private static void candidateSearchChecks() {
        // Compare optimized search against a bounded exhaustive oracle. All versions
        // end within 80 days, so scanning 90 days proves both earliest due and null.
        Random random = new Random(20261116);
        LocalDate start = LocalDate.of(2027, 3, 1);
        for (ZoneId zone : Arrays.asList(SEOUL, ZoneId.of("America/New_York"))) {
            for (int trial = 0; trial < 80; trial++) {
                String type = Arrays.asList("daily", "weekdays", "interval", "prn").get(trial % 4);
                AlarmPlan p = recurring(start.plusDays(random.nextInt(40) - 10).toString(),
                        start.plusDays(45).toString(), type, Arrays.asList(random.nextInt(7)), start.plusDays(3).toString());
                p.slots.add(slot("morning", start.plusDays(20).toString(), start.plusDays(75).toString(), "09:30"));
                p.meds.add(new AlarmPlan.Entry("med", start.plusDays(35).toString(), start.plusDays(80).toString(), "",
                        Arrays.asList("morning"), type, Arrays.asList(random.nextInt(7)), start.plusDays(3).toString()));
                for (int day = 0; day < 85; day++) {
                    String date = start.plusDays(day).toString();
                    if (random.nextBoolean()) p.checks.add(date + "|morning|med");
                    if (random.nextInt(3) == 0) p.sent.add(date + "|morning");
                }
                long now = start.atTime(trial % 2 == 0 ? 7 : 10, 0).atZone(zone).toInstant().toEpochMilli();
                AlarmPlan.Due expected = null;
                for (int day = 0; day < 90 && expected == null; day++) {
                    for (AlarmPlan.Due due : p.on(start.plusDays(day), zone)) {
                        if (due.at > now && (expected == null || due.at < expected.at)) expected = due;
                    }
                }
                AlarmPlan.Due actual = p.next(now, zone);
                check(expected == null ? actual == null : actual != null && actual.key().equals(expected.key()) && actual.at == expected.at);
            }
        }
        for (int weekday = 0; weekday < 7; weekday++) {
            AlarmPlan p = recurring("2020-01-01", null, "weekdays", Arrays.asList(weekday), null);
            for (int offset = 0; offset < 7; offset++) {
                check(p.on(LocalDate.of(2026, 11, 15).plusDays(offset), SEOUL).isEmpty() == (offset != weekday));
            }
        }
    }

}
