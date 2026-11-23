/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import net.sf.saxon.s9api.DocumentBuilder;
import net.sf.saxon.s9api.Processor;
import net.sf.saxon.s9api.XdmNode;
import net.sf.saxon.s9api.XdmNodeKind;

/**
 * For TraceRun's --rules: what processed each input file's elements, as the extension's input_rules tool summarises it
 * - the rules (template rules, and xsl:for-each, xsl:for-each-group and xsl:iterate) with how many elements each
 * processed, and the elements only built-in rules processed: no template matched them. From the adapter's xsltNodeRules
 * event (see NodeRules), whose elements are by the position where their start tags end - the file is read again, with
 * line numbers, for each element's path. Whitespace-only text the built-in rules processed isn't counted
 */
final class InputRulesSummary {
    private static final int MAX_LISTED = 20;
    private static final Pattern ATTRIBUTE = Pattern.compile("\\s(match|name|mode|priority)\\s*=\\s*([\"'])(.*?)\\2", Pattern.DOTALL);

    private InputRulesSummary() {
    }

    static void print(PrintStream out, Path cwd, Map<String, Object> event) {
        List<Object> rules = Json.array(event, "rules");
        List<Object> names = Json.array(event, "names");
        Map<String, Object> files = Json.object(event, "files");
        Map<Integer, String> labels = new HashMap<Integer, String>();
        for (Map.Entry<String, Object> file : files.entrySet()) {
            printFile(out, cwd, file.getKey(), asList(file.getValue()), rules, names, labels);
        }
        if (Json.bool(event, "truncated")) {
            out.println("(Only the first part of the input was recorded: it has more elements than the debugger records.)");
        }
    }

    private static void printFile(PrintStream out, Path cwd, String file, List<Object> flat, List<Object> rules, List<Object> names, Map<Integer, String> labels) {
        // each element's path, by the position where its start tag ends - as the event has it
        Map<Long, String> paths = new HashMap<Long, String>();
        int total = 0;
        try {
            DocumentBuilder builder = new Processor(false).newDocumentBuilder();
            builder.setLineNumbering(true);
            XdmNode document = builder.build(Paths.get(file).toFile());
            for (XdmNode element : document.select(net.sf.saxon.s9api.streams.Steps.descendant()).asListOfNodes()) {
                if (element.getNodeKind() == XdmNodeKind.ELEMENT) {
                    total++;
                    paths.put(((long) element.getLineNumber() << 32) | (element.getColumnNumber() & 0xffffffffL), Values.nodePath(element));
                }
            }
        } catch (Exception e) {
            out.println();
            out.println("--- Input rules for " + shown(cwd, file) + ": it couldn't be read again for its elements' paths - " + e.getMessage());
            return;
        }
        // by element: its rules, and whether only built-in rules processed it
        Map<String, int[]> byRule = new LinkedHashMap<String, int[]>();
        // by position: the path and what the built-in rules did - in document order, below
        java.util.TreeMap<Long, String[]> builtInOnly = new java.util.TreeMap<Long, String[]>();
        int byRules = 0;
        for (int i = 0; i < flat.size();) {
            int line = number(flat.get(i));
            int column = number(flat.get(i + 1));
            int n = number(flat.get(i + 2));
            i += 3;
            Set<String> elementRules = new LinkedHashSet<String>();
            Set<String> builtIns = new LinkedHashSet<String>();
            Map<String, Integer> times = new HashMap<String, Integer>();
            for (int k = 0; k < n; k++, i += 3) {
                String node = String.valueOf(names.get(number(flat.get(i))));
                int ruleId = number(flat.get(i + 1));
                int count = number(flat.get(i + 2));
                @SuppressWarnings("unchecked")
                Map<String, Object> rule = (Map<String, Object>) rules.get(ruleId);
                String builtIn = Json.string(rule, "builtIn");
                if (builtIn != null) {
                    if (!node.equals("whitespace")) {
                        String mode = Json.string(rule, "mode");
                        builtIns.add("built-in rule (" + builtIn + (mode != null && !mode.equals("#default") ? ", mode " + mode : "") + ") - " + effect(builtIn));
                    }
                } else {
                    String label = labels.computeIfAbsent(ruleId, (id) -> label(cwd, rule));
                    elementRules.add(label);
                    times.merge(label, count, Integer::sum);
                }
            }
            long position = ((long) line << 32) | (column & 0xffffffffL);
            String path = paths.getOrDefault(position, "line " + line);
            if (!elementRules.isEmpty()) {
                byRules++;
                for (String label : elementRules) {
                    int[] entry = byRule.computeIfAbsent(label, (l) -> new int[2]);
                    entry[0]++;
                    entry[1] += times.get(label);
                }
            } else if (!builtIns.isEmpty()) {
                builtInOnly.put(position, new String[] { path, path + " (line " + line + "): " + String.join("; ", builtIns) });
            }
        }
        out.println();
        out.println("--- Input rules for " + shown(cwd, file) + ": " + total + " elements - " + byRules + " processed by a template rule or an instruction " +
                "(or their attributes or text were), " + builtInOnly.size() + " only by built-in rules, " + Math.max(0, total - byRules - builtInOnly.size()) + " not selected by any");
        if (!byRule.isEmpty()) {
            out.println("Rules that processed its nodes:");
            List<Map.Entry<String, int[]>> sorted = new ArrayList<Map.Entry<String, int[]>>(byRule.entrySet());
            sorted.sort((a, b) -> b.getValue()[0] - a.getValue()[0]);
            for (Map.Entry<String, int[]> entry : sorted.subList(0, Math.min(MAX_LISTED, sorted.size()))) {
                int elements = entry.getValue()[0];
                int times = entry.getValue()[1];
                out.println("  " + entry.getKey() + ": " + elements + (elements == 1 ? " element" : " elements") + (times > elements ? " (" + times + " times)" : ""));
            }
            if (sorted.size() > MAX_LISTED) {
                out.println("  ... " + (sorted.size() - MAX_LISTED) + " more");
            }
        }
        if (!builtInOnly.isEmpty()) {
            // the topmost: an element's descendants that only built-in rules processed too are counted with it - the built-in
            // rule went on to them, so the element is where to look
            // - only through a parent that only built-in rules processed: an element a template processed breaks the chain
            Set<String> builtInPaths = new java.util.HashSet<String>();
            builtInOnly.values().forEach((element) -> builtInPaths.add(element[0]));
            Map<String, Integer> chainOf = new HashMap<String, Integer>();
            List<String[]> topmost = new ArrayList<String[]>();
            List<Integer> descendants = new ArrayList<Integer>();
            for (String[] element : builtInOnly.values()) {
                String parent = element[0].substring(0, Math.max(0, element[0].lastIndexOf('/')));
                Integer chain = builtInPaths.contains(parent) ? chainOf.get(parent) : null;
                if (chain != null) {
                    descendants.set(chain, descendants.get(chain) + 1);
                } else {
                    chain = topmost.size();
                    topmost.add(element);
                    descendants.add(0);
                }
                chainOf.put(element[0], chain);
            }
            out.println("Only built-in rules - no template matched them:");
            for (int k = 0; k < Math.min(MAX_LISTED, topmost.size()); k++) {
                int d = descendants.get(k);
                out.println("  " + topmost.get(k)[1] + (d > 0 ? " - and its " + d + (d == 1 ? " descendant" : " descendants") : ""));
            }
            if (topmost.size() > MAX_LISTED) {
                out.println("  ... " + (topmost.size() - MAX_LISTED) + " more");
            }
        }
    }

    // a rule as the stylesheet has it: e.g. 'xsl:template match="order" mode="summary" - report.xsl:12', with its attributes
    // read from its start tag - the debugger's label has neither its mode nor its priority
    private static String label(Path cwd, Map<String, Object> rule) {
        String label = Json.string(rule, "label");
        String path = Json.string(rule, "path");
        int line = (int) Json.number(rule, "line", 0);
        StringBuilder sb = new StringBuilder(label == null ? "a rule" : label);
        if (path != null && line > 0 && label != null && label.startsWith("xsl:template")) {
            try {
                List<String> lines = Files.readAllLines(Paths.get(path), StandardCharsets.UTF_8);
                StringBuilder tag = new StringBuilder();
                for (int l = line - 1; l < lines.size() && l < line + 10; l++) {
                    tag.append(' ').append(lines.get(l));
                    if (lines.get(l).contains(">")) {
                        break;
                    }
                }
                // the template's attributes as written - not the debugger's label, with Saxon's form of the pattern, e.g.
                // attribute(Q{}id) for @id
                Matcher m = ATTRIBUTE.matcher(tag.substring(0, tag.indexOf(">") > 0 ? tag.indexOf(">") : tag.length()));
                StringBuilder written = new StringBuilder("xsl:template");
                while (m.find()) {
                    written.append(' ').append(m.group(1)).append("=\"").append(m.group(3).replaceAll("\\s+", " ").trim()).append('"');
                }
                if (written.indexOf(" match=") > 0) {
                    sb.setLength(0);
                    sb.append(written);
                }
            } catch (Exception e) {
                // the label as it is
            }
        }
        return path != null && line > 0 ? sb + " - " + shown(cwd, path) + ":" + line : sb.toString();
    }

    // what a built-in rule does with an element (XSLT 3.0's on-no-match values)
    private static String effect(String builtIn) {
        switch (builtIn) {
            // as Saxon names it, and as XSLT's on-no-match does
            case "text-only":
            case "text-only-copy": return "its text is copied to the output as it is";
            case "shallow-copy": return "it is copied to the output, and its content processed";
            case "deep-copy": return "it is copied to the output with its content";
            case "shallow-skip": return "it is skipped, and its content processed";
            case "deep-skip": return "it is skipped with its content";
            case "fail": return "the run fails (XTDE0555)";
            default: return "no template matched";
        }
    }

    @SuppressWarnings("unchecked")
    private static List<Object> asList(Object value) {
        return value instanceof List ? (List<Object>) value : new ArrayList<Object>();
    }

    private static int number(Object value) {
        return value instanceof Number ? ((Number) value).intValue() : 0;
    }

    private static String shown(Path cwd, String path) {
        Path p = Paths.get(path);
        return p.startsWith(cwd) ? cwd.relativize(p).toString() : path;
    }
}
