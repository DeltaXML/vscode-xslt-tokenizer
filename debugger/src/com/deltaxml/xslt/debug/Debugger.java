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
    private final Map<String, Map<Integer, Breakpoint>> breakpoints = new ConcurrentHashMap<String, Map<Integer, Breakpoint>>();

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
    // the error paused at, if any
    private volatile Map<String, Object> pausedError;

    // --- transform-thread state
    private Thread transformThread;
    private boolean runningTask;
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
    private final Map<String, BreakableLines> sourceLines = new HashMap<String, BreakableLines>();

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
        // for the extension's log (VS Code ignores events it doesn't know)
        dap.event("xsltDebugLaunch", Json.obj().with("saxon", net.sf.saxon.Version.getProductTitle())
                .with("java", System.getProperty("java.version") + " (" + System.getProperty("java.vendor") + ")")
                .with("javaHome", System.getProperty("java.home")).with("saxonArgs", args));
        transformThread = new Thread(new Runnable() {
            public void run() {
                int exitCode = 0;
                try {
                    new DebugTransform(Debugger.this).doTransform(args.toArray(new String[0]), "java net.sf.saxon.Transform");
                } catch (Throwable e) {
                    exitCode = 2;
                    // Saxon has already reported a failure it throws as a plain RuntimeException
                    if (e.getClass() != RuntimeException.class) {
                        System.err.println(message(e));
                    }
                }
                System.out.flush();
                System.err.flush();
                sendOutputs(null, false);
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
            stepCallDepth = pausedCallDepth;
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
                result.add(scope("Locals", values.register(frame.xsltContext == null ? values.locals(frame.context, frame.current) :
                        values.xpathLocals(frame.context, frame.current, frame.xpathExternals, frame.xsltContext, frame.xsltCurrent)), false));
                result.add(scope("Context", values.register(values.focus(frame.context, xsltContext(frame), frame.xpathFocus)), false));
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
        if (Thread.currentThread() != transformThread || runningTask) {
            // e.g. a lazily evaluated variable being evaluated for the Variables view
            return;
        }
        if (isSequenceConstructor(traceable)) {
            // which Saxon 12 traces at its first instruction's location (Saxon 13 doesn't) - not an instruction of
            // its own: stopping at it would stop twice where the first instruction is
            return;
        }
        if (traceable.getClass().getSimpleName().equals("TryCatch")) {
            tryDepths.push(new java.util.AbstractMap.SimpleImmutableEntry<Traceable, Integer>(traceable, frames.size()));
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
        // a part of the XPath expression being stepped through belongs to its frame - even when, evaluated lazily
        // (e.g. a function argument), it's evaluated within a function it calls
        Frame top = xpathParts != null && traceable.getLocation() != null && xpathParts.containsKey(traceable.getLocation()) ? xpathFrame : frames.peek();
        int depth = top == xpathFrame && xpathFrame != null ? xpathFrame.callDepth : callDepth;
        top.context = context;
        top.current = traceable;
        Location location = traceable.getLocation();
        if (location == null || location.getSystemId() == null || location.getLineNumber() <= 0) {
            return;
        }
        String path = pathOf(location.getSystemId());
        if (path == null) {
            return;
        }
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
        if (onNewLine) {
            top.enteredPath = path;
            top.enteredLine = top.line;
            // not the focus instruction itself, which is entered once, not for each item
            top.lineStart = traceable == top.owner ? null : traceable;
        }
        top.enteredReportedLine = reportedLine;

        String reason = null;
        if (pauseRequested) {
            reason = "pause";
        } else if (stopOnEntry) {
            reason = "entry";
        } else if (isCall && functionBreakpointHit(traceable, properties, top)) {
            reason = "function breakpoint";
        } else if (onNewLine && breakpointHit(path, top.line, top)) {
            // checked once each time execution arrives at the line - not for each instruction Saxon reports on it -
            // including again, e.g. for the next iteration of a loop on one line
            reason = "breakpoint";
        } else if (isStepComplete(path, top.line, depth, arrivingAgain)) {
            reason = "step";
        }
        if (reason != null) {
            pauseRequested = false;
            stopOnEntry = false;
            stoppedPath = path;
            stoppedLine = top.line;
            pause(reason, top, depth);
        }
        if (onNewReportedLine && xpathDepth == 0) {
            // stepping into: from here, or from an instruction before it on the same line
            stepThroughXPath(traceable, context, path, reportedLine, top.line, step == Step.INTO);
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
    private void stepThroughXPath(Traceable instruction, XPathContext context, String path, int reportedLine, int line, boolean steppingIn) {
        BreakableLines lines = sourceLines(path);
        if (lines == null) {
            return;
        }
        for (BreakableLines.XPathAttribute attribute : lines.xpathAttributesAt(reportedLine)) {
            if (!steppingIn && !hasBreakpointWithin(path, attribute, line)) {
                continue;
            }
            // e.g. xsl:variable/@select, or for an expression in an element's content, xsl:select
            String name = attribute.name == null ? attribute.elementName : attribute.elementName + "/@" + attribute.name;
            String systemId = instruction.getLocation().getSystemId();
            Frame frame = new Frame(null, name + " (XPath)", true);
            frame.context = context;
            frame.xsltContext = context;
            frame.xsltCurrent = instruction;
            frame.current = instruction;
            frame.systemId = systemId;
            frame.line = attribute.line;
            frame.column = attribute.column;
            int depthBefore = frames.size();
            frames.push(frame);
            callDepth++;
            xpathDepth++;
            frame.callDepth = callDepth;
            try {
                XPathEngine.Compiled compiled = XPathEngine.compile(attribute.xpath, instruction, context, instruction, context,
                        new XPathEngine.SourcePosition(systemId, attribute.line, attribute.column));
                xpathFrame = frame;
                xpathParts = compiled.instrumented;
                frame.xpathExternals = compiled.externals;
                net.sf.saxon.sxpath.XPathDynamicContext dynamicContext = compiled.prepare();
                frame.xpathFocus = dynamicContext.getXPathContextObject().getCurrentIterator();
                GroundedValue value = compiled.evaluate(dynamicContext);
                dap.log(resultDescription(attribute, name) + " returned " + Values.summary(XdmValue.wrap(value)));
            } catch (Exception | LinkageError e) {
                // 'important': VS Code also shows it as a notification - it was stepped into, or has a breakpoint
                dap.event("output", Json.obj().with("category", "important").with("output",
                        name + " on line " + attribute.line + " couldn't be evaluated separately, to step through it: " + message(e) + "\n"));
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
                        stepCallDepth = callDepth;
                        stepPath = path;
                        stepLine = line;
                    }
                }
            }
        }
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
    private BreakableLines sourceLines(String path) {
        if (!sourceLines.containsKey(path)) {
            sourceLines.put(path, BreakableLines.forFile(path));
        }
        return sourceLines.get(path);
    }

    private boolean hasBreakpointWithin(String path, BreakableLines.XPathAttribute attribute, int instructionLine) {
        Map<Integer, Breakpoint> lines = breakpoints.get(path);
        if (lines != null) {
            for (Integer line : lines.keySet()) {
                if (line >= attribute.line && line <= attribute.lastLine && line != instructionLine) {
                    return true;
                }
            }
        }
        return false;
    }

    void leave(Traceable traceable) {
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
            if (top.isCall) {
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

    // a logpoint message, with each {xpath} replaced by its value
    private String interpolate(String message, Frame frame) {
        StringBuffer sb = new StringBuffer();
        Matcher m = LOG_EXPRESSION.matcher(message);
        while (m.find()) {
            String text;
            try {
                text = Values.logText(Evaluator.evaluate(frame.current, frame.context, xsltCurrent(frame), xsltContext(frame), m.group(1)));
            } catch (Exception e) {
                text = "<" + message(e) + ">";
            }
            m.appendReplacement(sb, Matcher.quoteReplacement(text));
        }
        m.appendTail(sb);
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
        if (path != null && line > 0) {
            dap.event("xsltDebugError", Json.obj().with("path", path).with("line", line).with("column", column)
                    .with("code", code).with("message", error.getMessage()).with("severity", error.isWarning() ? "warning" : "error")
                    .with("compiling", compiling));
        }
        if (!error.isWarning() && !compiling && breakOnErrors && Thread.currentThread() == transformThread && !runningTask && !frames.isEmpty()) {
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
        if (breakOnCaughtErrors && !frames.isEmpty()) {
            String code = error.getErrorCodeQName() == null ? "" : error.getErrorCodeQName().getLocalPart();
            pause("exception", frames.peek(), callDepth, errorInfo(code, error.getMessage(), "always", CAUGHT_ERROR));
        }
        if (checkpoint instanceof Integer) {
            unwindTo((Integer) checkpoint);
        }
    }

    // removes the frames above this depth, as their leave() calls would
    private void unwindTo(int depth) {
        while (frames.size() > depth) {
            if (frames.pop().isCall) {
                callDepth--;
            }
        }
    }

    private static final String DYNAMIC_ERROR = "Dynamic error";
    private static final String CAUGHT_ERROR = "Error caught by xsl:try";

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
        String tag = className.equals("ForEachGroup") ? "xsl:for-each-group" : className.equals("IterateInstr") ? "xsl:iterate" : "xsl:for-each";
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
        final boolean isCall;
        // for an XPath expression's frame: the call depth within it, and its instruction's context - for the
        // stylesheet's functions and global variables, and current(), current-group() etc.
        int callDepth;
        XPathContext xsltContext;
        Traceable xsltCurrent;
        // for an XPath expression's frame: the number of slots for the variables it references (not its own), and
        // the focus it's evaluated with - at its top level, that of its instruction
        int xpathExternals;
        net.sf.saxon.om.FocusIterator xpathFocus;
        // the line last entered in this frame, and the instruction or expression first entered on it
        String enteredPath;
        int enteredLine;
        // the line where Saxon reported the instruction last entered: where its start tag ends
        int enteredReportedLine;
        // a new item is being processed, e.g. by xsl:for-each: the line is arrived at again
        boolean newIteration;
        Traceable lineStart;
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
