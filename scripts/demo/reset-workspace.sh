#!/usr/bin/env bash
# Resets the demo workspace for a retake: empties /Users/Shared/xslt-demo - a path with no user name in it, as it's seen
# in the recording - and copies in fresh copies of the sample files for the video: no .vscode folder (so no tasks.json),
# and no generated XSpec results. Another folder can be given with XSLT_DEMO_WORKSPACE, but its name must be xslt-demo,
# as everything in it is deleted.
#
#   scripts/demo/reset-workspace.sh 1    # run and debug a stylesheet  (debug-xpath.xsl, orders.xml)
#   scripts/demo/reset-workspace.sh 2    # step-through debugging       (the same files)
#   scripts/demo/reset-workspace.sh 3    # XSpec testing                (sample/xspec-demo)
#   scripts/demo/reset-workspace.sh 4    # XSLT packages                (sample/packages-demo)
#
# Open the workspace with the 'Demo: Record Videos' launch configuration. Before running this, close the editors in that
# window (Cmd+K W); afterwards, run 'Debug: Remove All Breakpoints' there if breakpoints are left from the last take.
# Only the demo workspace is changed - never the committed samples.
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SAMPLES="$(cd "$DEMO_DIR/../../sample" && pwd)"
WORKSPACE="${XSLT_DEMO_WORKSPACE:-/Users/Shared/xslt-demo}"
if [ "$(basename "$WORKSPACE")" != "xslt-demo" ]; then
	echo "The demo workspace's folder must be named xslt-demo, as everything in it is deleted: $WORKSPACE" >&2
	exit 1
fi

video="${1:-}"
case "$video" in
	1|2) source="$SAMPLES/debugger-demo"; files=(debug-xpath.xsl orders.xml) ;;
	3) source="$SAMPLES/xspec-demo"; files=() ;;
	4) source="$SAMPLES/packages-demo"; files=() ;;
	*)
		echo "usage: $0 <video: 1, 2, 3 or 4>" >&2
		exit 1
		;;
esac

# empty the workspace - its contents, including hidden files such as .vscode - but keep the folder, which may be open
mkdir -p "$WORKSPACE"
find "$WORKSPACE" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

if [ ${#files[@]} -gt 0 ]; then
	for file in "${files[@]}"; do
		cp "$source/$file" "$WORKSPACE/"
	done
else
	# the whole sample, without editor settings, generated XSpec results, agent settings or .gitignore
	rsync -a --exclude '.vscode/' --exclude 'xspec/' --exclude '.claude/' --exclude '.gitignore' "$source/" "$WORKSPACE/"
fi

echo "Workspace reset for video $video: $WORKSPACE"
(cd "$WORKSPACE" && find . -type f | sed 's|^\./|  |' | sort)
