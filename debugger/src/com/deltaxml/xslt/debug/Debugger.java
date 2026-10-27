/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Matcher;

import net.sf.saxon.lib.ErrorReporter;
import net.sf.saxon.s9api.XmlProcessingError;
import net.sf.saxon.trans.XPathException;
import net.sf.saxon.expr.XPathContext;
import net.sf.saxon.om.GroundedValue;
import net.sf.saxon.om.Item;
import net.sf.saxon.om.StructuredQName;
import net.sf.saxon.s9api.Location;
import net.sf.saxon.s9api.XdmValue;
import net.sf.saxon.trace.Traceable;
import net.sf.saxon.trace.TraceableComponent;
import net.sf.saxon.style.StylesheetPackage;

/**
 * The debugger's state, shared by the DAP thread (requests from VS Code) and the transform thread (TraceListener
 * callbacks). The transform thread pauses inside TraceListener.enter(); while it is paused, the DAP thread hands it
 * the work for stackTrace/scopes/variables/evaluate requests, so Saxon's objects are only ever used on the transform
 * thread - evaluating a lazily-evaluated variable runs Saxon code, which mustn't race with the paused transform.
 */
final class Debugger {

    enum Step { NONE, OVER, INTO, OUT }

    // the transform thread's stack size (see start)
    private static final long TRANSFORM_STACK_SIZE = 2048L * 1024 * 1024;

    // the debugger instance that DebugTraceListener instances (created by Saxon from the -T option) report to
    static volatile Debugger current;

    private final XsltDebugAdapter dap;
    // a copy of each result written so far
    final OutputCapture outputs = new OutputCapture();

    // --- launch configuration (DAP thread, before start)
    private final List<String> saxonArgs = new ArrayList<String>();
    private boolean stopOnEntry;
    private boolean messageEscaping;

    // --- breakpoints: normalised file path -> line -> breakpoint (written by the DAP thread at any time)
    private final Map<String, Map<Integer, Breakpoint>> breakpoints;

    // --- function breakpoints: functions and named templates, by name (replaced by the DAP thread at any time); the
    // compiled stylesheet, which their names are checked against, once it's compiled
    private volatile List<FunctionBreakpoint> functionBreakpoints = new ArrayList<FunctionBreakpoint>();
    private volatile StylesheetPackage compiledPackage;
    private int nextFunctionBreakpointId = 1;

    // --- run control, guarded by lock
    private final Object lock = new Object();
    private boolean paused;
    private final Deque<FutureTask<?>> tasks = new ArrayDeque<FutureTask<?>>();
    private Step step = Step.NONE;
    private int stepCallDepth;
    private String stepPath;
    private int stepLine;
    private volatile boolean pauseRequested;
    // the exception breakpoint filters: dynamic errors, and errors caught by xsl:try
    private volatile boolean breakOnErrors = true;
    private volatile boolean breakOnCaughtErrors;
    // the 'No Template Matched' filter: pause at the first element of each name, in each mode, no template matched
    private volatile boolean breakOnNoMatch;
    // the error paused at, if any
    private volatile Map<String, Object> pausedError;

    // --- transform-thread state
    private Thread transformThread;
    private boolean runningTask;
    // the instruction (or part of an expression) just stopped at, while enter() for it runs - for stepThrough
    private Traceable stoppedAt;
    // for each traced inline function (see enterInlineFunction): its attribute, and where its body is in it
    private final Map<SteppedResult.InlineFunction, Object[]> inlineFunctionTexts = new java.util.IdentityHashMap<SteppedResult.InlineFunction, Object[]>();
    private final Deque<Frame> frames = new ArrayDeque<Frame>();
    // the xsl:try instructions being evaluated, and the stack depth where each started
    private final Deque<Map.Entry<Traceable, Integer>> tryDepths = new ArrayDeque<Map.Entry<Traceable, Integer>>();
    private int callDepth;
    // the line last stopped at, where breakpoints are ignored until execution moves to another line or item
    private String stoppedPath;
    private int stoppedLine;
    private List<Frame> pausedFrames = new ArrayList<Frame>();
    private final Values values = new Values();
    private final Map<String, String> pathCache = new HashMap<String, String>();
    private final Map<String, String> sourceTexts = new HashMap<String, String>();
    // the depth of XPath expressions being stepped through (see stepThroughXPath)
    private int xpathDepth;
    // the XPath expression being stepped through: its stack frame, and its parts as reported to the TraceListener
    private Frame xpathFrame;
    private Map<Location, Boolean> xpathParts;
    // the call depth when last paused: that of the frame paused in
    private int pausedCallDepth;
    // renders logpoint values, as xdm:trace does: made when first needed, with the transform's configuration
    private XdmView xdmView;
    private boolean xdmViewProblemShown;
    private final Map<String, BreakableLines> sourceLines = new HashMap<String, BreakableLines>();
    // the paths of the stylesheet modules with instructions executed so far
    private final Set<String> modulePaths = java.util.concurrent.ConcurrentHashMap.newKeySet();
    // the instruction entered last - for output written by it, e.g. nodes it copies (only used on the transform thread)
    private Traceable lastEntered;
    // the transform's controller, and for each element name and mode ('name (mode m)'), how many elements no
    // template rule matched (only used on the transform thread)
    private net.sf.saxon.Controller controller;
    private final Map<String, Integer> unmatched = new java.util.LinkedHashMap<String, Integer>();
    // likewise, for modes with on-no-match="deep-skip", where they're dropped
    private final Map<String, Integer> droppedUnmatched = new java.util.LinkedHashMap<String, Integer>();

    // --- going back (stepBack, reverseContinue). A transform runs the same way each time, so going back is running
    // it again, from the start, in a new Debugger, to an earlier point - quietly, resumed at each pause as it was
    // before (a step into, e.g., steps through XPath expressions, which reports more of them). The points are counted:
    // each instruction or expression part entered with a location (an event); the ones arriving at a line, where a
    // step back can go, are recorded, with their frame
    private int events;
    // for each arrival at a line: its event, its frame's serial number, its line, and its path (in arrivalPaths)
    private int[] arrivals = new int[4096];
    private int arrivalCount;
    private final List<String> arrivalPaths = new ArrayList<String>();
    private final Map<String, Integer> arrivalPathIds = new HashMap<String, Integer>();
    private int frameSerials;
    // how the run went on from each pause (guarded by lock), and where it's paused now
    private final List<Resumption> resumptions = new ArrayList<Resumption>();
    private int pausedEvent;
    private boolean pausedAtError;
    // when running again, to go back: the event to pause at, why, and how far the run went on from the pause
    // being resumed as before (-1 once it's paused there); the breakpoints' lines then
    private int replayTo = -1;
    private String replayReason;
    private int nextResumption;
    private Map<String, Set<Integer>> replayBreakpointLines;
    // the furthest event any run has written output after: the Debug Console has shown output up to there already
    private int shownTo;
    // current-dateTime(), the same for each run
    private net.sf.saxon.value.DateTimeValue currentDateTime;
    // a run that was gone back from: its thread stops at its next callback
    private volatile boolean abandoned;

    /** thrown on an abandoned run's thread, to end its transform (an Error: Saxon doesn't catch it) */
    static final class Abandoned extends Error {
        private static final long serialVersionUID = 1L;

        Abandoned() {
            super("the transform was run again, to go back", null, false, false);
        }
    }

    /** a pause - at an event, or an error after it - and the step it was resumed with */
    private static final class Resumption {
        final int event;
        final boolean atError;
        final Step step;
        final Map<String, Set<Integer>> breakpointLines;

        Resumption(int event, boolean atError, Step step, Map<String, Set<Integer>> breakpointLines) {
            this.event = event;
            this.atError = atError;
            this.step = step;
            this.breakpointLines = breakpointLines;
        }
    }

    Debugger(XsltDebugAdapter dap) {
        this.dap = dap;
        this.breakpoints = new ConcurrentHashMap<String, Map<Integer, Breakpoint>>();
        init();
    }

    // a run again, to go back to an event: with the same settings and breakpoints, resumed at each pause before it
    // as it was before
    private Debugger(Debugger before, int replayTo, String replayReason) {
        this.dap = before.dap;
        this.breakpoints = before.breakpoints;
        saxonArgs.addAll(before.saxonArgs);
        messageEscaping = before.messageEscaping;
        functionBreakpoints = before.functionBreakpoints;
        nextFunctionBreakpointId = before.nextFunctionBreakpointId;
        breakOnErrors = before.breakOnErrors;
        breakOnCaughtErrors = before.breakOnCaughtErrors;
        breakOnNoMatch = before.breakOnNoMatch;
        currentDateTime = before.currentDateTime;
        // the Debug Console has shown the output up to where the run being gone back from is paused - at an error,
        // including that event's
        shownTo = Math.max(before.shownTo, before.pausedAtError ? before.pausedEvent : before.pausedEvent - 1);
        synchronized (before.lock) {
            for (Resumption r : before.resumptions) {
                if (r.event < replayTo || (r.event == 0 && !r.atError)) {
                    resumptions.add(r);
                }
            }
        }
        this.replayTo = replayTo;
        this.replayReason = replayReason;
        init();
    }

    private void init() {
        current = this;
        SteppedResult.discardAll();
        // where the parts of an XML output came from, for going from the output to the stylesheet
        outputs.setLocationResolver(new OutputCapture.LocationResolver() {
            public Map<String, Object> resolve(Location location, boolean isText) {
                return outputLocation(location, isText);
            }

            public boolean isStylesheetLocation(Location location) {
                String systemId = location.getSystemId();
                if (systemId == null || systemId.isEmpty()) {
                    return true;
                }
                String path = pathOf(systemId);
                return path != null && modulePaths.contains(path);
            }

            public Location currentInstruction() {
                Traceable traceable = lastEntered;
                return traceable == null ? null : traceable.getLocation();
            }
        });
        // a global variable's frame: it's being evaluated (only read on the transform thread, as are the frames)
        Values.evaluatingGlobals = () -> {
            Set<net.sf.saxon.expr.instruct.GlobalVariable> result = new HashSet<net.sf.saxon.expr.instruct.GlobalVariable>();
            for (Frame frame : frames) {
                if (frame.owner instanceof net.sf.saxon.expr.instruct.GlobalVariable) {
                    result.add((net.sf.saxon.expr.instruct.GlobalVariable) frame.owner);
                }
            }
            return result;
        };
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
        // as for an 'xslt' task: "on" keeps Saxon's own xsl:message output, which escapes characters XML doesn't allow
        messageEscaping = "on".equals(Json.string(args, "messageEscaping"));
    }

    List<Map<String, Object>> setBreakpoints(Map<String, Object> args) {
        Map<String, Object> source = Json.object(args, "source");
        String path = Json.string(source, "path");
        List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
        if (path == null) {
            return result;
        }
        String normalised = normalisePath(path);
        // null if the file can't be parsed: all breakpoints are accepted where they are
        BreakableLines breakable = BreakableLines.forFile(normalised);
        // VS Code sends all of a file's breakpoints when any of them changes: one that's unchanged keeps its hit count
        Map<Integer, Breakpoint> previous = breakpoints.get(normalised);
        Map<Integer, Breakpoint> lines = new ConcurrentHashMap<Integer, Breakpoint>();
        for (Object item : Json.array(args, "breakpoints")) {
            @SuppressWarnings("unchecked")
            Map<String, Object> bp = (Map<String, Object>) item;
            int line = (int) Json.number(bp, "line", 0);
            BreakableLines.Resolution resolution = breakable == null ? null : breakable.resolve(line);
            if (resolution != null && resolution.verified && "xsl:assert".equals(resolution.element) && !assertionsEnabled()) {
                // Saxon only evaluates xsl:assert with assertions enabled
                result.add(Json.obj().with("verified", false).with("line", line).with("message",
                        "xsl:assert isn't evaluated: assertions aren't enabled - set \"enableAssertions\": \"on\" in the xslt task (Saxon's -ea:on option)"));
                continue;
            }
            if (resolution != null && !resolution.verified) {
                result.add(Json.obj().with("verified", false).with("line", line).with("message", resolution.message));
                continue;
            }
            String hitCondition = blankToNull(Json.string(bp, "hitCondition"));
            if (hitCondition != null && !HIT_CONDITION.matcher(hitCondition).matches()) {
                result.add(Json.obj().with("verified", false).with("line", line)
                        .with("message", "The hit count '" + hitCondition + "' isn't a number, optionally after ==, >, >=, <, <= or %"));
                continue;
            }
            // shown, and stopped at, at the first line of an instruction's start tag
            int actualLine = resolution == null ? line : resolution.line;
            Breakpoint breakpoint = new Breakpoint(blankToNull(Json.string(bp, "condition")), hitCondition, blankToNull(Json.string(bp, "logMessage")), null);
            Breakpoint old = previous == null ? null : previous.get(actualLine);
            if (old != null && old.primary == old && old.hasSameSettings(breakpoint)) {
                breakpoint.hits = old.hits;
            }
            lines.put(actualLine, breakpoint);
            if (resolution != null) {
                // e.g. xsl:try, reported at its first child's line - only when it's the instruction reported there
                for (int alias : resolution.aliasLines) {
                    if (!lines.containsKey(alias)) {
                        lines.put(alias, new Breakpoint(breakpoint.condition, hitCondition, breakpoint.logMessage, breakpoint));
                    }
                }
            }
            result.add(Json.obj().with("verified", true).with("line", actualLine));
        }
        breakpoints.put(normalised, lines);
        return result;
    }

    synchronized List<Map<String, Object>> setFunctionBreakpoints(Map<String, Object> args) {
        List<FunctionBreakpoint> previous = functionBreakpoints;
        List<FunctionBreakpoint> list = new ArrayList<FunctionBreakpoint>();
        List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
        for (Object item : Json.array(args, "breakpoints")) {
            @SuppressWarnings("unchecked")
            Map<String, Object> bp = (Map<String, Object>) item;
            String spec = Json.string(bp, "name");
            String hitCondition = blankToNull(Json.string(bp, "hitCondition"));
            int id = nextFunctionBreakpointId++;
            if (hitCondition != null && !HIT_CONDITION.matcher(hitCondition).matches()) {
                result.add(Json.obj().with("id", id).with("verified", false)
                        .with("message", "The hit count '" + hitCondition + "' isn't a number, optionally after ==, >, >=, <, <= or %"));
                continue;
            }
            FunctionBreakpoint breakpoint = FunctionBreakpoint.parse(id, spec, blankToNull(Json.string(bp, "condition")), hitCondition);
            if (breakpoint == null) {
                result.add(Json.obj().with("id", id).with("verified", false).with("message", FunctionBreakpoint.syntaxMessage(spec)));
                continue;
            }
            // VS Code sends all of them when any changes: one that's unchanged keeps its hit count
            for (FunctionBreakpoint old : previous) {
                if (old.hasSameSettings(breakpoint)) {
                    breakpoint.hits = old.hits;
                }
            }
            list.add(breakpoint);
            result.add(functionBreakpointStatus(breakpoint, compiledPackage));
        }
        functionBreakpoints = list;
        return result;
    }

    // a function breakpoint's name is checked once the stylesheet has compiled
    private static Json.Obj functionBreakpointStatus(FunctionBreakpoint bp, StylesheetPackage pkg) {
        String problem = pkg == null ? null : bp.problem(pkg);
        Json.Obj status = Json.obj().with("id", bp.id).with("verified", problem == null);
        return problem == null ? status : status.with("message", problem);
    }

    // the stylesheet has compiled (on the transform thread): the function breakpoints' names are checked
    synchronized void stylesheetCompiled(StylesheetPackage pkg) {
        compiledPackage = pkg;
        for (FunctionBreakpoint bp : functionBreakpoints) {
            Json.Obj status = functionBreakpointStatus(bp, pkg);
            if (!Boolean.TRUE.equals(status.get("verified"))) {
                dap.event("breakpoint", Json.obj().with("reason", "changed").with("breakpoint", status));
            }
        }
    }

    boolean isMessageEscaping() {
        return messageEscaping;
    }

    // -ea:on in the Saxon options (an 'xslt' task's enableAssertions)
    private boolean assertionsEnabled() {
        for (String arg : saxonArgs) {
            if (arg.matches("-ea:(on|yes|true|1)")) {
                return true;
            }
        }
        return false;
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
        if (replayTo < 0) {
            // for the extension's log (VS Code ignores events it doesn't know)
            dap.event("xsltDebugLaunch", Json.obj().with("saxon", net.sf.saxon.Version.getProductTitle())
                    .with("java", System.getProperty("java.version") + " (" + System.getProperty("java.vendor") + ")")
                    .with("javaHome", System.getProperty("java.home")).with("saxonArgs", args));
            // the breakpoints the run starts with (a run again, to go back, has those of the first)
            resumptions.add(new Resumption(0, false, Step.NONE, breakpointLines()));
        } else {
            // the output shown already, compiling the stylesheet again included
            dap.muted = true;
        }
        for (Resumption r : resumptions) {
            if (r.event == 0) {
                replayBreakpointLines = r.breakpointLines;
                nextResumption++;
            }
        }
        // a large stack: without optimisation (-opt:0), and traced, recursive calls aren't tail calls - each uses the
        // stack - so a deeply recursive stylesheet, which a normal run handles, would otherwise overflow it. The stack
        // is only reserved, not used, until needed
        transformThread = new Thread(null, new Runnable() {
            public void run() {
                int exitCode = 0;
                try {
                    new DebugTransform(Debugger.this).doTransform(args.toArray(new String[0]), "java net.sf.saxon.Transform");
                } catch (Throwable e) {
                    if (abandoned) {
                        return;
                    }
                    exitCode = 2;
                    // Saxon has already reported a failure it throws as a plain RuntimeException
                    if (e.getClass() != RuntimeException.class) {
                        System.err.println(message(e));
                    }
                    // why, for the extension's notification: e.g. 'Source file ... does not exist'
                    dap.event("xsltDebugFailure", Json.obj().with("message", message(e)));
                }
                if (abandoned) {
                    return;
                }
                if (replayTo >= 0) {
                    // the event to go back to wasn't reached: the run didn't go the same way
                    replayTo = -1;
                    dap.muted = false;
                    dap.event("output", Json.obj().with("category", "important").with("output",
                            "The transform didn't run the same way again, so it couldn't go back: it has run to the end\n"));
                }
                dap.muted = false;
                reportUnmatched();
                System.out.flush();
                System.err.flush();
                sendOutputs(null, false);
                dap.event("exited", Json.obj().with("exitCode", exitCode));
                dap.event("terminated", Json.obj());
            }
        }, "xslt-transform", TRANSFORM_STACK_SIZE);
        transformThread.start();
    }

    void resume(Step nextStep) {
        synchronized (lock) {
            if (!paused) {
                return;
            }
            step = nextStep;
            stepCallDepth = pausedCallDepth;
            stepPath = stoppedPath;
            stepLine = stoppedLine;
            paused = false;
            // how it went on from here: for running it again the same way, to go back
            resumptions.add(new Resumption(pausedEvent, pausedAtError, nextStep, breakpointLines()));
            lock.notifyAll();
        }
    }

    // the lines with breakpoints, by path: they decide which XPath expressions are stepped through
    private Map<String, Set<Integer>> breakpointLines() {
        Map<String, Set<Integer>> result = new HashMap<String, Set<Integer>>();
        for (Map.Entry<String, Map<Integer, Breakpoint>> entry : breakpoints.entrySet()) {
            result.put(entry.getKey(), new HashSet<Integer>(entry.getValue().keySet()));
        }
        return result;
    }

    // the lines with breakpoints in a file - when running again to go back, those of the run being repeated
    private Set<Integer> breakpointLines(String path) {
        if (replayTo >= 0 && replayBreakpointLines != null) {
            Set<Integer> lines = replayBreakpointLines.get(path);
            return lines == null ? java.util.Collections.<Integer>emptySet() : lines;
        }
        Map<Integer, Breakpoint> lines = breakpoints.get(path);
        return lines == null ? java.util.Collections.<Integer>emptySet() : lines.keySet();
    }

    /**
     * Goes back (on the DAP thread, while paused): a step back is to the line arrived at last in the frame paused in, or
     * one it was called from (e.g. the previous line, or the line making the call); a reverse continue is to the last
     * arrival at a line with a breakpoint (its condition isn't checked), else to the start. The transform is run
     * again, in the Debugger returned, to that point, then paused there; this one's run is abandoned
     */
    Debugger goBack(boolean toBreakpoint) {
        synchronized (lock) {
            if (!paused || replayTo >= 0) {
                throw new IllegalStateException("the transform is running");
            }
        }
        Set<Integer> stack = new HashSet<Integer>();
        for (Frame frame : pausedFrames) {
            stack.add(frame.serial);
        }
        int target = -1;
        String reason = "step";
        for (int i = arrivalCount - 1; i >= 0 && target < 0; i--) {
            int event = arrivals[i * 4];
            if (event > pausedEvent || (event == pausedEvent && !pausedAtError)) {
                continue;
            }
            if (toBreakpoint) {
                Map<Integer, Breakpoint> lines = breakpoints.get(arrivalPaths.get(arrivals[i * 4 + 3]));
                if (lines != null && lines.containsKey(arrivals[i * 4 + 2])) {
                    target = event;
                    reason = "breakpoint";
                }
            } else if (stack.contains(arrivals[i * 4 + 1])) {
                target = event;
            }
        }
        if (target < 0 && toBreakpoint && arrivalCount > 0 && arrivals[0] < pausedEvent) {
            target = arrivals[0];
            reason = "entry";
        }
        if (target < 0) {
            throw new IllegalStateException("this is the start of the transform: there's nothing to go back to");
        }
        Debugger next = new Debugger(this, target, reason);
        abandon();
        next.start();
        return next;
    }

    // this run is ended: its thread, paused, goes on and throws Abandoned at once
    private void abandon() {
        dap.muted = true;
        synchronized (lock) {
            abandoned = true;
            paused = false;
            tasks.clear();
            lock.notifyAll();
        }
        try {
            transformThread.join(10000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    // the current date and time, the same for each run, so it's run again the same way
    void fixCurrentDateTime(net.sf.saxon.Controller controller) {
        try {
            if (currentDateTime == null) {
                currentDateTime = controller.getCurrentDateTime();
            } else {
                controller.setCurrentDateTime(currentDateTime);
            }
        } catch (XPathException | RuntimeException e) {
            // each run has its own
        }
    }

    void requestPause() {
        pauseRequested = true;
    }

    // the frames from startFrame, at most levels of them (0: all) - VS Code asks for a deep stack, e.g. in recursion, a
    // part at a time
    // for each paused frame, in recursion - a frame whose name others on the stack have too, e.g. 'f:sum#2' - how deep
    // in it it is: 1 for the outermost of them; 0 for a frame whose name is the only one
    private int[] recursionDepths() {
        Map<String, Integer> totals = new HashMap<String, Integer>();
        for (Frame frame : pausedFrames) {
            Integer n = totals.get(frame.name);
            totals.put(frame.name, n == null ? 1 : n + 1);
        }
        int[] depths = new int[pausedFrames.size()];
        Map<String, Integer> seen = new HashMap<String, Integer>();
        for (int i = pausedFrames.size() - 1; i >= 0; i--) {
            String name = pausedFrames.get(i).name;
            if (totals.get(name) > 1) {
                Integer n = seen.get(name);
                seen.put(name, depths[i] = n == null ? 1 : n + 1);
            }
        }
        return depths;
    }

    int frameCount() throws Exception {
        return onTransformThread(new Callable<Integer>() {
            public Integer call() {
                return pausedFrames.size();
            }
        });
    }

    List<Map<String, Object>> stackTrace(final int startFrame, final int levels) throws Exception {
        return onTransformThread(new Callable<List<Map<String, Object>>>() {
            public List<Map<String, Object>> call() {
                List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
                int end = levels > 0 ? Math.min(pausedFrames.size(), startFrame + levels) : pausedFrames.size();
                int[] depths = recursionDepths();
                for (int i = Math.max(startFrame, 0); i < end; i++) {
                    Frame frame = pausedFrames.get(i);
                    String name = depths[i] > 0 ? frame.name + " [depth " + String.format(Locale.ROOT, "%,d", depths[i]) + "]" : frame.name;
                    Json.Obj dapFrame = Json.obj().with("id", i).with("name", name)
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
                result.add(scope("Locals", values.register(frame.xsltContext == null ? values.locals(frame.context, frame.current) :
                        values.xpathLocals(frame.context, frame.current, frame.xpathExternals, frame.xpathSlots, frame.xsltContext, frame.xsltCurrent)), false));
                result.add(scope("Context", values.register(values.focus(frame.context, xsltContext(frame), frame.xpathFocus, frame.lazyPart)), false));
                result.add(scope("Globals", values.register(values.globals(xsltContext(frame))), true));
                result.add(scope("Output", values.register(values.output(outputs, xsltContext(frame))), false));
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
                XdmValue result = Evaluator.evaluate(frame.current, frame.context, xsltCurrent(frame), xsltContext(frame), xpath);
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
        if (abandoned) {
            throw new Abandoned();
        }
        if (Thread.currentThread() != transformThread || runningTask) {
            // e.g. a lazily evaluated variable being evaluated for the Variables view
            return;
        }
        // entered again: a result of stepping through its expression that wasn't used is out of date
        SteppedResult.discard(traceable);
        if (isSequenceConstructor(traceable)) {
            // which Saxon 12 traces at its first instruction's location (Saxon 13 doesn't) - not an instruction of
            // its own: stopping at it would stop twice where the first instruction is
            return;
        }
        if (traceable instanceof SteppedResult && ((SteppedResult) traceable).inlineFunction != null) {
            enterInlineFunction((SteppedResult) traceable, context);
            return;
        }
        if (traceable.getClass().getSimpleName().equals("TryCatch")) {
            tryDepths.push(new java.util.AbstractMap.SimpleImmutableEntry<Traceable, Integer>(traceable, frames.size()));
        }
        boolean isCall = traceable instanceof TraceableComponent;
        if (isCall || isFocusInstruction(traceable)) {
            frames.push(newFrame(traceable, frameName(traceable, properties), true));
            callDepth++;
        } else if (frames.isEmpty()) {
            frames.push(newFrame(null, "transform", false));
        }
        // a part of the XPath expression being stepped through belongs to its frame - even when, evaluated lazily
        // (e.g. a function argument), it's evaluated within a function it calls
        Frame top = xpathParts != null && traceable.getLocation() != null && xpathParts.containsKey(traceable.getLocation()) ? xpathFrame : frames.peek();
        if (top == xpathFrame && xpathFrame != null) {
            xpathFrame.lazyPart = frames.peek() != xpathFrame;
        }
        int depth = top == xpathFrame && xpathFrame != null ? xpathFrame.callDepth : instructionDepth(traceable);
        top.context = context;
        top.current = traceable;
        lastEntered = traceable;
        Location location = traceable.getLocation();
        if (location == null || location.getSystemId() == null || location.getLineNumber() <= 0) {
            return;
        }
        String path = pathOf(location.getSystemId());
        if (path == null) {
            return;
        }
        modulePaths.add(path);
        // an instruction is shown at the first line of its start tag, though Saxon reports it at the tag's end;
        // the parts of an XPath expression being stepped through have their own lines already
        BreakableLines lines = top == xpathFrame && xpathFrame != null ? null : sourceLines(path);
        // Saxon 13 gives an instruction a location within that of one of its attributes: the attribute's is where
        // the start tag ends, as Saxon 12 reports it, and identifies the tag
        Location tagLocation = lines == null ? location : startTagLocation(location);
        int reportedLine = tagLocation.getLineNumber();
        top.systemId = location.getSystemId();
        String element = reportedElement(traceable);
        top.line = lines == null ? reportedLine : lines.displayLine(reportedLine, tagLocation.getColumnNumber(), element);
        top.column = lines == null ? location.getColumnNumber() : lines.displayColumn(reportedLine, tagLocation.getColumnNumber(), element);
        boolean onStoppedLine = top.line == stoppedLine && path.equals(stoppedPath);
        if (!onStoppedLine) {
            stoppedPath = null;
        }
        // arriving at a line of this frame: from another line, or again - its first instruction or expression is
        // entered again, e.g. for the next iteration of a loop - but not returning to it, e.g. after a function call
        // from it, or for a function argument evaluated lazily, within the function
        boolean onSameLine = top.line == top.enteredLine && path.equals(top.enteredPath);
        // arriving at the line again: its first instruction or expression entered again - the next iteration of a
        // loop, or call of an inline function, on one line
        // the first instruction within an xsl:for-each (or other focus instruction) on its own line, e.g.
        // <xsl:for-each select="item"><x/></xsl:for-each>: arrived at for each item, as the body on a line of its own is
        boolean firstInFocus = onSameLine && top.lineStart == null && traceable != top.owner;
        boolean arrivingAgain = onSameLine && (traceable == top.lineStart || top.newIteration || firstInFocus);
        boolean onNewLine = !onSameLine || arrivingAgain;
        top.newIteration = false;
        // another instruction on the line, whose start tag ends on another line - e.g. <out><xsl:sequence select="
        // ...multi-line..."/>: its XPath attributes can be stepped through too
        boolean onNewReportedLine = onNewLine || reportedLine != top.enteredReportedLine;
        // within an XPath expression being stepped through: coming back to a line by another part than the one first
        // entered on it is returning to the line, not arriving at it - a part evaluated lazily, e.g. a let's value
        // when it's first used (with only the variables it uses), or after an operand on another line, e.g. a
        // lookup's key after the map before it. The line was stopped at already, so a breakpoint, Step Over or Step
        // Out doesn't stop there again; Step Into does, as it stops at each evaluation. A new call of an inline
        // function enters its lines' first parts again - even within a lazy evaluation (Saxon 12's fold-left
        // evaluates its accumulator lazily), so returning isn't where the frame is: the line arrived at before is
        boolean lazyArrival = false;
        if (top == xpathFrame && xpathFrame != null && onNewLine && !arrivingAgain) {
            Traceable first = top.firstOnLine.putIfAbsent(path + ':' + top.line, traceable);
            lazyArrival = first != null && first != traceable;
        }
        if (onNewLine && !lazyArrival) {
            top.enteredPath = path;
            top.enteredLine = top.line;
            // not the focus instruction itself, which is entered once, not for each item
            top.lineStart = traceable == top.owner ? null : traceable;
        }
        top.enteredReportedLine = reportedLine;
        // an expression's first arrival, on the line of its instruction just stopped at: not stopped at again there
        boolean justStoppedHere = false;
        if (top == xpathFrame && xpathFrame != null && top.skipBreakpointLine >= 0) {
            justStoppedHere = top.line == top.skipBreakpointLine;
            top.skipBreakpointLine = -1;
        }

        stoppedAt = null;
        int event = ++events;
        if (onNewLine && !lazyArrival) {
            recordArrival(event, arrivalFrame(top, traceable).serial, top.line, path);
        }
        String reason = null;
        if (replayTo >= 0) {
            // running again, to go back: quietly to the event gone back to, resumed at each pause as before
            dap.muted = true;
            if (event == replayTo) {
                replayTo = -1;
                replayBreakpointLines = null;
                pauseRequested = false;
                reason = replayReason;
            } else {
                resumeAsBefore(event, false);
            }
        } else if (pauseRequested) {
            reason = "pause";
        } else if (stopOnEntry) {
            reason = "entry";
        } else if (isCall && functionBreakpointHit(traceable, properties, top)) {
            reason = "function breakpoint";
        } else if (onNewLine && !lazyArrival && !justStoppedHere && breakpointHit(path, top.line, top)) {
            // checked once each time execution arrives at the line - not for each instruction Saxon reports on it -
            // including again, e.g. for the next iteration of a loop on one line
            reason = "breakpoint";
        } else if ((!lazyArrival || step == Step.INTO) && isStepComplete(path, top.line, depth, arrivingAgain)) {
            reason = "step";
        }
        if (replayTo < 0) {
            // output after this event that the Debug Console has shown already isn't shown again
            dap.muted = event <= shownTo;
        }
        if (reason != null) {
            pauseRequested = false;
            stopOnEntry = false;
            stoppedPath = path;
            stoppedLine = top.line;
            pause(reason, top, depth);
            stoppedAt = traceable;
        }
        String branch = branchAttribute(location);
        if (branch != null && xpathDepth == 0) {
            // an XSLT 4.0 branch (xsl:when's or xsl:otherwise's select, xsl:if's then or else), now it's taken: only
            // that attribute - its test was stepped through where it was evaluated, maybe on the same line
            stepThroughXPath(traceable, context, path, reportedLine, top.line, step == Step.INTO, branch);
        } else if (onNewReportedLine && xpathDepth == 0) {
            // stepping into: from here, or from an instruction before it on the same line
            stepThroughXPath(traceable, context, path, reportedLine, top.line, step == Step.INTO, null);
        }
    }

    // the element an instruction Saxon reports is, where Saxon may report it at the location of an instruction in its
    // content (its first one's select): a local variable, an xsl:variable, in Saxon 13; an xsl:map, a call of
    // map:merge(), in Saxon 12
    private static String reportedElement(Traceable traceable) {
        String className = traceable.getClass().getSimpleName();
        if (className.equals("LetExpression")) {
            return "xsl:variable";
        } else if (traceable instanceof net.sf.saxon.expr.SystemFunctionCall) {
            StructuredQName name = ((net.sf.saxon.expr.SystemFunctionCall) traceable).getFunctionName();
            if (name != null && name.getLocalPart().equals("merge") && name.getNamespaceUri().toString().equals("http://www.w3.org/2005/xpath-functions/map")) {
                return "xsl:map";
            }
        }
        return null;
    }

    private static Location startTagLocation(Location location) {
        if (location instanceof net.sf.saxon.expr.parser.XPathParser.NestedLocation) {
            Location containing = ((net.sf.saxon.expr.parser.XPathParser.NestedLocation) location).getContainingLocation();
            if (containing instanceof net.sf.saxon.tree.AttributeLocation && containing.getLineNumber() > 0) {
                return containing;
            }
        }
        return location;
    }

    // a block of instructions, e.g. an element's content - not a block in an XPath expression, e.g. ($a, $b), whose
    // location is within an attribute (or, being stepped through, the expression's own)
    private boolean isSequenceConstructor(Traceable traceable) {
        if (!traceable.getClass().getSimpleName().equals("Block")) {
            return false;
        }
        Location location = traceable.getLocation();
        return !(location instanceof net.sf.saxon.expr.parser.XPathParser.NestedLocation || location instanceof net.sf.saxon.tree.AttributeLocation ||
                (xpathParts != null && location != null && xpathParts.containsKey(location)));
    }

    // Saxon only reports an attribute's XPath expression at its instruction's line, so a multi-line expression in an
    // instruction's attributes is also evaluated separately - instrumented, so each part reports its own line - when
    // it's stepped into, or has a breakpoint in it. It's evaluated in the instruction's context, in a stack frame of
    // its own, before the instruction itself runs. See XPathEngine
    // reportedLine: the instruction's start tag's end, where Saxon reports it; line: its first line, where it's shown
    // XSLT 4.0 branches: an xsl:when's or xsl:otherwise's select, and an xsl:if's then and else - each evaluated only
    // if that branch is taken
    private static boolean isBranch(String element, String attribute) {
        return ("select".equals(attribute) && (element.equals("when") || element.equals("otherwise"))) ||
                (element.equals("if") && ("then".equals(attribute) || "else".equals(attribute)));
    }

    private static boolean isBranch(BreakableLines.XPathAttribute attribute) {
        return isBranch(attribute.elementName.substring(attribute.elementName.indexOf(':') + 1), attribute.name);
    }

    // the branch attribute a traced expression is in, if it is (see DebugCodeInjector)
    private static String branchAttribute(Location location) {
        Location containing = location instanceof net.sf.saxon.expr.parser.XPathParser.NestedLocation ?
                ((net.sf.saxon.expr.parser.XPathParser.NestedLocation) location).getContainingLocation() : null;
        if (containing instanceof net.sf.saxon.tree.AttributeLocation) {
            net.sf.saxon.tree.AttributeLocation attribute = (net.sf.saxon.tree.AttributeLocation) containing;
            if (attribute.getElementName() != null && attribute.getAttributeName() != null &&
                    "http://www.w3.org/1999/XSL/Transform".equals(attribute.getElementName().getNamespaceUri().toString()) &&
                    isBranch(attribute.getElementName().getLocalPart(), attribute.getAttributeName().getLocalPart())) {
                return attribute.getAttributeName().getLocalPart();
            }
        }
        return null;
    }

    // branch: only that branch attribute (see isBranch), when it's taken; null: the others - not branches
    private void stepThroughXPath(Traceable instruction, XPathContext context, String path, int reportedLine, int line, boolean steppingIn, String branch) {
        BreakableLines lines = sourceLines(path);
        if (lines == null) {
            return;
        }
        for (BreakableLines.XPathAttribute attribute : lines.xpathAttributesAt(reportedLine)) {
            if (branch == null ? isBranch(attribute) : !(isBranch(attribute) && branch.equals(attribute.name))) {
                continue;
            }
            boolean breakpointWithin = hasBreakpointWithin(path, attribute, line);
            if (!steppingIn && !breakpointWithin) {
                continue;
            }
            // e.g. xsl:variable/@select, or for an expression in an element's content, xsl:select
            String name = attribute.name == null ? attribute.elementName : attribute.elementName + "/@" + attribute.name;
            String systemId = instruction.getLocation().getSystemId();
            // an xsl:when's test is always stopped at: which tests are evaluated, until one is true, shows the branch taken
            if (stepThrough(instruction, context, path, line, name, attribute.xpath, attribute.line, attribute.column, breakpointWithin,
                    "xsl:when".equals(attribute.elementName), isTest(attribute), resultDescription(attribute, name))) {
                String element = attribute.elementName.substring(attribute.elementName.indexOf(':') + 1);
                SteppedResult.stepped(SteppedResult.key(systemId, attribute.tagEndLine, attribute.tagEndColumn, element, attribute.name), instruction, frames.peek(), context);
            }
        }
    }

    // Steps through an XPath expression - the text of an instruction's attribute, or an inline function's body - by
    // evaluating it separately, instrumented, so each of its parts reports its own line: in a frame of its own, named
    // e.g. 'xsl:variable/@select (XPath)', above that of the instruction (whose line is given, for a step that's still
    // going afterwards). Unless a breakpoint is within it, or it's always stopped in, it's only stepped through if
    // that shows more than its result (see XPathEngine.worthSteppingThrough). True if it was evaluated without an
    // error: then the instruction's own evaluation of it is quiet (see SteppedResult) - not after an error, which the
    // instruction may not raise, if it evaluates the expression lazily
    private boolean stepThrough(Traceable instruction, XPathContext context, String path, int line, String name, String xpath,
            int startLine, int startColumn, boolean breakpointWithin, boolean alwaysStopped, boolean isTest, String description) {
        String systemId = instruction.getLocation().getSystemId();
        Frame frame = newFrame(null, name + " (XPath)", true);
        frame.context = context;
        frame.xsltContext = context;
        frame.xsltCurrent = instruction;
        frame.current = instruction;
        frame.systemId = systemId;
        frame.line = startLine;
        frame.column = startColumn;
        // just stopped at the instruction, on its line: its expression's start, on the same line, isn't stopped at again
        frame.skipBreakpointLine = stoppedAt == instruction ? line : -1;
        int depthBefore = frames.size();
        boolean stepped = false;
        frames.push(frame);
        callDepth++;
        xpathDepth++;
        frame.callDepth = callDepth;
        try {
            XPathEngine.Compiled compiled = XPathEngine.compile(xpath, instruction, context, instruction, context,
                    new XPathEngine.SourcePosition(systemId, startLine, startColumn));
            if (!breakpointWithin && !compiled.worthSteppingThrough && !alwaysStopped) {
                // stepping into it is stepping over it: the instruction evaluates it as usual
                return false;
            }
            xpathFrame = frame;
            frame.firstOnLine.clear();
            xpathParts = compiled.instrumented;
            frame.xpathExternals = compiled.externals;
            frame.xpathSlots = compiled.slots;
            net.sf.saxon.sxpath.XPathDynamicContext dynamicContext = compiled.prepare();
            frame.xpathFocus = dynamicContext.getXPathContextObject().getCurrentIterator();
            GroundedValue value = null;
            XPathException raised = null;
            try {
                // a test, as its instruction evaluates it: only as far as needed for true or false - not all of it,
                // which would call more functions (and write their messages) than the stylesheet does
                value = isTest ? net.sf.saxon.value.BooleanValue.get(compiled.effectiveBooleanValue(dynamicContext)) :
                        compiled.evaluate(dynamicContext);
            } catch (XPathException e) {
                // a dynamic error is its result, as when the instruction evaluates it - e.g. one an xsl:try catches
                raised = e;
            }
            stepped = raised == null;
            dap.log(description + (raised == null ? " returned " + Values.summary(XdmValue.wrap(value)) :
                    " raised " + (raised.getErrorCodeQName() == null ? "an error" : raised.getErrorCodeQName().getLocalPart()) + ": " + message(raised)));
        } catch (Exception | LinkageError e) {
            // 'important': VS Code also shows it as a notification - it was stepped into, or has a breakpoint
            dap.event("output", Json.obj().with("category", "important").with("output",
                    name + " on line " + startLine + " couldn't be evaluated separately, to step through it: " + message(e) + "\n"));
        } finally {
            xpathFrame = null;
            xpathParts = null;
            // also the frames of any stylesheet function it was in, if it failed
            unwindTo(depthBefore);
            xpathDepth--;
            // a step into or over that's still going: from the instruction's line, as if it had started there -
            // so the instruction's own evaluation of the expression, just stepped through, isn't stopped at
            synchronized (lock) {
                if (step == Step.INTO || step == Step.OVER) {
                    stepCallDepth = instructionDepth(instruction);
                    stepPath = path;
                    stepLine = line;
                }
            }
        }
        return stepped;
    }

    // A call of an inline function in a multi-line XPath expression - its compiled body, traced (see
    // DebugCodeInjector.traceInlineFunction): e.g. a function item a stylesheet function returned, called later
    // elsewhere. (A call within an expression being stepped through is of the debugger's own, instrumented copy, see
    // XPathEngine.instrument.) It's a frame of its own, e.g. 'function#0' - so the stylesheet functions it calls are
    // shown as called from it - and, when stepped into or with a breakpoint in it, its body's text is stepped through,
    // in the function's own context: its parameters, and the variables from outside it that it uses. Then the body
    // itself runs, quietly
    private void enterInlineFunction(SteppedResult body, XPathContext context) {
        SteppedResult.InlineFunction inline = body.inlineFunction;
        String path = pathOf(inline.systemId);
        BreakableLines.XPathAttribute attribute;
        InlineFunctionText text;
        // found once for each inline function: it may be called many times, e.g. by fold-left()
        Object[] found = inlineFunctionTexts.get(inline);
        if (found == null) {
            BreakableLines lines = path == null ? null : sourceLines(path);
            attribute = lines == null ? null : lines.xpathAttribute(inline.tagEndLine, inline.tagEndColumn, inline.element, inline.attribute);
            text = attribute == null ? null : InlineFunctionText.find(attribute.xpath, inline.parameters);
            inlineFunctionTexts.put(inline, new Object[] { attribute, text });
        } else {
            attribute = (BreakableLines.XPathAttribute) found[0];
            text = (InlineFunctionText) found[1];
        }
        Frame frame = newFrame(body, "function#" + (text == null ? inline.parameters.size() : text.declaredParameters), true);
        frame.context = context;
        frame.current = body;
        frame.systemId = inline.systemId;
        int[] start = text == null ? null : attribute.position(text.bodyStart);
        frame.line = start != null ? start[0] : attribute != null ? attribute.line : inline.tagEndLine;
        frame.column = start != null ? start[1] : 1;
        frames.push(frame);
        callDepth++;
        if (start == null || Thread.currentThread() != transformThread || runningTask) {
            return;
        }
        int lastLine = attribute.position(text.bodyEnd)[0];
        boolean breakpointWithin = hasBreakpointBetween(path, start[0], lastLine);
        if (step != Step.INTO && !breakpointWithin) {
            return;
        }
        String description = "▸ function#" + text.declaredParameters + " (" + (lastLine > start[0] ? "lines " + start[0] + "-" + lastLine : "line " + start[0]) + ")";
        if (stepThrough(body, context, path, start[0], "function#" + text.declaredParameters, attribute.xpath.substring(text.bodyStart, text.bodyEnd),
                start[0], start[1], breakpointWithin, false, false, description)) {
            SteppedResult.stepped(inline.key(), body, frames.peek(), context);
        }
    }

    private boolean hasBreakpointBetween(String path, int firstLine, int lastLine) {
        for (Integer line : breakpointLines(path)) {
            if (line >= firstLine && line <= lastLine) {
                return true;
            }
        }
        return false;
    }

    // an attribute evaluated for its effective boolean value: an xsl:if's, xsl:when's or xsl:assert's test
    private static boolean isTest(BreakableLines.XPathAttribute attribute) {
        String element = attribute.elementName.substring(attribute.elementName.indexOf(':') + 1);
        return "test".equals(attribute.name) && (element.equals("if") || element.equals("when") || element.equals("assert"));
    }

    // the Debug Console's note of an XPath expression's result, once it has been stepped through - marked as the
    // debugger's, with the variable or parameter it's for, if any, e.g. '▸ $totals (xsl:variable/@select, lines 25-28)'
    private static String resultDescription(BreakableLines.XPathAttribute attribute, String name) {
        // an xsl:select's variable is that of the xsl:variable (or parameter) it's in
        String variable = attribute.elementName.matches("xsl:(variable|param|with-param|select)") ? attribute.instructionName : null;
        String lines = attribute.lastLine > attribute.line ? "lines " + attribute.line + "-" + attribute.lastLine : "line " + attribute.line;
        return "\u25B8 " + (variable != null ? "$" + variable + " (" + name + ", " + lines + ")" : name + " (" + lines + ")");
    }

    // the stylesheet's start tags - null if it can't be parsed
    // for DebugCodeInjector, as the stylesheet is compiled: whether an attribute (null: the element's content) of the
    // element whose start tag ends here is a multi-line XPath expression, which can be stepped through
    static boolean isSteppable(String systemId, int tagEndLine, int tagEndColumn, String elementLocalName, String attributeName) {
        Debugger debugger = current;
        if (debugger == null || systemId == null) {
            return false;
        }
        String path = debugger.pathOf(systemId);
        BreakableLines lines = path == null ? null : debugger.sourceLines(path);
        return lines != null && lines.xpathAttribute(tagEndLine, tagEndColumn, elementLocalName, attributeName) != null;
    }

    // Where a part of an XML output came from (see OutputCapture): the start tag of the instruction that wrote it, e.g. a
    // literal result element or xsl:value-of, or for a node copied from a source document the instruction that copied it,
    // in its stylesheet module ('instruction') - or, for a source document location (if no instruction was known), where
    // its start tag ends ('source'). Saxon reports the text of a literal text node where the
    // text ends (or, for some, where it starts), so its location is given as it is ('text'). A node of a temporary tree,
    // e.g. a variable's, has the line and column of the literal result element that made it, but not its module: it's
    // the module with a start tag ending there
    Map<String, Object> outputLocation(Location location, boolean isText) {
        if (location == null) {
            return null;
        }
        Location tag = startTagLocation(location);
        int line = tag.getLineNumber();
        int column = tag.getColumnNumber();
        if (line <= 0) {
            return null;
        }
        String systemId = tag.getSystemId();
        String path = null;
        BreakableLines lines = null;
        if (systemId == null || systemId.isEmpty()) {
            for (String module : modulePaths) {
                BreakableLines moduleLines = sourceLines(module);
                if (moduleLines != null && moduleLines.tagEndingAt(line, column) != null) {
                    path = module;
                    lines = moduleLines;
                    break;
                }
            }
        } else {
            path = pathOf(systemId);
            lines = path != null && modulePaths.contains(path) ? sourceLines(path) : null;
        }
        if (path == null) {
            return null;
        }
        Json.Obj result = Json.obj().with("path", path).with("line", line).with("column", column);
        if (lines == null) {
            return result.with("kind", "source");
        }
        int[] start = lines.tagEndingAt(line, column);
        if (isText && (start == null || start[2] == 0)) {
            return result.with("kind", "text");
        }
        if (start != null) {
            result.with("line", start[0]).with("column", start[1]);
        }
        return result.with("kind", "instruction");
    }

    private synchronized BreakableLines sourceLines(String path) {
        if (!sourceLines.containsKey(path)) {
            sourceLines.put(path, BreakableLines.forFile(path));
        }
        return sourceLines.get(path);
    }

    private boolean hasBreakpointWithin(String path, BreakableLines.XPathAttribute attribute, int instructionLine) {
        for (Integer line : breakpointLines(path)) {
            if (line >= attribute.line && line <= attribute.lastLine && line != instructionLine) {
                return true;
            }
        }
        return false;
    }

    void leave(Traceable traceable) {
        if (abandoned) {
            throw new Abandoned();
        }
        if (Thread.currentThread() != transformThread || runningTask) {
            return;
        }
        // an xsl:try is complete, including any xsl:catch: the frames an error it caught was raised in - which get
        // no leave() calls - are removed (as also by caughtError, but Saxon 12.4 and earlier don't call that)
        if (!tryDepths.isEmpty() && tryDepths.peek().getKey() == traceable) {
            unwindTo(tryDepths.pop().getValue());
            return;
        }
        Frame top = frames.peek();
        if (top != null && top.owner == traceable) {
            frames.pop();
            SteppedResult.discardFrame(top);
            if (top.countsDepth) {
                callDepth--;
            }
        }
    }

    void startCurrentItem(Item item) {
        if (Thread.currentThread() == transformThread && !runningTask) {
            // a new iteration: a breakpoint on the line last stopped at applies again
            stoppedPath = null;
            Frame top = frames.peek();
            if (top != null) {
                top.newIteration = true;
            }
        }
    }

    // a step over or into completes at another line - or at the same line, arrived at again, e.g. the next iteration of
    // a loop on one line, or the next call of an inline function whose body is on one line
    private boolean isStepComplete(String path, int line, int callDepth, boolean arrivingAgain) {
        boolean sameLine = line == stepLine && path.equals(stepPath) && !arrivingAgain;
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
        if (bp == null || (bp.primary != bp && !REPORTED_AT_FIRST_CHILD.contains(frame.current.getClass().getSimpleName()))) {
            return false;
        }
        runningTask = true;
        try {
            if (!conditionsMet(bp.primary, frame, "the breakpoint at line " + line)) {
                return false;
            }
            if (bp.logMessage != null) {
                if (dap.muted) {
                    // shown already, before going back
                    return false;
                }
                dap.event("output", Json.obj().with("category", "console").with("output", interpolate(bp.logMessage, frame) + "\n")
                        .with("source", Json.obj().with("path", path)).with("line", line));
                return false;
            }
            return true;
        } finally {
            runningTask = false;
        }
    }

    // whether a breakpoint's condition is true where execution is (or it fails - reported once), and its hit count
    // is met - counting the hit, when the condition is true
    private boolean conditionsMet(Conditional bp, Frame frame, String description) {
        if (bp.condition != null) {
            try {
                if (!Evaluator.effectiveBooleanValue(frame.current, frame.context, xsltCurrent(frame), xsltContext(frame), bp.condition)) {
                    return false;
                }
            } catch (Exception e) {
                // stops, as for an error - reported once ('important': VS Code also shows it as a notification)
                if (!bp.conditionFailed) {
                    bp.conditionFailed = true;
                    dap.event("output", Json.obj().with("category", "important").with("output",
                            "The condition '" + bp.condition + "' of " + description + " failed: " + message(e) + "\n"));
                }
            }
        }
        int hits = ++bp.hits;
        return bp.hitCondition == null || isHitConditionMet(bp.hitCondition, hits);
    }

    // a function breakpoint for the function or named template being entered, whose conditions are met
    private boolean functionBreakpointHit(Traceable traceable, Map<String, Object> properties, Frame frame) {
        for (FunctionBreakpoint bp : functionBreakpoints) {
            if (bp.matches(traceable, properties)) {
                runningTask = true;
                try {
                    if (conditionsMet(bp, frame, "the function breakpoint " + bp.spec.trim())) {
                        return true;
                    }
                } finally {
                    runningTask = false;
                }
            }
        }
        return false;
    }

    private static final java.util.regex.Pattern LOG_EXPRESSION = java.util.regex.Pattern.compile("\\{([^{}]*)\\}");

    // a logpoint message, with each {xpath} replaced by its value - and {$*} by the local variables in scope (not
    // valid XPath, so it can't be mistaken for an expression, as {*}, the context item's child elements, would be)
    private String interpolate(String message, Frame frame) {
        StringBuffer sb = new StringBuffer();
        Matcher m = LOG_EXPRESSION.matcher(message);
        while (m.find()) {
            String text;
            if (m.group(1).replaceAll("\\s+", "").equals("$*")) {
                // after other text, on the lines below it
                text = m.start() > 0 ? "\n" + localsText(frame).replaceAll("(?m)^", "  ") : localsText(frame);
                m.appendReplacement(sb, Matcher.quoteReplacement(text));
                continue;
            }
            try {
                XdmValue value = Evaluator.evaluate(frame.current, frame.context, xsltCurrent(frame), xsltContext(frame), m.group(1));
                text = Values.isLogLeaves(value) ? null : renderedForLog(value, frame);
                if (text == null) {
                    text = Values.logText(value);
                }
            } catch (Exception e) {
                text = "<" + message(e) + ">";
            }
            m.appendReplacement(sb, Matcher.quoteReplacement(text));
        }
        m.appendTail(sb);
        // e.g. 'item 1: {$*}' - not a space at the end of the first line
        return sb.toString().replaceAll("[ \t]+\n", "\n");
    }

    // a value that isn't all leaves (see Values.isLogLeaves) as xdm:trace writes it - null if xdm-view can't be used:
    // said once, when the summary is written instead
    private String renderedForLog(XdmValue value, Frame frame) {
        if (xdmView == null) {
            xdmView = new XdmView(frame.context.getConfiguration());
        }
        String text = xdmView.render(value);
        if (text == null && xdmView.problem() != null && !xdmViewProblemShown) {
            xdmViewProblemShown = true;
            dap.log("Logpoint values are summarised: " + xdmView.problem());
        }
        return text;
    }

    // the local variables in scope - as the Locals scope shows them - one per line, with their names aligned, e.g.
    // '$customer = "Ada"', for a logpoint's {$*}
    private String localsText(Frame frame) {
        List<Map<String, Object>> locals;
        try {
            locals = (frame.xsltContext == null ? values.locals(frame.context, frame.current) :
                    values.xpathLocals(frame.context, frame.current, frame.xpathExternals, frame.xpathSlots, frame.xsltContext, frame.xsltCurrent)).get();
        } finally {
            // not paused: nothing to expand
            values.clear();
        }
        if (locals.isEmpty()) {
            return "(no local variables)";
        }
        int width = 0;
        for (Map<String, Object> local : locals) {
            width = Math.max(width, String.valueOf(local.get("name")).length());
        }
        StringBuilder sb = new StringBuilder();
        for (Map<String, Object> local : locals) {
            String name = String.valueOf(local.get("name"));
            sb.append(sb.length() > 0 ? "\n" : "").append(name);
            for (int i = name.length(); i < width; i++) {
                sb.append(' ');
            }
            sb.append(" = ").append(local.get("value"));
        }
        return sb.toString();
    }

    // paused in this frame - the frames above it (e.g. a function, while a lazily evaluated argument of its call is
    // being evaluated) aren't shown
    private void pause(String reason, Frame frame, int frameCallDepth) {
        pause(reason, frame, frameCallDepth, null);
    }

    // with an error: its code and message, for the stopped event and the exceptionInfo request
    private void pause(String reason, Frame frame, int frameCallDepth, Map<String, Object> error) {
        pausedError = error;
        pausedEvent = events;
        // an error, or no template matched: after the event it happened in (for going back)
        pausedAtError = error != null || NO_MATCH_REASON.equals(reason);
        pausedFrames = new ArrayList<Frame>();
        for (Frame f : frames) {
            if (!pausedFrames.isEmpty() || f == frame) {
                pausedFrames.add(f);
            }
        }
        if (pausedFrames.isEmpty()) {
            pausedFrames.addAll(frames);
        }
        pausedCallDepth = frameCallDepth;
        values.clear();
        synchronized (lock) {
            paused = true;
            step = Step.NONE;
        }
        Json.Obj stopped = Json.obj().with("reason", reason).with("threadId", XsltDebugAdapter.THREAD_ID).with("allThreadsStopped", true);
        if (error != null) {
            stopped.with("description", errorCategory(error)).with("text", error.get("exceptionId") + ": " + Json.object(error, "details").get("message"));
        }
        XPathContext pausedContext = frame == null ? null : xsltContext(frame);
        sendOutputs(pausedContext == null ? null : pausedContext.getCurrentOutputUri(), pausedContext != null && pausedContext.getTemporaryOutputState() != 0);
        dap.event("stopped", stopped);
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
        if (abandoned) {
            throw new Abandoned();
        }
    }

    // the XSLT context of a frame's XPath: within an XPath expression being stepped through, its instruction's
    private static XPathContext xsltContext(Frame frame) {
        return frame.xsltContext != null ? frame.xsltContext : frame.context;
    }

    private static Traceable xsltCurrent(Frame frame) {
        return frame.xsltCurrent != null ? frame.xsltCurrent : frame.current;
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

    // the text written to each result since the extension was last sent it - before a pause, so the view of the output
    // is up to date when VS Code shows the pause, and when the transform ends
    private void sendOutputs(String currentUri, boolean inTemporaryTree) {
        Map<String, Object> unsent = outputs.unsent(currentUri, inTemporaryTree);
        if (unsent != null) {
            dap.event("xsltOutputs", unsent);
        }
    }

    // ---------------------------------------------------------------- errors

    void setExceptionBreakpoints(Map<String, Object> args) {
        List<Object> filters = Json.array(args, "filters");
        breakOnErrors = filters.contains("errors");
        breakOnCaughtErrors = filters.contains("caught");
        breakOnNoMatch = filters.contains("noMatch");
    }

    // ---------------------------------------------------------------- no template matched

    void transformOpened(net.sf.saxon.Controller controller) {
        if (Thread.currentThread() == transformThread) {
            this.controller = controller;
        }
    }

    /**
     * No template rule matched an item, for xsl:apply-templates (from the TraceListener): its mode's built-in rules
     * apply. Only an element, where they're the usual fallback (text-only-copy, which Saxon names 'text-only') - not a mode whose on-no-match is e.g.
     * shallow-copy, or one with no template rules, where that's the intent. Each element name, in each mode, is
     * counted, for the summary at the end; with the 'No Template Matched' filter, the first of each is paused at -
     * at the xsl:apply-templates (or in a frame of its own, if no instruction has run yet, as for the initial mode),
     * in a frame for the element, which is its context item
     */
    void noTemplateMatched(net.sf.saxon.trans.rules.BuiltInRuleSet rules, net.sf.saxon.trans.Mode mode, Item item) {
        if (abandoned) {
            throw new Abandoned();
        }
        boolean dropping = rules.getName().equals("deep-skip");
        if (Thread.currentThread() != transformThread || runningTask || !(rules.getName().startsWith("text-only") || dropping) || mode.isEmpty() ||
                !(item instanceof net.sf.saxon.om.NodeInfo) || ((net.sf.saxon.om.NodeInfo) item).getNodeKind() != net.sf.saxon.type.Type.ELEMENT) {
            return;
        }
        String name = ((net.sf.saxon.om.NodeInfo) item).getDisplayName();
        String modeName = mode.isUnnamedMode() ? "#default" : mode.getModeName().getDisplayName();
        String key = name + " (mode " + modeName + ")";
        if (dropping) {
            // with on-no-match="deep-skip": the element and its content aren't processed - only in the summary
            Integer dropped = droppedUnmatched.get(key);
            droppedUnmatched.put(key, dropped == null ? 1 : dropped + 1);
            return;
        }
        Integer count = unmatched.get(key);
        unmatched.put(key, count == null ? 1 : count + 1);
        if (replayTo >= 0) {
            resumeAsBefore(events, true);
            return;
        }
        Frame top = frames.peek();
        net.sf.saxon.Controller c = top != null && top.context != null ? top.context.getController() : controller;
        if (!breakOnNoMatch || count != null || c == null) {
            return;
        }
        Frame frame = newFrame(null, "no template matched: " + key, false);
        net.sf.saxon.expr.XPathContextMajor context = c.newXPathContext();
        context.setCurrentIterator(new net.sf.saxon.tree.iter.ManualIterator(item));
        frame.context = context;
        if (top != null) {
            frame.current = top.current;
            frame.systemId = top.systemId;
            frame.line = top.line;
            frame.column = top.column;
        }
        frames.push(frame);
        try {
            // not an exception (VS Code shows those as errors): a pause, with why in the Debug Console
            dap.log("\u25b8 No template rule matched " + name + " (mode " + modeName + "): the built-in template rules apply - its text is written, and its children are processed");
            pause(NO_MATCH_REASON, frame, callDepth);
        } finally {
            frames.remove(frame);
        }
    }

    // the elements no template rule matched: e.g. 'Built-in template rules applied to 37 elements no template matched:
    // item ×30 (mode #default), o:note ×7 (mode summary)' - and on a line of its own, those dropped by deep-skip
    private void reportUnmatched() {
        if (!unmatched.isEmpty()) {
            int total = 0;
            for (int n : unmatched.values()) {
                total += n;
            }
            dap.log("▸ Built-in template rules applied to " + total + (total == 1 ? " element" : " elements") + " no template matched: " + unmatchedList(unmatched));
        }
        if (!droppedUnmatched.isEmpty()) {
            dap.log("▸ Dropped by on-no-match=\"deep-skip\": " + unmatchedList(droppedUnmatched));
        }
    }

    // e.g. 'item ×30 (mode #default), o:note ×7 (mode summary)'
    private static String unmatchedList(Map<String, Integer> counts) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, Integer> entry : counts.entrySet()) {
            String key = entry.getKey();
            int mode = key.indexOf(" (mode ");
            sb.append(sb.length() > 0 ? ", " : "").append(key, 0, mode).append(" ×").append(entry.getValue()).append(key.substring(mode));
        }
        return sb.toString();
    }

    Map<String, Object> exceptionInfo() {
        Map<String, Object> error = pausedError;
        if (error == null) {
            throw new IllegalStateException("not paused at an error");
        }
        return error;
    }

    // an error Saxon reports, compiling or running the stylesheet: Saxon's report, linked to the error's location in
    // the Debug Console, and the location for the Problems view - and with a dynamic error, a pause where it happened
    // (Saxon reports it at the top level, but the debugger's stack frames still show where it was raised)
    void reportError(XmlProcessingError error, ErrorReporter saxonReporter, boolean compiling) {
        if (abandoned) {
            return;
        }
        Location location = error.getLocation();
        String path = location == null || location.getSystemId() == null ? null : pathOf(location.getSystemId());
        int line = location == null ? -1 : location.getLineNumber();
        int column = location == null ? -1 : location.getColumnNumber();
        dap.linkedErrorOutput(path, line, column, () -> {
            if (saxonReporter != null) {
                saxonReporter.report(error);
            }
        });
        String code = error.getErrorCode() == null ? "" : error.getErrorCode().getLocalName();
        if (path != null && line > 0 && !dap.muted) {
            dap.event("xsltDebugError", Json.obj().with("path", path).with("line", line).with("column", column)
                    .with("code", code).with("message", error.getMessage()).with("severity", error.isWarning() ? "warning" : "error")
                    .with("compiling", compiling));
        }
        if (replayTo >= 0) {
            resumeAsBefore(events, true);
        } else if (!error.isWarning() && !compiling && breakOnErrors && Thread.currentThread() == transformThread && !runningTask && !frames.isEmpty()) {
            pause("exception", frames.peek(), callDepth, errorInfo(code, error.getMessage(), "unhandled", DYNAMIC_ERROR));
        }
    }

    // the stack depth where an xsl:try starts - from the TraceListener
    Integer checkpoint() {
        return Thread.currentThread() == transformThread && !runningTask ? frames.size() : null;
    }

    // an error caught by xsl:try - from the TraceListener: the frames it was raised in are left without leave()
    // calls, so they're removed - after pausing there, if that's asked for
    void caughtError(Object checkpoint, XPathException error) {
        if (Thread.currentThread() != transformThread || runningTask) {
            return;
        }
        if (replayTo >= 0) {
            resumeAsBefore(events, true);
        } else if (breakOnCaughtErrors && !frames.isEmpty()) {
            String code = error.getErrorCodeQName() == null ? "" : error.getErrorCodeQName().getLocalPart();
            pause("exception", frames.peek(), callDepth, errorInfo(code, error.getMessage(), "always", CAUGHT_ERROR));
        }
        if (checkpoint instanceof Integer) {
            unwindTo((Integer) checkpoint);
        }
    }

    // running again, to go back: at an event (or an error after it) where the run before paused, it goes on as it did
    // then - with the step it was resumed with, and the breakpoints it had then
    private void resumeAsBefore(int event, boolean atError) {
        while (nextResumption < resumptions.size()) {
            Resumption r = resumptions.get(nextResumption);
            if (r.event > event || (r.event == event && r.atError != atError)) {
                return;
            }
            nextResumption++;
            step = r.step;
            replayBreakpointLines = r.breakpointLines;
        }
    }

    private Frame newFrame(Traceable owner, String name, boolean countsDepth) {
        Frame frame = new Frame(owner, name, countsDepth);
        frame.serial = ++frameSerials;
        return frame;
    }

    private void recordArrival(int event, int frameSerial, int line, String path) {
        Integer pathId = arrivalPathIds.get(path);
        if (pathId == null) {
            pathId = arrivalPaths.size();
            arrivalPaths.add(path);
            arrivalPathIds.put(path, pathId);
        }
        if (arrivalCount * 4 == arrivals.length) {
            arrivals = java.util.Arrays.copyOf(arrivals, arrivals.length * 2);
        }
        int i = arrivalCount++ * 4;
        arrivals[i] = event;
        arrivals[i + 1] = frameSerial;
        arrivals[i + 2] = line;
        arrivals[i + 3] = pathId;
    }

    // removes the frames above this depth, as their leave() calls would
    private void unwindTo(int depth) {
        while (frames.size() > depth) {
            Frame frame = frames.pop();
            SteppedResult.discardFrame(frame);
            if (frame.countsDepth) {
                callDepth--;
            }
        }
    }

    private static final String DYNAMIC_ERROR = "Dynamic error";
    private static final String CAUGHT_ERROR = "Error caught by xsl:try";
    // the stopped event's reason: VS Code shows 'Paused on no template matched'
    private static final String NO_MATCH_REASON = "no template matched";

    // for the exceptionInfo request: VS Code's exception widget shows the code as its title, and the description below
    // it - Saxon's message, for an error caught by xsl:try after saying so (else, with no message, the category)
    private static Map<String, Object> errorInfo(String code, String message, String breakMode, String category) {
        String description = message == null || message.trim().isEmpty() ? category :
                category.equals(CAUGHT_ERROR) ? "Caught by xsl:try: " + message : message;
        return Json.obj().with("exceptionId", code.isEmpty() ? "error" : code).with("description", description).with("breakMode", breakMode)
                .with("details", Json.obj().with("message", message).with("typeName", code));
    }

    // the stopped event's short description, e.g. for the call stack: the category
    private static String errorCategory(Map<String, Object> error) {
        return "always".equals(error.get("breakMode")) ? CAUGHT_ERROR : DYNAMIC_ERROR;
    }

    // the call depth of an instruction where it's entered: a focus instruction is at the depth of the frame it's in,
    // not its own, entered for it - so Step Over steps over all its iterations, and Step Into into them, as for a call
    private int instructionDepth(Traceable traceable) {
        Frame top = frames.peek();
        return top != null && top.owner == traceable && isFocusInstruction(traceable) ? callDepth - 1 : callDepth;
    }

    // the frame an arrival at a line belongs to, for going back: a focus instruction's own is in the frame it's in - so a
    // step back from after it goes back to it, not to the line before it, once its frame has gone
    private Frame arrivalFrame(Frame top, Traceable traceable) {
        if (top.owner == traceable && isFocusInstruction(traceable) && frames.size() > 1) {
            java.util.Iterator<Frame> it = frames.iterator();
            it.next();
            return it.next();
        }
        return top;
    }

    // instructions that change the focus get their own stack frame, showing the context item - and, like calls, are
    // stepped over (all their iterations) with Step Over, and out of with Step Out
    private static boolean isFocusInstruction(Traceable traceable) {
        String className = traceable.getClass().getSimpleName();
        return className.equals("ForEach") || className.equals("ForEachGroup") || className.equals("IterateInstr") || className.equals("AnalyzeString");
    }

    private String frameName(Traceable traceable, Map<String, Object> properties) {
        if (traceable instanceof TraceableComponent) {
            String tag = ((TraceableComponent) traceable).getTracingTag();
            StructuredQName name = traceable.getObjectName();
            Object match = properties == null ? null : properties.get("match");
            if (match != null) {
                // as written, rather than Saxon's canonical form, e.g. element(Q{}item)
                String written = sourceAttribute(startTagLocation(traceable.getLocation()), "match");
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
        String tag = className.equals("ForEachGroup") ? "xsl:for-each-group" : className.equals("IterateInstr") ? "xsl:iterate" :
                className.equals("AnalyzeString") ? "xsl:analyze-string" : "xsl:for-each";
        String select = sourceAttribute(startTagLocation(traceable.getLocation()), "select");
        if (select == null) {
            return tag;
        }
        // on one line, as a call stack frame's name is shown
        String oneLine = select.trim().replaceAll("\\s+", " ");
        return tag + " select=\"" + (oneLine.length() > 60 ? oneLine.substring(0, 57) + "..." : oneLine) + "\"";
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
                text = BreakableLines.sourceText(path);
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

    // the instructions (xsl:try, xsl:array and, in Saxon 13, xsl:choose) Saxon reports at their first child's line
    private static final java.util.Set<String> REPORTED_AT_FIRST_CHILD = new java.util.HashSet<String>(java.util.Arrays.asList("TryCatch", "ArrayInstr", "Choose"));

    // a hit count: n (or ==n) for the nth hit, >n, >=n, <n or <=n, or %n for every nth
    private static final java.util.regex.Pattern HIT_CONDITION = java.util.regex.Pattern.compile("\\s*(==|>=|<=|>|<|%)?\\s*(\\d+)\\s*");

    private static boolean isHitConditionMet(String hitCondition, int hits) {
        Matcher m = HIT_CONDITION.matcher(hitCondition);
        if (!m.matches()) {
            return true;
        }
        String operator = m.group(1) == null ? "==" : m.group(1);
        long n = Long.parseLong(m.group(2));
        switch (operator) {
            case ">": return hits > n;
            case ">=": return hits >= n;
            case "<": return hits < n;
            case "<=": return hits <= n;
            case "%": return n > 0 && hits % n == 0;
            default: return hits == n;
        }
    }

    /** a breakpoint's condition and hit count, and its hits so far */
    abstract static class Conditional {
        final String condition;
        final String hitCondition;
        int hits;
        boolean conditionFailed;

        Conditional(String condition, String hitCondition) {
            this.condition = condition;
            this.hitCondition = hitCondition;
        }

        boolean hasSameConditions(Conditional other) {
            return java.util.Objects.equals(condition, other.condition) && java.util.Objects.equals(hitCondition, other.hitCondition);
        }
    }

    private static final class Breakpoint extends Conditional {
        final String logMessage;
        // the breakpoint itself - or for an instruction reported at its first child's line (an alias, only hit by
        // that instruction), the breakpoint it's for, whose hits it counts
        final Breakpoint primary;

        Breakpoint(String condition, String hitCondition, String logMessage, Breakpoint aliasFor) {
            super(condition, hitCondition);
            this.logMessage = logMessage;
            this.primary = aliasFor != null ? aliasFor : this;
        }

        boolean hasSameSettings(Breakpoint other) {
            return hasSameConditions(other) && java.util.Objects.equals(logMessage, other.logMessage);
        }
    }

    /** a template, function or global variable invocation, or a focus-changing instruction within one */
    static final class Frame {
        final Traceable owner;
        final String name;
        // a call, a focus instruction or an XPath expression stepped through: a level of the call depth, which Step
        // Over steps over and Step Out steps out of
        final boolean countsDepth;
        // in the order frames are made: the same in each run, so arrivals at lines are matched to frames on going back
        int serial;
        // for an XPath expression's frame: the call depth within it, and its instruction's context - for the
        // stylesheet's functions and global variables, and current(), current-group() etc.
        int callDepth;
        XPathContext xsltContext;
        Traceable xsltCurrent;
        // for an XPath expression's frame: the number of slots for the variables it references (not its own), in
        // its stack frame (xpathSlots - not an inline function's), and the focus it's evaluated with - at its top
        // level, that of its instruction
        int xpathExternals;
        net.sf.saxon.expr.instruct.SlotManager xpathSlots;
        net.sf.saxon.om.FocusIterator xpathFocus;
        // where it's paused, a part of the XPath expression is evaluated lazily, within a function it calls (e.g. an
        // argument, when the function uses it): Saxon keeps only the context item for it, not position() and last()
        boolean lazyPart;
        // the line last entered in this frame, and the instruction or expression first entered on it
        String enteredPath;
        int enteredLine;
        // the line where Saxon reported the instruction last entered: where its start tag ends
        int enteredReportedLine;
        // a new item is being processed, e.g. by xsl:for-each: the line is arrived at again
        boolean newIteration;
        Traceable lineStart;
        // for an XPath expression's frame: the part of the expression first entered on each line ('path:line') - a
        // line arrived at by another part is a part of it evaluated lazily
        final Map<String, Traceable> firstOnLine = new HashMap<String, Traceable>();
        // for an XPath expression's frame: its instruction's line, if the instruction was just stopped at there - a
        // breakpoint there isn't stopped at again when the expression first arrives at that line (-1: none)
        int skipBreakpointLine = -1;
        Traceable current;
        XPathContext context;
        String systemId;
        int line;
        int column;

        Frame(Traceable owner, String name, boolean countsDepth) {
            this.owner = owner;
            this.name = name;
            this.countsDepth = countsDepth;
        }
    }
}
