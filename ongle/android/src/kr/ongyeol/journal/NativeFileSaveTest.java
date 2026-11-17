package kr.ongyeol.journal;

import java.io.IOException;
import java.io.OutputStream;
import java.util.Arrays;

/** Host-side regression for the exact stream writer used by the SAF callback. */
public final class NativeFileSaveTest {
    private static final class Stream extends OutputStream {
        final String fail;
        boolean closed, flushed;
        byte[] written;
        Stream(String fail) { this.fail = fail; }
        @Override public void write(int value) throws IOException { throw new IOException("Unexpected single-byte write"); }
        @Override public void write(byte[] value) throws IOException {
            if ("write".equals(fail)) throw new IOException("write failed");
            written = value.clone();
        }
        @Override public void flush() throws IOException {
            if ("flush".equals(fail)) throw new IOException("flush failed");
            flushed = true;
        }
        @Override public void close() throws IOException {
            closed = true;
            if ("close".equals(fail)) throw new IOException("close failed");
        }
    }
    public static void main(String[] args) throws Exception {
        if (!MainActivity.allowedExport("ongle-backup-2026-11-16.json", "application/json")
                || !MainActivity.allowedExport("ongle-reminders-2026-11-16.ics", "text/calendar")) throw new AssertionError("Existing export compatibility");
        for (String name : new String[]{"ongle-damaged-original.txt", "ongle-backup-2026-11-16.json", "arbitrary.txt"}) {
            if (MainActivity.allowedExport(name, "text/plain")) throw new AssertionError("Plaintext export allowed");
        }
        if (MainActivity.allowedExport("ongle-damaged-original.txt", "application/json")) throw new AssertionError("Damaged source bypass");
        byte[] bytes = new byte[]{1, 2, 3};
        Stream successful = new Stream("");
        MainActivity.writeExport(successful, bytes);
        if (!successful.closed || !successful.flushed || !Arrays.equals(bytes, successful.written)) throw new AssertionError("Incomplete save");
        for (String stage : new String[]{"write", "flush", "close"}) {
            Stream failed = new Stream(stage);
            try {
                MainActivity.writeExport(failed, bytes);
                throw new AssertionError("Reported success after " + stage + " failure");
            } catch (IOException expected) {
                if (!failed.closed) throw new AssertionError("Stream not closed after " + stage);
            }
        }
        try {
            MainActivity.writeExport(null, bytes);
            throw new AssertionError("Null destination accepted");
        } catch (IOException expected) { }
        System.out.println("PASS: encrypted-only allowlist and SAF writer write/flush/close success/failure checks");
    }
}
