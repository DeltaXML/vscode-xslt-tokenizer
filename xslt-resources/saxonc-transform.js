// Runs SaxonC's Transform for the 'xslt-c' task provider, using the Node.js runtime built into VS Code (its own
// executable, run with ELECTRON_RUN_AS_NODE=1) - so it needs nothing else installed, and on Windows no
// PowerShell execution policy applies
//
// usage: <VS Code executable> saxonc-transform.js [line-break] /path/to/Transform [transform-args...]
//
// The optional line-break argument (whitespace, with an optional '\' or '^' line-continuation character) is
// ignored: it only exists so the 'Executing task' line VS Code echoes (the arguments joined with spaces) breaks
// after the long VS Code executable and script paths
//
// Environment variables set by the task provider:
//   SAXONC_LIBRARY_PATH      - folders to search for SaxonC's native libraries, prepended for Transform to
//                              DYLD_LIBRARY_PATH (macOS), LD_LIBRARY_PATH (Linux) or PATH (Windows). macOS
//                              strips DYLD_* variables a process merely inherits (SIP), but a process may set
//                              them for its own children
//   SAXONC_UNESCAPE_MESSAGES - when 'true', XML character references and predefined entities on stderr are
//                              converted back to literal characters, since SaxonC serializes xsl:message
//                              output as escaped XML text (e.g. '<' as '&lt;' and an ANSI escape as '&#x1b;').
//                              stdout (which may be the transform result) is left untouched
//
// The exit status of Transform is preserved
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const entities = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

// a single-pass substitution, so that an escaped reference such as '&amp;#x1b;' decodes only once (to '&#x1b;')
function unescape(text) {
    return text.replace(/&(?:#x([0-9A-Fa-f]+)|#([0-9]+)|(lt|gt|amp|quot|apos));/g, (match, hex, decimal, name) => {
        if (name) {
            return entities[name];
        }
        try {
            return String.fromCodePoint(hex ? parseInt(hex, 16) : parseInt(decimal, 10));
        } catch {
            return match; // not a valid code point
        }
    });
}

function libraryPathEnvVarName(env) {
    if (process.platform === 'win32') {
        // environment variable names are case-insensitive on Windows, so e.g. 'Path' may be used
        return Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
    }
    return process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
}

const argv = process.argv.slice(2);
if (argv.length > 0 && /^\s*[\\^]?\s*$/.test(argv[0])) {
    argv.shift();
}
const [executable, ...args] = argv;

const env = { ...process.env };
const libraryPath = env.SAXONC_LIBRARY_PATH;
const unescapeMessages = env.SAXONC_UNESCAPE_MESSAGES === 'true';
delete env.ELECTRON_RUN_AS_NODE;
delete env.SAXONC_LIBRARY_PATH;
delete env.SAXONC_UNESCAPE_MESSAGES;
if (libraryPath) {
    const varName = libraryPathEnvVarName(env);
    env[varName] = env[varName] ? libraryPath + path.delimiter + env[varName] : libraryPath;
}

const transform = spawn(executable, args, { env, stdio: ['inherit', 'inherit', unescapeMessages ? 'pipe' : 'inherit'] });
transform.on('error', (error) => {
    process.stderr.write(`Could not run ${executable}: ${error.message}\n`);
    process.exit(1);
});
if (unescapeMessages) {
    readline.createInterface({ input: transform.stderr, crlfDelay: Infinity }).on('line', (line) => {
        process.stderr.write(unescape(line) + '\n');
    });
}
transform.on('close', (code) => {
    process.exit(code ?? 1);
});
