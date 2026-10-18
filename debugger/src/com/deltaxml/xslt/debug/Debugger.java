/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Matcher;

import net.sf.saxon.Transform;
import net.sf.saxon.expr.XPathContext;
import net.sf.saxon.om.Item;
import net.sf.saxon.om.StructuredQName;
import net.sf.saxon.s9api.Location;
import net.sf.saxon.s9api.XdmValue;
import net.sf.saxon.trace.Traceable;
import net.sf.saxon.trace.TraceableComponent;

/**
 * The debugger's state, shared by the DAP thread (requests from VS Code) and the transform thread (TraceListener
 * callbacks). The transform thread pauses inside TraceListener.enter(); while it is paused, the DAP thread hands it
 * the work for stackTrace/scopes/variables/evaluate requests, so Saxon's objects are only ever used on the transform
 * thread - evaluating a lazily-evaluated variable runs Saxon code, which mustn't race with the paused transform.
 */
final class Debugger {

    enum Step { NONE, OVER, INTO, OUT }

    // the debugger instance that DebugTraceListener instances (created by Saxon from the -T option) report to
    static volatile Debugger current;

    private final XsltDebugAdapter dap;

    // --- launch configuration (DAP thread, before start)
    private final List<String> saxonArgs = new ArrayList<String>();
    private boolean stopOnEntry;

    // --- breakpoints: normalised file path -> line -> breakpoint (written by the DAP thread at any time)
    private final Map<String, Map<Integer, Breakpoint>> breakpoints = new ConcurrentHashMap<String, Map<Integer, Breakpoint>>();

    // --- run control, guarded by lock
    private final Object lock = new Object();
    private boolean paused;
    private final Deque<FutureTask<?>> tasks = new ArrayDeque<FutureTask<?>>();
    private Step step = Step.NONE;
    private int stepCallDepth;
    private String stepPath;
    private int stepLine;
    private volatile boolean pauseRequested;

    // --- transform-thread state
    private Thread transformThread;
    private boolean runningTask;
    private final Deque<Frame> frames = new ArrayDeque<Frame>();
    private int callDepth;
    // the line last stopped at, where breakpoints are ignored until execution moves to another line or item
    private String stoppedPath;
    private int stoppedLine;
    private List<Frame> pausedFrames = new ArrayList<Frame>();
    private final Values values = new Values();
    private final Map<String, String> pathCache = new HashMap<String, String>();
    private final Map<String, String> sourceTexts = new HashMap<String, String>();

    Debugger(XsltDebugAdapter dap) {
        this.dap = dap;
        current = this;
    }

    // ---------------------------------------------------------------- DAP thread

    void configure(Map<String, Object> args) {
        saxonArgs.clear();
        for (Object arg : Json.array(args, "saxonArgs")) {
            saxonArgs.add(String.valueOf(arg));
        }
        if (saxonArgs.isEmpty()) {
            throw new IllegalArgumentException("the launch request has no 'saxonArgs'");
        }
        stopOnEntry = Json.bool(args, "stopOnEntry");
    }

    List<Map<String, Object>> setBreakpoints(Map<String, Object> args) {
        Map<String, Object> source = Json.object(args, "source");
        String path = Json.string(source, "path");
        List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
        if (path == null) {
            return result;
        }
        Map<Integer, Breakpoint> lines = new ConcurrentHashMap<Integer, Breakpoint>();
        for (Object item : Json.array(args, "breakpoints")) {
            @SuppressWarnings("unchecked")
            Map<String, Object> bp = (Map<String, Object>) item;
            int line = (int) Json.number(bp, "line", 0);
            lines.put(line, new Breakpoint(blankToNull(Json.string(bp, "condition")), blankToNull(Json.string(bp, "logMessage"))));
            result.add(Json.obj().with("verified", true).with("line", line));
        }
        breakpoints.put(normalisePath(path), lines);
        return result;
    }

    void start() {
        final List<String> args = new ArrayList<String>(saxonArgs);
        // tracing (-T) makes Saxon call our TraceListener for each instruction; without optimisation (-opt:0),
        // variables aren't inlined or eliminated, so they can be inspected; line numbering (-l) gives nodes from
        // source documents line numbers for the Variables view; with -quit:off, a failure throws an exception
        // rather than calling System.exit()
        args.add("-T:" + DebugTraceListener.class.getName());
        args.add("-opt:0");
        args.add("-l:on");
        args.add("-quit:off");
        transformThread = new Thread(new Runnable() {
            public void run() {
                int exitCode = 0;
                try {
                    new Transform().doTransform(args.toArray(new String[0]), "java net.sf.saxon.Transform");
                } catch (Throwable e) {
                    exitCode = 2;
                    // Saxon has already reported a failure it throws as a plain RuntimeException
                    if (e.getClass() != RuntimeException.class) {
                        System.err.println(message(e));
                    }
                }
                System.out.flush();
                System.err.flush();
                dap.event("exited", Json.obj().with("exitCode", exitCode));
                dap.event("terminated", Json.obj());
            }
        }, "xslt-transform");
        transformThread.start();
    }

    void resume(Step nextStep) {
        synchronized (lock) {
            if (!paused) {
                return;
            }
            step = nextStep;
            stepCallDepth = callDepth;
            stepPath = stoppedPath;
            stepLine = stoppedLine;
            paused = false;
            lock.notifyAll();
        }
    }

    void requestPause() {
        pauseRequested = true;
    }

    List<Map<String, Object>> stackTrace() throws Exception {
        return onTransformThread(new Callable<List<Map<String, Object>>>() {
            public List<Map<String, Object>> call() {
                List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
                for (int i = 0; i < pausedFrames.size(); i++) {
                    Frame frame = pausedFrames.get(i);
                    Json.Obj dapFrame = Json.obj().with("id", i).with("name", frame.name)
                            .with("line", Math.max(frame.line, 0)).with("column", Math.max(frame.column, 1));
                    String path = frame.systemId == null ? null : pathOf(frame.systemId);
                    if (path != null) {
                        dapFrame.with("source", Json.obj().with("name", Paths.get(path).getFileName().toString()).with("path", path));
                    }
                    result.add(dapFrame);
                }
                return result;
            }
        });
    }

    List<Map<String, Object>> scopes(final int frameId) throws Exception {
        return onTransformThread(new Callable<List<Map<String, Object>>>() {
            public List<Map<String, Object>> call() {
                Frame frame = frame(frameId);
                List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
                result.add(scope("Locals", values.register(values.locals(frame.context)), false));
                result.add(scope("Context", values.register(values.focus(frame.context)), false));
                result.add(scope("Globals", values.register(values.globals(frame.context)), true));
                return result;
            }
        });
    }

    List<Map<String, Object>> variables(final int reference) throws Exception {
        return onTransformThread(new Callable<List<Map<String, Object>>>() {
            public List<Map<String, Object>> call() {
                return values.children(reference);
            }
        });
    }

    Map<String, Object> evaluate(final String expression, final int frameId, final String context) throws Exception {
        return onTransformThread(new Callable<Map<String, Object>>() {
            public Map<String, Object> call() throws Exception {
                Frame frame = frame(frameId < 0 ? 0 : frameId);
                String xpath = expression.trim();
                if ("hover".equals(context)) {
                    // only variable references - not words that happen to be valid XPath
                    if (!xpath.startsWith("$")) {
                        xpath = "$" + xpath;
                    }
                    if (!xpath.matches("\\$[\\p{L}_][\\p{L}\\p{N}_.:-]*")) {
                        throw new IllegalArgumentException("not a variable reference");
                    }
                }
                XdmValue result = Evaluator.evaluate(frame.current, frame.context, xpath);
                Map<String, Object> variable = values.variable("result", result.getUnderlyingValue());
                return Json.obj().with("result", variable.get("value")).with("type", variable.get("type"))
                        .with("variablesReference", variable.get("variablesReference"));
            }
        });
    }

    private <T> T onTransformThread(Callable<T> work) throws Exception {
        FutureTask<T> task = new FutureTask<T>(work);
        synchronized (lock) {
            if (!paused) {
                throw new IllegalStateException("the transform is running");
            }
            tasks.add(task);
            lock.notifyAll();
        }
        try {
            return task.get(60, TimeUnit.SECONDS);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            throw cause instanceof Exception ? (Exception) cause : e;
        } catch (TimeoutException e) {
            task.cancel(false);
            throw new IllegalStateException("timed out");
        }
    }

    // ---------------------------------------------------------------- transform thread

    void enter(Traceable traceable, Map<String, Object> properties, XPathContext context) {
        if (Thread.currentThread() != transformThread || runningTask) {
            // e.g. a lazily evaluated variable being evaluated for the Variables view
            return;
        }
        boolean isCall = traceable instanceof TraceableComponent;
        if (isCall || isFocusInstruction(traceable)) {
            frames.push(new Frame(traceable, frameName(traceable, properties), isCall));
            if (isCall) {
                callDepth++;
            }
        } else if (frames.isEmpty()) {
            frames.push(new Frame(null, "transform", false));
        }
        Frame top = frames.peek();
        top.context = context;
        top.current = traceable;
        Location location = traceable.getLocation();
        if (location == null || location.getSystemId() == null || location.getLineNumber() <= 0) {
            return;
        }
        top.systemId = location.getSystemId();
        top.line = location.getLineNumber();
        top.column = location.getColumnNumber();

        String path = pathOf(top.systemId);
        if (path == null) {
            return;
        }
        boolean onStoppedLine = top.line == stoppedLine && path.equals(stoppedPath);
        if (!onStoppedLine) {
            stoppedPath = null;
        }

        String reason = null;
        if (pauseRequested) {
            reason = "pause";
        } else if (stopOnEntry) {
            reason = "entry";
        } else if (!onStoppedLine && breakpointHit(path, top.line, top)) {
            reason = "breakpoint";
        } else if (isStepComplete(path, top.line)) {
            reason = "step";
        }
        if (reason != null) {
            pauseRequested = false;
            stopOnEntry = false;
            stoppedPath = path;
            stoppedLine = top.line;
            pause(reason);
        }
    }

    void leave(Traceable traceable) {
        if (Thread.currentThread() != transformThread || runningTask) {
            return;
        }
        Frame top = frames.peek();
        if (top != null && top.owner == traceable) {
            frames.pop();
            if (top.isCall) {
                callDepth--;
            }
        }
    }

    void startCurrentItem(Item item) {
        if (Thread.currentThread() == transformThread && !runningTask) {
            // a new iteration: a breakpoint on the line last stopped at applies again
            stoppedPath = null;
        }
    }

    private boolean isStepComplete(String path, int line) {
        boolean sameLine = line == stepLine && path.equals(stepPath);
        switch (step) {
            case OVER: return callDepth < stepCallDepth || (callDepth == stepCallDepth && !sameLine);
            case INTO: return callDepth != stepCallDepth || !sameLine;
            case OUT: return callDepth < stepCallDepth;
            default: return false;
        }
    }

    private boolean breakpointHit(String path, int line, Frame frame) {
        Map<Integer, Breakpoint> lines = breakpoints.get(path);
        Breakpoint bp = lines == null ? null : lines.get(line);
        if (bp == null) {
            return false;
        }
        runningTask = true;
        try {
            if (bp.condition != null) {
                try {
                    if (!Evaluator.effectiveBooleanValue(frame.current, frame.context, bp.condition)) {
                        return false;
                    }
                } catch (Exception e) {
                    dap.log("Breakpoint condition '" + bp.condition + "' at line " + line + " failed: " + message(e));
                }
            }
            if (bp.logMessage != null) {
                dap.event("output", Json.obj().with("category", "console").with("output", interpolate(bp.logMessage, frame) + "\n")
                        .with("source", Json.obj().with("path", path)).with("line", line));
                return false;
            }
            return true;
        } finally {
            runningTask = false;
        }
    }

    private static final java.util.regex.Pattern LOG_EXPRESSION = java.util.regex.Pattern.compile("\\{([^{}]*)\\}");

    // a logpoint message, with each {xpath} replaced by its value
    private String interpolate(String message, Frame frame) {
        StringBuffer sb = new StringBuffer();
        Matcher m = LOG_EXPRESSION.matcher(message);
        while (m.find()) {
            String text;
            try {
                text = Values.logText(Evaluator.evaluate(frame.current, frame.context, m.group(1)));
            } catch (Exception e) {
                text = "<" + message(e) + ">";
            }
            m.appendReplacement(sb, Matcher.quoteReplacement(text));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private void pause(String reason) {
        pausedFrames = new ArrayList<Frame>(frames);
        values.clear();
        synchronized (lock) {
            paused = true;
            step = Step.NONE;
        }
        dap.event("stopped", Json.obj().with("reason", reason).with("threadId", XsltDebugAdapter.THREAD_ID).with("allThreadsStopped", true));
        while (true) {
            FutureTask<?> task;
            synchronized (lock) {
                while (paused && tasks.isEmpty()) {
                    try {
                        lock.wait();
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                }
                task = tasks.poll();
                if (task == null) {
                    break;
                }
            }
            runningTask = true;
            try {
                task.run();
            } finally {
                runningTask = false;
            }
        }
        values.clear();
    }

    private Frame frame(int frameId) {
        if (frameId < 0 || frameId >= pausedFrames.size()) {
            throw new IllegalArgumentException("no stack frame " + frameId);
        }
        return pausedFrames.get(frameId);
    }

    private static Map<String, Object> scope(String name, int reference, boolean expensive) {
        return Json.obj().with("name", name).with("variablesReference", reference).with("expensive", expensive);
    }

    // instructions that change the focus get their own stack frame, showing the context item - unlike calls, they
    // aren't stepped over
    private static boolean isFocusInstruction(Traceable traceable) {
        String className = traceable.getClass().getSimpleName();
        return className.equals("ForEach") || className.equals("ForEachGroup") || className.equals("IterateInstr");
    }

    private String frameName(Traceable traceable, Map<String, Object> properties) {
        if (traceable instanceof TraceableComponent) {
            String tag = ((TraceableComponent) traceable).getTracingTag();
            StructuredQName name = traceable.getObjectName();
            Object match = properties == null ? null : properties.get("match");
            if (match != null) {
                // as written, rather than Saxon's canonical form, e.g. element(Q{}item)
                String written = sourceAttribute(traceable.getLocation(), "match");
                return tag + " match=\"" + (written != null ? written : match) + "\"" + modeSuffix(properties);
            } else if (name != null) {
                if (tag.equals("xsl:function")) {
                    Object arity = properties == null ? null : properties.get("arity");
                    return name.getDisplayName() + (arity != null ? "#" + arity : "()");
                } else if (tag.equals("xsl:variable") || tag.equals("xsl:param")) {
                    return tag + " $" + name.getDisplayName();
                }
                return tag + " name=\"" + name.getDisplayName() + "\"";
            }
            return tag;
        }
        String className = traceable.getClass().getSimpleName();
        String tag = className.equals("ForEachGroup") ? "xsl:for-each-group" : className.equals("IterateInstr") ? "xsl:iterate" : "xsl:for-each";
        String select = sourceAttribute(traceable.getLocation(), "select");
        return select != null ? tag + " select=\"" + select + "\"" : tag;
    }

    // an attribute of the start tag of the instruction at this location, as written in the stylesheet - a Saxon
    // location is that of the end of the start tag
    private String sourceAttribute(Location location, String attributeName) {
        if (location == null || location.getSystemId() == null || location.getLineNumber() <= 0) {
            return null;
        }
        String path = pathOf(location.getSystemId());
        if (path == null) {
            return null;
        }
        String text = sourceTexts.get(path);
        if (text == null) {
            try {
                text = new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8);
            } catch (IOException e) {
                text = "";
            }
            sourceTexts.put(path, text);
        }
        int offset = 0;
        for (int line = 1; line < location.getLineNumber() && offset >= 0; line++) {
            int newline = text.indexOf('\n', offset);
            offset = newline < 0 ? -1 : newline + 1;
        }
        if (offset < 0) {
            return null;
        }
        int end = Math.min(text.length(), offset + Math.max(location.getColumnNumber(), 1));
        int start = text.lastIndexOf('<', end - 1);
        if (start < 0) {
            return null;
        }
        Matcher m = java.util.regex.Pattern.compile("\\s" + attributeName + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')").matcher(text.substring(start, end));
        return m.find() ? (m.group(2) != null ? m.group(2) : m.group(3)) : null;
    }

    private static String modeSuffix(Map<String, Object> properties) {
        Object mode = properties.get("mode");
        return mode != null && !"#unnamed".equals(String.valueOf(mode)) ? " mode=\"" + mode + "\"" : "";
    }

    // the normalised file path for a module's system id - null if it isn't a file
    private String pathOf(String systemId) {
        String cached = pathCache.get(systemId);
        if (cached == null && !pathCache.containsKey(systemId)) {
            try {
                cached = systemId.startsWith("file:") ? normalisePath(Paths.get(new URI(systemId)).toString()) : null;
            } catch (Exception e) {
                cached = null;
            }
            pathCache.put(systemId, cached);
        }
        return cached;
    }

    // file paths from VS Code and from Saxon's system ids can differ in symbolic links (e.g. /tmp on macOS) and, on
    // Windows, in the case of the drive letter
    static String normalisePath(String fsPath) {
        Path path = Paths.get(fsPath).toAbsolutePath().normalize();
        try {
            path = path.toRealPath();
        } catch (IOException e) {
            // keep the absolute path
        }
        String result = path.toString();
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).startsWith("windows") ? result.toLowerCase(Locale.ROOT) : result;
    }

    private static String blankToNull(String s) {
        return s == null || s.trim().isEmpty() ? null : s;
    }

    static String message(Throwable e) {
        return e.getMessage() != null ? e.getMessage() : e.toString();
    }

    private static final class Breakpoint {
        final String condition;
        final String logMessage;

        Breakpoint(String condition, String logMessage) {
            this.condition = condition;
            this.logMessage = logMessage;
        }
    }

    /** a template, function or global variable invocation, or a focus-changing instruction within one */
    static final class Frame {
        final Traceable owner;
        final String name;
        final boolean isCall;
        Traceable current;
        XPathContext context;
        String systemId;
        int line;
        int column;

        Frame(Traceable owner, String name, boolean isCall) {
            this.owner = owner;
            this.name = name;
            this.isCall = isCall;
        }
    }
}
