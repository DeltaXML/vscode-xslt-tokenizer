/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.util.Iterator;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import net.sf.saxon.expr.Expression;
import net.sf.saxon.expr.XPathContext;
import net.sf.saxon.expr.parser.RetainedStaticContext;
import net.sf.saxon.om.Item;
import net.sf.saxon.om.NamespaceUri;
import net.sf.saxon.om.Sequence;
import net.sf.saxon.om.StructuredQName;
import net.sf.saxon.s9api.Processor;
import net.sf.saxon.s9api.QName;
import net.sf.saxon.s9api.SaxonApiException;
import net.sf.saxon.s9api.XPathCompiler;
import net.sf.saxon.s9api.XPathSelector;
import net.sf.saxon.s9api.XdmItem;
import net.sf.saxon.s9api.XdmValue;
import net.sf.saxon.trace.Traceable;
import net.sf.saxon.trace.TraceableComponent;

/**
 * Evaluates XPath expressions (watch expressions, the Debug Console, hovers, breakpoint conditions and logpoints)
 * where execution is paused: with the instruction's in-scope namespaces, the variables in scope and the context item.
 * Stylesheet functions aren't available.
 */
final class Evaluator {

    private static final Pattern VARIABLE_REFERENCE = Pattern.compile("\\$\\s*((?:[\\p{L}_][\\p{L}\\p{N}_.\\-]*:)?[\\p{L}_][\\p{L}\\p{N}_.\\-]*)");

    private Evaluator() { }

    // false once XPathEngine (which uses Saxon's internal classes) turns out not to work with this Saxon version
    private static boolean engineWorks = true;

    // context: for the variables in scope and the context item; xsltContext: for the stylesheet's functions and
    // global variables, and current() etc. - the same, except within an XPath expression being stepped through
    static XdmValue evaluate(Traceable instruction, XPathContext context, XPathContext xsltContext, String xpath) throws Exception {
        if (engineWorks) {
            try {
                // with the stylesheet's functions, and current() etc.
                return XdmValue.wrap(XPathEngine.evaluate(xpath, instruction, context, xsltContext));
            } catch (LinkageError | ReflectiveOperationException | IllegalStateException e) {
                engineWorks = false;
            }
        }
        return selector(instruction, context, xpath).evaluate();
    }

    static boolean effectiveBooleanValue(Traceable instruction, XPathContext context, XPathContext xsltContext, String xpath) throws Exception {
        if (engineWorks) {
            // the newline ends any trailing XPath comment
            XdmValue value = evaluate(instruction, context, xsltContext, "boolean((" + xpath + "\n))");
            return value.size() == 1 && Boolean.parseBoolean(value.itemAt(0).getStringValue());
        }
        return selector(instruction, context, xpath).effectiveBooleanValue();
    }

    private static XPathSelector selector(Traceable instruction, XPathContext context, String xpath) throws SaxonApiException {
        XPathCompiler compiler = new Processor(context.getConfiguration()).newXPathCompiler();
        RetainedStaticContext staticContext = staticContext(instruction);
        if (staticContext != null) {
            for (Iterator<String> prefixes = staticContext.iteratePrefixes(); prefixes.hasNext(); ) {
                String prefix = prefixes.next();
                NamespaceUri uri = staticContext.getURIForPrefix(prefix, true);
                if (uri != null && !prefix.isEmpty()) {
                    compiler.declareNamespace(prefix, uri.toString());
                }
            }
            try {
                compiler.setBaseURI(staticContext.getStaticBaseUri());
            } catch (Exception e) {
                // no base URI
            }
        }

        // only the variables the expression references are bound: binding a variable evaluates it, if it is still
        // lazily evaluated
        Map<String, Map.Entry<StructuredQName, Sequence>> inScope = Values.inScopeVariables(context);
        Map<String, Map.Entry<StructuredQName, Sequence>> referenced = new java.util.LinkedHashMap<String, Map.Entry<StructuredQName, Sequence>>();
        Matcher m = VARIABLE_REFERENCE.matcher(xpath);
        while (m.find()) {
            Map.Entry<StructuredQName, Sequence> variable = inScope.get(m.group(1));
            if (variable != null) {
                referenced.put(m.group(1), variable);
                compiler.declareVariable(new QName(variable.getKey()));
            }
        }

        XPathSelector selector = compiler.compile(xpath).load();
        for (Map.Entry<StructuredQName, Sequence> variable : referenced.values()) {
            selector.setVariable(new QName(variable.getKey()), XdmValue.wrap(Values.ground(variable.getValue())));
        }
        Item contextItem = context.getContextItem();
        if (contextItem != null) {
            XdmValue wrapped = XdmValue.wrap(contextItem);
            if (wrapped instanceof XdmItem) {
                selector.setContextItem((XdmItem) wrapped);
            }
        }
        return selector;
    }

    private static RetainedStaticContext staticContext(Traceable instruction) {
        Expression expression = instruction instanceof Expression ? (Expression) instruction :
                instruction instanceof TraceableComponent ? ((TraceableComponent) instruction).getBody() : null;
        return expression == null ? null : expression.getRetainedStaticContext();
    }
}
