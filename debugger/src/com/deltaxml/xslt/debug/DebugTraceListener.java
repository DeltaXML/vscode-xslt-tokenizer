/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.util.Map;

import net.sf.saxon.expr.XPathContext;
import net.sf.saxon.lib.TraceListener;
import net.sf.saxon.om.Item;
import net.sf.saxon.trace.Traceable;
import net.sf.saxon.trans.XPathException;

/**
 * The TraceListener Saxon creates for the '-T:' command-line option - Saxon instantiates it by class name, so it
 * forwards each callback to the current Debugger.
 */
public class DebugTraceListener implements TraceListener {

    private final Debugger debugger = Debugger.current;

    @Override
    public void enter(Traceable traceable, Map<String, Object> properties, XPathContext context) {
        if (debugger != null) {
            debugger.enter(traceable, properties, context);
        }
    }

    @Override
    public void leave(Traceable traceable) {
        if (debugger != null) {
            debugger.leave(traceable);
        }
    }

    // where an xsl:try starts
    @Override
    public Object checkpoint() {
        return debugger != null ? debugger.checkpoint() : null;
    }

    // an error caught by xsl:try
    @Override
    public void recover(Object checkpoint, XPathException error) {
        if (debugger != null) {
            debugger.caughtError(checkpoint, error);
        }
    }

    @Override
    public void startCurrentItem(Item item) {
        if (debugger != null) {
            debugger.startCurrentItem(item);
        }
    }
}
