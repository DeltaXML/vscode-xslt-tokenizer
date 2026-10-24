/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.util.AbstractMap;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashSet;
import java.util.Set;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import net.sf.saxon.Controller;
import net.sf.saxon.expr.Assignation;
import net.sf.saxon.expr.Expression;
import net.sf.saxon.expr.ForExpression;
import net.sf.saxon.expr.LocalBinding;
import net.sf.saxon.expr.Operand;
import net.sf.saxon.expr.Component;
import net.sf.saxon.expr.ComponentBinding;
import net.sf.saxon.expr.instruct.Actor;
import net.sf.saxon.expr.instruct.UserFunction;
import net.sf.saxon.expr.PackageData;
import net.sf.saxon.expr.StackFrame;
import net.sf.saxon.expr.XPathContext;
import net.sf.saxon.expr.instruct.GlobalVariable;
import net.sf.saxon.expr.instruct.IterateInstr;
import net.sf.saxon.expr.instruct.LocalParam;
import net.sf.saxon.expr.instruct.ParameterSet;
import net.sf.saxon.expr.instruct.SlotManager;
import net.sf.saxon.expr.sort.GroupIterator;
import net.sf.saxon.lib.NamespaceConstant;
import net.sf.saxon.om.FocusIterator;
import net.sf.saxon.om.GroundedValue;
import net.sf.saxon.om.Item;
import net.sf.saxon.om.Sequence;
import net.sf.saxon.om.StructuredQName;
import net.sf.saxon.regex.RegexIterator;
import net.sf.saxon.str.UnicodeString;
import net.sf.saxon.value.StringValue;
import net.sf.saxon.s9api.Axis;
import net.sf.saxon.s9api.QName;
import net.sf.saxon.s9api.XdmArray;
import net.sf.saxon.s9api.XdmAtomicValue;
import net.sf.saxon.s9api.XdmFunctionItem;
import net.sf.saxon.s9api.XdmItem;
import net.sf.saxon.s9api.XdmMap;
import net.sf.saxon.s9api.XdmNode;
import net.sf.saxon.s9api.XdmNodeKind;
import net.sf.saxon.s9api.XdmSequenceIterator;
import net.sf.saxon.s9api.XdmValue;
import net.sf.saxon.style.StylesheetPackage;
import net.sf.saxon.trace.Traceable;

/**
 * Presents XDM values as DAP variables. Expandable values (sequences, nodes, maps and arrays) get a
 * variablesReference whose children are only worked out when VS Code asks for them; references are only valid while
 * execution stays paused. Values are explored with the s9api classes, which (unlike Saxon's internal classes) are the
 * same in Saxon 12 and 13.
 */
final class Values {

    private static final int MAX_CHILDREN = 1000;
    private static final int MAX_TEXT = 200;

    private final List<Supplier<List<Map<String, Object>>>> references = new ArrayList<Supplier<List<Map<String, Object>>>>();

    void clear() {
        references.clear();
    }

    int register(Supplier<List<Map<String, Object>>> children) {
        references.add(children);
        return references.size();
    }

    List<Map<String, Object>> children(int reference) {
        if (reference < 1 || reference > references.size()) {
            throw new IllegalArgumentException("the variable is no longer available");
        }
        return references.get(reference - 1).get();
    }

    // ---------------------------------------------------------------- scopes

    // within an XPath expression being stepped through: its instruction's local variables, then the expression's own
    // range variables, which hide any of the same name - not the variables it references, passed to it from where
    // it's evaluated (which may be global variables), in the first slots of its stack frame (slots). Within an inline
    // function, the stack frame is the function's: its parameters - including the variables from outside it that it
    // uses, which Saxon passes to it - then its range variables; the instruction's other variables aren't shown
    Supplier<List<Map<String, Object>>> xpathLocals(final XPathContext context, final Traceable current, final int externals,
            final SlotManager slots, final XPathContext xsltContext, final Traceable xsltCurrent) {
        return () -> {
            StackFrame stackFrame = context.getStackFrame();
            boolean expressionFrame = stackFrame != null && stackFrame.getStackFrameMap() == slots;
            List<Map.Entry<StructuredQName, Sequence>> own = localVariables(context, current, expressionFrame ? externals : 0);
            Set<String> ownNames = new HashSet<String>();
            for (Map.Entry<StructuredQName, Sequence> local : own) {
                ownNames.add(local.getKey().getDisplayName());
            }
            List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
            if (expressionFrame) {
                for (Map.Entry<StructuredQName, Sequence> local : localVariables(xsltContext, xsltCurrent, 0)) {
                    if (!ownNames.contains(local.getKey().getDisplayName())) {
                        result.add(variable("$" + local.getKey().getDisplayName(), local.getValue()));
                    }
                }
            }
            for (Map.Entry<StructuredQName, Sequence> local : own) {
                result.add(variable("$" + local.getKey().getDisplayName(), local.getValue()));
            }
            if (expressionFrame) {
                for (Map.Entry<StructuredQName, Sequence> tunnel : tunnelParameters(xsltContext)) {
                    result.add(variable("$" + tunnel.getKey().getDisplayName() + " (tunnel)", tunnel.getValue()));
                }
            }
            return result;
        };
    }

    Supplier<List<Map<String, Object>>> locals(final XPathContext context, final Traceable current) {
        return () -> {
            List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
            for (Map.Entry<StructuredQName, Sequence> local : localVariables(context, current)) {
                result.add(variable("$" + local.getKey().getDisplayName(), local.getValue()));
            }
            for (Map.Entry<StructuredQName, Sequence> tunnel : tunnelParameters(context)) {
                result.add(variable("$" + tunnel.getKey().getDisplayName() + " (tunnel)", tunnel.getValue()));
            }
            return result;
        };
    }

    // the focus; and from the XSLT instruction's context (which, within an XPath expression being stepped through, is
    // that of its instruction), the current group and grouping key in xsl:for-each-group, and the captured groups in
    // xsl:analyze-string - as current-group(), current-grouping-key() and regex-group() would give them
    // xpathFocus: within an XPath expression being stepped through, the focus it's evaluated with - where that's the
    // focus, position() and last() are its instruction's; lazyPart: a part of it evaluated lazily, within a function it
    // calls - Saxon keeps only the context item for that, so position() and last() aren't known
    Supplier<List<Map<String, Object>>> focus(final XPathContext context, final XPathContext xsltContext, final FocusIterator xpathFocus, final boolean lazyPart) {
        return () -> {
            List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
            Item item = context.getContextItem();
            if (item == null) {
                result.add(text(".", "(absent)", ""));
            } else {
                result.add(variable(".", item));
                XPathContext focusContext = xpathFocus != null && context.getCurrentIterator() == xpathFocus ? xsltContext : context;
                FocusIterator iterator = focusContext.getCurrentIterator();
                if (iterator != null && lazyPart) {
                    String why = "evaluated lazily, within a function the expression calls";
                    result.add(text("position()", "(not known)", why));
                    result.add(text("last()", "(not known)", why));
                } else if (iterator != null) {
                    result.add(text("position()", String.valueOf(iterator.position()), "xs:integer"));
                    try {
                        result.add(text("last()", String.valueOf(focusContext.getLast()), "xs:integer"));
                    } catch (Exception e) {
                        // not available
                    }
                }
            }
            GroupIterator groups = xsltContext.getCurrentGroupIterator();
            if (groups != null) {
                try {
                    result.add(variable("current-group()", groups.currentGroup()));
                    result.add(variable("current-grouping-key()", groups.getCurrentGroupingKey().materialize()));
                } catch (Exception e) {
                    // not available, e.g. before the first group
                }
            }
            RegexIterator regex = xsltContext.getCurrentRegexIterator();
            // in xsl:matching-substring - not xsl:non-matching-substring, where there's no match
            if (regex != null && regex.isMatching()) {
                try {
                    // regex-group(0) is the whole match: the number of groups includes it
                    for (int i = 0; i < regex.getNumberOfGroups(); i++) {
                        UnicodeString group = regex.getRegexGroup(i);
                        result.add(variable("regex-group(" + i + ")", group == null ? StringValue.EMPTY_STRING : new StringValue(group)));
                    }
                } catch (Exception e) {
                    // not available
                }
            }
            return result;
        };
    }

    // the global variables being evaluated where execution is paused - set by the debugger, which knows from its stack
    // frames
    static volatile Supplier<Set<GlobalVariable>> evaluatingGlobals = () -> Collections.emptySet();

    // Whether a global variable that isn't evaluated yet can be evaluated now: not if it might use one being evaluated
    // - that would be a circularity, and Saxon would keep the error as that variable's value. It's known not to when
    // the global variables and functions it refers to, and those they refer to in turn, don't include one being
    // evaluated, or a template, mode, accumulator etc. (whose use depends on the data)
    private static boolean canEvaluate(GlobalVariable global, Set<GlobalVariable> evaluating) {
        if (evaluating.isEmpty()) {
            return true;
        }
        Component start = global.getDeclaringComponent();
        if (start == null || evaluating.contains(global)) {
            return false;
        }
        Set<Component> seen = new HashSet<Component>();
        Deque<Component> pending = new ArrayDeque<Component>();
        pending.add(start);
        seen.add(start);
        while (!pending.isEmpty()) {
            Component component = pending.remove();
            List<ComponentBinding> bindings = component.getComponentBindings();
            if (bindings == null) {
                continue;
            }
            for (ComponentBinding binding : bindings) {
                Component target = binding.getTarget();
                if (target == null || !seen.add(target)) {
                    continue;
                }
                Actor actor = target.getActor();
                if (actor instanceof GlobalVariable ? evaluating.contains(actor) : !(actor instanceof UserFunction)) {
                    return false;
                }
                pending.add(target);
            }
        }
        return true;
    }

    Supplier<List<Map<String, Object>>> globals(final XPathContext context) {
        return () -> {
            List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
            Controller controller = context.getController();
            Set<GlobalVariable> evaluating = evaluatingGlobals.get();
            for (GlobalVariable global : globalVariableList(context)) {
                String name = "$" + global.getVariableQName().getDisplayName();
                Sequence value = controller.getBindery(global.getPackageData()).getGlobalVariableValue(global);
                if (value == null && !canEvaluate(global, evaluating)) {
                    result.add(text(name, "(not evaluated yet)", ""));
                    continue;
                }
                try {
                    // not yet used: evaluated now, as it would be on first use
                    result.add(variable(name, value != null ? value : evaluateGlobal(global, context)));
                } catch (Exception e) {
                    result.add(text(name, "error: " + Debugger.message(e), ""));
                }
            }
            return result;
        };
    }

    // the results written so far: which one is being written to (or a temporary tree), and the end of each - each, and
    // the one being written to, with a context menu item in the Variables view to show it (see the extension's
    // xslt-xpath.showDebugOutputFromVariable)
    Supplier<List<Map<String, Object>>> output(final OutputCapture outputs, final XPathContext context) {
        return () -> {
            List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
            List<OutputCapture.Output> all = outputs.all();
            String current = context.getCurrentOutputUri();
            String writingTo = context.getTemporaryOutputState() != 0 ? "a temporary tree (e.g. an xsl:variable's content)" : null;
            for (OutputCapture.Output output : all) {
                if (writingTo == null && current != null && current.equals(output.uri)) {
                    writingTo = output.name;
                }
            }
            if (writingTo == null && !all.isEmpty() && current == null) {
                writingTo = all.get(0).name;
            }
            Json.Obj writingToItem = text("writing to", writingTo == null ? "(nothing yet)" : writingTo, "");
            boolean isWritingToOutput = false;
            for (OutputCapture.Output output : all) {
                isWritingToOutput |= output.name.equals(writingTo);
            }
            result.add(isWritingToOutput ? writingToItem.with(OUTPUT_MENU_CONTEXT, "xsltOutput") : writingToItem);
            for (OutputCapture.Output output : all) {
                String tail = output.tail(120).replaceAll("\\s+", " ");
                result.add(text(output.name, (output.length() > 120 ? "..." : "") + tail,
                        output.method + ", " + output.length() + " characters" + (output.isTruncated() ? " (truncated)" : "")).with(OUTPUT_MENU_CONTEXT, "xsltOutput"));
            }
            return result;
        };
    }

    // ---------------------------------------------------------------- variables in scope

    // keyed by display name (lexical QName), as written in XPath expressions - locals hide globals
    static Map<String, Map.Entry<StructuredQName, Sequence>> inScopeVariables(XPathContext context, Traceable current) {
        Map<String, Map.Entry<StructuredQName, Sequence>> result = new LinkedHashMap<String, Map.Entry<StructuredQName, Sequence>>();
        List<Map.Entry<StructuredQName, Sequence>> all = new ArrayList<Map.Entry<StructuredQName, Sequence>>(evaluatedGlobalVariables(context));
        all.addAll(tunnelParameters(context));
        all.addAll(localVariables(context, current));
        for (Map.Entry<StructuredQName, Sequence> variable : all) {
            result.put(variable.getKey().getDisplayName(), variable);
        }
        return result;
    }

    // the variable with this display name (lexical QName) in scope: a local variable or tunnel parameter, else a
    // global variable or parameter - evaluated now if it hasn't been used yet - or null if there's none
    // (the XSLT context and instruction: of an XPath expression being stepped through, its instruction's)
    static Map.Entry<StructuredQName, Sequence> variableNamed(XPathContext context, Traceable current, XPathContext xsltContext, Traceable xsltCurrent, String displayName) throws net.sf.saxon.trans.XPathException {
        Map.Entry<StructuredQName, Sequence> variable = inScopeVariables(context, current).get(displayName);
        if (variable == null && xsltContext != context) {
            variable = inScopeVariables(xsltContext, xsltCurrent).get(displayName);
        }
        if (variable != null) {
            return variable;
        }
        for (GlobalVariable global : globalVariableList(xsltContext)) {
            if (global.getVariableQName().getDisplayName().equals(displayName)) {
                Sequence value = xsltContext.getController().getBindery(global.getPackageData()).getGlobalVariableValue(global);
                if (value == null && !canEvaluate(global, evaluatingGlobals.get())) {
                    // an evaluation error (not IllegalStateException, which Evaluator takes as XPathEngine not working)
                    throw new net.sf.saxon.trans.XPathException("$" + displayName + " isn't evaluated yet: it might use a global variable being evaluated");
                }
                try {
                    return new AbstractMap.SimpleImmutableEntry<StructuredQName, Sequence>(global.getVariableQName(), value != null ? value : evaluateGlobal(global, xsltContext));
                } catch (Exception e) {
                    return null;
                }
            }
        }
        return null;
    }

    // as Saxon evaluates a global variable on its first use: with its own component, for the global variables it refers
    // to - not that of where execution is paused
    private static Sequence evaluateGlobal(GlobalVariable global, XPathContext context) throws net.sf.saxon.trans.XPathException {
        return global.getDeclaringComponent() != null ? global.evaluateVariable(context, global.getDeclaringComponent()) : global.evaluateVariable(context);
    }

    // The local variables in scope at an instruction or expression: those bound by an xsl:variable, or a for, let,
    // some or every in XPath, whose scope contains it - the binding's action, as compiled - with the nearest binding
    // of a name hiding any further out; and parameters - of the template or function, or xsl:iterate - which are
    // in scope throughout. Others in the stack frame aren't in scope: e.g. a variable in an xsl:if that has finished,
    // one declared later, or one from the previous iteration of an xsl:for-each. Without an expression, e.g. at a
    // template's start, only the parameters with values
    private static List<Map.Entry<StructuredQName, Sequence>> localVariables(XPathContext context, Traceable current) {
        return localVariables(context, current, 0);
    }

    // firstParameterSlot: the first slot that may be a parameter - the slots before it aren't shown
    private static List<Map.Entry<StructuredQName, Sequence>> localVariables(XPathContext context, Traceable current, int firstParameterSlot) {
        List<Map.Entry<StructuredQName, Sequence>> result = new ArrayList<Map.Entry<StructuredQName, Sequence>>();
        StackFrame frame = context.getStackFrame();
        SlotManager slots = frame == null ? null : frame.getStackFrameMap();
        if (slots == null) {
            return result;
        }
        List<StructuredQName> names = slots.getVariableMap();
        Set<String> seen = new HashSet<String>();
        // the bindings in scope, found nearest first: each enclosing binding whose action this is within
        List<Map.Entry<StructuredQName, Sequence>> bindings = new ArrayList<Map.Entry<StructuredQName, Sequence>>();
        Expression root = current instanceof Expression ? (Expression) current : null;
        if (root != null) {
            Expression child = root;
            for (Expression parent = root.getParentExpression(); parent != null; child = parent, parent = parent.getParentExpression()) {
                if (parent instanceof IterateInstr && child != ((IterateInstr) parent).getSelectExpression()) {
                    // an xsl:iterate's parameters: in scope within it - in its body and xsl:on-completion
                    List<LocalParam> params = iterateParams((IterateInstr) parent);
                    for (int i = params.size() - 1; i >= 0; i--) {
                        addLocal(bindings, seen, context, names, params.get(i).getSlotNumber(), params.get(i).getVariableQName());
                    }
                }
                if (parent instanceof Assignation && ((Assignation) parent).getAction() == child) {
                    Assignation binding = (Assignation) parent;
                    // nearest first, so a positional variable ('for $i at $pos') before the variable it counts
                    LocalBinding position = positionVariable(parent);
                    if (position != null) {
                        addLocal(bindings, seen, context, names, position.getLocalSlotNumber(), position.getVariableQName());
                    }
                    addLocal(bindings, seen, context, names, binding.getLocalSlotNumber(), binding.getVariableQName());
                }
                root = parent;
            }
        }
        // parameters: the slots that no binding uses - shown first, then the bindings in the order they're declared
        Set<Integer> bound = boundSlots(root);
        for (int slot = firstParameterSlot; slot < names.size(); slot++) {
            if (!bound.contains(slot)) {
                addParameter(result, seen, context, names, slot, names.get(slot));
            }
        }
        java.util.Collections.reverse(bindings);
        result.addAll(bindings);
        return result;
    }

    // a parameter: before its xsl:param has run - e.g. paused at the start of a named template - the value passed to it
    // (by xsl:call-template, or xsl:apply-templates or xsl:next-match with xsl:with-param)
    private static void addParameter(List<Map.Entry<StructuredQName, Sequence>> result, Set<String> seen, XPathContext context,
            List<StructuredQName> names, int slot, StructuredQName name) {
        int before = result.size();
        addLocal(result, seen, context, names, slot, name);
        ParameterSet supplied = context.getLocalParameters();
        if (result.size() == before && name != null && !isGenerated(name) && supplied != null && !seen.contains(name.getDisplayName())) {
            int index = supplied.getIndex(name);
            Sequence value = index < 0 ? null : supplied.getValue(index);
            if (value != null) {
                seen.add(name.getDisplayName());
                result.add(new AbstractMap.SimpleImmutableEntry<StructuredQName, Sequence>(name, value));
            }
        }
    }

    private static void addLocal(List<Map.Entry<StructuredQName, Sequence>> result, Set<String> seen, XPathContext context,
            List<StructuredQName> names, int slot, StructuredQName name) {
        if (name == null || isGenerated(name) || slot < 0 || slot >= names.size() || seen.contains(name.getDisplayName())) {
            return;
        }
        Sequence value;
        try {
            value = context.evaluateLocalVariable(slot);
        } catch (Exception e) {
            value = null;
        }
        if (value != null) {
            // a nearer binding of the name hides this one, even if it's not assigned yet
            seen.add(name.getDisplayName());
            result.add(new AbstractMap.SimpleImmutableEntry<StructuredQName, Sequence>(name, value));
        }
    }

    private static List<LocalParam> iterateParams(IterateInstr iterate) {
        List<LocalParam> params = new ArrayList<LocalParam>();
        if (iterate.getInitiallyExp() != null) {
            for (Operand operand : iterate.getInitiallyExp().operands()) {
                if (operand.getChildExpression() instanceof LocalParam) {
                    params.add((LocalParam) operand.getChildExpression());
                }
            }
        }
        return params;
    }

    // the positional variable of an XPath 4.0 'for $i at $pos' - not an Assignation of its own, but in scope where the
    // for expression's variable is. ForExpression.getPositionVariable() is new in Saxon 13, so it's called by reflection
    private static LocalBinding positionVariable(Expression expression) {
        if (!(expression instanceof ForExpression)) {
            return null;
        }
        try {
            Object position = expression.getClass().getMethod("getPositionVariable").invoke(expression);
            return position instanceof LocalBinding ? (LocalBinding) position : null;
        } catch (ReflectiveOperationException | RuntimeException e) {
            return null;
        }
    }

    // the slots used by the bindings in a compiled template, function or expression
    private static Set<Integer> boundSlots(Expression root) {
        Set<Integer> bound = new HashSet<Integer>();
        if (root == null) {
            return bound;
        }
        Deque<Expression> pending = new ArrayDeque<Expression>();
        pending.push(root);
        while (!pending.isEmpty()) {
            Expression expression = pending.pop();
            if (expression instanceof IterateInstr) {
                // not the template's or function's parameters
                for (LocalParam param : iterateParams((IterateInstr) expression)) {
                    bound.add(param.getSlotNumber());
                }
            }
            if (expression instanceof Assignation) {
                bound.add(((Assignation) expression).getLocalSlotNumber());
                LocalBinding position = positionVariable(expression);
                if (position != null) {
                    bound.add(position.getLocalSlotNumber());
                }
            }
            for (Operand operand : expression.operands()) {
                if (operand.getChildExpression() != null) {
                    pending.push(operand.getChildExpression());
                }
            }
        }
        return bound;
    }

    private static List<Map.Entry<StructuredQName, Sequence>> tunnelParameters(XPathContext context) {
        List<Map.Entry<StructuredQName, Sequence>> result = new ArrayList<Map.Entry<StructuredQName, Sequence>>();
        ParameterSet tunnel = context.getTunnelParameters();
        if (tunnel != null) {
            for (StructuredQName name : tunnel.getParameterNames()) {
                if (name != null) {
                    Sequence value = tunnel.getValue(tunnel.getIndex(name));
                    if (value != null) {
                        result.add(new AbstractMap.SimpleImmutableEntry<StructuredQName, Sequence>(name, value));
                    }
                }
            }
        }
        return result;
    }

    // global variables and parameters already evaluated - Saxon evaluates them on first use
    private static List<Map.Entry<StructuredQName, Sequence>> evaluatedGlobalVariables(XPathContext context) {
        List<Map.Entry<StructuredQName, Sequence>> result = new ArrayList<Map.Entry<StructuredQName, Sequence>>();
        Controller controller = context.getController();
        for (GlobalVariable global : globalVariableList(context)) {
            Sequence value = controller.getBindery(global.getPackageData()).getGlobalVariableValue(global);
            if (value != null) {
                result.add(new AbstractMap.SimpleImmutableEntry<StructuredQName, Sequence>(global.getVariableQName(), value));
            }
        }
        return result;
    }

    private static List<GlobalVariable> globalVariableList(XPathContext context) {
        List<GlobalVariable> result = new ArrayList<GlobalVariable>();
        Controller controller = context.getController();
        if (controller == null || controller.getExecutable() == null) {
            return result;
        }
        // in the component index: the stylesheet's global variables and params, and those from used packages
        PackageData pkg = controller.getExecutable().getTopLevelPackage();
        if (!(pkg instanceof StylesheetPackage)) {
            return result;
        }
        for (Component component : ((StylesheetPackage) pkg).getComponentIndex().values()) {
            if (component.getActor() instanceof GlobalVariable) {
                GlobalVariable global = (GlobalVariable) component.getActor();
                if (global.getVariableQName() != null && !isGenerated(global.getVariableQName())) {
                    result.add(global);
                }
            }
        }
        result.sort((a, b) -> a.getVariableQName().getDisplayName().compareTo(b.getVariableQName().getDisplayName()));
        return result;
    }

    // variables Saxon introduces itself, e.g. for xsl:for-each-group or optimisations
    private static boolean isGenerated(StructuredQName name) {
        String uri = name.getNamespaceUri().toString();
        return uri.equals(NamespaceConstant.SAXON_GENERATED_VARIABLE) || uri.equals(NamespaceConstant.SAXON);
    }

    // ---------------------------------------------------------------- values

    static GroundedValue ground(Sequence value) {
        try {
            return value.materialize();
        } catch (Exception e) {
            throw new IllegalStateException(Debugger.message(e), e);
        }
    }

    // a value Saxon hasn't evaluated (all of) yet, whose evaluation would run stylesheet code, is shown as such, with
    // VS Code's button to evaluate it: evaluating it to show it would run that code now, where it isn't traced - and
    // Saxon would keep the result, so it never runs where its breakpoints are. E.g. Saxon 12's fold-left passes the
    // accumulator to each call as one: the previous call - its function's body - still to be evaluated. Others, e.g.
    // a parameter's value xs:integer(@n), are evaluated to show them, as before
    Map<String, Object> variable(final String name, final Sequence value) {
        if (isUnevaluated(value)) {
            // evaluated on request - with its own function caches, as for a watch expression
            XPathContext saved = ((net.sf.saxon.value.Closure) value).getSavedXPathContext();
            int reference = register(() -> {
                try {
                    return java.util.Collections.singletonList(Evaluator.withOwnFunctionCaches(saved, () -> evaluatedVariable(name, value)));
                } catch (Exception e) {
                    return java.util.Collections.singletonList(text(name, "error: " + Debugger.message(e), ""));
                }
            });
            return text(name, "(not evaluated yet)", "").with("variablesReference", reference)
                    .with("presentationHint", Json.obj().with("lazy", true));
        }
        return evaluatedVariable(name, value);
    }

    private Map<String, Object> evaluatedVariable(String name, Sequence value) {
        XdmValue xdm;
        try {
            xdm = XdmValue.wrap(ground(value));
        } catch (Exception e) {
            return text(name, "error: " + Debugger.message(e), "");
        }
        return variable(name, xdm);
    }

    private Map<String, Object> variable(String name, final XdmValue value) {
        int size = value.size();
        if (size == 0) {
            return text(name, "()", "empty-sequence()");
        } else if (size == 1) {
            return item(name, value.itemAt(0));
        }
        int reference = register(() -> {
            List<Map<String, Object>> children = new ArrayList<Map<String, Object>>();
            int n = 0;
            for (XdmItem item : value) {
                if (++n > MAX_CHILDREN) {
                    children.add(text("...", (value.size() - MAX_CHILDREN) + " more items", ""));
                    break;
                }
                children.add(item("[" + n + "]", item));
            }
            return children;
        });
        return text(name, summary(value), "sequence of " + size + " items").with("variablesReference", reference)
                .with("indexedVariables", size);
    }

    private Json.Obj item(String name, final XdmItem item) {
        return item(name, item, true);
    }

    // withPath: a node's path is shown, as xdm:debug() shows it - for an attribute or text node in its summary, for
    // an element in its type - except as a child of an element being expanded, whose path is already shown
    private Json.Obj item(String name, final XdmItem item, boolean withPath) {
        if (isJNode(item)) {
            final XdmValue content = XdmValue.wrap((Sequence) jnodeCall(item.getUnderlyingValue(), "getContent"));
            Json.Obj variable = text(name, summary(item), "jnode()");
            List<Map<String, Object>> children = contentChildren(content);
            if (!children.isEmpty()) {
                variable.with("variablesReference", register(() -> contentChildren(content)));
            }
            return variable;
        }
        if (item instanceof XdmNode) {
            final XdmNode node = (XdmNode) item;
            XdmNodeKind nodeKind = node.getNodeKind();
            boolean pathInSummary = withPath && (nodeKind == XdmNodeKind.ATTRIBUTE || nodeKind == XdmNodeKind.TEXT);
            boolean pathInType = withPath && !pathInSummary && nodeKind != XdmNodeKind.DOCUMENT;
            Json.Obj variable = text(name, pathInSummary ? pathSummary(node) : nodeSummary(node), nodeType(node, pathInType));
            XdmNodeKind kind = node.getNodeKind();
            if (kind == XdmNodeKind.ELEMENT || kind == XdmNodeKind.DOCUMENT) {
                variable.with("variablesReference", register(() -> nodeChildren(node)));
            }
            return variable;
        } else if (item instanceof XdmMap) {
            final XdmMap map = (XdmMap) item;
            Json.Obj variable = text(name, summary(map), "map(*)");
            if (map.mapSize() > 0) {
                variable.with("variablesReference", register(() -> {
                    List<Map<String, Object>> children = new ArrayList<Map<String, Object>>();
                    for (XdmAtomicValue key : map.keySet()) {
                        children.add(variable(atomicSummary(key), map.get(key)));
                    }
                    return children;
                }));
            }
            return variable;
        } else if (item instanceof XdmArray) {
            final XdmArray array = (XdmArray) item;
            Json.Obj variable = text(name, summary(array), "array(*)");
            if (array.arrayLength() > 0) {
                variable.with("variablesReference", register(() -> {
                    List<Map<String, Object>> children = new ArrayList<Map<String, Object>>();
                    List<XdmValue> members = array.asList();
                    for (int i = 0; i < members.size(); i++) {
                        children.add(variable("[" + (i + 1) + "]", members.get(i)));
                    }
                    return children;
                })).with("indexedVariables", array.arrayLength());
            }
            return variable;
        } else if (item instanceof XdmFunctionItem) {
            return text(name, summary(item), "function(*)");
        } else if (item instanceof XdmAtomicValue) {
            return text(name, atomicSummary((XdmAtomicValue) item), typeName(((XdmAtomicValue) item).getTypeName()));
        }
        return text(name, summary(item), item.getClass().getSimpleName());
    }

    // a partially applied function, as it was written - e.g. f:add(?, 10) - or null for another function item, or
    // if its parts can't be read: Saxon's CurriedFunction has the function and the values bound to its arguments (null
    // for a placeholder), in private fields with the same names in Saxon 12 and 13. A value Saxon hasn't evaluated
    // yet isn't evaluated for this: it's shown as ...
    private static String partialApplication(Object function) {
        if (function == null || !function.getClass().getSimpleName().equals("CurriedFunction")) {
            return null;
        }
        try {
            java.lang.reflect.Field targetField = function.getClass().getDeclaredField("targetFunction");
            java.lang.reflect.Field boundField = function.getClass().getDeclaredField("boundValues");
            targetField.setAccessible(true);
            boundField.setAccessible(true);
            net.sf.saxon.om.FunctionItem target = (net.sf.saxon.om.FunctionItem) targetField.get(function);
            net.sf.saxon.om.Sequence[] bound = (net.sf.saxon.om.Sequence[]) boundField.get(function);
            String name = partialApplication(target);
            if (name == null) {
                net.sf.saxon.om.StructuredQName targetName = target.getFunctionName();
                name = targetName == null || net.sf.saxon.lib.NamespaceConstant.ANONYMOUS.equals(targetName.getNamespaceUri().toString()) ?
                        "function" : targetName.getDisplayName();
            }
            StringBuilder sb = new StringBuilder(name).append('(');
            for (int i = 0; i < bound.length; i++) {
                sb.append(i > 0 ? ", " : "");
                if (bound[i] == null) {
                    sb.append('?');
                } else if (bound[i] instanceof net.sf.saxon.om.GroundedValue) {
                    sb.append(summary(XdmValue.wrap((net.sf.saxon.om.GroundedValue) bound[i])));
                } else {
                    sb.append("...");
                }
            }
            return sb.append(')').toString();
        } catch (ReflectiveOperationException | RuntimeException e) {
            return null;
        }
    }

    // a JNode's value, expanded: a map's entries, an array's members, or the items of a sequence
    private List<Map<String, Object>> contentChildren(XdmValue content) {
        List<Map<String, Object>> children = new ArrayList<Map<String, Object>>();
        if (content.size() == 1 && content.itemAt(0) instanceof XdmMap) {
            XdmMap map = (XdmMap) content.itemAt(0);
            for (XdmAtomicValue key : map.keySet()) {
                children.add(variable(atomicSummary(key), map.get(key)));
            }
        } else if (content.size() == 1 && content.itemAt(0) instanceof XdmArray) {
            List<XdmValue> members = ((XdmArray) content.itemAt(0)).asList();
            for (int i = 0; i < members.size(); i++) {
                children.add(variable("[" + (i + 1) + "]", members.get(i)));
            }
        } else if (content.size() > 1) {
            int n = 0;
            for (XdmItem item : content) {
                children.add(item("[" + (++n) + "]", item));
            }
        }
        return children;
    }

    // XPath 4.0 JNodes - a node in a tree of maps and arrays, e.g. from jtree() - are new in Saxon 13: found by
    // reflection, so the debugger still runs with Saxon 12
    private static final Class<?> JNODE_CLASS = classNamed("net.sf.saxon.ma.jnode.JNode");

    private static Class<?> classNamed(String name) {
        try {
            return Class.forName(name);
        } catch (ClassNotFoundException | LinkageError e) {
            return null;
        }
    }

    private static boolean isJNode(XdmItem item) {
        return JNODE_CLASS != null && JNODE_CLASS.isInstance(item.getUnderlyingValue());
    }

    private static Object jnodeCall(Object jnode, String method) {
        try {
            return jnode.getClass().getMethod(method).invoke(jnode);
        } catch (ReflectiveOperationException | RuntimeException e) {
            return null;
        }
    }

    // e.g. '/orders/*[1] map{2 entries}', or for the root of the tree, '/ map{1 entry}' - its path, as xdm:debug()
    // shows it, then its value
    private static String jnodeSummary(XdmItem item) {
        Object jnode = item.getUnderlyingValue();
        Object content = jnodeCall(jnode, "getContent");
        String value = content instanceof Sequence ? summary(XdmValue.wrap((Sequence) content)) : "";
        Deque<String> steps = new ArrayDeque<String>();
        for (Object node = jnode; node != null && jnodeCall(node, "getParent") != null; node = jnodeCall(node, "getParent")) {
            Object selector = jnodeCall(node, "getSelector");
            String key = selector == null ? "?" : ((net.sf.saxon.value.AtomicValue) selector).getStringValue();
            boolean isMember = node.getClass().getSimpleName().contains("ArrayMember");
            steps.push(isMember ? "*[" + key + "]" : key.matches("[\\p{L}_][\\p{L}\\p{N}_.\\-]*") ? key : "get('" + key.replace("'", "''") + "')");
        }
        return "/" + String.join("/", steps) + " " + value;
    }

    private List<Map<String, Object>> nodeChildren(XdmNode node) {
        List<Map<String, Object>> children = new ArrayList<Map<String, Object>>();
        for (XdmSequenceIterator<XdmNode> attributes = node.axisIterator(Axis.ATTRIBUTE); attributes.hasNext(); ) {
            XdmNode attribute = attributes.next();
            children.add(item("@" + attribute.getNodeName(), attribute, false));
        }
        Map<String, Integer> counts = new HashMap<String, Integer>();
        int n = 0;
        for (XdmSequenceIterator<XdmNode> nodes = node.axisIterator(Axis.CHILD); nodes.hasNext(); ) {
            XdmNode child = nodes.next();
            if (child.getNodeKind() == XdmNodeKind.TEXT && child.getStringValue().trim().isEmpty()) {
                continue;
            }
            if (++n > MAX_CHILDREN) {
                children.add(text("...", "more child nodes", ""));
                break;
            }
            String step = child.getNodeKind() == XdmNodeKind.ELEMENT ? child.getNodeName().toString() :
                    child.getNodeKind() == XdmNodeKind.TEXT ? "text()" :
                    child.getNodeKind() == XdmNodeKind.COMMENT ? "comment()" : "processing-instruction()";
            Integer count = counts.get(step);
            count = count == null ? 1 : count + 1;
            counts.put(step, count);
            children.add(item(step + "[" + count + "]", child, false));
        }
        return children;
    }

    // ---------------------------------------------------------------- one-line summaries

    // the value as text for logpoints - like xsl:value-of, atomic values and nodes as their string values
    static String logText(XdmValue value) {
        StringBuilder sb = new StringBuilder();
        for (XdmItem item : value) {
            if (sb.length() > 0) {
                sb.append(' ');
            }
            sb.append(item instanceof XdmAtomicValue || item instanceof XdmNode ? item.getStringValue() : summary(item));
        }
        return sb.toString();
    }

    static String summary(XdmValue value) {
        if (value.size() == 1) {
            XdmItem item = value.itemAt(0);
            if (isJNode(item)) {
                return jnodeSummary(item);
            } else if (item instanceof XdmNode) {
                return nodeSummary((XdmNode) item);
            } else if (item instanceof XdmMap) {
                XdmMap map = (XdmMap) item;
                return "map{" + map.mapSize() + (map.mapSize() == 1 ? " entry}" : " entries}");
            } else if (item instanceof XdmArray) {
                int length = ((XdmArray) item).arrayLength();
                return "array{" + length + (length == 1 ? " member}" : " members}");
            } else if (item instanceof XdmFunctionItem) {
                XdmFunctionItem function = (XdmFunctionItem) item;
                String partial = partialApplication(function.getUnderlyingValue());
                if (partial != null) {
                    return partial;
                }
                QName name = function.getName();
                // an inline function: Saxon names it, in its anonymous namespace - function-name() is ()
                boolean anonymous = name == null || net.sf.saxon.lib.NamespaceConstant.ANONYMOUS.equals(name.getNamespace());
                return (anonymous ? "function" : name.toString()) + "#" + function.getArity();
            } else if (item instanceof XdmAtomicValue) {
                return atomicSummary((XdmAtomicValue) item);
            }
            return truncate(item.toString());
        }
        StringBuilder sb = new StringBuilder("(");
        int n = 0;
        for (XdmItem item : value) {
            if (n > 0) {
                sb.append(", ");
            }
            if (++n > 3 || sb.length() > MAX_TEXT) {
                sb.append("...");
                break;
            }
            sb.append(summary(item));
        }
        return sb.append(')').toString();
    }

    private static String atomicSummary(XdmAtomicValue value) {
        String text = value.getStringValue();
        String type = value.getPrimitiveTypeName().getLocalName();
        boolean isString = type.equals("string") || type.equals("untypedAtomic") || type.equals("anyURI");
        return isString ? '"' + truncate(text) + '"' : truncate(text);
    }

    // an attribute or text node, after its path - e.g. '/order/@id="A-100"', '/order/line/text() "widget"'
    private static String pathSummary(XdmNode node) {
        String path = nodePath(node);
        return node.getNodeKind() == XdmNodeKind.ATTRIBUTE ? path + "=\"" + truncate(node.getStringValue(), 40) + '"' : path + " " + nodeSummary(node);
    }

    // a node's path, as xdm:debug() shows it (xdm:path in xdm-view-common.xsl): a step for each ancestor - a name,
    // text(), comment() or processing-instruction(target), with a position only where a sibling has the same step,
    // and @name for an attribute - starting with '/' within a document
    static String nodePath(XdmNode node) {
        Deque<String> steps = new ArrayDeque<String>();
        for (XdmNode n = node; n != null; n = n.getParent()) {
            steps.push(n.getNodeKind() == XdmNodeKind.DOCUMENT ? "" : step(n));
        }
        return steps.size() == 1 && node.getNodeKind() == XdmNodeKind.DOCUMENT ? "/" : String.join("/", steps);
    }

    private static String step(XdmNode node) {
        XdmNodeKind kind = node.getNodeKind();
        if (kind == XdmNodeKind.ATTRIBUTE) {
            return "@" + node.getNodeName();
        } else if (kind == XdmNodeKind.NAMESPACE) {
            return "namespace::" + (node.getNodeName() == null || node.getNodeName().getLocalName().isEmpty() ? "*default*" : node.getNodeName().getLocalName());
        }
        String label = kind == XdmNodeKind.ELEMENT ? node.getNodeName().toString() : kind == XdmNodeKind.TEXT ? "text()" :
                kind == XdmNodeKind.COMMENT ? "comment()" : "processing-instruction(" + node.getNodeName() + ")";
        XdmNode parent = node.getParent();
        if (parent == null) {
            return label;
        }
        int position = 0;
        int same = 0;
        for (XdmSequenceIterator<XdmNode> siblings = parent.axisIterator(Axis.CHILD); siblings.hasNext(); ) {
            XdmNode sibling = siblings.next();
            if (sibling.getNodeKind() == kind && (kind != XdmNodeKind.ELEMENT && kind != XdmNodeKind.PROCESSING_INSTRUCTION ||
                    sibling.getNodeName().equals(node.getNodeName()))) {
                same++;
                if (sibling.equals(node)) {
                    position = same;
                }
            }
        }
        return same > 1 ? label + "[" + position + "]" : label;
    }

    private static String nodeSummary(XdmNode node) {
        switch (node.getNodeKind()) {
            case DOCUMENT:
                return "document-node()" + (node.getBaseURI() != null ? " " + fileName(node.getBaseURI().toString()) : "");
            case ELEMENT: {
                StringBuilder sb = new StringBuilder("<").append(node.getNodeName());
                int n = 0;
                for (XdmSequenceIterator<XdmNode> attributes = node.axisIterator(Axis.ATTRIBUTE); attributes.hasNext(); ) {
                    XdmNode attribute = attributes.next();
                    if (++n > 3) {
                        sb.append(" ...");
                        break;
                    }
                    sb.append(' ').append(attribute.getNodeName()).append("=\"").append(truncate(attribute.getStringValue(), 40)).append('"');
                }
                return sb.append(node.axisIterator(Axis.CHILD).hasNext() ? ">" : "/>").toString();
            }
            case ATTRIBUTE:
                return node.getNodeName() + "=\"" + truncate(node.getStringValue()) + '"';
            case TEXT:
                return '"' + truncate(node.getStringValue().replaceAll("\\s+", " ")) + '"';
            case COMMENT:
                return "<!--" + truncate(node.getStringValue()) + "-->";
            case PROCESSING_INSTRUCTION:
                return "<?" + node.getNodeName() + " " + truncate(node.getStringValue()) + "?>";
            case NAMESPACE:
                return "xmlns" + (node.getNodeName() == null || node.getNodeName().getLocalName().isEmpty() ? "" : ":" + node.getNodeName()) +
                        "=\"" + node.getStringValue() + '"';
            default:
                return truncate(node.toString());
        }
    }

    private static String nodeType(XdmNode node) {
        return nodeType(node, false);
    }

    // e.g. 'element() /orders/order[1] line 3'
    private static String nodeType(XdmNode node, boolean withPath) {
        String kind;
        switch (node.getNodeKind()) {
            case DOCUMENT: kind = "document-node()"; break;
            case ELEMENT: kind = "element()"; break;
            case ATTRIBUTE: kind = "attribute()"; break;
            case TEXT: kind = "text()"; break;
            case COMMENT: kind = "comment()"; break;
            case PROCESSING_INSTRUCTION: kind = "processing-instruction()"; break;
            default: kind = "namespace-node()";
        }
        int line = node.getLineNumber();
        String path = withPath ? " " + nodePath(node) : "";
        return line > 0 && node.getNodeKind() != XdmNodeKind.DOCUMENT ? kind + path + " line " + line : kind + path;
    }

    private static String typeName(QName type) {
        if (type == null) {
            return "";
        }
        return NamespaceConstant.SCHEMA.equals(type.getNamespace()) ? "xs:" + type.getLocalName() : type.getClarkName();
    }

    private static String fileName(String uri) {
        int slash = uri.lastIndexOf('/');
        return slash >= 0 ? uri.substring(slash + 1) : uri;
    }

    private static String truncate(String text) {
        return truncate(text, MAX_TEXT);
    }

    private static String truncate(String text, int max) {
        return text.length() > max ? text.substring(0, max) + "..." : text;
    }

    // a variable's context for the menus of VS Code's Variables view - its 'debugProtocolVariableMenuContext'
    private static final String OUTPUT_MENU_CONTEXT = "__vscodeVariableMenuContext";

    // a lazily evaluated value (a Closure) whose expression runs stylesheet code, and that Saxon hasn't read in full: a
    // MemoClosure not started, or partly read - its MemoSequence's state is private (the same in Saxon 12 and 13); any
    // other Closure evaluates its expression again each time it's read
    static boolean isUnevaluated(Sequence value) {
        if (!(value instanceof net.sf.saxon.value.Closure) || !runsStylesheetCode(((net.sf.saxon.value.Closure) value).getExpression())) {
            return false;
        }
        if (!(value instanceof net.sf.saxon.value.MemoClosure)) {
            return true;
        }
        Sequence read = ((net.sf.saxon.value.MemoClosure) value).getSequenceAsIs();
        if (read == null) {
            return true;
        }
        if (read instanceof GroundedValue || !(read instanceof net.sf.saxon.om.MemoSequence)) {
            return false;
        }
        try {
            java.lang.reflect.Field state = net.sf.saxon.om.MemoSequence.class.getDeclaredField("state");
            state.setAccessible(true);
            String name = String.valueOf(state.get(read));
            return !(name.equals("ALL_READ") || name.equals("EMPTY") || name.equals("ERROR"));
        } catch (ReflectiveOperationException | RuntimeException e) {
            return true;
        }
    }

    private static final Set<String> CALLING_EXPRESSIONS = new HashSet<String>(java.util.Arrays.asList(
            "UserFunctionCall", "DynamicFunctionCall", "UserFunctionReference", "FunctionLiteral", "PartialApply", "DynamicPartialApply"));

    // whether evaluating the expression runs stylesheet code: it calls a stylesheet function or a function item (e.g.
    // passes one to fold-left), or it has more than one traced part - e.g. it's an inline function's body
    private static boolean runsStylesheetCode(Expression expression) {
        if (expression == null) {
            return false;
        }
        int traced = 0;
        Deque<Expression> pending = new ArrayDeque<Expression>();
        pending.push(expression);
        while (!pending.isEmpty()) {
            Expression e = pending.pop();
            if (CALLING_EXPRESSIONS.contains(e.getClass().getSimpleName())) {
                return true;
            }
            if (e instanceof net.sf.saxon.expr.instruct.TraceExpression && ++traced > 1) {
                return true;
            }
            for (Operand operand : e.operands()) {
                if (operand.getChildExpression() != null) {
                    pending.push(operand.getChildExpression());
                }
            }
        }
        return false;
    }

    private static Json.Obj text(String name, String value, String type) {
        return Json.obj().with("name", name).with("value", value).with("type", type).with("variablesReference", 0);
    }
}
