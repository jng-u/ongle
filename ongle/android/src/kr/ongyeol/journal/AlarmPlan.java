package kr.ongyeol.journal;

import java.time.*;
import java.util.*;

/** Pure wall-clock planning: version ends are exclusive; a stopped latest version never revives. */
final class AlarmPlan {
    static final class Entry {
        final String id, from, until, time, scheduleType, anchor;
        final List<Integer> days;
        final List<String> slots;
        Entry(String id, String from, String until, String time, List<String> slots) {
            this(id, from, until, time, slots, "daily", Collections.emptyList(), null);
        }
        Entry(String id, String from, String until, String time, List<String> slots,
                String scheduleType, List<Integer> days, String anchor) {
            this.scheduleType = scheduleType; this.days = days; this.anchor = anchor;
            this.id = id; this.from = from; this.until = until; this.time = time; this.slots = slots;
        }
    }
    static final class Due {
        final String id, date;
        final long at;
        Due(String id, String date, long at) { this.id = id; this.date = date; this.at = at; }
        String key() { return date + "|" + id; }
    }
    final List<Entry> slots = new ArrayList<>(), meds = new ArrayList<>();
    final Set<String> checks = new HashSet<>(), sent = new HashSet<>();
    boolean enabled;

    static List<Entry> active(List<Entry> entries, String date) {
        Map<String, Entry> latest = new LinkedHashMap<>();
        for (Entry e : entries) {
            Entry old = latest.get(e.id);
            if (e.from.compareTo(date) <= 0 && (old == null || old.from.compareTo(e.from) <= 0)) latest.put(e.id, e);
        }
        List<Entry> result = new ArrayList<>();
        for (Entry e : latest.values()) if (e.until == null || date.compareTo(e.until) < 0) result.add(e);
        return result;
    }
    private static boolean scheduled(Entry med, LocalDate day) {
        switch (med.scheduleType) {
            case "daily": return true;
            case "weekdays": return med.days.contains(day.getDayOfWeek().getValue() % 7);
            case "interval": return java.time.temporal.ChronoUnit.DAYS.between(LocalDate.parse(med.anchor), day) % 2 == 0;
            default: return false; // PRN never schedules an alarm.
        }
    }
    List<Due> on(LocalDate day, ZoneId zone) {
        List<Due> result = new ArrayList<>();
        String date = day.toString();
        if (!enabled) return result;
        Set<String> pending = new HashSet<>();
        for (Entry med : active(meds, date)) if (scheduled(med, day)) for (String slot : med.slots) {
            if (!checks.contains(date + "|" + slot + "|" + med.id)) pending.add(slot);
        }
        for (Entry slot : active(slots, date)) {
            if (pending.contains(slot.id) && !sent.contains(date + "|" + slot.id)) {
                result.add(new Due(slot.id, date, day.atTime(LocalTime.parse(slot.time)).atZone(zone).toInstant().toEpochMilli()));
            }
        }
        return result;
    }
    Due next(long now, ZoneId zone) {
        LocalDate today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate();
        // Recurrence repeats within seven days (weekly or every two days). Search a
        // full week after every version/check/sent boundary, including future starts.
        // This covers arbitrarily distant versions and runs of completed occurrences
        // without scanning every calendar day up to an arbitrary horizon.
        SortedSet<LocalDate> days = new TreeSet<>();
        days.add(today); days.add(today.plusDays(1));
        for (List<Entry> entries : Arrays.asList(slots, meds)) for (Entry e : entries) {
            days.add(LocalDate.parse(e.from));
            if (e.until != null) days.add(LocalDate.parse(e.until));
        }
        for (Set<String> keys : Arrays.asList(checks, sent)) for (String key : keys) {
            LocalDate date = LocalDate.parse(key.substring(0, 10));
            days.add(date); days.add(date.plusDays(1));
        }
        SortedSet<LocalDate> candidates = new TreeSet<>();
        for (LocalDate start : days.tailSet(today)) {
            for (int offset = 0; offset <= 7; offset++) candidates.add(start.plusDays(offset));
        }
        for (LocalDate day : candidates) {
            Due best = null;
            for (Due due : on(day, zone)) if (due.at > now && (best == null || due.at < best.at)) best = due;
            if (best != null) return best;
        }
        return null;
    }
}
