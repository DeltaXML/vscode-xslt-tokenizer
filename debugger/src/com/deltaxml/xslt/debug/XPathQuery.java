/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import javax.xml.transform.stream.StreamSource;

import net.sf.saxon.Configuration;
import net.sf.saxon.om.NamespaceBinding;
import net.sf.saxon.s9api.Axis;
import net.sf.saxon.s9api.DocumentBuilder;
import net.sf.saxon.s9api.Processor;
import net.sf.saxon.s9api.SaxonApiException;
import net.sf.saxon.s9api.Serializer;
import net.sf.saxon.s9api.XPathCompiler;
import net.sf.saxon.s9api.XPathSelector;
import net.sf.saxon.s9api.XdmAtomicValue;
import net.sf.saxon.s9api.XdmItem;
import net.sf.saxon.s9api.XdmNode;
import net.sf.saxon.s9api.XdmNodeKind;
import net.sf.saxon.s9api.XdmSequenceIterator;
import net.sf.saxon.s9api.XdmValue;

/**
 * Evaluates an XPath expression on an XML document, for the extension's 'Find Nodes with XPath' - run as a main class
 * of its own, with the user's Saxon jar: the request is JSON on stdin - {xpath, xml (the document's text, which may not
 * be saved), systemId, namespaces: {prefix: uri}} - and the result JSON on stdout: {count, items: [...]} or {error}.
 *
 * The expression's namespace prefixes are those in scope on the document element, and any given (e.g. from a 'declare
 * namespace' in the query file); an unprefixed element name is in the document element's default namespace - not
 * standard XPath, but what's usually meant. With Saxon-PE or EE, it's XPath 4.0.
 *
 * Each node is identified by where it is among the document's elements: the position of each element, from the
 * document element down, among its parent's element children - so the extension can find it in the document's
 * outline, whatever the namespaces or prefixes - and, for an attribute, its name.
 */
final class XPathQuery {

    // the most items returned: a result can be large, e.g. //node()
    private static final int MAX_ITEMS = 5000;
    // of a map, array or function's text on one line
    private static final int MAX_VALUE_LENGTH = 10000;
    // of the result's text, as xdm-view writes it: the most items, and characters
    static final int MAX_TEXT_ITEMS = 100;
    private static final int MAX_TEXT_LENGTH = 100000;

    private XPathQuery() { }

    /**
     * With no arguments, one request: all of stdin, and its result on stdout. With --server, a request on each line of
     * stdin, and each result on a line of stdout - in a JVM that stays running, so a query needn't wait for Java and
     * Saxon to start, or for xdm-view to compile, again. It ends when stdin is closed
     */
    public static void main(String[] args) throws Exception {
        java.io.Writer out = new java.io.OutputStreamWriter(System.out, StandardCharsets.UTF_8);
        Session session = null;
        if (args.length > 0 && "--server".equals(args[0])) {
            java.io.BufferedReader in = new java.io.BufferedReader(new java.io.InputStreamReader(System.in, StandardCharsets.UTF_8));
            for (String line = in.readLine(); line != null; line = in.readLine()) {
                if (line.trim().isEmpty()) {
                    continue;
                }
                if (session == null) {
                    session = new Session();
                }
                out.write(Json.stringify(respond(session, line)) + "\n");
                out.flush();
            }
            return;
        }
        out.write(Json.stringify(respond(null, new String(readAll(System.in), StandardCharsets.UTF_8))));
        out.flush();
    }

    // the result for a request, or the error - a new session if there's none
    private static Object respond(Session session, String json) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> request = (Map<String, Object>) Json.parse(json);
            return evaluate(session == null ? new Session() : session, request);
        } catch (SaxonApiException e) {
            return Json.obj().with("error", error(e));
        } catch (Exception | LinkageError | StackOverflowError e) {
            return Json.obj().with("error", Json.obj().with("message", Debugger.message(e)));
        }
    }

    // what's kept between a server's requests: Saxon's configuration - XPath 4.0 with Saxon-PE or EE - and xdm-view,
    // once compiled
    static final class Session {
        final Configuration config = Configuration.newLicensedConfiguration();
        final Processor processor;
        final boolean xpath40;
        final XdmView view;

        Session() {
            boolean is40 = !"HE".equals(config.getEditionCode());
            if (is40) {
                try {
                    config.setConfigurationProperty("http://saxon.sf.net/feature/allowSyntaxExtensions", Boolean.TRUE);
                } catch (RuntimeException e) {
                    is40 = false;
                }
            }
            xpath40 = is40;
            processor = new Processor(config);
            // one result at a time: each entry, member and item on a line of its own
            view = new XdmView(config, true);
        }
    }

    static Object evaluate(Session session, Map<String, Object> request) throws SaxonApiException {
        boolean xpath40 = session.xpath40;
        Processor processor = session.processor;
        DocumentBuilder builder = processor.newDocumentBuilder();
        String systemId = Json.string(request, "systemId");
        XdmNode document = builder.build(new StreamSource(new StringReader(Json.string(request, "xml")), systemId));

        XPathCompiler compiler = processor.newXPathCompiler();
        try {
            compiler.setLanguageVersion(xpath40 ? "4.0" : "3.1");
        } catch (RuntimeException e) {
            compiler.setLanguageVersion("3.1");
        }
        if (systemId != null) {
            try {
                compiler.setBaseURI(new java.net.URI(systemId));
            } catch (java.net.URISyntaxException e) {
                // no base URI
            }
        }
        XdmNode root = documentElement(document);
        if (root != null) {
            for (NamespaceBinding binding : root.getUnderlyingNode().getAllNamespaces()) {
                // the default namespace, for unprefixed element names, as the prefix ""
                compiler.declareNamespace(binding.getPrefix(), binding.getNamespaceUri().toString());
            }
        }
        Map<String, Object> namespaces = Json.object(request, "namespaces");
        if (namespaces != null) {
            for (Map.Entry<String, Object> entry : namespaces.entrySet()) {
                compiler.declareNamespace(entry.getKey(), String.valueOf(entry.getValue()));
            }
        }
        XPathSelector selector = compiler.compile(Json.string(request, "xpath")).load();
        selector.setContextItem(document);
        XdmValue value = selector.evaluate();

        List<Object> items = new ArrayList<Object>();
        int n = 0;
        for (XdmItem item : value) {
            if (++n > MAX_ITEMS) {
                break;
            }
            items.add(item.isNode() ? node((XdmNode) item) : item instanceof XdmAtomicValue ?
                    Json.obj().with("kind", "atomic").with("type", ((XdmAtomicValue) item).getPrimitiveTypeName().getLocalName())
                            .with("value", item.getStringValue()) :
                    Json.obj().with("kind", "other").with("value", adaptive(processor, item)));
        }
        Json.Obj result = Json.obj().with("count", value.size()).with("items", items);
        String text = text(session.view, value);
        if (text != null) {
            result.with("text", text);
        }
        return result;
    }

    // the result - its first items, if there are many - as xdm:debug() writes it, without color: a node as its path
    // above a pruned copy, text normalized and cut short, a sequence in parentheses, atomic values with their types...
    // For the Output panel. Null if xdm-view can't be used, e.g. for a function item, which it doesn't show yet
    private static String text(XdmView view, XdmValue value) {
        XdmValue shown = value.size() > MAX_TEXT_ITEMS ? value.subsequence(0, MAX_TEXT_ITEMS) : value;
        String text = view.renderPlain(shown);
        return text == null || text.length() <= MAX_TEXT_LENGTH ? text : text.substring(0, MAX_TEXT_LENGTH - 1) + "…";
    }

    // a map, array or function, as the adaptive output method writes it - e.g. [89], map{"a":1}, fn:count#1 - on
    // one line, and cut short if it's long
    private static String adaptive(Processor processor, XdmItem item) {
        java.io.StringWriter writer = new java.io.StringWriter();
        Serializer serializer = processor.newSerializer(writer);
        serializer.setOutputProperty(Serializer.Property.METHOD, "adaptive");
        serializer.setOutputProperty(Serializer.Property.OMIT_XML_DECLARATION, "yes");
        try {
            serializer.serializeXdmValue(item);
        } catch (SaxonApiException e) {
            return Values.summary(item);
        }
        String text = writer.toString();
        return text.length() > MAX_VALUE_LENGTH ? text.substring(0, MAX_VALUE_LENGTH - 1) + "…" : text;
    }

    private static Json.Obj node(XdmNode node) {
        XdmNodeKind kind = node.getNodeKind();
        Json.Obj result = Json.obj().with("kind", "node").with("nodeKind", kind.toString().toLowerCase(java.util.Locale.ROOT))
                .with("path", path(node));
        // the element it is, or is in
        XdmNode element = kind == XdmNodeKind.ELEMENT ? node : node.getParent();
        if (element != null && element.getNodeKind() == XdmNodeKind.ELEMENT) {
            result.with("positions", positions(element));
        }
        if (kind == XdmNodeKind.ATTRIBUTE) {
            result.with("name", node.getUnderlyingNode().getDisplayName());
        } else if (kind == XdmNodeKind.TEXT) {
            // which of its element's text nodes: in the XML file, the text between its child elements, comments and
            // processing instructions
            long textIndex = 1;
            for (XdmSequenceIterator<XdmNode> it = node.axisIterator(Axis.PRECEDING_SIBLING); it.hasNext(); ) {
                if (it.next().getNodeKind() == XdmNodeKind.TEXT) {
                    textIndex++;
                }
            }
            result.with("textIndex", textIndex);
        }
        if (kind != XdmNodeKind.ELEMENT && kind != XdmNodeKind.DOCUMENT) {
            String text = node.getStringValue();
            result.with("value", text.length() > 100 ? text.substring(0, 99) + "…" : text);
        }
        return result;
    }

    // the element's position among its parent's element children, for it and each of its ancestors - the document
    // element's first
    private static List<Object> positions(XdmNode element) {
        List<Object> positions = new ArrayList<Object>();
        for (XdmNode e = element; e != null && e.getNodeKind() == XdmNodeKind.ELEMENT; e = e.getParent()) {
            int position = 1;
            for (XdmSequenceIterator<XdmNode> it = e.axisIterator(Axis.PRECEDING_SIBLING); it.hasNext(); ) {
                if (it.next().getNodeKind() == XdmNodeKind.ELEMENT) {
                    position++;
                }
            }
            positions.add(0, (long) position);
        }
        return positions;
    }

    // a readable path, with names as written, e.g. /orders/order[3]/@id - a position only where there are other
    // children of the same name
    static String path(XdmNode node) {
        StringBuilder sb = new StringBuilder();
        for (XdmNode n = node; n != null && n.getNodeKind() != XdmNodeKind.DOCUMENT; n = n.getParent()) {
            sb.insert(0, "/" + step(n));
        }
        return sb.length() == 0 ? "/" : sb.toString();
    }

    private static String step(XdmNode node) {
        switch (node.getNodeKind()) {
            case ATTRIBUTE:
                return "@" + node.getUnderlyingNode().getDisplayName();
            case TEXT:
                return "text()" + position(node);
            case COMMENT:
                return "comment()" + position(node);
            case PROCESSING_INSTRUCTION:
                return "processing-instruction(" + node.getUnderlyingNode().getDisplayName() + ")" + position(node);
            case NAMESPACE:
                return "namespace::" + node.getUnderlyingNode().getDisplayName();
            default:
                return node.getUnderlyingNode().getDisplayName() + position(node);
        }
    }

    // [n] among its siblings of the same kind and name, if there are others
    private static String position(XdmNode node) {
        int before = 0;
        int after = 0;
        for (XdmSequenceIterator<XdmNode> it = node.axisIterator(Axis.PRECEDING_SIBLING); it.hasNext(); ) {
            if (sameKindAndName(it.next(), node)) {
                before++;
            }
        }
        for (XdmSequenceIterator<XdmNode> it = node.axisIterator(Axis.FOLLOWING_SIBLING); it.hasNext(); ) {
            if (sameKindAndName(it.next(), node)) {
                after++;
            }
        }
        return before + after == 0 ? "" : "[" + (before + 1) + "]";
    }

    private static boolean sameKindAndName(XdmNode a, XdmNode b) {
        return a.getNodeKind() == b.getNodeKind() && java.util.Objects.equals(a.getNodeName(), b.getNodeName());
    }

    private static XdmNode documentElement(XdmNode document) {
        for (XdmSequenceIterator<XdmNode> it = document.axisIterator(Axis.CHILD); it.hasNext(); ) {
            XdmNode child = it.next();
            if (child.getNodeKind() == XdmNodeKind.ELEMENT) {
                return child;
            }
        }
        return null;
    }

    // Saxon's error: its message and code, and where in the expression (from 1), if known
    private static Json.Obj error(SaxonApiException e) {
        Json.Obj error = Json.obj().with("message", e.getMessage());
        if (e.getErrorCode() != null) {
            error.with("code", e.getErrorCode().getLocalName());
        }
        if (e.getLineNumber() > 0) {
            error.with("line", (long) e.getLineNumber());
        }
        Throwable cause = e.getCause();
        if (cause instanceof net.sf.saxon.trans.XPathException && ((net.sf.saxon.trans.XPathException) cause).getLocator() != null) {
            int column = ((net.sf.saxon.trans.XPathException) cause).getLocator().getColumnNumber();
            if (column > 0) {
                error.with("column", (long) column);
            }
        }
        return error;
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        for (int n = in.read(buffer); n >= 0; n = in.read(buffer)) {
            out.write(buffer, 0, n);
        }
        return out.toByteArray();
    }
}
