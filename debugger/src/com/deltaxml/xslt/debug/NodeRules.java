/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import net.sf.saxon.om.NodeInfo;
import net.sf.saxon.type.Type;

/**
 * The template rules each node of the input files was processed by - for going from a node to its templates, and from
 * a template to its nodes. Recorded by position: Saxon gives an element (with line numbering) the position where its
 * start tag ends; an attribute, text node, comment or processing instruction is recorded at its parent element's
 * position, as its own isn't reliable, with its kind and name. A template rule is recorded each time it's entered
 * with the node as its context item - by xsl:apply-templates, xsl:next-match or xsl:apply-imports - and a built-in
 * rule each time xsl:apply-templates finds no template rule for a node. Sent, aggregated, when the run ends.
 */
final class NodeRules {
    // the most element positions recorded: after that, no more are, and the result says so
    private static final int MAX_POSITIONS = 1000000;

    // the rules: a template's {path, line, column, label}, or a built-in rule's {builtIn, mode}
    private final List<Map<String, Object>> rules = new ArrayList<Map<String, Object>>();
    private final Map<String, Integer> ruleIds = new HashMap<String, Integer>();
    // the nodes' kinds and names, e.g. 'element:order', 'attribute:id', 'text', 'whitespace' (a whitespace-only text node)
    private final List<String> names = new ArrayList<String>();
    private final Map<String, Integer> nameIds = new HashMap<String, Integer>();
    // by file path: by element position (line << 32 | column), a list of (name id, rule id, count) triples
    private final Map<String, Map<Long, int[]>> files = new LinkedHashMap<String, Map<Long, int[]>>();
    private int positions;
    private boolean truncated;

    interface Paths {
        String pathOf(String systemId);
    }

    private final Paths paths;

    NodeRules(Paths paths) {
        this.paths = paths;
    }

    void template(NodeInfo node, String path, int line, int column, String label) {
        String key = path + ':' + line + ':' + column;
        Integer id = ruleIds.get(key);
        if (id == null) {
            id = rules.size();
            ruleIds.put(key, id);
            rules.add(Json.obj().with("path", path).with("line", line).with("column", column).with("label", label));
        }
        record(node, id);
    }

    void builtIn(NodeInfo node, String name, String mode) {
        String key = "built-in " + name + ' ' + mode;
        Integer id = ruleIds.get(key);
        if (id == null) {
            id = rules.size();
            ruleIds.put(key, id);
            rules.add(Json.obj().with("builtIn", name).with("mode", mode));
        }
        record(node, id);
    }

    // where a node is: its element (itself, or its parent), that element's file and position, and the node's kind and
    // name - null if it isn't in a document read from a file
    private Object[] place(NodeInfo node) {
        int kind = node.getNodeKind();
        // by s9api: NodeInfo.getParent() returns another type in Saxon 13
        net.sf.saxon.s9api.XdmNode parent = kind == Type.ELEMENT ? null : new net.sf.saxon.s9api.XdmNode(node).getParent();
        NodeInfo element = kind == Type.ELEMENT ? node : parent == null ? null : parent.getUnderlyingNode();
        if (element == null || element.getNodeKind() != Type.ELEMENT || element.getSystemId() == null || element.getLineNumber() <= 0) {
            return null;
        }
        String path = paths.pathOf(element.getSystemId());
        // only a document's that was read from a file: a node the stylesheet constructs - e.g. in a temporary tree, a
        // parentless element, or an XSpec test's inline context - has the location of the instruction that constructed it
        if (path == null || !isFromFile(element)) {
            return null;
        }
        String name = kind == Type.ELEMENT ? "element:" + node.getDisplayName() : kind == Type.ATTRIBUTE ? "attribute:" + node.getDisplayName() :
                kind == Type.TEXT ? (isWhitespace(node) ? "whitespace" : "text") : kind == Type.COMMENT ? "comment" : kind == Type.PROCESSING_INSTRUCTION ? "pi:" + node.getDisplayName() : null;
        return name == null ? null : new Object[] { element, path, name };
    }

    // for the output mapping: the input node that was the context item - {path, line, column, node}, as for a node here
    Map<String, Object> position(NodeInfo node) {
        Object[] place = place(node);
        if (place == null) {
            return null;
        }
        NodeInfo element = (NodeInfo) place[0];
        return Json.obj().with("path", place[1]).with("line", element.getLineNumber()).with("column", element.getColumnNumber()).with("node", place[2]);
    }

    private void record(NodeInfo node, int ruleId) {
        Object[] place = place(node);
        if (place == null) {
            return;
        }
        NodeInfo element = (NodeInfo) place[0];
        String path = (String) place[1];
        String name = (String) place[2];
        Integer nameId = nameIds.get(name);
        if (nameId == null) {
            nameId = names.size();
            nameIds.put(name, nameId);
            names.add(name);
        }
        Map<Long, int[]> file = files.get(path);
        if (file == null) {
            file = new HashMap<Long, int[]>();
            files.put(path, file);
        }
        long position = ((long) element.getLineNumber() << 32) | (element.getColumnNumber() & 0xffffffffL);
        int[] triples = file.get(position);
        if (triples == null) {
            if (positions >= MAX_POSITIONS) {
                truncated = true;
                return;
            }
            positions++;
            // the first slot: the number of triples used
            triples = new int[1 + 3 * 2];
        }
        int used = triples[0];
        for (int i = 0; i < used; i++) {
            if (triples[1 + 3 * i] == nameId && triples[2 + 3 * i] == ruleId) {
                triples[3 + 3 * i]++;
                file.put(position, triples);
                return;
            }
        }
        if (1 + 3 * (used + 1) > triples.length) {
            triples = java.util.Arrays.copyOf(triples, triples.length * 2 + 1);
        }
        triples[1 + 3 * used] = nameId;
        triples[2 + 3 * used] = ruleId;
        triples[3 + 3 * used] = 1;
        triples[0] = used + 1;
        file.put(position, triples);
    }

    // the tree last checked, and whether it's a document read from a file - checked once for each tree, not each node
    private net.sf.saxon.om.TreeInfo lastTree;
    private boolean lastTreeFromFile;

    private boolean isFromFile(NodeInfo element) {
        net.sf.saxon.om.TreeInfo tree = element.getTreeInfo();
        if (tree != lastTree) {
            lastTree = tree;
            net.sf.saxon.s9api.XdmNode root = new net.sf.saxon.s9api.XdmNode(tree.getRootNode());
            lastTreeFromFile = root.getNodeKind() == net.sf.saxon.s9api.XdmNodeKind.DOCUMENT && root.getDocumentURI() != null;
        }
        return lastTreeFromFile;
    }

    // a whitespace-only text node: told apart from other text, as there are usually many, processed by built-in rules
    private static boolean isWhitespace(NodeInfo node) {
        String value = new net.sf.saxon.s9api.XdmNode(node).getStringValue();
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c != ' ' && c != '\t' && c != '\n' && c != '\r') {
                return false;
            }
        }
        return true;
    }

    boolean isEmpty() {
        return files.isEmpty();
    }

    // {rules, names, files: {path: [line, column, n, (name, rule, count) x n, ...]}, truncated}
    Map<String, Object> toJson() {
        Json.Obj byFile = Json.obj();
        for (Map.Entry<String, Map<Long, int[]>> file : files.entrySet()) {
            List<Object> flat = new ArrayList<Object>();
            for (Map.Entry<Long, int[]> entry : file.getValue().entrySet()) {
                int[] triples = entry.getValue();
                flat.add((int) (entry.getKey() >>> 32));
                flat.add((int) (long) entry.getKey());
                flat.add(triples[0]);
                for (int i = 0; i < 3 * triples[0]; i++) {
                    flat.add(triples[1 + i]);
                }
            }
            byFile.with(file.getKey(), flat);
        }
        return Json.obj().with("rules", rules).with("names", names).with("files", byFile).with("truncated", truncated ? Boolean.TRUE : null);
    }
}
