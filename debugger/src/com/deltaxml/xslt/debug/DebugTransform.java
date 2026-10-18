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
import net.sf.saxon.s9api.SaxonApiException;
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

    @Override
    protected Xslt30Transformer newTransformer(XsltExecutable executable, CommandLineOptions options) throws SaxonApiException {
        Xslt30Transformer transformer = super.newTransformer(executable, options);
        final ErrorReporter saxonReporter = transformer.getErrorReporter();
        transformer.setErrorReporter(error -> debugger.reportError(error, saxonReporter, false));
        return transformer;
    }
}
