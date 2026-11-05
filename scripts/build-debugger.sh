#!/bin/bash
# Builds the XSLT debug adapter jar (xslt-resources/xslt-debugger/xslt-debugger.jar) from debugger/src.
#
# The adapter runs on the user's own Saxon jar, so it's compiled against Saxon-HE 12 (downloaded from Maven Central
# unless SAXON_JAR is set) and targets Java 8, the lowest Java version Saxon 12 supports. It only uses Saxon APIs that
# are the same in Saxon 12 and 13 - check changes against both with scripts/test-debugger.sh.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/debugger/src"
build="$root/debugger/build"
out="$root/xslt-resources/xslt-debugger/xslt-debugger.jar"
saxon_version="12.9"

if [[ -z "${SAXON_JAR:-}" ]]; then
	SAXON_JAR="$root/debugger/lib/Saxon-HE-$saxon_version.jar"
	if [[ ! -f "$SAXON_JAR" ]]; then
		mkdir -p "$(dirname "$SAXON_JAR")"
		echo "Downloading Saxon-HE $saxon_version for compilation..."
		curl -sfL -o "$SAXON_JAR" "https://repo1.maven.org/maven2/net/sf/saxon/Saxon-HE/$saxon_version/Saxon-HE-$saxon_version.jar"
	fi
fi

rm -rf "$build"
mkdir -p "$build" "$(dirname "$out")"
javac --release 8 -Xlint:-options -encoding UTF-8 -cp "$SAXON_JAR" -d "$build" $(find "$src" -name '*.java')
jar --create --file "$out" -C "$build" .
echo "Built $out"
