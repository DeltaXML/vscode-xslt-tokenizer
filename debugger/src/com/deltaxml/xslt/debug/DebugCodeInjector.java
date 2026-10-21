/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import net.sf.saxon.expr.Expression;
import net.sf.saxon.expr.Literal;
import net.sf.saxon.expr.instruct.TraceExpression;
import net.sf.saxon.expr.Operand;
import net.sf.saxon.expr.parser.Loc;
import net.sf.saxon.expr.sort.SortKeyDefinition;
import net.sf.saxon.trace.TraceableComponent;
import net.sf.saxon.expr.parser.XPathParser;
import net.sf.saxon.om.NodeInfo;
import net.sf.saxon.s9api.Location;
import net.sf.saxon.trace.XSLTTraceCodeInjector;
import net.sf.saxon.tree.AttributeLocation;

/**
 * Saxon's XSLT trace code injector, which also traces each xsl:sequence instruction.
 *
 * An xsl:sequence compiles to just its select expression, with no instruction of its own, and Saxon's injector
 * decides whether an expression is an instruction from where it is - so it only traces an xsl:sequence in some
 * places (e.g. as a function body, or a template's only instruction), not, for example, as one of several. Here, an
 * xsl:sequence's top-level select expression is traced too - so it can be stopped at, and a multi-line select
 * stepped through. (Other instructions are traced by Saxon - except those it evaluates when compiling, e.g. an
 * xsl:if with a constant test.)
 */
class DebugCodeInjector extends XSLTTraceCodeInjector {

    @Override
    public Expression inject(Expression expression) {
        Location location = expression.getLocation();
        Expression parent = expression.getParentExpression();
        Location parentLocation = parent == null ? null : parent.getLocation();
        NodeInfo selectElement = xslSelect(location);
        if (selectElement != null) {
            // an XSLT 4.0 xsl:select's content: its top-level expression is traced at the xsl:select element - Saxon
            // traces only some kinds of expression, at their own location within the content. Its parts aren't
            // traced: they're stopped at when the expression is stepped through, as for a multi-line attribute
            if (xslSelect(parentLocation) == selectElement) {
                return expression;
            }
            // the TraceListener is given the wrapped expression, so that has the element's location (its parts keep
            // their own)
            Loc elementLocation = new Loc(selectElement.getSystemId(), selectElement.getLineNumber(), selectElement.getColumnNumber());
            expression.setLocation(elementLocation);
            TraceExpression trace = new TraceExpression(expression);
            trace.setRetainedStaticContext(expression.getRetainedStaticContext());
            trace.setLocation(elementLocation);
            return trace;
        }
        Expression injected = super.inject(expression);
        if (injected instanceof TraceExpression || Literal.isEmptySequence(expression)) {
            return injected;
        }
        AttributeLocation select = tracedAttribute(location);
        if (select != null) {
            // e.g. an xsl:sequence's select: its top-level expression, whose parent isn't part of the same attribute -
            // or an xsl:when's test, a condition of its xsl:choose (which Saxon 13 gives its first test's location)
            AttributeLocation parentSelect = tracedAttribute(parentLocation);
            boolean isTopLevel = parentSelect == null || !sameLocation(parentSelect, select) || parent.getClass().getSimpleName().equals("Choose");
            return isTopLevel ? new TraceExpression(expression) : injected;
        }
        return injected;
    }

    private static boolean sameLocation(Location a, Location b) {
        return a == b || (a.getLineNumber() == b.getLineNumber() && a.getColumnNumber() == b.getColumnNumber() &&
                java.util.Objects.equals(a.getSystemId(), b.getSystemId()));
    }

    // a compiled template, function or global variable: its sort keys - which aren't passed to inject() - are traced
    // at their xsl:sort, so they can be stopped at for each item sorted, and a multi-line select stepped through
    @Override
    public void process(TraceableComponent component) {
        if (component.getBody() != null) {
            traceSortKeys(component.getBody());
        }
        super.process(component);
    }

    private static void traceSortKeys(Expression expression) {
        for (Operand operand : expression.operands()) {
            if (operand.getChildExpression() != null) {
                traceSortKeys(operand.getChildExpression());
            }
        }
        if (expression instanceof SortKeyDefinition) {
            SortKeyDefinition sortKey = (SortKeyDefinition) expression;
            Expression key = sortKey.getSortKey();
            Location location = key == null ? null : key.getLocation();
            Location attribute = location instanceof XPathParser.NestedLocation ? ((XPathParser.NestedLocation) location).getContainingLocation() : location;
            if (key != null && !(key instanceof TraceExpression) && attribute instanceof AttributeLocation && isSortSelect((AttributeLocation) attribute)) {
                // the TraceListener is given the wrapped expression: so that's at the xsl:sort's start tag
                key.setLocation(attribute);
                TraceExpression trace = new TraceExpression(key);
                trace.setRetainedStaticContext(key.getRetainedStaticContext());
                trace.setLocation(attribute);
                sortKey.setSortKey(trace, sortKey.isSetContextForSortKey());
            }
        }
    }

    private static boolean isSortSelect(AttributeLocation attribute) {
        return attribute.getElementName() != null && attribute.getAttributeName() != null &&
                "sort".equals(attribute.getElementName().getLocalPart()) &&
                "http://www.w3.org/1999/XSL/Transform".equals(attribute.getElementName().getNamespaceUri().toString()) &&
                "select".equals(attribute.getAttributeName().getLocalPart());
    }

    // the xsl:select element (XSLT 4.0) whose content an expression is part of, if it is
    private static NodeInfo xslSelect(Location location) {
        Location containing = location instanceof XPathParser.NestedLocation ? ((XPathParser.NestedLocation) location).getContainingLocation() : null;
        if (containing instanceof NodeInfo) {
            NodeInfo element = (NodeInfo) containing;
            if ("select".equals(element.getLocalPart()) && "http://www.w3.org/1999/XSL/Transform".equals(element.getNamespaceUri().toString())) {
                return element;
            }
        }
        return null;
    }

    // the attributes whose expressions Saxon's injector doesn't trace, as element/attribute: they're traced where
    // they're evaluated - an xsl:when's test only if it's reached. (Not xsl:with-param's select: it's often evaluated
    // lazily, within the template it's passed to - so it's stepped through with the instruction it's in, see
    // BreakableLines)
    private static final java.util.Set<String> TRACED_ATTRIBUTES = new java.util.HashSet<String>(java.util.Arrays.asList(
            "sequence/select", "on-completion/select", "when/test", "map-entry/key", "map-entry/select"));

    // the attribute (one of TRACED_ATTRIBUTES) that an expression is part of, if it is
    private static AttributeLocation tracedAttribute(Location location) {
        Location containing = location instanceof XPathParser.NestedLocation ? ((XPathParser.NestedLocation) location).getContainingLocation() : location;
        if (containing instanceof AttributeLocation) {
            AttributeLocation attribute = (AttributeLocation) containing;
            if (attribute.getElementName() != null && attribute.getAttributeName() != null &&
                    TRACED_ATTRIBUTES.contains(attribute.getElementName().getLocalPart() + "/" + attribute.getAttributeName().getLocalPart()) &&
                    "http://www.w3.org/1999/XSL/Transform".equals(attribute.getElementName().getNamespaceUri().toString())) {
                return attribute;
            }
        }
        return null;
    }
}
