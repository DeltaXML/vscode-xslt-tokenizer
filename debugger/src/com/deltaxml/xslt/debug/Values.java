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
import net.sf.saxon.expr.PackageData;
import net.sf.saxon.expr.StackFrame;
import net.sf.saxon.expr.XPathContext;
import net.sf.saxon.expr.instruct.GlobalVariable;
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
    Supplier<List<Map<String, Object>>> focus(final XPathContext context, final XPathContext xsltContext) {
        return () -> {
            List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
            Item item = context.getContextItem();
            if (item == null) {
                result.add(text(".", "(absent)", ""));
            } else {
                result.add(variable(".", item));
                FocusIterator iterator = context.getCurrentIterator();
                if (iterator != null) {
                    result.add(text("position()", String.valueOf(iterator.position()), "xs:integer"));
                    try {
                        result.add(text("last()", String.valueOf(context.getLast()), "xs:integer"));
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
            if (regex != null) {
                try {
                    // regex-group(0) is the whole match - none for xsl:non-matching-substring
                    for (int i = 0; i <= regex.getNumberOfGroups(); i++) {
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

    Supplier<List<Map<String, Object>>> globals(final XPathContext context) {
        return () -> {
            List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
            Controller controller = context.getController();
            for (GlobalVariable global : globalVariableList(context)) {
                String name = "$" + global.getVariableQName().getDisplayName();
                Sequence value = controller.getBindery(global.getPackageData()).getGlobalVariableValue(global);
                try {
                    // not yet used: evaluated now, as it would be on first use
                    result.add(variable(name, value != null ? value : global.evaluateVariable(context)));
                } catch (Exception e) {
                    result.add(text(name, "error: " + Debugger.message(e), ""));
                }
            }
            return result;
        };
    }

    // the results written so far: which one is being written to (or a temporary tree), and the end of each
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
            result.add(text("writing to", writingTo == null ? "(nothing yet)" : writingTo, ""));
            for (OutputCapture.Output output : all) {
                String tail = output.tail(120).replaceAll("\\s+", " ");
                result.add(text(output.name, (output.length() > 120 ? "..." : "") + tail,
                        output.method + ", " + output.length() + " characters" + (output.isTruncated() ? " (truncated)" : "")));
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
    static Map.Entry<StructuredQName, Sequence> variableNamed(XPathContext context, Traceable current, XPathContext xsltContext, Traceable xsltCurrent, String displayName) {
        Map.Entry<StructuredQName, Sequence> variable = inScopeVariables(context, current).get(displayName);
        if (variable == null && xsltContext != context) {
            variable = inScopeVariables(xsltContext, xsltCurrent).get(displayName);
        }
        if (variable != null) {
            return variable;
        }
        for (GlobalVariable global : globalVariableList(xsltContext)) {
            if (global.getVariableQName().getDisplayName().equals(displayName)) {
                try {
                    return new AbstractMap.SimpleImmutableEntry<StructuredQName, Sequence>(global.getVariableQName(), global.evaluateVariable(xsltContext));
                } catch (Exception e) {
                    return null;
                }
            }
        }
        return null;
    }

    // The local variables in scope at an instruction or expression: those bound by an xsl:variable, or a for, let,
    // some or every in XPath, whose scope contains it - the binding's action, as compiled - with the nearest binding
    // of a name hiding any further out; and parameters - of the template or function, or xsl:iterate - which are
    // in scope throughout. Others in the stack frame aren't in scope: e.g. a variable in an xsl:if that has finished,
    // one declared later, or one from the previous iteration of an xsl:for-each. Without an expression, e.g. at a
    // template's start, only the parameters with values
    private static List<Map.Entry<StructuredQName, Sequence>> localVariables(XPathContext context, Traceable current) {
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
        for (int slot = 0; slot < names.size(); slot++) {
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

    Map<String, Object> variable(String name, Sequence value) {
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
        if (item instanceof XdmNode) {
            final XdmNode node = (XdmNode) item;
            Json.Obj variable = text(name, nodeSummary(node), nodeType(node));
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

    private List<Map<String, Object>> nodeChildren(XdmNode node) {
        List<Map<String, Object>> children = new ArrayList<Map<String, Object>>();
        for (XdmSequenceIterator<XdmNode> attributes = node.axisIterator(Axis.ATTRIBUTE); attributes.hasNext(); ) {
            XdmNode attribute = attributes.next();
            children.add(item("@" + attribute.getNodeName(), attribute));
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
            children.add(item(step + "[" + count + "]", child));
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
            if (item instanceof XdmNode) {
                return nodeSummary((XdmNode) item);
            } else if (item instanceof XdmMap) {
                XdmMap map = (XdmMap) item;
                return "map{" + map.mapSize() + (map.mapSize() == 1 ? " entry}" : " entries}");
            } else if (item instanceof XdmArray) {
                int length = ((XdmArray) item).arrayLength();
                return "array{" + length + (length == 1 ? " member}" : " members}");
            } else if (item instanceof XdmFunctionItem) {
                XdmFunctionItem function = (XdmFunctionItem) item;
                QName name = function.getName();
                return (name == null ? "function" : name.toString()) + "#" + function.getArity();
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
        return line > 0 && node.getNodeKind() != XdmNodeKind.DOCUMENT ? kind + " line " + line : kind;
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

    private static Json.Obj text(String name, String value, String type) {
        return Json.obj().with("name", name).with("value", value).with("type", type).with("variablesReference", 0);
    }
}
