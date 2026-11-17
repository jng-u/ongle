#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Android/Sdk}}"
bt="$sdk/build-tools/36.0.0"; api="$sdk/platforms/android-36/android.jar"
release="../releases/ongyeol-android.apk"
tmp=$(mktemp -d); trap 'rm -rf -- "$tmp"' EXIT
mkdir -p "$tmp"/{classes,dex,assets/web} ../releases
npm run build
cp -r dist/client/. "$tmp/assets/web/"
# Android loads packaged resources directly; do not install a second offline cache.
rm -f "$tmp/assets/web/sw.js"
"$bt/aapt2" compile --dir android/res -o "$tmp/res.zip"
"$bt/aapt2" link -o "$tmp/base.apk" -I "$api" --manifest android/AndroidManifest.xml -A "$tmp/assets" "$tmp/res.zip"
test -s android/src/kr/ongyeol/journal/MainActivity.java
mapfile -t sources < <(find android/src -name '*.java' ! -name '*Test.java')
javac -encoding UTF-8 --release 8 -classpath "$api" -d "$tmp/classes" "${sources[@]}"
test -s "$tmp/classes/kr/ongyeol/journal/MainActivity.class"
jar cf "$tmp/classes.jar" -C "$tmp/classes" .
"$bt/d8" --release --min-api 26 --lib "$api" --output "$tmp/dex" "$tmp/classes.jar"
(cd "$tmp/dex" && zip -q "$tmp/base.apk" classes*.dex)
"$bt/zipalign" -P 16 -f 4 "$tmp/base.apk" "$tmp/aligned.apk"
keydir=android/signing.local
mkdir -p -m 700 "$keydir"
if [[ ! -f "$keydir/release.p12" && ! -f "$keydir/password" ]]; then
  if [[ -e "$release" ]]; then echo '기존 APK의 서명 키를 복구한 뒤 다시 실행하세요.' >&2; exit 1; fi
  (umask 077
   openssl rand -base64 36 > "$keydir/password"
   keytool -genkeypair -keystore "$keydir/release.p12" -storetype PKCS12 -storepass:file "$keydir/password" -alias ongyeol -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Ongyeol Android')
fi
"$bt/apksigner" sign --ks "$keydir/release.p12" --ks-pass "file:$keydir/password" --ks-key-alias ongyeol --v4-signing-enabled false --out "$tmp/release.apk" "$tmp/aligned.apk"
"$bt/apksigner" verify --verbose --print-certs "$tmp/release.apk"
"$bt/zipalign" -c -P 16 4 "$tmp/release.apk"
install -m 644 "$tmp/release.apk" "$release.tmp"
mv "$release.tmp" "$release"
(cd ../releases && sha256sum ongyeol-android.apk > ongyeol-android.apk.sha256)
