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

    private XPathQuery() { }

    public static void main(String[] args) throws Exception {
        Object result;
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> request = (Map<String, Object>) Json.parse(new String(readAll(System.in), StandardCharsets.UTF_8));
            result = evaluate(request);
        } catch (SaxonApiException e) {
            result = Json.obj().with("error", error(e));
        } catch (Exception | LinkageError e) {
            result = Json.obj().with("error", Json.obj().with("message", Debugger.message(e)));
        }
        System.out.print(Json.stringify(result));
        System.out.flush();
    }

    static Object evaluate(Map<String, Object> request) throws SaxonApiException {
        Configuration config = Configuration.newLicensedConfiguration();
        boolean xpath40 = !"HE".equals(config.getEditionCode());
        if (xpath40) {
            try {
                config.setConfigurationProperty("http://saxon.sf.net/feature/allowSyntaxExtensions", Boolean.TRUE);
            } catch (RuntimeException e) {
                xpath40 = false;
            }
        }
        Processor processor = new Processor(config);
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
                    Json.obj().with("kind", "other").with("value", Values.summary(item)));
        }
        return Json.obj().with("count", value.size()).with("items", items);
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
