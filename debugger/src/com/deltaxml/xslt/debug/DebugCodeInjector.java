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
import net.sf.saxon.expr.parser.Loc;
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
        AttributeLocation select = sequenceSelect(location);
        if (select != null) {
            // an xsl:sequence's select: its top-level expression, whose parent isn't part of the same select
            AttributeLocation parentSelect = sequenceSelect(parentLocation);
            boolean isTopLevel = parentSelect == null || !sameLocation(parentSelect, select);
            return isTopLevel ? new TraceExpression(expression) : injected;
        }
        return injected;
    }

    private static boolean sameLocation(Location a, Location b) {
        return a == b || (a.getLineNumber() == b.getLineNumber() && a.getColumnNumber() == b.getColumnNumber() &&
                java.util.Objects.equals(a.getSystemId(), b.getSystemId()));
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

    // the xsl:sequence select attribute an expression is part of, if it is
    private static AttributeLocation sequenceSelect(Location location) {
        Location containing = location instanceof XPathParser.NestedLocation ? ((XPathParser.NestedLocation) location).getContainingLocation() : location;
        if (containing instanceof AttributeLocation) {
            AttributeLocation attribute = (AttributeLocation) containing;
            if (attribute.getElementName() != null && attribute.getAttributeName() != null &&
                    "sequence".equals(attribute.getElementName().getLocalPart()) &&
                    "http://www.w3.org/1999/XSL/Transform".equals(attribute.getElementName().getNamespaceUri().toString()) &&
                    "select".equals(attribute.getAttributeName().getLocalPart())) {
                return attribute;
            }
        }
        return null;
    }
}
