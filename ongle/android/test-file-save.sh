#!/usr/bin/env bash
# Host-side tests: compile native sources, exercise the SAF writer, check shell policy.
set -euo pipefail
cd "$(dirname "$0")/.."
sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Android/Sdk}}"
api="$sdk/platforms/android-36/android.jar"
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
javac -Xlint:all,-options -encoding UTF-8 --release 8 -classpath "$api" -d "$tmp" android/src/kr/ongyeol/journal/*.java
java -cp "$tmp:$api" kr.ongyeol.journal.NativeFileSaveTest
java -cp "$tmp" kr.ongyeol.journal.ShellPolicyTest "$tmp/shell.js"
node --check "$tmp/shell.js"
