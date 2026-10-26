/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * A Debug Adapter Protocol server for Saxon XSLT transforms, talking to VS Code over stdin/stdout. It runs in the same
 * JVM as the transform, which is started by net.sf.saxon.Transform with the same command-line options the
 * extension's 'xslt' tasks use, plus a TraceListener (DebugTraceListener) that pauses execution.
 *
 * Since stdout carries the protocol, System.out and System.err are redirected to DAP 'output' events: the
 * principal result (when there is no -o option), xsl:message output and Saxon's error messages all appear in the
 * Debug Console.
 */
public final class XsltDebugAdapter {

    static final int THREAD_ID = 1;

    private final OutputStream protocolOut;
    private int seq = 1;
    // replaced by a new one on going back (stepBack, reverseContinue), which runs the transform again
    private volatile Debugger debugger = new Debugger(this);
    private OutputEventStream stderr;
    // while the transform is run again, to go back: the output already shown in the Debug Console isn't shown again
    volatile boolean muted;

    private XsltDebugAdapter(OutputStream protocolOut) {
        this.protocolOut = protocolOut;
    }

    public static void main(String[] args) throws IOException {
        XsltDebugAdapter adapter = new XsltDebugAdapter(new BufferedOutputStream(new FileOutputStream(FileDescriptor.out)));
        System.setOut(new PrintStream(new OutputEventStream(adapter, "stdout"), true, "UTF-8"));
        adapter.stderr = new OutputEventStream(adapter, "stderr");
        System.setErr(new PrintStream(adapter.stderr, true, "UTF-8"));
        adapter.run(new BufferedInputStream(new FileInputStream(FileDescriptor.in)));
    }

    private void run(InputStream in) {
        try {
            String message;
            while ((message = readMessage(in)) != null) {
                Object parsed = Json.parse(message);
                if (parsed instanceof Map) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> request = (Map<String, Object>) parsed;
                    if ("request".equals(request.get("type"))) {
                        handle(request);
                    }
                }
            }
        } catch (Exception e) {
            log("debug adapter stopped: " + e);
        }
        // the client has gone
        System.exit(0);
    }

    // a 'Content-Length: n' header block, then n bytes of UTF-8 JSON - null at the end of the input
    private static String readMessage(InputStream in) throws IOException {
        int contentLength = -1;
        StringBuilder line = new StringBuilder();
        while (true) {
            int b = in.read();
            if (b < 0) {
                return null;
            }
            if (b == '\n') {
                String header = line.toString().trim();
                line.setLength(0);
                if (header.isEmpty()) {
                    if (contentLength >= 0) {
                        break;
                    }
                } else if (header.toLowerCase().startsWith("content-length:")) {
                    contentLength = Integer.parseInt(header.substring("content-length:".length()).trim());
                }
            } else {
                line.append((char) b);
            }
        }
        byte[] body = new byte[contentLength];
        int read = 0;
        while (read < contentLength) {
            int n = in.read(body, read, contentLength - read);
            if (n < 0) {
                return null;
            }
            read += n;
        }
        return new String(body, StandardCharsets.UTF_8);
    }

    synchronized void send(Map<String, Object> message) {
        message.put("seq", seq++);
        byte[] body = Json.stringify(message).getBytes(StandardCharsets.UTF_8);
        try {
            protocolOut.write(("Content-Length: " + body.length + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            protocolOut.write(body);
            protocolOut.flush();
        } catch (IOException e) {
            // the client has gone
            System.exit(0);
        }
    }

    void event(String name, Object body) {
        send(Json.obj().with("type", "event").with("event", name).with("body", body));
    }

    // a message for the Debug Console from the adapter itself (rather than the transform)
    void log(String text) {
        if (muted) {
            return;
        }
        event("output", Json.obj().with("category", "console").with("output", text + "\n"));
    }

    private void respond(Map<String, Object> request, Object body) {
        send(Json.obj().with("type", "response").with("request_seq", request.get("seq")).with("success", true)
                .with("command", request.get("command")).with("body", body));
    }

    private void respondError(Map<String, Object> request, String message) {
        send(Json.obj().with("type", "response").with("request_seq", request.get("seq")).with("success", false)
                .with("command", request.get("command")).with("message", message)
                .with("body", Json.obj().with("error", Json.obj().with("id", 1).with("format", message).with("showUser", false))));
    }

    private void handle(Map<String, Object> request) {
        String command = String.valueOf(request.get("command"));
        Map<String, Object> args = Json.object(request, "arguments");
        try {
            switch (command) {
                case "initialize":
                    respond(request, Json.obj()
                            .with("supportsConfigurationDoneRequest", true)
                            .with("supportsEvaluateForHovers", true)
                            .with("supportsConditionalBreakpoints", true)
                            .with("supportsHitConditionalBreakpoints", true)
                            .with("supportsLogPoints", true)
                            .with("supportsFunctionBreakpoints", true)
                            .with("supportsTerminateRequest", true)
                            .with("supportsExceptionInfoRequest", true)
                            .with("supportsStepBack", true)
                            .with("exceptionBreakpointFilters", Arrays.asList(
                                    Json.obj().with("filter", "errors").with("label", "Dynamic Errors").with("default", true)
                                            .with("description", "Pause at a dynamic error that ends the transform - including xsl:message with terminate=\"yes\""),
                                    Json.obj().with("filter", "caught").with("label", "Errors Caught by xsl:try").with("default", false)
                                            .with("description", "Pause at a dynamic error that an xsl:try catches"))));
                    event("initialized", null);
                    break;
                case "launch":
                    debugger.configure(args);
                    respond(request, null);
                    break;
                case "setBreakpoints":
                    respond(request, Json.obj().with("breakpoints", debugger.setBreakpoints(args)));
                    break;
                case "setExceptionBreakpoints":
                    debugger.setExceptionBreakpoints(args);
                    respond(request, Json.obj().with("breakpoints", new ArrayList<Object>()));
                    break;
                case "exceptionInfo":
                    respond(request, debugger.exceptionInfo());
                    break;
                case "setFunctionBreakpoints":
                    respond(request, Json.obj().with("breakpoints", debugger.setFunctionBreakpoints(args)));
                    break;
                case "configurationDone":
                    respond(request, null);
                    debugger.start();
                    break;
                case "threads":
                    List<Object> threads = new ArrayList<Object>();
                    threads.add(Json.obj().with("id", THREAD_ID).with("name", "XSLT transform"));
                    respond(request, Json.obj().with("threads", threads));
                    break;
                case "stackTrace":
                    List<Map<String, Object>> frames = debugger.stackTrace();
                    respond(request, Json.obj().with("stackFrames", frames).with("totalFrames", frames.size()));
                    break;
                case "scopes":
                    respond(request, Json.obj().with("scopes", debugger.scopes((int) Json.number(args, "frameId", 0))));
                    break;
                case "variables":
                    respond(request, Json.obj().with("variables", debugger.variables((int) Json.number(args, "variablesReference", 0))));
                    break;
                case "evaluate":
                    respond(request, debugger.evaluate(Json.string(args, "expression"),
                            (int) Json.number(args, "frameId", -1), Json.string(args, "context")));
                    break;
                case "continue":
                    debugger.resume(Debugger.Step.NONE);
                    respond(request, Json.obj().with("allThreadsContinued", true));
                    break;
                case "next":
                    debugger.resume(Debugger.Step.OVER);
                    respond(request, null);
                    break;
                case "stepIn":
                    debugger.resume(Debugger.Step.INTO);
                    respond(request, null);
                    break;
                case "stepOut":
                    debugger.resume(Debugger.Step.OUT);
                    respond(request, null);
                    break;
                case "stepBack":
                case "reverseContinue":
                    debugger = debugger.goBack(command.equals("reverseContinue"));
                    respond(request, null);
                    break;
                case "pause":
                    debugger.requestPause();
                    respond(request, null);
                    break;
                case "terminate":
                    // VS Code ends the session at the 'terminated' event, then disconnects - the transform runs in
                    // this JVM, so it's stopped when the adapter exits then
                    respond(request, null);
                    // no longer paused: VS Code stops asking for the call stack
                    event("continued", Json.obj().with("threadId", THREAD_ID).with("allThreadsContinued", true));
                    event("terminated", Json.obj());
                    break;
                case "disconnect":
                    respond(request, null);
                    System.out.flush();
                    System.err.flush();
                    System.exit(0);
                    break;
                default:
                    respondError(request, "unsupported request '" + command + "'");
            }
        } catch (Exception e) {
            String message = e.getMessage() != null ? e.getMessage() : e.toString();
            respondError(request, message);
        }
    }

    // Saxon's report of an error, written to System.err, as one Debug Console entry linked to the error's location
    void linkedErrorOutput(String path, int line, int column, Runnable report) {
        System.err.flush();
        stderr.link(path, line, column);
        try {
            report.run();
        } finally {
            System.err.flush();
            stderr.unlink();
        }
    }

    /** sends each line written to it as a DAP 'output' event - or, while linked to a location, all of it as one */
    private static final class OutputEventStream extends OutputStream {
        private final XsltDebugAdapter adapter;
        private final String category;
        private final ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        private boolean linked;
        private String linkPath;
        private int linkLine;
        private int linkColumn;

        OutputEventStream(XsltDebugAdapter adapter, String category) {
            this.adapter = adapter;
            this.category = category;
        }

        @Override
        public synchronized void write(int b) {
            buffer.write(b);
            if (b == '\n' && !linked) {
                flush();
            }
        }

        synchronized void link(String path, int line, int column) {
            emit();
            linked = true;
            linkPath = path;
            linkLine = line;
            linkColumn = column;
        }

        synchronized void unlink() {
            emit();
            linked = false;
            linkPath = null;
        }

        @Override
        public synchronized void write(byte[] b, int off, int len) {
            for (int i = off; i < off + len; i++) {
                write(b[i]);
            }
        }

        @Override
        public synchronized void flush() {
            if (!linked) {
                emit();
            }
        }

        private void emit() {
            if (buffer.size() > 0 && adapter.muted) {
                buffer.reset();
            } else if (buffer.size() > 0) {
                String text = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
                buffer.reset();
                Json.Obj event = Json.obj().with("category", category).with("output", text);
                if (linked && linkPath != null && linkLine > 0) {
                    String name = java.nio.file.Paths.get(linkPath).getFileName().toString();
                    event.with("source", Json.obj().with("name", name).with("path", linkPath)).with("line", linkLine).with("column", Math.max(linkColumn, 1));
                }
                adapter.event("output", event);
            }
        }
    }
}
