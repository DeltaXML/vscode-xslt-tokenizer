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
 *
 * For an XML result, the copy also records where each part of its text came from - the location of the event the copy's
 * emitter was writing (after any indenter, which holds some events back): the instruction, e.g. a literal result element
 * or xsl:value-of, or a node copied from a source document - so the extension can go from the output to the stylesheet.
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
        // an XML result: where its text came from - runs of [offset, location id], each run from the offset to the next
        final boolean mapped;
        private int[] runs = new int[64];
        private int runLength;
        // the locations, by id, and whether each was for text (characters) - a location may be both
        private final List<Location> locations = new ArrayList<Location>();
        private final List<Boolean> locationIsText = new ArrayList<Boolean>();
        private final Map<Location, Integer> instructionIds = new java.util.IdentityHashMap<Location, Integer>();
        private final Map<Location, Integer> textIds = new java.util.IdentityHashMap<Location, Integer>();
        // how many runs and locations have been sent
        int sentRuns;
        int sentLocations;
        // the location of the event being written, and whether it's text - null: as for the text before
        Location current;
        boolean currentIsText;

        Output(int id, String name, String uri, String method) {
            this.id = id;
            this.name = name;
            this.uri = uri;
            this.method = method;
            this.mapped = method.equals("xml");
        }

        synchronized void append(char[] chars, int offset, int length) {
            int room = MAX_LENGTH - text.length();
            if (room <= 0) {
                truncated = true;
                return;
            }
            if (mapped && current != null && length > 0) {
                int locationId = locationId(current, currentIsText);
                if (runLength == 0 || runs[runLength - 1] != locationId) {
                    if (runLength == runs.length) {
                        runs = java.util.Arrays.copyOf(runs, runs.length * 2);
                    }
                    runs[runLength++] = text.length();
                    runs[runLength++] = locationId;
                }
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

        private int locationId(Location location, boolean isText) {
            Map<Location, Integer> ids = isText ? textIds : instructionIds;
            Integer locationId = ids.get(location);
            if (locationId == null) {
                locationId = locations.size();
                locations.add(location);
                locationIsText.add(isText);
                ids.put(location, locationId);
            }
            return locationId;
        }

        // the runs not yet sent, as [offset, location id, ...]
        synchronized List<Object> unsentRuns() {
            List<Object> result = new ArrayList<Object>();
            for (int i = sentRuns; i < runLength; i++) {
                result.add(runs[i]);
            }
            sentRuns = runLength;
            return result;
        }

        // the locations not yet sent, resolved to where they are in the stylesheet or a source document
        synchronized List<Object> unsentLocations(LocationResolver resolver) {
            List<Object> result = new ArrayList<Object>();
            for (int i = sentLocations; i < locations.size(); i++) {
                Map<String, Object> resolved = resolver == null ? null : resolver.resolve(locations.get(i), locationIsText.get(i));
                Json.Obj location = Json.obj().with("id", i);
                if (resolved != null) {
                    location.putAll(resolved);
                }
                result.add(location);
            }
            sentLocations = locations.size();
            return result;
        }
    }

    /** where a location of the output is: in a stylesheet module, or a source document */
    interface LocationResolver {
        // null if it isn't known; isText: the location of text, e.g. a literal text node's (where the text ends)
        Map<String, Object> resolve(Location location, boolean isText);

        // whether it's a location in the stylesheet - a node of a temporary tree has no module, but is made there
        boolean isStylesheetLocation(Location location);

        // the location of the instruction being executed - null if there's none
        Location currentInstruction();
    }

    private LocationResolver resolver;
    // the XML result whose copy's serializer is being created
    private Output building;

    void setLocationResolver(LocationResolver resolver) {
        this.resolver = resolver;
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
                // each property by name, including the defaults - where Saxon puts the principal result's xsl:output
                // properties, e.g. method="json" (putAll would leave the copy with no method, so it couldn't write a map)
                Properties copyProperties = new Properties();
                for (String name : properties.getProperties().stringPropertyNames()) {
                    copyProperties.setProperty(name, properties.getProperties().getProperty(name));
                }
                String method = output.method;
                if (method.equals("xml") || method.equals("xhtml") || method.equals("html") || method.equals("json")) {
                    copyProperties.setProperty("indent", "yes");
                }
                building = output.mapped ? output : null;
                Receiver copy;
                try {
                    copy = super.getReceiver(new StreamResult(new OutputWriter(output)),
                            new SerializationProperties(copyProperties, properties.getCharacterMapIndex()), pipe);
                } finally {
                    building = null;
                }
                return new ItemDepthReceiver(new TeeOutputter(serializer, copy));
            }

            // the copy of an XML result: an emitter that records where its text comes from
            @Override
            protected net.sf.saxon.serialize.Emitter newXMLEmitter(Properties properties) {
                return building != null ? new LocatingXMLEmitter(building, resolver) : super.newXMLEmitter(properties);
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
                Json.Obj changes = Json.obj().with("id", output.id).with("name", output.name).with("uri", output.uri)
                        .with("method", output.method).with("offset", output.sent).with("text", output.substring(output.sent))
                        .with("truncated", output.isTruncated());
                if (output.mapped) {
                    changes.with("locations", output.unsentLocations(resolver)).with("runs", output.unsentRuns());
                }
                changed.add(changes);
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

    /**
     * The XML emitter of a copy: it sets the location of each event as it writes it - an end tag has its start tag's.
     * The text of an event may be written as the next one is, e.g. the '>' of a start tag - a click on it is taken to
     * be on the tag
     */
    private static final class LocatingXMLEmitter extends net.sf.saxon.serialize.XMLEmitter {
        private final Output output;
        private final LocationResolver resolver;
        private final java.util.ArrayDeque<Location> elements = new java.util.ArrayDeque<Location>();

        LocatingXMLEmitter(Output output, LocationResolver resolver) {
            this.output = output;
            this.resolver = resolver;
        }

        // an event with no location, e.g. the indenter's whitespace, is part of the text before - and a node copied from
        // a source document, which has its location there, is the instruction's that copied it, e.g. xsl:copy-of
        private void at(Location location, boolean isText) {
            if (location != null && location.getLineNumber() > 0) {
                Location instruction = resolver == null || resolver.isStylesheetLocation(location) ? null : resolver.currentInstruction();
                output.current = instruction != null ? instruction : location;
                output.currentIsText = isText && instruction == null;
            }
        }

        @Override
        public void startElement(net.sf.saxon.om.NodeName elemName, net.sf.saxon.type.SchemaType type, net.sf.saxon.om.AttributeMap attributes,
                net.sf.saxon.om.NamespaceMap namespaces, Location location, int properties) throws XPathException {
            at(location, false);
            elements.push(location == null ? net.sf.saxon.expr.parser.Loc.NONE : location);
            super.startElement(elemName, type, attributes, namespaces, location, properties);
        }

        @Override
        public void endElement() throws XPathException {
            Location location = elements.isEmpty() ? null : elements.pop();
            at(location == net.sf.saxon.expr.parser.Loc.NONE ? null : location, false);
            super.endElement();
        }

        @Override
        public void characters(net.sf.saxon.str.UnicodeString chars, Location location, int properties) throws XPathException {
            at(location, true);
            super.characters(chars, location, properties);
        }

        @Override
        public void comment(net.sf.saxon.str.UnicodeString chars, Location location, int properties) throws XPathException {
            at(location, false);
            super.comment(chars, location, properties);
        }

        @Override
        public void processingInstruction(String target, net.sf.saxon.str.UnicodeString data, Location location, int properties) throws XPathException {
            at(location, false);
            super.processingInstruction(target, data, location, properties);
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
