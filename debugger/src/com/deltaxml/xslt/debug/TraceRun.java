/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A run of a stylesheet with logpoints, and no VS Code: for a command line - an AI assistant's (see the MCP tool
 * trace_configuration in the extension). It drives the debug adapter in this JVM, as VS Code would over the protocol:
 * the stylesheet runs to the end, and at each logpoint the message - by default the local variables, {$*} - is printed
 * with where it is, as the Debug Console shows it, with xsl:message output and Saxon's errors in between. Nothing pauses.
 *
 *   java -cp xslt-debugger.jar:saxon.jar com.deltaxml.xslt.debug.TraceRun [options] -- saxon-options
 *
 *   --log FILE:LINE[=MESSAGE]  a logpoint at the line; MESSAGE as a logpoint's, with {expression} parts - {$*} by default
 *   --when FILE:LINE=CONDITION  only log at the line when the XPath condition is true
 *   --max-hits N               the most messages printed for each logpoint (20 by default) - the rest are counted
 *   --rules                    at the end, for each input file: the rules that processed its elements, and the elements only
 *                              built-in rules did - no template matched them - as the extension's input_rules tool gives them
 */
public final class TraceRun {

    private static final Pattern AT = Pattern.compile("^(.+?):(\\d+)(?:=(.*))?$", Pattern.DOTALL);
    private static final Pattern ANSI = Pattern.compile("\u001B\\[[0-9;]*m");

    private static final class Logpoint {
        final String path;
        final int line;
        String message;
        String condition;
        // where the adapter set it - moved to the instruction's first line - or -1 if it couldn't
        int actualLine;
        String note;
        int hits;

        Logpoint(String path, int line) {
            this.path = path;
            this.line = line;
            this.actualLine = line;
        }
    }

    private TraceRun() {
    }

    public static void main(String[] args) throws Exception {
        final PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
        final Map<String, Logpoint> logpoints = new LinkedHashMap<String, Logpoint>();
        final List<String> saxonArgs = new ArrayList<String>();
        int maxHitsArg = 20;
        boolean rulesArg = false;
        try {
            for (int i = 0; i < args.length; i++) {
                String arg = args[i];
                if (arg.equals("--")) {
                    Collections.addAll(saxonArgs, java.util.Arrays.copyOfRange(args, i + 1, args.length));
                    break;
                } else if (arg.equals("--log") || arg.equals("--when")) {
                    Matcher m = AT.matcher(value(args, ++i, arg));
                    if (!m.matches()) {
                        throw new IllegalArgumentException(arg + " " + args[i] + ": give FILE:LINE" + (arg.equals("--when") ? "=CONDITION" : "[=MESSAGE]"));
                    }
                    String path = Debugger.normalisePath(m.group(1));
                    int line = Integer.parseInt(m.group(2));
                    String key = path + ':' + line;
                    Logpoint logpoint = logpoints.get(key);
                    if (logpoint == null) {
                        logpoint = new Logpoint(path, line);
                        logpoints.put(key, logpoint);
                    }
                    if (arg.equals("--log")) {
                        logpoint.message = m.group(3) == null || m.group(3).trim().isEmpty() ? "{$*}" : m.group(3);
                    } else if (m.group(3) == null || m.group(3).trim().isEmpty()) {
                        throw new IllegalArgumentException("--when " + args[i] + ": give FILE:LINE=CONDITION");
                    } else {
                        logpoint.condition = m.group(3);
                    }
                } else if (arg.equals("--rules")) {
                    rulesArg = true;
                } else if (arg.equals("--max-hits")) {
                    maxHitsArg = Integer.parseInt(value(args, ++i, arg));
                } else {
                    throw new IllegalArgumentException("unknown option " + arg + " - Saxon's options go after --");
                }
            }
            if (saxonArgs.isEmpty()) {
                throw new IllegalArgumentException("no Saxon options: give them after --, e.g. -- -xsl:report.xsl -s:orders.xml -o:out.xml");
            }
            for (Logpoint logpoint : logpoints.values()) {
                if (logpoint.message == null) {
                    // a condition alone: the local variables, when it's true
                    logpoint.message = "{$*}";
                }
            }
        } catch (IllegalArgumentException e) {
            out.println("TraceRun: " + e.getMessage());
            out.println("Usage: java -cp xslt-debugger.jar:saxon.jar " + TraceRun.class.getName() +
                    " [--log FILE:LINE[=MESSAGE]]... [--when FILE:LINE=CONDITION]... [--max-hits N] [--rules] -- saxon-options");
            System.exit(2);
            return;
        }
        final int maxHits = maxHitsArg;
        final boolean rules = rulesArg;
        // the rules each input node was processed by, sent when the run ends
        final List<Map<String, Object>> nodeRules = new ArrayList<Map<String, Object>>();
        final CountDownLatch done = new CountDownLatch(1);
        final AtomicInteger exitCode = new AtomicInteger(0);
        final Path cwd = Paths.get("").toAbsolutePath();
        final XsltDebugAdapter[] adapter = new XsltDebugAdapter[1];
        // the logpoints of the file whose setBreakpoints request is being answered - requests are answered as they're handled
        final List<List<Logpoint>> setting = new ArrayList<List<Logpoint>>();
        adapter[0] = new XsltDebugAdapter(message -> {
            if ("response".equals(message.get("type")) && "setBreakpoints".equals(message.get("command")) && !setting.isEmpty()) {
                Map<String, Object> responseBody = Json.object(message, "body");
                List<Object> set = responseBody == null ? new ArrayList<Object>() : Json.array(responseBody, "breakpoints");
                List<Logpoint> fileLogpoints = setting.get(0);
                for (int k = 0; k < fileLogpoints.size(); k++) {
                    Logpoint logpoint = fileLogpoints.get(k);
                    @SuppressWarnings("unchecked")
                    Map<String, Object> result = k < set.size() ? (Map<String, Object>) set.get(k) : null;
                    logpoint.actualLine = result != null && Json.bool(result, "verified") ? (int) Json.number(result, "line", logpoint.line) : -1;
                    logpoint.note = result == null ? Json.string(message, "message") : Json.string(result, "message");
                }
                return;
            }
            if (!"event".equals(message.get("type"))) {
                return;
            }
            String event = String.valueOf(message.get("event"));
            Map<String, Object> body = Json.object(message, "body");
            switch (event) {
                case "output": {
                    String text = ANSI.matcher(String.valueOf(body.get("output"))).replaceAll("");
                    Map<String, Object> source = Json.object(body, "source");
                    String path = source == null ? null : Json.string(source, "path");
                    int line = (int) Json.number(body, "line", 0);
                    Logpoint logpoint = path != null && "console".equals(body.get("category")) ? find(logpoints, path, line) : null;
                    if (logpoint != null) {
                        logpoint.hits++;
                        if (logpoint.hits <= maxHits) {
                            String where = shown(cwd, logpoint.path) + ':' + logpoint.actualLine + " #" + logpoint.hits + ": ";
                            out.print(where + text.replace("\n", "\n  ").replaceAll("\n  $", "\n"));
                        }
                    } else {
                        out.print(text);
                    }
                    break;
                }
                case "stopped":
                    // nothing should pause a trace - but if something does, go on
                    new Thread(() -> adapter[0].handle(request("continue", Json.obj().with("threadId", XsltDebugAdapter.THREAD_ID)))).start();
                    break;
                case "xsltNodeRules":
                    nodeRules.add(body);
                    break;
                case "exited":
                    exitCode.set((int) Json.number(body, "exitCode", 0));
                    break;
                case "terminated":
                    done.countDown();
                    break;
                default:
                    // the extension's own events: outputs, input mapping, coverage
            }
        });
        adapter[0].redirectSystemStreams();
        adapter[0].handle(request("initialize", Json.obj()));
        // with the input mapping only for --rules: it's what the rules are recorded with
        adapter[0].handle(request("launch", Json.obj().with("saxonArgs", saxonArgs).with("mapInputs", rules)));
        // each file's logpoints - and where the adapter set them
        Map<String, List<Logpoint>> byFile = new LinkedHashMap<String, List<Logpoint>>();
        for (Logpoint logpoint : logpoints.values()) {
            byFile.computeIfAbsent(logpoint.path, (p) -> new ArrayList<Logpoint>()).add(logpoint);
        }
        for (Map.Entry<String, List<Logpoint>> file : byFile.entrySet()) {
            List<Object> breakpoints = new ArrayList<Object>();
            for (Logpoint logpoint : file.getValue()) {
                breakpoints.add(Json.obj().with("line", logpoint.line).with("logMessage", logpoint.message).with("condition", logpoint.condition));
            }
            setting.clear();
            setting.add(file.getValue());
            adapter[0].handle(request("setBreakpoints", Json.obj().with("source", Json.obj().with("path", file.getKey())).with("breakpoints", breakpoints)));
            setting.clear();
        }
        for (Logpoint logpoint : logpoints.values()) {
            String at = shown(cwd, logpoint.path) + ':' + logpoint.line;
            if (logpoint.actualLine < 0) {
                out.println("Logpoint " + at + " not set: " + (logpoint.note != null ? logpoint.note : "there is no instruction there"));
            } else if (logpoint.actualLine != logpoint.line) {
                out.println("Logpoint " + at + " is at line " + logpoint.actualLine + (logpoint.note != null ? " - " + logpoint.note : ", where its instruction starts"));
            }
        }
        // nothing pauses: not even at an error, which ends the run
        adapter[0].handle(request("setExceptionBreakpoints", Json.obj().with("filters", new ArrayList<Object>())));
        adapter[0].handle(request("configurationDone", Json.obj()));
        done.await();
        System.out.flush();
        System.err.flush();
        out.println();
        out.println("--- " + (exitCode.get() == 0 ? "The run ended" : "The run failed (exit code " + exitCode.get() + ") - see Saxon's error above"));
        for (Logpoint logpoint : logpoints.values()) {
            if (logpoint.actualLine < 0) {
                continue;
            }
            String at = shown(cwd, logpoint.path) + ':' + logpoint.actualLine;
            out.println(at + ": " + (logpoint.hits == 0 ? "never reached" + (logpoint.condition != null ? ", or its condition was never true" : "") :
                    logpoint.hits + (logpoint.hits == 1 ? " hit" : " hits") + (logpoint.hits > maxHits ? " - the first " + maxHits + " shown (--max-hits)" : "")));
        }
        if (rules) {
            if (nodeRules.isEmpty()) {
                out.println();
                out.println("--- Input rules: none recorded - no node of an input file was processed by a rule (e.g. a run from a named template that reads no file)");
            } else {
                InputRulesSummary.print(out, cwd, nodeRules.get(0));
            }
        }
        out.flush();
        System.exit(exitCode.get());
    }

    private static String value(String[] args, int i, String option) {
        if (i >= args.length) {
            throw new IllegalArgumentException(option + " needs a value");
        }
        return args[i];
    }

    private static Map<String, Object> request(String command, Map<String, Object> arguments) {
        return Json.obj().with("type", "request").with("seq", 0).with("command", command).with("arguments", arguments);
    }

    // the logpoint a message is from: the event has the normalised path and the line it was set at
    private static Logpoint find(Map<String, Logpoint> logpoints, String path, int line) {
        String normalised = Debugger.normalisePath(path);
        for (Logpoint logpoint : logpoints.values()) {
            if (logpoint.path.equals(normalised) && logpoint.actualLine == line) {
                return logpoint;
            }
        }
        return null;
    }

    private static String shown(Path cwd, String path) {
        Path p = Paths.get(path);
        return p.startsWith(cwd) ? cwd.relativize(p).toString() : path;
    }
}
