/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.io.Writer;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;

import javax.xml.transform.Result;
import javax.xml.transform.stream.StreamResult;

import net.sf.saxon.Configuration;
import net.sf.saxon.event.PipelineConfiguration;
import net.sf.saxon.event.ProxyReceiver;
import net.sf.saxon.event.Receiver;
import net.sf.saxon.event.TeeOutputter;
import net.sf.saxon.lib.SerializerFactory;
import net.sf.saxon.om.Item;
import net.sf.saxon.s9api.Location;
import net.sf.saxon.serialize.SerializationProperties;
import net.sf.saxon.trans.XPathException;

/**
 * A copy of each result the transform writes - the principal result and each xsl:result-document - as Saxon
 * serializes it so far, for the extension's view of the output at each pause. The copy uses the result's own
 * serialization properties, with indent="yes" (for xml, xhtml, html and json) for readability; the result itself is
 * written as the stylesheet says.
 *
 * Saxon creates every serializer from the configuration's SerializerFactory, so the copy is made there: a
 * TeeOutputter sends the serializer's input to a second serializer too, writing to memory. xsl:message output (to a
 * UnicodeWriterResult, not a StreamResult) isn't a result, and nor is a node serialized within a map or array item.
 */
final class OutputCapture {

    // the largest copy kept of one output
    private static final int MAX_LENGTH = 8 * 1024 * 1024;

    /** one result's serialized text so far */
    static final class Output {
        final int id;
        final String name;
        final String uri;
        final String method;
        private final StringBuilder text = new StringBuilder();
        private boolean truncated;
        // how much of the text has been sent to the extension, and whether the output has been, even if empty
        int sent;
        boolean announced;

        Output(int id, String name, String uri, String method) {
            this.id = id;
            this.name = name;
            this.uri = uri;
            this.method = method;
        }

        synchronized void append(char[] chars, int offset, int length) {
            int room = MAX_LENGTH - text.length();
            if (room <= 0) {
                truncated = true;
                return;
            }
            text.append(chars, offset, Math.min(length, room));
            truncated |= length > room;
        }

        synchronized int length() {
            return text.length();
        }

        synchronized String substring(int from) {
            return text.substring(Math.min(from, text.length()));
        }

        synchronized String tail(int length) {
            return text.substring(Math.max(0, text.length() - length));
        }

        synchronized boolean isTruncated() {
            return truncated;
        }
    }

    private final List<Output> outputs = new ArrayList<Output>();
    // serializers being created while an item is being written: those for nodes within maps or arrays
    private int itemDepth;
    // a serializer is being created here
    private boolean creating;
    // the results being copied
    private final Map<Result, Boolean> copied = new java.util.IdentityHashMap<Result, Boolean>();

    void install(final Configuration config) {
        config.setSerializerFactory(new SerializerFactory(config) {
            @Override
            public Receiver getReceiver(Result result, SerializationProperties properties, PipelineConfiguration pipe) throws XPathException {
                if (creating) {
                    // Saxon's own SerializerFactory calls this again, e.g. creating the copy
                    return super.getReceiver(result, properties, pipe);
                }
                creating = true;
                try {
                    return copied(result, properties, pipe);
                } finally {
                    creating = false;
                }
            }

            private Receiver copied(Result result, SerializationProperties properties, PipelineConfiguration pipe) throws XPathException {
                Receiver serializer = super.getReceiver(result, properties, pipe);
                // a result that's already copied is asked for again when Saxon decides its output method (an
                // 'uncommitted' serializer, when the stylesheet doesn't say) - as is the copy itself
                boolean isCopy = result instanceof StreamResult && ((StreamResult) result).getWriter() instanceof OutputWriter;
                if (itemDepth > 0 || !(result instanceof StreamResult) || isCopy || copied.containsKey(result)) {
                    return serializer;
                }
                copied.put(result, Boolean.TRUE);
                Output output = newOutput(result.getSystemId(), properties.getProperties().getProperty("method"));
                Properties copyProperties = new Properties();
                copyProperties.putAll(properties.getProperties());
                String method = output.method;
                if (method.equals("xml") || method.equals("xhtml") || method.equals("html") || method.equals("json")) {
                    copyProperties.setProperty("indent", "yes");
                }
                Receiver copy = super.getReceiver(new StreamResult(new OutputWriter(output)),
                        new SerializationProperties(copyProperties, properties.getCharacterMapIndex()), pipe);
                return new ItemDepthReceiver(new TeeOutputter(serializer, copy));
            }
        });
    }

    private synchronized Output newOutput(String systemId, String method) {
        String m = method == null || method.isEmpty() ? "xml" : method.replaceAll("^Q\\{[^}]*\\}", "");
        String name = null;
        if (systemId != null) {
            try {
                String path = new URI(systemId).getPath();
                name = path == null ? null : path.substring(path.lastIndexOf('/') + 1);
            } catch (Exception e) {
                name = null;
            }
        }
        if (name == null || name.isEmpty()) {
            // the principal result, with no -o: to stdout
            name = "result." + (m.equals("json") ? "json" : m.equals("html") ? "html" : m.equals("text") || m.equals("adaptive") ? "txt" : "xml");
        }
        Output output = new Output(outputs.size() + 1, name, systemId, m);
        outputs.add(output);
        return output;
    }

    // the text of each output added since it was last sent, as an event body - null if nothing is new
    synchronized Map<String, Object> unsent(String currentUri, boolean inTemporaryTree) {
        List<Object> changed = new ArrayList<Object>();
        for (Output output : outputs) {
            int length = output.length();
            if (length > output.sent || !output.announced) {
                output.announced = true;
                changed.add(Json.obj().with("id", output.id).with("name", output.name).with("uri", output.uri)
                        .with("method", output.method).with("offset", output.sent).with("text", output.substring(output.sent))
                        .with("truncated", output.isTruncated()));
                output.sent = length;
            }
        }
        if (changed.isEmpty()) {
            return null;
        }
        return Json.obj().with("outputs", changed).with("current", currentUri).with("inTemporaryTree", inTemporaryTree);
    }

    synchronized List<Output> all() {
        return new ArrayList<Output>(outputs);
    }

    /** writes to an output's copy */
    private static final class OutputWriter extends Writer {
        private final Output output;

        OutputWriter(Output output) {
            this.output = output;
        }

        @Override
        public void write(char[] chars, int offset, int length) {
            output.append(chars, offset, length);
        }

        @Override
        public void flush() {
        }

        @Override
        public void close() {
        }
    }

    /** counts the items being written, so serializers created meanwhile - for nodes within them - aren't copied */
    private final class ItemDepthReceiver extends ProxyReceiver {
        ItemDepthReceiver(Receiver next) {
            super(next);
        }

        @Override
        public void append(Item item, Location location, int properties) throws XPathException {
            itemDepth++;
            try {
                super.append(item, location, properties);
            } finally {
                itemDepth--;
            }
        }
    }
}
