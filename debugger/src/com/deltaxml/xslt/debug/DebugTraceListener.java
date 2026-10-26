/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.util.Map;

import net.sf.saxon.Controller;
import net.sf.saxon.expr.XPathContext;
import net.sf.saxon.lib.TraceListener;
import net.sf.saxon.om.Item;
import net.sf.saxon.trace.Traceable;
import net.sf.saxon.trans.Mode;
import net.sf.saxon.trans.XPathException;
import net.sf.saxon.trans.rules.BuiltInRuleSet;

/**
 * The TraceListener Saxon creates for the '-T:' command-line option - Saxon instantiates it by class name, so it
 * forwards each callback to the current Debugger.
 */
public class DebugTraceListener implements TraceListener {

    private final Debugger debugger = Debugger.current;

    @Override
    public void enter(Traceable traceable, Map<String, Object> properties, XPathContext context) {
        // not while an expression just stepped through is evaluated again, by its instruction (see SteppedResult)
        if (debugger != null && !SteppedResult.isQuiet()) {
            debugger.enter(traceable, properties, context);
        }
    }

    @Override
    public void leave(Traceable traceable) {
        if (debugger != null && !SteppedResult.isQuiet()) {
            debugger.leave(traceable);
        }
    }

    // where an xsl:try starts
    @Override
    public Object checkpoint() {
        return debugger != null && !SteppedResult.isQuiet() ? debugger.checkpoint() : null;
    }

    // an error caught by xsl:try
    @Override
    public void recover(Object checkpoint, XPathException error) {
        if (debugger != null && !SteppedResult.isQuiet()) {
            debugger.caughtError(checkpoint, error);
        }
    }

    @Override
    public void startCurrentItem(Item item) {
        if (debugger != null && !SteppedResult.isQuiet()) {
            debugger.startCurrentItem(item);
        }
    }

    // the transform's controller - for a pause where no stylesheet instruction has run yet
    @Override
    public void open(Controller controller) {
        if (debugger != null) {
            debugger.transformOpened(controller);
        }
    }

    // the template rule for an item, found by xsl:apply-templates - Saxon gives its mode's built-in rules if none matched
    @Override
    public void endRuleSearch(Object rule, Mode mode, Item item) {
        if (debugger != null && !SteppedResult.isQuiet() && rule instanceof BuiltInRuleSet) {
            debugger.noTemplateMatched((BuiltInRuleSet) rule, mode, item);
        }
    }
}
