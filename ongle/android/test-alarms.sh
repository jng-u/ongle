#!/usr/bin/env bash
# Disposable metadata-driven upgrade/alarm test. No user AVD/default ADB.
# Usage: test-alarms.sh [FINAL_APK] [--baseline APK] [--baseline-dir DIR]
#        [--non-interactive] [--check-apks]
# Auto-selects the highest older compatible APK in releases/ and /tmp by default.
# --check-apks verifies metadata/signatures without starting an emulator.
# --non-interactive exits after UI persistence/upgrade checks, without signal files.
# Interactive mode waits for run-apk and finish in its printed evidence directory.
# Exit 0 proves upgrade/persistence, not alarm delivery. Alarm probes must use
# HOME + am kill / recents swipe, never force-stop. Evidence stays in /tmp.
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
FINAL_APK="$ROOT/releases/ongyeol-android.apk"
APK=${BASELINE_APK:-}
NON_INTERACTIVE=0 CHECK_APKS=0 FINAL_SET=0
BASELINE_DIRS=()
while (( $# )); do
  case "$1" in
    --baseline|--baseline-dir)
      (( $# >= 2 )) || { echo "FAIL: $1 requires a path" >&2; exit 2; }
      if [[ "$1" == --baseline ]]; then APK=$2; else BASELINE_DIRS+=(--baseline-dir "$2"); fi
      shift 2 ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    --check-apks) CHECK_APKS=1; shift ;;
    --help|-h) sed -n '2,10p' "${BASH_SOURCE[0]}"; exit 0 ;;
    --*) echo "FAIL: unknown option $1" >&2; exit 2 ;;
    *) (( FINAL_SET == 0 )) || { echo 'FAIL: only one final APK is allowed' >&2; exit 2; }
       FINAL_APK=$1; FINAL_SET=1; shift ;;
  esac
done
SDK=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-"$HOME/Android/Sdk"}}
EMU="$SDK/emulator/emulator"
ADB="$SDK/platform-tools/adb"
for tool in python3 timeout; do
  command -v "$tool" >/dev/null || { echo "UNAVAILABLE: $tool" >&2; exit 2; }
done
OUT=$(mktemp -d /tmp/ongyeol-alarms.XXXXXX)
echo "Evidence: $OUT"
exec > >(tee "$OUT/harness.log") 2>&1
if (( ${#BASELINE_DIRS[@]} == 0 )); then BASELINE_DIRS=(--baseline-dir "$ROOT/releases" --baseline-dir /tmp); fi
SELECT=(python3 "$ROOT/ongle/scripts/apk-upgrade.py" --sdk "$SDK" --final "$FINAL_APK" "${BASELINE_DIRS[@]}")
if [[ -n "$APK" ]]; then SELECT+=(--baseline "$APK"); fi
"${SELECT[@]}" > "$OUT/apk-metadata.json"
# Freeze both inputs and verify their bytes, so a concurrent build cannot change
# the APK after metadata validation. Never write to the published releases.
python3 - "$OUT" <<'PYFREEZE'
import hashlib, json, pathlib, shutil, sys
out = pathlib.Path(sys.argv[1])
metadata = json.loads((out / 'apk-metadata.json').read_text())
for kind in ('baseline', 'final'):
    item = metadata[kind]
    target = out / (kind + '-under-test.apk')
    shutil.copyfile(item['path'], target)
    if hashlib.sha256(target.read_bytes()).hexdigest() != item['sha256']:
        raise SystemExit('FAIL: APK changed during preflight: ' + item['path'])
    print(f"PASS: {kind} {item['versionName']} (code {item['versionCode']}): {item['path']}")
PYFREEZE
APK="$OUT/baseline-under-test.apk"
FINAL_APK="$OUT/final-under-test.apk"
if (( CHECK_APKS )); then echo 'PASS: metadata/signatures/checksums and older baseline selection; emulator not started'; exit 0; fi
[[ -x "$EMU" && -x "$ADB" ]] || { echo "UNAVAILABLE: Android emulator/platform-tools in $SDK" >&2; exit 2; }
IMAGE=$(find "$SDK/system-images" -name system.img -path '*/x86_64/*' -print 2>/dev/null | sort -V | tail -1)
[[ -n "$IMAGE" ]] || { echo 'UNAVAILABLE: installed x86_64 system image' >&2; exit 2; }
IMAGE=${IMAGE%/system.img}
# Isolate emulator configuration, ADB keys, crash data and all writable AVD files.
export ANDROID_USER_HOME="$OUT/home/.android"
export ANDROID_EMULATOR_HOME="$ANDROID_USER_HOME" ANDROID_AVD_HOME="$OUT/avd"
export ANDROID_SDK_ROOT="$SDK" ANDROID_HOME="$SDK"
unset ANDROID_SERIAL ANDROID_ADB_SERVER_PORT ADB_SERVER_SOCKET ADB_VENDOR_KEYS
mkdir -p "$ANDROID_USER_HOME" "$ANDROID_AVD_HOME/disposable.avd" "$OUT/tmp"
export TMPDIR="$OUT/tmp"
read -r ADB_PORT EMU_PORT < <(python3 - <<'PY'
import socket
s = socket.socket(); s.bind(('127.0.0.1', 0))
for p in range(5580, 5680, 2):
    sockets = []
    try:
        for port in (p, p + 1):
            x = socket.socket(); sockets.append(x); x.bind(('127.0.0.1', port))
        print(s.getsockname()[1], p); break
    except OSError: pass
    finally:
        for x in sockets: x.close()
else: raise SystemExit('No free emulator port pair')
PY
)
export ANDROID_ADB_SERVER_PORT="$ADB_PORT" ADB_SERVER_SOCKET="tcp:127.0.0.1:$ADB_PORT"
SERIAL="emulator-$EMU_PORT"
EMU_PID= SERVER_STARTED=0
adb_private() { timeout 30 "$ADB" -P "$ADB_PORT" -s "$SERIAL" "$@"; }
cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$EMU_PID" ]]; then
    if kill -0 "$EMU_PID" 2>/dev/null; then
      adb_private logcat -d > "$OUT/logcat.txt" 2>&1 || true
      adb_private emu kill > "$OUT/emulator-stop.txt" 2>&1 || true
      kill "$EMU_PID" 2>/dev/null || true
    fi
    wait "$EMU_PID" 2>/dev/null || true
  fi
  if [[ "$SERVER_STARTED" == 1 ]]; then "$ADB" -P "$ADB_PORT" kill-server >> "$OUT/adb-server.log" 2>&1 || true; fi
  # Retain logs/screenshots, discard only this run's disposable device and keys.
  rm -rf -- "$OUT/avd" "$OUT/home" "$OUT/tmp"
  echo "Exit: $status; evidence: $OUT"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cat > "$ANDROID_AVD_HOME/disposable.ini" <<EOF
avd.ini.encoding=UTF-8
path=$ANDROID_AVD_HOME/disposable.avd
EOF
cat > "$ANDROID_AVD_HOME/disposable.avd/config.ini" <<EOF
AvdId=disposable
avd.ini.encoding=UTF-8
abi.type=x86_64
hw.cpu.arch=x86_64
hw.cpu.ncore=2
hw.ramSize=2048
hw.lcd.width=540
hw.lcd.height=960
hw.lcd.density=240
hw.keyboard=yes
hw.gpu.enabled=yes
hw.gpu.mode=software
hw.audioInput=no
hw.audioOutput=no
hw.camera.back=none
hw.camera.front=none
hw.sdCard=no
disk.dataPartition.size=2048M
image.sysdir.1=$IMAGE/
tag.id=google_apis
showDeviceFrame=no
EOF
cp "$IMAGE/source.properties" "$OUT/system-image.properties"
cp "$ANDROID_AVD_HOME/disposable.avd/config.ini" "$OUT/avd-config.ini"
"$EMU" -version > "$OUT/emulator-version.txt" 2>&1
"$ADB" -P "$ADB_PORT" start-server > "$OUT/adb-server.log" 2>&1
SERVER_STARTED=1
ACCEL=off
if "$EMU" -accel-check > "$OUT/acceleration.txt" 2>&1; then ACCEL=on; fi
echo "Image: $IMAGE; acceleration: $ACCEL; serial: $SERIAL; private ADB: $ADB_PORT"
"$EMU" -avd disposable -port "$EMU_PORT" -no-window -no-audio -no-boot-anim \
  -no-snapshot -wipe-data -gpu software -accel "$ACCEL" -no-metrics \
  > "$OUT/emulator.log" 2>&1 &
EMU_PID=$!
DEADLINE=$((SECONDS + ${BOOT_TIMEOUT:-300}))
while [[ $(adb_private shell getprop sys.boot_completed 2>/dev/null | tr -d '\r') != 1 ]]; do
  if ! kill -0 "$EMU_PID" 2>/dev/null; then echo 'FAIL: emulator exited'; tail -40 "$OUT/emulator.log"; exit 1; fi
  if (( SECONDS >= DEADLINE )); then echo 'FAIL: boot timeout'; tail -40 "$OUT/emulator.log"; exit 1; fi
  sleep 2
done
[[ $(adb_private shell getprop ro.kernel.qemu | tr -d '\r') == 1 ]] || { echo 'FAIL: target is not an emulator'; exit 1; }
echo 'PASS: disposable emulator booted'
adb_private shell input keyevent 82
adb_private shell settings put global window_animation_scale 0
adb_private shell settings put global transition_animation_scale 0
adb_private shell settings put global animator_duration_scale 0
if [[ ! -f "$APK" ]]; then echo "SKIP: APK not present: $APK"; exit 2; fi
cp -- "$APK" "$OUT/apk-under-test.apk"
if [[ -f "$APK.sha256" ]]; then
  EXPECTED=$(awk 'NR == 1 {print $1}' "$APK.sha256")
  ACTUAL=$(sha256sum "$OUT/apk-under-test.apk" | awk '{print $1}')
  [[ "$EXPECTED" == "$ACTUAL" ]] || { echo 'FAIL: APK checksum does not match sidecar'; exit 1; }
  cp -- "$APK.sha256" "$OUT/published-apk.sha256"
  echo "PASS: published APK checksum $ACTUAL"
fi
sha256sum "$OUT/apk-under-test.apk" > "$OUT/apk.sha256"
adb_private install --no-streaming "$OUT/apk-under-test.apk" | tee "$OUT/install.txt"
grep -q '^Success' "$OUT/install.txt" || { echo 'FAIL: APK installation'; exit 1; }
# Network is disabled BEFORE first launch, proving bundled assets work cold/offline.
adb_private shell svc wifi disable
adb_private shell svc data disable
adb_private shell cmd connectivity airplane-mode enable
adb_private shell settings get global airplane_mode_on > "$OUT/airplane-mode.txt"
[[ $(tr -d '\r\n' < "$OUT/airplane-mode.txt") == 1 ]] || { echo 'FAIL: offline mode'; exit 1; }
adb_private shell am start -W -n kr.ongyeol.journal/.MainActivity | tee "$OUT/launch.txt"
! grep -Eq 'Error:|Exception' "$OUT/launch.txt" || { echo 'FAIL: Activity launch'; exit 1; }
python3 - "$ADB" "$ADB_PORT" "$SERIAL" "$OUT" "${UI_TIMEOUT:-90}" <<'PY'
import json, re, subprocess, sys, time, xml.etree.ElementTree as ET
adb, port, serial, out, ui_timeout = sys.argv[1:]
def run(*args):
    return subprocess.run([adb, '-P', port, '-s', serial, *args], check=True, capture_output=True, timeout=40).stdout

def snapshot(name):
    for attempt in range(4):
        try:
            run('shell', 'rm', '-f', '/data/local/tmp/ongyeol-ui.xml')
            dump = run('shell', 'uiautomator', 'dump', '/data/local/tmp/ongyeol-ui.xml')
            with open(f'{out}/uiautomator.log', 'ab') as log: log.write(dump + b'\n')
            xml = run('shell', 'cat', '/data/local/tmp/ongyeol-ui.xml')
            root = ET.fromstring(xml)
            open(f'{out}/{name}.xml', 'wb').write(xml)
            open(f'{out}/{name}.png', 'wb').write(run('exec-out', 'screencap', '-p'))
            return root
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, ET.ParseError) as error:
            with open(f'{out}/uiautomator.log', 'a') as log: log.write(str(error) + '\n')
            if attempt == 3:
                open(f'{out}/{name}-failure.png', 'wb').write(run('exec-out', 'screencap', '-p'))
                raise
            time.sleep(2)

def nodes(root):
    return list(root.iter('node'))

def wait_page(name, predicate):
    deadline = time.monotonic() + int(ui_timeout)
    while True:
        root = snapshot(name)
        if predicate(root): return root
        if time.monotonic() > deadline: raise RuntimeError(f'UI check timed out: {name}')
        time.sleep(2)

def text(root):
    return ' '.join(n.get('text', '') + ' ' + n.get('content-desc', '') for n in nodes(root))

def tap(node):
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds', '')))
    run('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
    time.sleep(1)

def button(root, label):
    matches = [n for n in nodes(root) if n.get('text') == label or n.get('content-desc') == label]
    if not matches:
        matches = [n for n in nodes(root) if n.get('class') == 'android.widget.Button' and
                   any(n.get(key, '').startswith(label + ' ') for key in ('text', 'content-desc'))]
    if not matches: raise RuntimeError(f'UI control unavailable: {label}')
    if not re.search(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', matches[-1].get('bounds', '')):
        raise RuntimeError(f'Invalid control bounds: {label}')
    tap(matches[-1])

root = wait_page('offline-first-launch', lambda r: '온결' in text(r) and '기록 추가' in text(r))
activity = run('shell', 'dumpsys', 'activity', 'activities').decode(errors='replace')
open(f'{out}/activity.txt', 'w').write(activity)
if not re.search(r'(?:mResumedActivity|topResumedActivity).*kr\.ongyeol\.journal/\.MainActivity', activity):
    raise RuntimeError('Expected MainActivity is not resumed')
print('PASS: MainActivity and Korean app page rendered on cold offline launch', flush=True)
button(root, '기록 추가')
root = wait_page('quick-menu', lambda r: '몸 상태와 하루 메모' in text(r))
button(root, '증상 일기')
root = wait_page('record-form', lambda r: '증상과 하루 메모' in text(r))
# Reveal the lower form before choosing its textarea and Save control.
run('shell', 'input', 'swipe', '450', '800', '450', '350', '450')
time.sleep(1)
root = snapshot('record-form-scrolled')
# Accessibility hierarchy exposes the WebView textarea as an Android EditText.
fields = [n for n in nodes(root) if n.get('class') == 'android.widget.EditText' and
          ('불편했던' in n.get('text', '') or n.get('multi-line') == 'true')]
if not fields:
    fields = [n for n in nodes(root) if n.get('class') == 'android.widget.EditText'][-1:]
if not fields: raise RuntimeError('Record textarea not exposed by WebView accessibility')
tap(fields[-1])
marker = 'emulator-persistence-' + str(int(time.time()))
run('shell', 'input', 'text', marker)
ime = run('shell', 'dumpsys', 'input_method').decode(errors='replace')
open(f'{out}/input-method.txt', 'w').write(ime)
if re.search(r'(?:mInputShown|isInputViewShown|mIsInputViewShown)=true', ime):
    run('shell', 'input', 'keyevent', '4')  # BACK dismisses a visible IME.
root = snapshot('record-filled')
if marker not in text(root): raise RuntimeError('Textarea did not receive the test record')
for attempt in range(5):
    saves = [n for n in nodes(root) if n.get('text') == '저장' or n.get('content-desc') == '저장']
    if saves:
        bounds = list(map(int, re.findall(r'\d+', saves[-1].get('bounds', ''))))
        if len(bounds) == 4 and bounds[3] - bounds[1] >= 30:
            tap(saves[-1]); break
    run('shell', 'input', 'swipe', '450', '780', '450', '350', '450')
    time.sleep(1)
    root = snapshot('record-save-scrolled')
else: raise RuntimeError('Save control remains offscreen after scrolling')
time.sleep(2)
run('shell', 'am', 'force-stop', 'kr.ongyeol.journal')
run('shell', 'am', 'start', '-W', '-n', 'kr.ongyeol.journal/.MainActivity')
root = wait_page('offline-relaunch', lambda r: '기록 추가' in text(r))
button(root, '일기')
root = wait_page('persisted-record', lambda r: marker in text(r))
open(f'{out}/result.json', 'w').write(json.dumps({
    'package': 'kr.ongyeol.journal', 'offlineColdLaunch': True,
    'recordSavedViaUI': True, 'recordPersistsAfterForceStop': True,
    'marker': marker, 'serial': serial}, ensure_ascii=False, indent=2) + '\n')
print('PASS: UI-created record persists after force-stop/relaunch while offline', flush=True)
PY
echo 'PASS: install, offline page, record save and persistence'

# The baseline is now seeded. Leave the disposable device available for alarm probes.
printf 'ADB=%q\nADB_PORT=%q\nSERIAL=%q\nOUT=%q\n' "$ADB" "$ADB_PORT" "$SERIAL" "$OUT" > "$OUT/control.env"
cp "$OUT/result.json" "$OUT/baseline-result.json"
echo "READY: baseline seeded; touch $OUT/run-apk to install the frozen final APK"
DEADLINE=$((SECONDS + ${SIGNAL_TIMEOUT:-7200}))
while [[ "$NON_INTERACTIVE" == 0 && ! -f "$OUT/run-apk" ]]; do
  kill -0 "$EMU_PID" 2>/dev/null || { echo 'FAIL: emulator exited'; exit 1; }
  (( SECONDS < DEADLINE )) || { echo 'SKIP: final APK signal timeout'; exit 2; }
  sleep 2
done
sha256sum "$OUT/final-under-test.apk" > "$OUT/final.sha256"
adb_private shell dumpsys package kr.ongyeol.journal > "$OUT/package-before-upgrade.txt"
adb_private install --no-streaming -r "$OUT/final-under-test.apk" | tee "$OUT/upgrade.txt"
grep -q '^Success' "$OUT/upgrade.txt" || { echo 'FAIL: signed in-place upgrade'; exit 1; }
adb_private shell dumpsys package kr.ongyeol.journal > "$OUT/package-after-upgrade.txt"
adb_private shell am start -W -n kr.ongyeol.journal/.MainActivity | tee "$OUT/upgrade-launch.txt"
python3 - "$OUT" <<'PYVERSION'
import json, pathlib, re, sys
out = pathlib.Path(sys.argv[1])
metadata = json.loads((out / 'apk-metadata.json').read_text())
for kind, stage in [('baseline', 'before'), ('final', 'after')]:
    package = (out / f'package-{stage}-upgrade.txt').read_text()
    code = re.search(r'\bversionCode=(\d+)', package)
    name = re.search(r'^\s*versionName=(.*)$', package, re.M)
    expected = metadata[kind]
    if not code or int(code[1]) != expected['versionCode'] or not name or name[1].strip() != expected['versionName']:
        raise SystemExit(f'FAIL: installed {kind} package differs from APK metadata')
print('PASS: installed package versions match both APK metadata records')
PYVERSION
python3 - "$ADB" "$ADB_PORT" "$SERIAL" "$OUT" "${UI_TIMEOUT:-90}" <<'PYUPGRADE'
import json, re, subprocess, sys, time, xml.etree.ElementTree as ET
adb, port, serial, out, ui_timeout = sys.argv[1:]
def run(*args):
    return subprocess.run([adb, '-P', port, '-s', serial, *args], check=True, capture_output=True, timeout=40).stdout

def snapshot(name):
    for attempt in range(4):
        try:
            run('shell', 'rm', '-f', '/data/local/tmp/ongyeol-ui.xml')
            dump = run('shell', 'uiautomator', 'dump', '/data/local/tmp/ongyeol-ui.xml')
            with open(f'{out}/uiautomator.log', 'ab') as log: log.write(dump + b'\n')
            xml = run('shell', 'cat', '/data/local/tmp/ongyeol-ui.xml')
            root = ET.fromstring(xml)
            open(f'{out}/{name}.xml', 'wb').write(xml)
            open(f'{out}/{name}.png', 'wb').write(run('exec-out', 'screencap', '-p'))
            return root
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, ET.ParseError) as error:
            with open(f'{out}/uiautomator.log', 'a') as log: log.write(str(error) + '\n')
            if attempt == 3:
                open(f'{out}/{name}-failure.png', 'wb').write(run('exec-out', 'screencap', '-p'))
                raise
            time.sleep(2)

def nodes(root):
    return list(root.iter('node'))

def wait_page(name, predicate):
    deadline = time.monotonic() + int(ui_timeout)
    while True:
        root = snapshot(name)
        if predicate(root): return root
        if time.monotonic() > deadline: raise RuntimeError(f'UI check timed out: {name}')
        time.sleep(2)

def text(root):
    return ' '.join(n.get('text', '') + ' ' + n.get('content-desc', '') for n in nodes(root))

def tap(node):
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds', '')))
    run('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
    time.sleep(1)

def button(root, label):
    matches = [n for n in nodes(root) if n.get('text') == label or n.get('content-desc') == label]
    if not matches:
        matches = [n for n in nodes(root) if n.get('class') == 'android.widget.Button' and
                   any(n.get(key, '').startswith(label + ' ') for key in ('text', 'content-desc'))]
    if not matches: raise RuntimeError(f'UI control unavailable: {label}')
    if not re.search(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', matches[-1].get('bounds', '')):
        raise RuntimeError(f'Invalid control bounds: {label}')
    tap(matches[-1])


marker = json.load(open(f'{out}/baseline-result.json'))['marker']
root = wait_page('upgraded-home', lambda r: '기록 추가' in text(r))
if marker not in text(root):
    button(root, '일기')
root = wait_page('upgrade-preserved-record', lambda r: marker in text(r))
metadata = json.load(open(f'{out}/apk-metadata.json'))
open(f'{out}/upgrade-result.json', 'w').write(json.dumps({'baseline':metadata['baseline'], 'final':metadata['final'], 'signedInPlaceUpgrade':True, 'journalMarkerPreserved':marker}, ensure_ascii=False, indent=2)+'\n')
print('PASS: signed in-place upgrade preserves baseline UI-created journal record', flush=True)
PYUPGRADE
if (( NON_INTERACTIVE )); then
  echo 'PASS: unattended offline baseline/upgrade persistence checks complete; alarm delivery not tested'
  exit 0
fi
echo "UPGRADED: run alarm probes using $OUT/control.env; touch $OUT/finish to stop"
while [[ ! -f "$OUT/finish" ]]; do
  kill -0 "$EMU_PID" 2>/dev/null || { echo 'FAIL: emulator exited'; exit 1; }
  (( SECONDS < DEADLINE )) || { echo 'SKIP: probe timeout'; exit 2; }
  sleep 2
done
echo 'DONE: consult probe evidence; baseline/upgrade success alone does not prove alarm delivery'
