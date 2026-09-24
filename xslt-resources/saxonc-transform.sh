#!/bin/sh
# Runs SaxonC's Transform for the 'xslt-c' task provider on macOS/Linux
#
# usage: sh saxonc-transform.sh /path/to/Transform [transform-args...]
#
# Environment variables set by the task provider:
#   SAXONC_LIBRARY_PATH      - folders to search for SaxonC's native libraries. Exported here as
#                              DYLD_LIBRARY_PATH (macOS) or LD_LIBRARY_PATH (Linux): macOS strips DYLD_*
#                              variables a process merely inherits (SIP), but a process may set them for its
#                              own children
#   SAXONC_UNESCAPE_MESSAGES - when 'true', stderr is merged into stdout and XML character references and
#                              predefined entities are converted back to literal characters, since SaxonC
#                              serializes xsl:message output as escaped XML text (e.g. '<' as '&lt;' and an
#                              ANSI escape as '&#x1b;'). The exit status of Transform is preserved

if [ -n "$SAXONC_LIBRARY_PATH" ]; then
    if [ "$(uname)" = "Darwin" ]; then
        export DYLD_LIBRARY_PATH="$SAXONC_LIBRARY_PATH"
    else
        export LD_LIBRARY_PATH="$SAXONC_LIBRARY_PATH"
    fi
fi

if [ "$SAXONC_UNESCAPE_MESSAGES" != "true" ] || ! command -v perl >/dev/null 2>&1; then
    exec "$@"
fi

# A single-pass substitution, so that an escaped reference such as '&amp;#x1b;' decodes only once (to
# '&#x1b;'). Output is flushed per line so messages appear as they're produced
unescape() {
    perl -CS -pe 'BEGIN { $| = 1 }
        s/&(?:#x([0-9A-Fa-f]+)|#([0-9]+)|(lt|gt|amp|quot|apos));/
            defined $1 ? chr(hex $1) : defined $2 ? chr($2) :
            { lt => "<", gt => ">", amp => "&", quot => "\"", apos => "\x27" }->{$3}/ge'
}

# POSIX sh has no 'pipefail' - pass the exit status of Transform out via fd 3 instead
exec 4>&1
status=$( { { "$@" 2>&1; echo $? >&3; } | unescape >&4; } 3>&1 )
exit "$status"
