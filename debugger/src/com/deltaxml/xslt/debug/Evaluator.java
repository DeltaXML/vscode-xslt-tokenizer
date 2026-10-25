/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.util.Iterator;
import java.util.List;
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
    static XdmValue evaluate(final Traceable instruction, final XPathContext context, final Traceable xsltInstruction, final XPathContext xsltContext, final String xpath) throws Exception {
        return withOwnFunctionCaches(xsltContext, () -> evaluateNow(instruction, context, xsltInstruction, xsltContext, xpath));
    }

    private static XdmValue evaluateNow(Traceable instruction, XPathContext context, Traceable xsltInstruction, XPathContext xsltContext, String xpath) throws Exception {
        if (engineWorks) {
            try {
                // with the stylesheet's functions, and current() etc.
                return XdmValue.wrap(XPathEngine.evaluate(xpath, instruction, context, xsltInstruction, xsltContext));
            } catch (LinkageError | ReflectiveOperationException | IllegalStateException e) {
                engineWorks = false;
            }
        }
        return selector(instruction, context, xpath).evaluate();
    }

    static boolean effectiveBooleanValue(Traceable instruction, XPathContext context, Traceable xsltInstruction, XPathContext xsltContext, String xpath) throws Exception {
        if (engineWorks) {
            // the newline ends any trailing XPath comment
            XdmValue value = evaluate(instruction, context, xsltInstruction, xsltContext, "boolean((" + xpath + "\n))");
            return value.size() == 1 && Boolean.parseBoolean(value.itemAt(0).getStringValue());
        }
        return withOwnFunctionCaches(xsltContext, () -> selector(instruction, context, xpath).effectiveBooleanValue());
    }

    // The name Saxon (12 and 13) keeps a cached function's results under, as user data of the transform's Controller
    // for the function: one with xsl:function cache="yes" (or saxon:memo-function="yes")
    private static final String FUNCTION_CACHE = "memo-function-cache";

    // While the debugger evaluates an expression (for Watch, the Debug Console, a hover, a breakpoint condition or a
    // logpoint, or a value in the Variables view) each cached function has an empty cache of its own: its calls
    // aren't remembered for the transform - else the stylesheet's own call with the same arguments wouldn't run the
    // function, so its breakpoints wouldn't be stopped at, and its messages would have been written already
    static <T> T withOwnFunctionCaches(XPathContext context, java.util.concurrent.Callable<T> work) throws Exception {
        net.sf.saxon.Controller controller = context == null ? null : context.getController();
        List<net.sf.saxon.expr.instruct.UserFunction> cached = cachedFunctions(controller);
        Map<net.sf.saxon.expr.instruct.UserFunction, Object> caches = new java.util.HashMap<net.sf.saxon.expr.instruct.UserFunction, Object>();
        for (net.sf.saxon.expr.instruct.UserFunction function : cached) {
            caches.put(function, controller.getUserData(function, FUNCTION_CACHE));
            controller.setUserData(function, FUNCTION_CACHE, null);
        }
        try {
            return work.call();
        } finally {
            for (net.sf.saxon.expr.instruct.UserFunction function : cached) {
                // null removes the debugger's cache, where the function hadn't been called yet
                controller.setUserData(function, FUNCTION_CACHE, caches.get(function));
            }
        }
    }

    // the stylesheet's functions with caching - in its component index, with those of the packages it uses
    private static List<net.sf.saxon.expr.instruct.UserFunction> cachedFunctions(net.sf.saxon.Controller controller) {
        List<net.sf.saxon.expr.instruct.UserFunction> result = new java.util.ArrayList<net.sf.saxon.expr.instruct.UserFunction>();
        if (controller == null || controller.getExecutable() == null || !(controller.getExecutable().getTopLevelPackage() instanceof net.sf.saxon.style.StylesheetPackage)) {
            return result;
        }
        net.sf.saxon.style.StylesheetPackage pkg = (net.sf.saxon.style.StylesheetPackage) controller.getExecutable().getTopLevelPackage();
        for (net.sf.saxon.expr.Component component : pkg.getComponentIndex().values()) {
            if (component.getActor() instanceof net.sf.saxon.expr.instruct.UserFunction && ((net.sf.saxon.expr.instruct.UserFunction) component.getActor()).isMemoFunction()) {
                result.add((net.sf.saxon.expr.instruct.UserFunction) component.getActor());
            }
        }
        return result;
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
        Map<String, Map.Entry<StructuredQName, Sequence>> inScope = Values.inScopeVariables(context, instruction);
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
