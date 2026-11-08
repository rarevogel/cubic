#!/bin/sh
# Builds Cubic.apk without Gradle: aapt2 -> javac -> dx -> zipalign -> apksigner.
# Needs: android.jar of platform 29-34 (for foregroundServiceType; aapt2 2.19 cannot read the API 35 jar), aapt2, dalvik-exchange (dx) or d8, zipalign, apksigner, a JDK.
# Usage: KEYSTORE_FILE=... KEYSTORE_PASSWORD=... KEY_ALIAS=... ./build.sh
set -e
cd "$(dirname "$0")"
python3 ../build.py                          # writes the page to assets/index.html
SDK=${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-34/android.jar}
VERSION_CODE=${VERSION_CODE:-1}
VERSION_NAME=${VERSION_NAME:-1.0}
B=build
rm -rf $B && mkdir -p $B/classes $B/gen $B/dex
aapt2 compile --dir res -o $B/res.zip
aapt2 link -I "$SDK" --manifest AndroidManifest.xml -A assets --java $B/gen \
    --min-sdk-version 24 --target-sdk-version 35 --version-code $VERSION_CODE --version-name $VERSION_NAME \
    -o $B/unsigned.apk $B/res.zip
javac -encoding UTF-8 -source 8 -target 8 -bootclasspath "$SDK" -Xlint:-options -d $B/classes \
    $(find src -name "*.java") $B/gen/nl/rarevogel/cubic/R.java
dalvik-exchange --dex --min-sdk-version=24 --output=$B/dex/classes.dex $B/classes
(cd $B/dex && zip -q ../unsigned.apk classes.dex)
zipalign -f -p 4 $B/unsigned.apk $B/aligned.apk
apksigner sign --ks "$KEYSTORE_FILE" --ks-pass env:KEYSTORE_PASSWORD --ks-key-alias "$KEY_ALIAS" \
    --key-pass env:KEYSTORE_PASSWORD --out Cubic.apk $B/aligned.apk
apksigner verify Cubic.apk && ls -la Cubic.apk
