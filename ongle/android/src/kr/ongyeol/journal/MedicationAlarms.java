package kr.ongyeol.journal;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;
import org.json.*;
import java.time.*;
import java.util.*;

/** Private, name-free persisted schedule. All entry points run in the app's main process. */
final class MedicationAlarms {
    static final String CHANNEL = "ongyeol_medication_v1";
    static final String FIRE = "kr.ongyeol.journal.MEDICATION_ALARM";
    private static final String PREFS = "medication_alarms_v1";
    private static android.content.SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    static void channel(Context c) {
        NotificationChannel channel = new NotificationChannel(CHANNEL, "복약 시간 알림", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("앱을 닫아도 기기에 저장된 복약 시간을 알려드려요.");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        c.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    static boolean notifications(Context c) {
        channel(c);
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        return (Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
                && nm.areNotificationsEnabled() && nm.getNotificationChannel(CHANNEL).getImportance() != NotificationManager.IMPORTANCE_NONE;
    }
    static boolean exact(Context c) {
        return Build.VERSION.SDK_INT < 31 || c.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }
    static JSONObject status(Context c) throws JSONException {
        return new JSONObject().put("notifications", notifications(c)).put("exact", exact(c))
                .put("enabled", prefs(c).getBoolean("enabled", false));
    }
    private static String id(JSONObject o, String key) throws JSONException {
        Object value = o.get(key);
        if (!(value instanceof String) || !((String) value).matches("[A-Za-z0-9_-]{1,128}")) throw new JSONException("Invalid ID");
        return (String) value;
    }
    private static String date(JSONObject o, String key) throws JSONException {
        String value = o.getString(key);
        try { if (!value.matches("\\d{4}-\\d{2}-\\d{2}") || !LocalDate.parse(value).toString().equals(value)) throw new IllegalArgumentException(); }
        catch (RuntimeException e) { throw new JSONException("Invalid date"); }
        return value;
    }
    private static JSONArray array(JSONObject o, String key, int max) throws JSONException {
        JSONArray a = o.getJSONArray(key);
        if (a.length() > max) throw new JSONException("Schedule too large");
        return a;
    }
    private static JSONObject recurrence(JSONObject entry) throws JSONException {
        if (!entry.has("schedule")) return new JSONObject().put("type", "daily");
        JSONObject input = entry.getJSONObject("schedule");
        String type = input.getString("type");
        JSONObject clean = new JSONObject().put("type", type);
        switch (type) {
            case "daily": case "prn": return clean;
            case "weekdays":
                JSONArray days = array(input, "days", 7), safe = new JSONArray();
                SortedSet<Integer> unique = new TreeSet<>();
                if (days.length() == 0) throw new JSONException("Invalid weekdays");
                for (int i = 0; i < days.length(); i++) {
                    Object day = days.get(i);
                    if (!(day instanceof Number) || ((Number) day).doubleValue() != ((Number) day).intValue()
                            || ((Number) day).intValue() < 0 || ((Number) day).intValue() > 6) throw new JSONException("Invalid weekday");
                    unique.add(((Number) day).intValue());
                }
                for (int day : unique) safe.put(day);
                return clean.put("days", safe);
            case "interval":
                Object every = input.get("every");
                if (!(every instanceof Number) || ((Number) every).doubleValue() != 2) throw new JSONException("Invalid interval");
                return clean.put("every", 2).put("anchor", date(input, "anchor"));
            default: throw new JSONException("Invalid recurrence");
        }
    }
    private static JSONObject sanitize(JSONObject input) throws JSONException {
        if (!(input.get("enabled") instanceof Boolean)) throw new JSONException("Invalid enabled");
        JSONObject clean = new JSONObject().put("enabled", input.getBoolean("enabled"));
        if (!input.getBoolean("enabled")) return clean.put("slots", new JSONArray())
                .put("meds", new JSONArray()).put("checks", new JSONArray());
        Set<String> slotIds = new HashSet<>(), medIds = new HashSet<>();
        for (String kind : Arrays.asList("slots", "meds")) {
            JSONArray source = array(input, kind, 2000), target = new JSONArray();
            for (int i = 0; i < source.length(); i++) {
                JSONObject e = source.getJSONObject(i);
                String identity = id(e, "id"), from = date(e, "from");
                JSONObject item = new JSONObject().put("id", identity).put("from", from);
                if (e.has("until") && !e.isNull("until")) {
                    String until = date(e, "until");
                    if (until.compareTo(from) < 0) throw new JSONException("Invalid range");
                    item.put("until", until);
                }
                if (kind.equals("slots")) {
                    String time = e.getString("time");
                    if (!time.matches("([01]\\d|2[0-3]):[0-5]\\d")) throw new JSONException("Invalid time");
                    item.put("time", time); slotIds.add(identity);
                } else {
                    JSONArray ids = array(e, "slotIds", 200), safe = new JSONArray();
                    Set<String> unique = new HashSet<>();
                    for (int j = 0; j < ids.length(); j++) {
                        String slot = id(new JSONObject().put("id", ids.get(j)), "id");
                        if (unique.add(slot)) safe.put(slot);
                    }
                    item.put("slotIds", safe).put("schedule", recurrence(e)); medIds.add(identity);
                }
                target.put(item);
            }
            clean.put(kind, target);
        }
        JSONArray checks = array(input, "checks", 30000), safeChecks = new JSONArray();
        Set<String> unique = new HashSet<>();
        for (int i = 0; i < checks.length(); i++) {
            String key = checks.getString(i);
            String[] parts = key.split("\\|", -1);
            if (parts.length != 3) throw new JSONException("Invalid check");
            date(new JSONObject().put("date", parts[0]), "date");
            if (slotIds.contains(parts[1]) && medIds.contains(parts[2]) && unique.add(key)) safeChecks.put(key);
        }
        return clean.put("checks", safeChecks);
    }
    static synchronized void sync(Context c, JSONObject input) throws JSONException {
        JSONObject clean = sanitize(input);
        if (!prefs(c).edit().putString("schedule", clean.toString()).putBoolean("enabled", clean.getBoolean("enabled")).commit())
            throw new IllegalStateException("Cannot persist schedule");
        c.getSystemService(NotificationManager.class).cancel(2001);
        schedule(c);
    }
    private static AlarmPlan load(Context c) throws JSONException {
        AlarmPlan plan = new AlarmPlan();
        JSONObject data = new JSONObject(prefs(c).getString("schedule", "{\"enabled\":false,\"slots\":[],\"meds\":[],\"checks\":[]}"));
        plan.enabled = data.getBoolean("enabled");
        for (String kind : Arrays.asList("slots", "meds")) {
            JSONArray list = data.getJSONArray(kind);
            for (int i = 0; i < list.length(); i++) {
                JSONObject e = list.getJSONObject(i);
                List<String> ids = new ArrayList<>();
                JSONArray a = e.optJSONArray("slotIds");
                if (a != null) for (int j = 0; j < a.length(); j++) ids.add(a.getString(j));
                JSONObject schedule = recurrence(e);
                List<Integer> days = new ArrayList<>();
                JSONArray weekdays = schedule.optJSONArray("days");
                if (weekdays != null) for (int j = 0; j < weekdays.length(); j++) days.add(weekdays.getInt(j));
                AlarmPlan.Entry entry = new AlarmPlan.Entry(e.getString("id"), e.getString("from"), e.has("until") ? e.getString("until") : null, e.optString("time"), ids,
                        schedule.getString("type"), days, schedule.optString("anchor", null));
                (kind.equals("slots") ? plan.slots : plan.meds).add(entry);
            }
        }
        JSONArray checks = data.getJSONArray("checks");
        for (int i = 0; i < checks.length(); i++) plan.checks.add(checks.getString(i));
        plan.sent.addAll(prefs(c).getStringSet("sent", Collections.emptySet()));
        return plan;
    }
    private static PendingIntent pending(Context c, long at) {
        Intent intent = new Intent(c, MedicationAlarmReceiver.class).setAction(FIRE).putExtra("at", at);
        return PendingIntent.getBroadcast(c, 2000, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static synchronized void reschedule(Context c) {
        try { schedule(c); }
        catch (JSONException | RuntimeException e) { /* System callbacks fail closed without logging data. */ }
    }
    private static void schedule(Context c) throws JSONException {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        am.cancel(pending(c, 0));
        if (!notifications(c)) return;
        AlarmPlan.Due due = load(c).next(System.currentTimeMillis(), ZoneId.systemDefault());
        if (due == null) return;
        PendingIntent pi = pending(c, due.at);
        if (exact(c)) {
            try { am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, due.at, pi); return; }
            catch (SecurityException e) { /* Permission can be revoked between check and use. */ }
        }
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, due.at, pi);
    }
    static synchronized void fire(Context c, long trigger) {
        try {
            long now = System.currentTimeMillis();
            AlarmPlan plan = load(c);
            ZoneId zone = ZoneId.systemDefault();
            LocalDate today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate();
            if (trigger <= 0 || trigger > now || !notifications(c)) return;
            boolean due = false;
            for (AlarmPlan.Due item : plan.on(today, zone)) {
                if (item.at >= trigger && item.at <= now) { plan.sent.add(item.key()); due = true; }
            }
            if (!due) return;
            // Persist before posting: duplicate broadcasts, edits and process restarts cannot repeat today's slot.
            if (!prefs(c).edit().putStringSet("sent", plan.sent).commit()) return;
            Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent content = PendingIntent.getActivity(c, 2001, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification notification = new Notification.Builder(c, CHANNEL)
                    .setSmallIcon(android.R.drawable.ic_popup_reminder).setContentTitle("나를 돌볼 시간")
                    .setContentText("복약 시간을 확인해 주세요.").setContentIntent(content).setAutoCancel(true)
                    .setCategory(Notification.CATEGORY_REMINDER).setVisibility(Notification.VISIBILITY_PRIVATE).build();
            c.getSystemService(NotificationManager.class).notify(2001, notification);
        } catch (JSONException | RuntimeException e) { /* No patient data in diagnostics. */ }
        finally { reschedule(c); }
    }
    private MedicationAlarms() { }
}
