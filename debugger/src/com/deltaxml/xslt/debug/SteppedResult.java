/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import net.sf.saxon.event.Outputter;
import net.sf.saxon.expr.Expression;
import net.sf.saxon.expr.Operand;
import net.sf.saxon.expr.OperandRole;
import net.sf.saxon.expr.StackFrame;
import net.sf.saxon.expr.XPathContext;
import net.sf.saxon.expr.elab.Elaborator;
import net.sf.saxon.expr.elab.FallbackElaborator;
import net.sf.saxon.expr.parser.ExpressionTool;
import net.sf.saxon.expr.parser.RebindingMap;
import net.sf.saxon.om.SequenceTool;
import net.sf.saxon.om.Item;
import net.sf.saxon.om.NodeInfo;
import net.sf.saxon.om.SequenceIterator;
import net.sf.saxon.str.UnicodeString;
import net.sf.saxon.trace.ExpressionPresenter;
import net.sf.saxon.trans.XPathException;
import net.sf.saxon.type.ItemType;
import net.sf.saxon.type.UType;

/**
 * A multi-line XPath expression in an instruction's attribute (or an xsl:select's content), as the stylesheet
 * evaluates it. When the debugger has just stepped through the expression - evaluated separately, so each part
 * reports its own line - the instruction's own evaluation of it is quiet: it isn't stopped in, and the xsl:message
 * output of the stylesheet functions it calls isn't written again, nor their breakpoints counted again. So stepping
 * into a function it calls stops there once, and its messages are written once, as in a normal run. The expression
 * is still evaluated as usual - with any conversions Saxon adds around it - so its result is the stylesheet's own.
 * This applies only to the same instruction, with the same stack frame and context item; otherwise, and when the
 * expression wasn't stepped through, it's evaluated as usual.
 */
final class SteppedResult extends Expression {

    private static final class Pending {
        final Object owner;
        // the debugger's frame (template, function etc.) it was stepped through in
        final Object debuggerFrame;
        // the stack frame's variables: an expression evaluated lazily - e.g. an xsl:with-param's select, in the
        // template called - has a copy of the frame
        final Object frameMap;
        final Item contextItem;

        Pending(Object owner, Object debuggerFrame, Object frameMap, Item contextItem) {
            this.owner = owner;
            this.debuggerFrame = debuggerFrame;
            this.frameMap = frameMap;
            this.contextItem = contextItem;
        }
    }

    // by key: the expressions just stepped through, while their instruction runs - only ever accessed on the
    // transform's thread. Not removed when used: Saxon may evaluate an expression in parts - e.g. a sequence's items,
    // each in a TraceExpression of its own - each with a SteppedResult
    private static final Map<String, Pending> pending = new HashMap<String, Pending>();
    // the depth of quiet evaluations
    private static int quiet;

    // an inline function's body, in the attribute whose multi-line expression it's in: identified by its parameters - its
    // own, then those Saxon adds for the variables from outside it that it uses
    static final class InlineFunction {
        final String systemId;
        final int tagEndLine;
        final int tagEndColumn;
        final String element;
        final String attribute;
        final java.util.List<String> parameters;

        InlineFunction(String systemId, int tagEndLine, int tagEndColumn, String element, String attribute, java.util.List<String> parameters) {
            this.systemId = systemId;
            this.tagEndLine = tagEndLine;
            this.tagEndColumn = tagEndColumn;
            this.element = element;
            this.attribute = attribute;
            this.parameters = parameters;
        }

        String key() {
            return SteppedResult.key(systemId, tagEndLine, tagEndColumn, element, attribute) + " function(" + String.join(", ", parameters) + ")";
        }
    }

    private final Operand operand;
    private final String key;
    // for an inline function's body: which one
    final InlineFunction inlineFunction;

    SteppedResult(Expression child, String key) {
        this(child, key, null);
    }

    SteppedResult(Expression child, String key, InlineFunction inlineFunction) {
        this.operand = new Operand(this, child, OperandRole.SAME_FOCUS_ACTION);
        this.key = key;
        this.inlineFunction = inlineFunction;
        ExpressionTool.copyLocationInfo(child, this);
    }

    // where the expression is: its module, its element's start tag end (the location Saxon gives the element), the
    // element's local name, and the attribute's - none, for an element's content
    static String key(String systemId, int line, int column, String element, String attribute) {
        return systemId + "#" + line + ":" + column + " " + element + "/" + (attribute == null ? "" : attribute);
    }

    // the expression with this key has been stepped through, for the instruction (owner) about to evaluate it - in
    // the debugger's frame given. (The owner may be only a part of it, e.g. its first function call, which Saxon
    // traces: so it applies until the frame is left, or the owner is entered again - e.g. in the next iteration.)
    static void stepped(String key, Object owner, Object debuggerFrame, XPathContext context) {
        pending.put(key, new Pending(owner, debuggerFrame, frameMap(context), context.getContextItem()));
    }

    // the instruction is entered again
    static void discard(Object owner) {
        if (!pending.isEmpty()) {
            pending.values().removeIf((p) -> p.owner == owner);
        }
    }

    // the debugger's frame is left
    static void discardFrame(Object debuggerFrame) {
        if (!pending.isEmpty()) {
            pending.values().removeIf((p) -> p.debuggerFrame == debuggerFrame);
        }
    }

    static void discardAll() {
        pending.clear();
        quiet = 0;
    }

    // whether an expression just stepped through is being evaluated again, by its instruction
    static boolean isQuiet() {
        return quiet > 0;
    }

    private boolean isStepped(XPathContext context) {
        if (pending.isEmpty()) {
            return false;
        }
        Pending stepped = pending.get(key);
        return stepped != null && stepped.frameMap == frameMap(context) && sameItem(stepped.contextItem, context.getContextItem());
    }

    private static Object frameMap(XPathContext context) {
        StackFrame frame = context.getStackFrame();
        return frame == null ? null : frame.getStackFrameMap();
    }

    private static boolean sameItem(Item a, Item b) {
        // a node can be represented by more than one object
        return a == b || (a instanceof NodeInfo && a.equals(b));
    }

    Expression getChild() {
        return operand.getChildExpression();
    }

    @Override
    public Iterable<Operand> operands() {
        return Collections.singletonList(operand);
    }

    @Override
    public int getImplementationMethod() {
        return ITERATE_METHOD | EVALUATE_METHOD | PROCESS_METHOD;
    }

    @Override
    public ItemType getItemType() {
        return getChild().getItemType();
    }

    @Override
    public UType getStaticUType(UType contextItemType) {
        return getChild().getStaticUType(contextItemType);
    }

    @Override
    protected int computeCardinality() {
        return getChild().getCardinality();
    }

    @Override
    protected int computeSpecialProperties() {
        return getChild().getSpecialProperties();
    }

    @Override
    public String getExpressionName() {
        return getChild().getExpressionName();
    }

    @Override
    public Expression copy(RebindingMap rebindings) {
        SteppedResult copy = new SteppedResult(getChild().copy(rebindings), key, inlineFunction);
        ExpressionTool.copyLocationInfo(this, copy);
        return copy;
    }

    @Override
    public void export(ExpressionPresenter out) throws XPathException {
        getChild().export(out);
    }

    // evaluated by calling the methods below
    @Override
    public Elaborator getElaborator() {
        return new FallbackElaborator();
    }

    @Override
    public SequenceIterator iterate(XPathContext context) throws XPathException {
        if (!isStepped(context)) {
            return getChild().iterate(context);
        }
        quiet++;
        try {
            // all of it, while quiet - not lazily, as the instruction reads it
            return SequenceTool.toGroundedValue(getChild().iterate(context)).iterate();
        } finally {
            quiet--;
        }
    }

    @Override
    public Item evaluateItem(XPathContext context) throws XPathException {
        if (!isStepped(context)) {
            return getChild().evaluateItem(context);
        }
        quiet++;
        try {
            return getChild().evaluateItem(context);
        } finally {
            quiet--;
        }
    }

    @Override
    public boolean effectiveBooleanValue(XPathContext context) throws XPathException {
        if (!isStepped(context)) {
            return getChild().effectiveBooleanValue(context);
        }
        quiet++;
        try {
            return getChild().effectiveBooleanValue(context);
        } finally {
            quiet--;
        }
    }

    @Override
    public UnicodeString evaluateAsString(XPathContext context) throws XPathException {
        if (!isStepped(context)) {
            return getChild().evaluateAsString(context);
        }
        quiet++;
        try {
            return getChild().evaluateAsString(context);
        } finally {
            quiet--;
        }
    }

    @Override
    public void process(Outputter output, XPathContext context) throws XPathException {
        if (!isStepped(context)) {
            getChild().process(output, context);
            return;
        }
        quiet++;
        try {
            getChild().process(output, context);
        } finally {
            quiet--;
        }
    }
}
