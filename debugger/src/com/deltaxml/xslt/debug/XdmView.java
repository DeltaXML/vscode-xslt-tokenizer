/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.io.File;

import net.sf.saxon.Configuration;
import net.sf.saxon.s9api.Processor;
import net.sf.saxon.s9api.QName;
import net.sf.saxon.s9api.XdmValue;
import net.sf.saxon.s9api.XsltCompiler;
import net.sf.saxon.s9api.Xslt30Transformer;

/**
 * A value as xdm:trace writes it, in color - a node or JNode as its path above a (pruned) copy, a map or array
 * pretty-printed over several lines - for a logpoint's {expression}. It's rendered by the xdm-view stylesheets the
 * extension bundles (xslt-resources/xdm-view, beside the adapter's jar), compiled once per run with the transform's
 * configuration, so its values can be passed to them - without tracing, so the debugger isn't told about them.
 * Stylesheets needn't include xdm-view, or declare its namespace.
 */
final class XdmView {

    // xdm-view's functions aren't public (it isn't a package), so they're called by one of this stylesheet's, which is
    private static final String NS = "http://deltaxml.com/ns/xslt-debugger";
    private static final QName LOG_TEXT = new QName(NS, "log-text");
    private static final String WRAPPER =
            "<xsl:stylesheet version='3.0' xmlns:xsl='http://www.w3.org/1999/XSL/Transform' xmlns:dbg='" + NS + "'" +
            "    xmlns:zxd='http://deltaxignia.com/ns/xdm-persistence/internal'>" +
            "  <xsl:import href='xdm-view.xsl'/>" +
            "  <xsl:function name='dbg:log-text' visibility='public'>" +
            "    <xsl:param name='value'/>" +
            "    <xsl:sequence select='zxd:trace-text($value, (), true())'/>" +
            "  </xsl:function>" +
            "</xsl:stylesheet>";

    private final Configuration config;
    private Xslt30Transformer transformer;
    // why it can't be used, once that's known
    private String problem;

    XdmView(Configuration config) {
        this.config = config;
    }

    /** the value rendered - null if xdm-view can't be used (see problem()), or rendering it failed */
    String render(XdmValue value) {
        if (transformer == null && problem == null) {
            compile();
        }
        if (transformer == null) {
            return null;
        }
        try {
            return transformer.callFunction(LOG_TEXT, new XdmValue[] { value }).toString();
        } catch (Exception | LinkageError e) {
            return null;
        }
    }

    /** why xdm-view can't be used - null if it can, or that isn't known yet */
    String problem() {
        return problem;
    }

    private void compile() {
        try {
            File jar = new File(XdmView.class.getProtectionDomain().getCodeSource().getLocation().toURI());
            File stylesheet = new File(jar.getParentFile().getParentFile(), "xdm-view" + File.separator + "xdm-view.xsl");
            if (!stylesheet.isFile()) {
                problem = "xdm-view isn't at " + stylesheet;
                return;
            }
            XsltCompiler compiler = new Processor(config).newXsltCompiler();
            compiler.getUnderlyingCompilerInfo().setCodeInjector(null);
            // in xdm-view's folder, for its import
            javax.xml.transform.stream.StreamSource source = new javax.xml.transform.stream.StreamSource(new java.io.StringReader(WRAPPER),
                    new File(stylesheet.getParentFile(), "xslt-debugger-log.xsl").toURI().toString());
            Xslt30Transformer compiled = compiler.compile(source).load30();
            compiled.getUnderlyingController().setTraceListener(null);
            transformer = compiled;
        } catch (Exception | LinkageError e) {
            problem = "xdm-view couldn't be compiled: " + e.getMessage();
        }
    }
}
