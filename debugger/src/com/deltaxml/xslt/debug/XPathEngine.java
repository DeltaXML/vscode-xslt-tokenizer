/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.IdentityHashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import net.sf.saxon.Configuration;
import net.sf.saxon.expr.Expression;
import net.sf.saxon.expr.FunctionCall;
import net.sf.saxon.expr.Literal;
import net.sf.saxon.expr.Operand;
import net.sf.saxon.expr.StaticContext;
import net.sf.saxon.expr.XPathContext;
import net.sf.saxon.expr.instruct.Executable;
import net.sf.saxon.expr.instruct.SlotManager;
import net.sf.saxon.expr.instruct.TraceExpression;
import net.sf.saxon.expr.parser.ContextItemStaticInfo;
import net.sf.saxon.expr.parser.ExpressionTool;
import net.sf.saxon.expr.parser.ExpressionVisitor;
import net.sf.saxon.expr.parser.Loc;
import net.sf.saxon.expr.parser.XPathParser;
import net.sf.saxon.expr.parser.RetainedStaticContext;
import net.sf.saxon.expr.sort.GroupIterator;
import net.sf.saxon.functions.FunctionLibraryList;
import net.sf.saxon.lib.Feature;
import net.sf.saxon.lib.NamespaceConstant;
import net.sf.saxon.om.GroundedValue;
import net.sf.saxon.om.Item;
import net.sf.saxon.om.NamespaceUri;
import net.sf.saxon.om.Sequence;
import net.sf.saxon.om.SequenceTool;
import net.sf.saxon.om.StructuredQName;
import net.sf.saxon.regex.RegexIterator;
import net.sf.saxon.s9api.HostLanguage;
import net.sf.saxon.s9api.Location;
import net.sf.saxon.str.UnicodeString;
import net.sf.saxon.trans.XPathException;
import net.sf.saxon.sxpath.IndependentContext;
import net.sf.saxon.sxpath.XPathDynamicContext;
import net.sf.saxon.sxpath.XPathExpression;
import net.sf.saxon.sxpath.XPathVariable;
import net.sf.saxon.trace.Traceable;
import net.sf.saxon.trace.TraceableComponent;
import net.sf.saxon.value.EmptySequence;
import net.sf.saxon.value.Int64Value;
import net.sf.saxon.value.StringValue;

/**
 * Compiles and evaluates XPath where execution is paused: with the paused instruction's namespaces and base URI, the
 * variables in scope, the context item, and the stylesheet's own functions. XSLT functions that depend on the
 * instruction's dynamic state - current(), current-group(), current-grouping-key(), regex-group() and
 * current-output-uri() - are replaced by their values there, as the extension's Extract Function refactoring
 * replaces them by parameters.
 *
 * With instrumentation, each sub-expression is wrapped in a TraceExpression, so evaluating the expression reports
 * each part's own location to the TraceListener. In XSLT, Saxon only knows an attribute's expression by the location
 * of its instruction (an XML parser doesn't report attribute positions), so this is how execution can stop within a
 * multi-line expression: by evaluating its text, whose line numbers are known, separately.
 *
 * This uses Saxon's internal classes, but only those that are the same in Saxon 12 and 13 (ExpressionTool.make,
 * whose signature differs, is called by reflection).
 */
final class XPathEngine {

    private XPathEngine() { }

    /** a compiled expression, ready to evaluate in the context it was compiled for */
    static final class Compiled {
        private final XPathExpression expression;
        private final Map<XPathVariable, Sequence> bindings;
        private final Item contextItem;
        // the locations of the expression's own parts (not those in stylesheet functions it calls): those Saxon
        // reports, as type checking may replace a part by another, with the same location
        final Map<Location, Boolean> instrumented;

        Compiled(XPathExpression expression, Map<XPathVariable, Sequence> bindings, Item contextItem, Map<Location, Boolean> instrumented) {
            this.expression = expression;
            this.bindings = bindings;
            this.contextItem = contextItem;
            this.instrumented = instrumented;
        }

        GroundedValue evaluate() throws Exception {
            XPathDynamicContext dynamicContext = expression.createDynamicContext(contextItem);
            for (Map.Entry<XPathVariable, Sequence> binding : bindings.entrySet()) {
                dynamicContext.setVariable(binding.getKey(), binding.getValue());
            }
            return SequenceTool.toGroundedValue(expression.iterate(dynamicContext));
        }
    }

    private static final Pattern VARIABLE_REFERENCE = Pattern.compile("\\$\\s*((?:[\\p{L}_][\\p{L}\\p{N}_.\\-]*:)?[\\p{L}_][\\p{L}\\p{N}_.\\-]*)");

    /** where an expression's text starts in its stylesheet, for the locations of its instrumented parts */
    static final class SourcePosition {
        final String systemId;
        final int line;
        final int column;

        SourcePosition(String systemId, int line, int column) {
            this.systemId = systemId;
            this.line = line;
            this.column = column;
        }
    }

    // with a source position, the expression is instrumented: each part reports its location in the stylesheet
    // context: for the variables in scope and the context item; xsltContext: for the stylesheet's functions and
    // global variables, and current() etc. - the same, except within an XPath expression being stepped through
    static Compiled compile(String xpath, Traceable instruction, XPathContext context, Traceable xsltInstruction, XPathContext xsltContext, SourcePosition instrumentAt) throws Exception {
        Configuration config = context.getConfiguration();
        FunctionLibraryList stylesheetFunctions = xsltContext.getController() == null ? null : xsltContext.getController().getExecutable().getFunctionLibrary();
        RetainedStaticContext staticContext = staticContext(instruction);
        // as the stylesheet's own expressions: XPath 4.0 for an XSLT 4.0 stylesheet, otherwise 3.1 - with syntax
        // extensions, Saxon-PE 13 would otherwise use 4.0, where a call to a stylesheet function isn't found
        int xpathVersion = staticContext != null && staticContext.getPackageData() != null && staticContext.getPackageData().getHostLanguageVersion() >= 40 ? 40 : 31;
        StaticContextWithFunctions env = new StaticContextWithFunctions(config, stylesheetFunctions, xpathVersion);
        if (staticContext != null) {
            for (Iterator<String> prefixes = staticContext.iteratePrefixes(); prefixes.hasNext(); ) {
                String prefix = prefixes.next();
                NamespaceUri uri = staticContext.getURIForPrefix(prefix, true);
                if (uri != null && !prefix.isEmpty()) {
                    env.declareNamespace(prefix, uri);
                }
            }
        }
        Location location = instruction == null ? null : instruction.getLocation();
        if (location != null && location.getSystemId() != null) {
            // e.g. for document('')
            env.setBaseURI(location.getSystemId());
        }

        // only the variables the expression references are bound: binding a variable evaluates it, if it is still
        // lazily evaluated
        Map<XPathVariable, Sequence> bindings = new LinkedHashMap<XPathVariable, Sequence>();
        Map<String, Boolean> declared = new LinkedHashMap<String, Boolean>();
        Matcher m = VARIABLE_REFERENCE.matcher(xpath);
        while (m.find()) {
            String name = m.group(1);
            if (declared.containsKey(name)) {
                continue;
            }
            declared.put(name, Boolean.TRUE);
            Map.Entry<StructuredQName, Sequence> variable = Values.variableNamed(context, instruction, xsltContext, xsltInstruction, name);
            if (variable != null) {
                bindings.put(env.declareVariable(variable.getKey()), variable.getValue());
            }
        }

        Executable executable = new Executable(config);
        executable.setTopLevelPackage(env.getPackageData());
        executable.setHostLanguage(HostLanguage.XPATH);
        env.setExecutable(executable);

        // stepping through, a function's arguments are evaluated before it's called - as they're written - rather
        // than lazily, within the function
        Boolean eager = config.getConfigurationProperty(Feature.EAGER_EVALUATION);
        if (instrumentAt != null) {
            config.setConfigurationProperty(Feature.EAGER_EVALUATION, true);
        }
        try {
            return compile(xpath, context, xsltContext, env, executable, bindings, instrumentAt);
        } finally {
            config.setConfigurationProperty(Feature.EAGER_EVALUATION, eager);
        }
    }

    private static Compiled compile(String xpath, XPathContext context, XPathContext xsltContext, StaticContextWithFunctions env, Executable executable,
            Map<XPathVariable, Sequence> bindings, SourcePosition instrumentAt) throws Exception {
        LocatingParser parser = new LocatingParser(env);
        Expression expression = parser.parse(xpath, env);
        expression = replaceXsltContextFunctions(expression, xsltContext);
        Map<Location, Boolean> instrumented = new IdentityHashMap<Location, Boolean>();
        if (instrumentAt != null) {
            expression = instrument(expression, instrumented, parser.starts, xpath, lineStarts(xpath), instrumentAt);
        }
        expression = expression.simplify();
        expression.setRetainedStaticContext(env.makeRetainedStaticContext());
        expression = expression.typeCheck(ExpressionVisitor.make(env), ContextItemStaticInfo.DEFAULT);
        SlotManager slots = env.getStackFrameMap();
        int externals = slots.getNumberOfVariables();
        ExpressionTool.allocateSlots(expression, externals, slots);
        return new Compiled(new CompiledExpression(env, expression, executable, slots, externals), bindings, context.getContextItem(), instrumented);
    }

    static GroundedValue evaluate(String xpath, Traceable instruction, XPathContext context, Traceable xsltInstruction, XPathContext xsltContext) throws Exception {
        return compile(xpath, instruction, context, xsltInstruction, xsltContext, null).evaluate();
    }

    private static RetainedStaticContext staticContext(Traceable instruction) {
        Expression expression = instruction instanceof Expression ? (Expression) instruction :
                instruction instanceof TraceableComponent ? ((TraceableComponent) instruction).getBody() : null;
        return expression == null ? null : expression.getRetainedStaticContext();
    }

    /**
     * Saxon's XPath parser, recording where each part of the expression starts: the location Saxon gives an
     * expression is where its parser was when it made it - often at the token after it. The methods overridden have
     * the same signatures in Saxon 12 and 13; parse(), whose signature differs, is called by reflection.
     */
    static final class LocatingParser extends XPathParser {
        final Map<Expression, Integer> starts = new IdentityHashMap<Expression, Integer>();

        LocatingParser(StaticContext env) throws Exception {
            super(env);
            // e.g. Saxon-PE's syntax extensions: from a parser as the configuration makes it
            XPathParser configured = env.getConfiguration().newExpressionParser("XP", false, env);
            Field extension = XPathParser.class.getDeclaredField("parserExtension");
            extension.setAccessible(true);
            setParserExtension((net.sf.saxon.expr.parser.ParserExtension) extension.get(configured));
        }

        // as ExpressionTool.make() parses, without simplifying - so the parts are those recorded
        Expression parse(String xpath, StaticContext env) throws Exception {
            for (Method method : XPathParser.class.getMethods()) {
                if (method.getName().equals("parse") && method.getParameterCount() == 4 && method.getParameterTypes()[0] == String.class) {
                    // the terminator is an int (Token.EOF) in Saxon 12 and a Predicate<Tokenizer> in Saxon 13
                    Object terminator = method.getParameterTypes()[2] == int.class ?
                            Class.forName("net.sf.saxon.expr.parser.Token").getField("EOF").get(null) :
                            Class.forName("net.sf.saxon.expr.parser.Tokenizer").getField("END_OF_INPUT").get(null);
                    Expression expression;
                    try {
                        expression = (Expression) method.invoke(this, xpath, 0, terminator, env);
                    } catch (InvocationTargetException e) {
                        throw e.getCause() instanceof Exception ? (Exception) e.getCause() : e;
                    }
                    ExpressionTool.setDeepRetainedStaticContext(expression, env.makeRetainedStaticContext());
                    return expression;
                }
            }
            throw new IllegalStateException("this Saxon version has no XPathParser.parse(String, int, ?, StaticContext)");
        }

        private Expression started(int offset, Expression expression) {
            if (expression != null && !starts.containsKey(expression)) {
                starts.put(expression, offset);
            }
            return expression;
        }

        @Override
        public Expression parseExprSingle() throws XPathException {
            int start = getTokenizer().currentTokenStartOffset;
            return started(start, super.parseExprSingle());
        }

        @Override
        protected Expression parseBasicStep(boolean firstInPattern) throws XPathException {
            int start = getTokenizer().currentTokenStartOffset;
            return started(start, super.parseBasicStep(firstInPattern));
        }

        @Override
        protected Expression parseStepExpression(boolean firstInPattern) throws XPathException {
            int start = getTokenizer().currentTokenStartOffset;
            return started(start, super.parseStepExpression(firstInPattern));
        }

        @Override
        protected Expression parseRelativePath() throws XPathException {
            int start = getTokenizer().currentTokenStartOffset;
            return started(start, super.parseRelativePath());
        }

        @Override
        public Expression parseBinaryExpression(Expression lhs, int precedence) throws XPathException {
            Integer start = starts.get(lhs);
            Expression expression = super.parseBinaryExpression(lhs, precedence);
            return start == null ? expression : started(start, expression);
        }
    }

    // XSLT functions whose values come from the instruction's dynamic context, which a separately evaluated
    // expression doesn't have: replaced by literals with their values where execution is paused
    private static Expression replaceXsltContextFunctions(Expression expression, XPathContext context) {
        for (Operand operand : expression.operands()) {
            operand.setChildExpression(replaceXsltContextFunctions(operand.getChildExpression(), context));
        }
        // current-group() and current-grouping-key() are parsed as expressions of their own, not function calls
        String className = expression.getClass().getSimpleName();
        String function = className.equals("CurrentGroupCall") ? "current-group" : className.equals("CurrentGroupingKeyCall") ? "current-grouping-key" : null;
        FunctionCall call = expression instanceof FunctionCall ? (FunctionCall) expression : null;
        if (function == null && call != null) {
            StructuredQName name = call.getFunctionName();
            function = name != null && NamespaceConstant.FN.equals(name.getNamespaceUri().toString()) ? name.getLocalPart() : null;
        }
        if (function == null) {
            return expression;
        }
        GroundedValue value;
        try {
            switch (function) {
                case "current":
                    value = context.getContextItem() == null ? EmptySequence.getInstance() : context.getContextItem();
                    break;
                case "current-group": {
                    GroupIterator groups = context.getCurrentGroupIterator();
                    value = groups == null ? EmptySequence.getInstance() : groups.currentGroup();
                    break;
                }
                case "current-grouping-key": {
                    GroupIterator groups = context.getCurrentGroupIterator();
                    value = groups == null ? EmptySequence.getInstance() : groups.getCurrentGroupingKey().materialize();
                    break;
                }
                case "regex-group": {
                    RegexIterator regex = context.getCurrentRegexIterator();
                    Expression argument = call != null && call.getArity() == 1 ? call.getArg(0) : null;
                    if (!(argument instanceof Literal) || !(((Literal) argument).getGroundedValue() instanceof Int64Value)) {
                        return expression;
                    }
                    UnicodeString group = regex == null ? null : regex.getRegexGroup((int) ((Int64Value) ((Literal) argument).getGroundedValue()).longValue());
                    value = group == null ? StringValue.EMPTY_STRING : new StringValue(group);
                    break;
                }
                case "current-output-uri": {
                    String uri = context.getCurrentOutputUri();
                    value = uri == null ? EmptySequence.getInstance() : new StringValue(uri);
                    break;
                }
                default:
                    return expression;
            }
        } catch (Exception e) {
            return expression;
        }
        Literal literal = Literal.makeLiteral(value);
        ExpressionTool.copyLocationInfo(expression, literal);
        return literal;
    }

    // wraps each part of the expression (other than literals) in a TraceExpression, which reports it to the
    // TraceListener when it's evaluated - at its location in the stylesheet
    private static Expression instrument(Expression expression, Map<Location, Boolean> instrumented, Map<Expression, Integer> starts,
            String xpath, int[] lineStarts, SourcePosition start) {
        // where it starts in the text: as recorded by the parser, else where its first part does
        Integer offset = starts.get(expression);
        for (Operand operand : expression.operands()) {
            Expression child = operand.getChildExpression();
            Integer childOffset = starts.get(child);
            if (!starts.containsKey(expression) && childOffset != null && (offset == null || childOffset < offset)) {
                offset = childOffset;
            }
            operand.setChildExpression(instrument(child, instrumented, starts, xpath, lineStarts, start));
        }
        if (expression instanceof Literal || expression instanceof TraceExpression || offset == null) {
            return expression;
        }
        // the TraceListener is given the wrapped expression, so that has the stylesheet location (as do Saxon's
        // error messages, then)
        Location location = sourceLocation(offset, lineStarts, start);
        expression.setLocation(location);
        TraceExpression trace = new TraceExpression(expression);
        trace.setRetainedStaticContext(expression.getRetainedStaticContext());
        trace.setLocation(location);
        instrumented.put(location, Boolean.TRUE);
        return trace;
    }

    // the stylesheet location of an offset in the expression's text
    private static Location sourceLocation(int offset, int[] lineStarts, SourcePosition start) {
        int index = java.util.Arrays.binarySearch(lineStarts, offset);
        int textLine = (index >= 0 ? index : -index - 2) + 1;
        int textColumn = offset - lineStarts[textLine - 1];
        return new Loc(start.systemId, start.line + textLine - 1, textLine == 1 ? start.column + textColumn : textColumn + 1);
    }

    private static int[] lineStarts(String text) {
        java.util.List<Integer> starts = new java.util.ArrayList<Integer>();
        starts.add(0);
        for (int i = 0; i < text.length(); i++) {
            if (text.charAt(i) == '\n') {
                starts.add(i + 1);
            }
        }
        int[] result = new int[starts.size()];
        for (int i = 0; i < result.length; i++) {
            result[i] = starts.get(i);
        }
        return result;
    }

    /** a static context with the stylesheet's functions, as well as the standard ones - addFunctionLibrary is protected */
    private static final class StaticContextWithFunctions extends IndependentContext {
        StaticContextWithFunctions(Configuration config, FunctionLibraryList stylesheetFunctions, int xpathVersion) {
            super(config);
            if (getXPathVersion() != xpathVersion) {
                try {
                    // this resets the function library, so it's done first
                    setXPathLanguageLevel(xpathVersion);
                } catch (RuntimeException e) {
                    // not available with this Saxon edition
                }
            }
            if (stylesheetFunctions != null) {
                addFunctionLibrary(stylesheetFunctions);
            }
        }
    }

    /** XPathExpression's constructor and setStackFrameMap are protected */
    private static final class CompiledExpression extends XPathExpression {
        CompiledExpression(StaticContext env, Expression expression, Executable executable, SlotManager slots, int externals) {
            super(env, expression, executable);
            setStackFrameMap(slots, externals);
        }
    }
}
