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

import javax.xml.transform.Source;
import javax.xml.transform.stream.StreamSource;

import net.sf.saxon.Configuration;
import net.sf.saxon.expr.XPathContext;
import net.sf.saxon.lib.CollectionFinder;
import net.sf.saxon.lib.ResourceCollection;
import net.sf.saxon.lib.ResourceRequest;
import net.sf.saxon.lib.ResourceResolver;
import net.sf.saxon.trans.XPathException;
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
        // a session for each XPath version requested, made when first needed
        Map<String, Session> sessions = new java.util.HashMap<String, Session>();
        if (args.length > 0 && "--server".equals(args[0])) {
            java.io.BufferedReader in = new java.io.BufferedReader(new java.io.InputStreamReader(System.in, StandardCharsets.UTF_8));
            for (String line = in.readLine(); line != null; line = in.readLine()) {
                if (line.trim().isEmpty()) {
                    continue;
                }
                out.write(Json.stringify(respond(sessions, line)) + "\n");
                out.flush();
            }
            return;
        }
        out.write(Json.stringify(respond(sessions, new String(readAll(System.in), StandardCharsets.UTF_8))));
        out.flush();
    }

    // the result for a request, or the error - in the session for the XPath version it asks for, 4.0 if none
    private static Object respond(Map<String, Session> sessions, String json) {
        Session session = null;
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> request = (Map<String, Object>) Json.parse(json);
            String version = "3.1".equals(Json.string(request, "xpathVersion")) ? "3.1" : "4.0";
            boolean sandbox = Json.bool(request, "sandbox");
            String key = version + (sandbox ? " sandbox" : "");
            session = sessions.get(key);
            if (session == null) {
                session = new Session("4.0".equals(version), sandbox);
                sessions.put(key, session);
            }
            return evaluate(session, request);
        } catch (SaxonApiException e) {
            return withVersion(Json.obj().with("error", error(e)), session);
        } catch (Exception | LinkageError | StackOverflowError e) {
            return withVersion(Json.obj().with("error", Json.obj().with("message", Debugger.message(e))), session);
        }
    }

    // an error, with the XPath version it was evaluated as, if that's known - e.g. 3.1, with Saxon-HE, for a 4.0
    // expression's syntax error
    private static Json.Obj withVersion(Json.Obj result, Session session) {
        return session == null ? result : result.with("xpathVersion", session.xpath40 ? "4.0" : "3.1");
    }

    // what's kept between a server's requests: Saxon's configuration and xdm-view, once compiled. XPath 4.0, if it's
    // asked for, with Saxon-PE or EE (with syntax extensions) - else XPath 3.1, strictly: no syntax extensions, as when
    // an XSLT 3.0 stylesheet is run
    static final class Session {
        final Configuration config = Configuration.newLicensedConfiguration();
        final Processor processor;
        final boolean xpath40;
        final XdmView view;

        Session(boolean want40, boolean sandbox) {
            if (sandbox) {
                // before the Processor: it registers the extension function libraries (EXPath modules) as it's made
                restrictFeatures(config);
            }
            boolean is40 = want40 && !"HE".equals(config.getEditionCode());
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
            if (sandbox) {
                // xdm-view compiles on first use: before extension functions and file access are turned off, so
                // the result is still shown as xdm:debug() does
                try {
                    view.renderPlain(new XdmAtomicValue(1L));
                } catch (RuntimeException | LinkageError e) {
                    // the result is then listed by item
                }
                restrictResources(config);
                verifySandbox(processor);
            }
        }
    }

    // the folders a sandboxed request may read files in (canonical paths), set for each request
    private static volatile List<String> allowedRoots = new ArrayList<String>();

    // For an assistant's expression, not one a person wrote: no extension functions (calls to Java methods, EXPath
    // modules such as file:, which can write files and run programs), no protocol but file:, and only files in the
    // folders the request gives, for doc(), collection(), unparsed-text() and the XML parser's entities. Failing to
    // restrict is an error, not an unrestricted run
    private static void restrictFeatures(Configuration config) {
        config.setConfigurationProperty("http://saxon.sf.net/feature/allow-external-functions", Boolean.FALSE);
        config.setConfigurationProperty("http://saxon.sf.net/feature/allowedProtocols", "file");
        // no external entities or DTDs in the XML parser: its parser is reused, and after the first document its
        // entities were no longer read through the resolver below
        for (String feature : new String[] { "http://xml.org/sax/features/external-general-entities",
                "http://xml.org/sax/features/external-parameter-entities", "http://apache.org/xml/features/nonvalidating/load-external-dtd" }) {
            config.setConfigurationProperty("http://saxon.sf.net/feature/parserFeature?uri=" + feature.replace(":", "%3A").replace("/", "%2F"), Boolean.FALSE);
        }
    }

    // the files the expression can read: after xdm-view, which reads its own stylesheet, is compiled
    private static void restrictResources(Configuration config) {
        final ResourceResolver delegate = config.getResourceResolver();
        config.setResourceResolver(new ResourceResolver() {
            public Source resolve(ResourceRequest request) throws XPathException {
                String uri = request.uri;
                if (uri == null && request.relativeUri != null) {
                    try {
                        uri = request.baseUri != null ? new java.net.URI(request.baseUri).resolve(request.relativeUri).toString() : request.relativeUri;
                    } catch (java.net.URISyntaxException e) {
                        uri = request.relativeUri;
                    }
                }
                checkAllowed(uri);
                return delegate.resolve(request);
            }
        });
        // collection() and uri-collection() list and read files themselves, not through the resolver, and follow symbolic
        // links out of the folders - so they're not available: doc() reads a file
        config.setCollectionFinder(new CollectionFinder() {
            public ResourceCollection findCollection(XPathContext context, String collectionURI) throws XPathException {
                throw new XPathException("collection() and uri-collection() aren't available here: use doc() for a file in the workspace", "FODC0004");
            }
        });
    }

    // fails, rather than runs without a restriction: an extension function that compiles is one that could run
    private static void verifySandbox(Processor processor) {
        for (String call : new String[] { "Q{http://expath.org/ns/file}exists('/')", "Q{java:java.lang.Math}abs(-1)" }) {
            boolean compiled = true;
            try {
                processor.newXPathCompiler().compile(call);
            } catch (SaxonApiException | RuntimeException e) {
                compiled = false;
            }
            if (compiled) {
                throw new IllegalStateException("Extension functions couldn't be turned off in this Saxon, so an expression isn't evaluated");
            }
        }
    }

    private static void checkAllowed(String uri) throws XPathException {
        try {
            java.net.URI parsed = new java.net.URI(uri);
            if ("file".equals(parsed.getScheme())) {
                String path = new java.io.File(parsed).getCanonicalPath();
                for (String root : allowedRoots) {
                    if (path.equals(root) || path.startsWith(root.endsWith(java.io.File.separator) ? root : root + java.io.File.separator)) {
                        return;
                    }
                }
            }
        } catch (java.net.URISyntaxException | IllegalArgumentException | java.io.IOException e) {
            // not allowed
        }
        throw new XPathException("Not allowed to read " + uri + ": the expression can read only files in the workspace folders", "FODC0002");
    }

    private static List<String> canonicalRoots(List<Object> roots) {
        List<String> result = new ArrayList<String>();
        if (roots != null) {
            for (Object root : roots) {
                try {
                    result.add(new java.io.File(String.valueOf(root)).getCanonicalPath());
                } catch (java.io.IOException e) {
                    // not a folder that exists
                }
            }
        }
        return result;
    }

    static Object evaluate(Session session, Map<String, Object> request) throws SaxonApiException {
        boolean xpath40 = session.xpath40;
        Processor processor = session.processor;
        DocumentBuilder builder = processor.newDocumentBuilder();
        // for an assistant: where a node is in the XML file, in the result and saxon:line-number()
        builder.setLineNumbering(Json.bool(request, "sandbox"));
        String systemId = Json.string(request, "systemId");
        boolean sandbox = Json.bool(request, "sandbox");
        if (sandbox) {
            allowedRoots = canonicalRoots(Json.array(request, "roots"));
        }
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
        if (sandbox) {
            // the prefixes XPath 3.1 predeclares that Saxon's API doesn't - a stylesheet has to declare them
            compiler.declareNamespace("map", "http://www.w3.org/2005/xpath-functions/map");
            compiler.declareNamespace("array", "http://www.w3.org/2005/xpath-functions/array");
            compiler.declareNamespace("math", "http://www.w3.org/2005/xpath-functions/math");
            compiler.declareNamespace("err", "http://www.w3.org/2005/xqt-errors");
        }
        XdmNode root = documentElement(document);
        String documentDefault = null;
        if (root != null) {
            for (NamespaceBinding binding : root.getUnderlyingNode().getAllNamespaces()) {
                if (sandbox && binding.getPrefix().isEmpty()) {
                    // not bound: in a stylesheet, unprefixed element names are in no namespace, unless it sets
                    // xpath-default-namespace - which the request gives
                    documentDefault = binding.getNamespaceUri().toString();
                    continue;
                }
                // the default namespace, for unprefixed element names, as the prefix ""
                compiler.declareNamespace(binding.getPrefix(), binding.getNamespaceUri().toString());
            }
        }
        String defaultElementNamespace = Json.string(request, "xpathDefaultNamespace");
        if (sandbox && defaultElementNamespace != null) {
            compiler.declareNamespace("", defaultElementNamespace);
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
            items.add(item.isNode() ? node((XdmNode) item, document) : item instanceof XdmAtomicValue ?
                    Json.obj().with("kind", "atomic").with("type", ((XdmAtomicValue) item).getPrimitiveTypeName().getLocalName())
                            .with("value", item.getStringValue()) :
                    Json.obj().with("kind", "other").with("value", adaptive(processor, item)));
        }
        // the version used: 3.1 when 4.0 was asked for with Saxon-HE
        Json.Obj result = Json.obj().with("count", value.size()).with("items", items).with("xpathVersion", xpath40 ? "4.0" : "3.1");
        String text = text(session.view, value);
        if (text != null) {
            result.with("text", text);
        }
        if (sandbox && value.size() == 0 && documentDefault != null && !documentDefault.isEmpty() && defaultElementNamespace == null) {
            result.with("hint", "The document's default namespace is " + documentDefault + ", which unprefixed element names don't match, as in a "
                    + "stylesheet - unless it sets xpath-default-namespace (the xpathDefaultNamespace argument) or the expression uses a prefix or Q{" + documentDefault + "}name");
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

    private static Json.Obj node(XdmNode node, XdmNode context) {
        XdmNodeKind kind = node.getNodeKind();
        Json.Obj result = Json.obj().with("kind", "node").with("nodeKind", kind.toString().toLowerCase(java.util.Locale.ROOT))
                .with("path", path(node));
        // in another document, e.g. one doc() read: its positions are not the context document's
        if (node.getUnderlyingNode().getTreeInfo() != context.getUnderlyingNode().getTreeInfo()) {
            String uri = node.getBaseURI() == null ? null : node.getBaseURI().toString();
            result.with("otherDocument", uri == null ? "another document" : uri);
        }
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
        // where it is in the XML file, if the document was built with line numbers: for an attribute or text, its element's
        // if it has none of its own
        int line = node.getLineNumber();
        int column = node.getColumnNumber();
        if (line <= 0 && element != null && element.getNodeKind() == XdmNodeKind.ELEMENT) {
            line = element.getLineNumber();
            column = element.getColumnNumber();
        }
        if (line > 0) {
            result.with("line", (long) line);
            if (column > 0) {
                result.with("column", (long) column);
            }
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
