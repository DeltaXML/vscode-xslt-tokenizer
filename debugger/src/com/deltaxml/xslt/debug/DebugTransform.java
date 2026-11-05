/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.lang.reflect.Field;

import net.sf.saxon.Configuration;
import net.sf.saxon.Transform;
import net.sf.saxon.lib.ErrorReporter;
import net.sf.saxon.s9api.Axis;
import net.sf.saxon.s9api.Message;
import net.sf.saxon.s9api.SaxonApiException;
import net.sf.saxon.s9api.XdmNode;
import net.sf.saxon.s9api.XdmNodeKind;
import net.sf.saxon.s9api.XdmSequenceIterator;
import net.sf.saxon.s9api.XsltCompiler;
import net.sf.saxon.s9api.XsltExecutable;
import net.sf.saxon.s9api.Xslt30Transformer;
import net.sf.saxon.trace.XSLTTraceCodeInjector;
import net.sf.saxon.trans.CommandLineOptions;

/**
 * Saxon's command-line transform, with the errors it reports - when the stylesheet is compiled, and when it runs -
 * passed to the debugger first: to link them to their source, and to pause on a dynamic error. Saxon's own reports
 * are kept, so its error messages are unchanged.
 */
class DebugTransform extends Transform {

    private final Debugger debugger;

    DebugTransform(Debugger debugger) {
        this.debugger = debugger;
    }

    // a copy of each result, for the extension's view of the output so far
    @Override
    protected void initializeConfiguration(Configuration config) {
        super.initializeConfiguration(config);
        debugger.outputs.install(config);
    }

    // the compiler exists by now, before the stylesheet is compiled - its field is private, so it's found by reflection
    @Override
    protected void applyLocalOptions(CommandLineOptions options, Configuration config) {
        super.applyLocalOptions(options, config);
        try {
            Field field = Transform.class.getDeclaredField("compiler");
            field.setAccessible(true);
            XsltCompiler compiler = (XsltCompiler) field.get(this);
            if (compiler != null) {
                final ErrorReporter saxonReporter = compiler.getErrorReporter();
                compiler.setErrorReporter(error -> debugger.reportError(error, saxonReporter, true));
                // also tracing xsl:sequence instructions (with -T, Saxon's own XSLT injector is set by now)
                if (compiler.getUnderlyingCompilerInfo().getCodeInjector() instanceof XSLTTraceCodeInjector) {
                    compiler.getUnderlyingCompilerInfo().setCodeInjector(new DebugCodeInjector());
                }
            }
        } catch (ReflectiveOperationException | RuntimeException e) {
            // compile errors are only reported by Saxon
        }
    }

    // an xsl:message as it is - as for an 'xslt' task (com.deltaxml.saxon.perf.AltTransform) - rather than as Saxon
    // writes it, as XML, where e.g. the ANSI color codes of xdm:debug-color() become character references such as
    // &#x1B;[0;33m; the Debug Console shows ANSI colors. A message with elements in it is still written as XML
    private static void printMessage(Message message) {
        if (SteppedResult.isQuiet()) {
            // already written, when the expression whose evaluation it's part of was stepped through
            return;
        }
        XdmNode content = message.getContent();
        boolean hasElements = false;
        if (content != null) {
            for (XdmSequenceIterator<XdmNode> nodes = content.axisIterator(Axis.DESCENDANT); nodes.hasNext() && !hasElements; ) {
                hasElements = nodes.next().getNodeKind() == XdmNodeKind.ELEMENT;
            }
        }
        System.err.println(hasElements ? content.toString() : message.getStringValue());
    }

    @Override
    protected Xslt30Transformer newTransformer(XsltExecutable executable, CommandLineOptions options) throws SaxonApiException {
        // the function breakpoints' names are checked against the compiled stylesheet
        debugger.stylesheetCompiled(executable.getUnderlyingCompiledStylesheet().getTopLevelPackage());
        DebugCodeInjector.traceKeys(executable.getUnderlyingCompiledStylesheet().getTopLevelPackage());
        Xslt30Transformer transformer = super.newTransformer(executable, options);
        debugger.fixCurrentDateTime(transformer.getUnderlyingController());
        final ErrorReporter saxonReporter = transformer.getErrorReporter();
        transformer.setErrorReporter(error -> debugger.reportError(error, saxonReporter, false));
        if (!debugger.isMessageEscaping()) {
            transformer.setMessageHandler(DebugTransform::printMessage);
        }
        return transformer;
    }
}
