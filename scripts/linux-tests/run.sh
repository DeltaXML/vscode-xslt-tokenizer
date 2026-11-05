#!/bin/bash
# Runs the extension's tests on Linux, in a Docker container: the debug adapter's protocol tests
# (scripts/test-debugger.js) with Saxon-HE 12.9 and 13.1, then the VS Code extension tests under Xvfb, with the
# debug-session tests run against Saxon-HE 13.1.
#
#   scripts/linux-tests/run.sh          all of the above
#   scripts/linux-tests/run.sh shell    a shell in the container, with the working tree copied in
#
# The working tree (including uncommitted changes) is copied into the container, without node_modules or build
# output, so nothing in it is changed. npm packages and the VS Code download are kept in Docker volumes between runs.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
image="xslt-tokenizer-linux-tests"

docker build -q -t "$image" "$root/scripts/linux-tests" > /dev/null

steps='
set -euo pipefail
rsync -a --delete --exclude node_modules --exclude out --exclude .vscode-test --exclude debugger/build \
    --exclude debugger/lib --exclude "*.vsix" --exclude .git /src/ /home/node/work/
npm ci --no-audit --no-fund --loglevel=error
'
if [[ "${1:-}" == "shell" ]]; then
    steps+='exec bash'
else
    steps+='
echo "== Building the debug adapter"
SAXON_JAR=/opt/SaxonHE12-9J/saxon-he-12.9.jar scripts/build-debugger.sh
echo "== Debug adapter protocol tests"
node scripts/test-debugger.js /opt/SaxonHE12-9J/saxon-he-12.9.jar /opt/SaxonHE13-1J/saxon-he-13.1.jar
echo "== VS Code extension tests"
XSLT_TEST_SAXON_JAR=/opt/SaxonHE13-1J/saxon-he-13.1.jar xvfb-run -a npm test
'
fi

docker run --rm --init $([[ -t 0 ]] && echo -it) \
    -v "$root:/src:ro" \
    -v xslt-tokenizer-node-modules:/home/node/work/node_modules \
    -v xslt-tokenizer-vscode-test:/home/node/work/.vscode-test \
    "$image" bash -c "$steps"
