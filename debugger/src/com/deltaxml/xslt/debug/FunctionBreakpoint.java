/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import net.sf.saxon.expr.Component;
import net.sf.saxon.expr.instruct.NamedTemplate;
import net.sf.saxon.expr.instruct.UserFunction;
import net.sf.saxon.om.StructuredQName;
import net.sf.saxon.style.StylesheetPackage;
import net.sf.saxon.trace.Traceable;
import net.sf.saxon.trace.TraceableComponent;

/**
 * A function breakpoint (added in VS Code's Breakpoints view): a stylesheet function or named template, by name - as
 * written where it's declared, e.g. f:total or cell, or as an EQName, Q{uri}total - and for a function, optionally
 * its arity, e.g. f:total#2. A '()' after the name is allowed, e.g. f:total(). A lexical name is matched as written,
 * with its prefix - not by the prefix's namespace.
 */
final class FunctionBreakpoint extends Debugger.Conditional {

    private static final String NC_NAME = "[\\p{L}_][\\p{L}\\p{N}_.\\-]*";
    private static final Pattern SPEC = Pattern.compile("\\s*(?:Q\\{([^{}]*)\\}(" + NC_NAME + ")|(" + NC_NAME + "(?::" + NC_NAME + ")?))(?:\\(\\))?(?:#(\\d+))?\\s*");

    final int id;
    final String spec;
    // for an EQName: the namespace URI and local name; otherwise the lexical name
    private final String uri;
    private final String name;
    private final Integer arity;

    private FunctionBreakpoint(int id, String spec, String uri, String name, Integer arity, String condition, String hitCondition) {
        super(condition, hitCondition);
        this.id = id;
        this.spec = spec;
        this.uri = uri;
        this.name = name;
        this.arity = arity;
    }

    // null if the text isn't a function or template name
    static FunctionBreakpoint parse(int id, String spec, String condition, String hitCondition) {
        Matcher m = spec == null ? null : SPEC.matcher(spec);
        if (m == null || !m.matches()) {
            return null;
        }
        String uri = m.group(1);
        String name = uri != null ? m.group(2) : m.group(3);
        Integer arity = m.group(4) == null ? null : Integer.valueOf(m.group(4));
        return new FunctionBreakpoint(id, spec, uri, name, arity, condition, hitCondition);
    }

    static String syntaxMessage(String spec) {
        return "'" + spec + "' isn't the name of a function (e.g. f:total, or f:total#2 for its 2-argument version) or a named template";
    }

    boolean hasSameSettings(FunctionBreakpoint other) {
        return spec.trim().equals(other.spec.trim()) && hasSameConditions(other);
    }

    // the function or named template being entered is this breakpoint's - not a template rule, even one with a name
    boolean matches(Traceable traceable, Map<String, Object> properties) {
        if (!(traceable instanceof TraceableComponent)) {
            return false;
        }
        String tag = ((TraceableComponent) traceable).getTracingTag();
        StructuredQName qName = traceable.getObjectName();
        if (qName == null || !matchesName(qName)) {
            return false;
        }
        if ("xsl:function".equals(tag)) {
            if (traceable instanceof UserFunction) {
                return arityMatches((UserFunction) traceable);
            }
            Object reported = properties == null ? null : properties.get("arity");
            return arity == null || String.valueOf(arity).equals(String.valueOf(reported));
        }
        return "xsl:template".equals(tag) && (properties == null || properties.get("match") == null) && arity == null;
    }

    // why the breakpoint can't be hit - null if the compiled stylesheet has a function or named template it matches
    String problem(StylesheetPackage pkg) {
        boolean nameFound = false;
        for (Component component : pkg.getComponentIndex().values()) {
            Object actor = component.getActor();
            if (actor instanceof UserFunction && ((UserFunction) actor).getFunctionName() != null && matchesName(((UserFunction) actor).getFunctionName())) {
                nameFound = true;
                if (arityMatches((UserFunction) actor)) {
                    return null;
                }
            } else if (actor instanceof NamedTemplate && ((NamedTemplate) actor).getTemplateName() != null && matchesName(((NamedTemplate) actor).getTemplateName())) {
                nameFound = true;
                if (arity == null) {
                    return null;
                }
            }
        }
        return nameFound ? "The stylesheet has no version of " + name + " with " + arity + (arity == 1 ? " argument" : " arguments") :
                "The stylesheet has no function or named template named " + (uri != null ? "Q{" + uri + "}" : "") + name;
    }

    // a function with optional parameters (XSLT 4.0) has a range of arities
    private boolean arityMatches(UserFunction function) {
        return arity == null || (arity >= function.getMinimumArity() && arity <= function.getArity());
    }

    private boolean matchesName(StructuredQName qName) {
        return uri != null ? uri.equals(qName.getNamespaceUri().toString()) && name.equals(qName.getLocalPart()) : name.equals(qName.getDisplayName());
    }
}
