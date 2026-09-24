#!/bin/sh
# npm's Windows script-shell (cmd.exe) can't reliably resolve `./gradlew.bat`
# or `android/gradlew.bat` from a chained `&&` script (see build:apk in
# package.json) — cmd.exe's path/cwd handling for that call kept failing
# ("not recognized") even though the exact same invocation works fine when
# run directly through Git Bash. Routing through this script sidesteps
# cmd.exe entirely: package.json calls `bash scripts/build-android.sh`,
# and bash is already required for every other device script in this repo.
set -e
cd "$(dirname "$0")/../android"
# Belt-and-suspenders: org.gradle.daemon=false (gradle.properties) means
# this build won't leave a new daemon behind, but stop any daemon still
# resident from before that setting existed, or from a different Gradle
# version/JVM-args combo not covered by this project's own --stop.
./gradlew.bat --stop
./gradlew.bat assembleDebug
