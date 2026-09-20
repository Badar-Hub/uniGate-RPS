#!/usr/bin/env bash
# Local Android release build of apps/mobile without an Expo account (docs/deployment.md §Mobile).
#
#   scripts/mobile/build-android.sh setup      one-time: JDK 17 + Android SDK under ~/android-tools (no sudo)
#   scripts/mobile/build-android.sh keystore   one-time: upload keystore in ~/unigate-keys (KEEP IT — Play needs the same key forever)
#   scripts/mobile/build-android.sh build      prebuild + gradle → ~/unigate-builds/<version>/unigate-<version>-<code>.{apk,aab}
#
# The APK is what testers install directly; the AAB is what goes to Google Play. Both are signed with
# the upload key. EXPO_PUBLIC_API_URL is inlined at bundle time from the environment or apps/mobile/.env.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="${ANDROID_TOOLS_DIR:-$HOME/android-tools}"
KEYS="${UNIGATE_KEYS_DIR:-$HOME/unigate-keys}"
OUT="${UNIGATE_BUILDS_DIR:-$HOME/unigate-builds}"
JDK_URL="https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
CMDLINE_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"

export JAVA_HOME="$TOOLS/jdk"
export ANDROID_HOME="$TOOLS/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

setup() {
  mkdir -p "$TOOLS"
  if [[ ! -x "$JAVA_HOME/bin/java" ]]; then
    echo "== JDK 17 → $JAVA_HOME"
    curl -fsSL "$JDK_URL" -o "$TOOLS/jdk.tgz"
    mkdir -p "$JAVA_HOME" && tar -xzf "$TOOLS/jdk.tgz" -C "$JAVA_HOME" --strip-components=1 && rm "$TOOLS/jdk.tgz"
  fi
  if [[ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]]; then
    echo "== Android command-line tools → $ANDROID_HOME"
    mkdir -p "$ANDROID_HOME/cmdline-tools"
    curl -fsSL "$CMDLINE_URL" -o "$TOOLS/cmdline.zip"
    # `jar xf` stands in for unzip on a minimal host (the JDK is already there).
    (cd "$ANDROID_HOME/cmdline-tools" && rm -rf latest tmp && mkdir tmp && cd tmp && { command -v unzip >/dev/null && unzip -q "$TOOLS/cmdline.zip" || "$JAVA_HOME/bin/jar" xf "$TOOLS/cmdline.zip"; } && mv cmdline-tools ../latest && cd .. && rm -rf tmp)
    chmod +x "$ANDROID_HOME/cmdline-tools/latest/bin/"*
    rm "$TOOLS/cmdline.zip"
  fi
  yes | sdkmanager --licenses >/dev/null
  # sdkmanager draws a progress bar with carriage returns; keep only real problems.
  sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;36.0.0" 2>&1 | tr '\r' '\n' | grep -E "Warning|Error|Failed" || true
  java -version 2>&1 | head -1
  echo "setup done"
}

keystore() {
  mkdir -p "$KEYS" && chmod 700 "$KEYS"
  local ks="$KEYS/unigate-upload.keystore" props="$KEYS/keystore.properties"
  if [[ -f "$ks" ]]; then echo "keystore already exists: $ks"; return; fi
  local pw; pw="$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)"
  keytool -genkeypair -v -storetype PKCS12 -keystore "$ks" -alias unigate-upload -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$pw" -keypass "$pw" -dname "CN=UniGate, O=UniGate, L=Riyadh, C=SA" >/dev/null
  umask 077
  cat > "$props" <<EOF
storeFile=$ks
storePassword=$pw
keyAlias=unigate-upload
keyPassword=$pw
EOF
  echo "created $ks and $props — back both up somewhere safe; losing them means a new Play listing"
}

build() {
  [[ -f "$KEYS/keystore.properties" ]] || { echo "run '$0 keystore' first" >&2; exit 1; }
  [[ -x "$JAVA_HOME/bin/java" ]] || { echo "run '$0 setup' first" >&2; exit 1; }
  cd "$ROOT/apps/mobile"
  [[ -n "${EXPO_PUBLIC_API_URL:-}" ]] || { [[ -f .env ]] && set -a && . ./.env && set +a; }
  echo "== EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL:-<default from app.config.ts>}"
  local version code
  version="$(node -p "require('./package.json').version")"
  code="$(npx --yes expo config --type public --json 2>/dev/null | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).android.versionCode")"
  echo "== prebuild (android/ is generated, never committed)"
  rm -rf android
  CI=1 npx expo prebuild --platform android --no-install >/dev/null
  # Sign the release build with the upload key instead of the template's debug key.
  cat >> android/gradle.properties <<EOF

# Release signing (scripts/mobile/build-android.sh)
UNIGATE_KEYSTORE_PROPERTIES=$KEYS/keystore.properties
EOF
  node - <<'EOF'
const fs = require('fs');
const p = 'android/app/build.gradle';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/signingConfigs \{\n\s*debug \{/, `signingConfigs {
        release {
            def props = new Properties()
            file(project.property('UNIGATE_KEYSTORE_PROPERTIES')).withInputStream { props.load(it) }
            storeFile file(props['storeFile'])
            storePassword props['storePassword']
            keyAlias props['keyAlias']
            keyPassword props['keyPassword']
        }
        debug {`);
s = s.replace(/(release \{[\s\S]*?)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.release');
fs.writeFileSync(p, s);
EOF
  echo "== gradle assembleRelease bundleRelease (first run downloads Gradle + dependencies)"
  (cd android && ./gradlew --no-daemon -q assembleRelease bundleRelease)
  local dest="$OUT/$version"
  mkdir -p "$dest"
  cp android/app/build/outputs/apk/release/app-release.apk "$dest/unigate-$version-$code.apk"
  cp android/app/build/outputs/bundle/release/app-release.aab "$dest/unigate-$version-$code.aab"
  (cd "$dest" && sha256sum "unigate-$version-$code.apk" "unigate-$version-$code.aab" > "unigate-$version-$code.sha256")
  ls -la "$dest"
}

case "${1:-}" in
  setup) setup ;;
  keystore) keystore ;;
  build) build ;;
  *) echo "usage: $0 setup|keystore|build" >&2; exit 2 ;;
esac
