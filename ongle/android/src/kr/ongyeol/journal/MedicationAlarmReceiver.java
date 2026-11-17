package kr.ongyeol.journal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Manifest receiver survives ordinary process death and task dismissal; Android force-stop is excluded. */
public final class MedicationAlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (MedicationAlarms.FIRE.equals(intent.getAction())) MedicationAlarms.fire(context, intent.getLongExtra("at", 0));
        else MedicationAlarms.reschedule(context);
    }
}
