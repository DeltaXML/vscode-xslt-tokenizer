/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.io.File;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import javax.xml.parsers.SAXParser;
import javax.xml.parsers.SAXParserFactory;

import org.xml.sax.Attributes;
import org.xml.sax.InputSource;
import org.xml.sax.Locator;
import org.xml.sax.helpers.DefaultHandler;

/**
 * The lines of a stylesheet where execution can stop. Saxon reports each instruction's location as that of the end
 * of its start tag - the line of its '>' - so a breakpoint anywhere within a multi-line start tag (including within a
 * multi-line XPath expression in an attribute, whose parts Saxon doesn't trace separately) is moved to that line. A
 * breakpoint where no instruction is traced (a comment, text, blank line, xsl:note, a declaration or a child element
 * like xsl:sort) is rejected.
 *
 * The rules were found by tracing Saxon 12.8 and 13.1 - an XSLT element not listed as untraced is assumed to be a
 * traced instruction, so a new instruction is breakable by default.
 */
final class BreakableLines {

    private static final String XSLT_NS = "http://www.w3.org/1999/XSL/Transform";

    // XSLT elements Saxon doesn't trace: declarations, and instructions' child elements and parts
    private static final Set<String> UNTRACED = new HashSet<String>(Arrays.asList(
            "stylesheet", "transform", "package", "output", "key", "import", "include", "mode", "decimal-format",
            "namespace-alias", "preserve-space", "strip-space", "character-map", "output-character", "import-schema",
            "use-package", "expose", "accept", "override", "global-context-item", "item-type", "record-type",
            "sort", "with-param", "when", "otherwise", "catch", "fallback", "map", "map-entry", "perform-sort",
            "matching-substring", "non-matching-substring", "on-completion", "context-item", "merge-source",
            "merge-key"));

    // XSLT elements whose content is never executed as instructions
    private static final Set<String> UNEXECUTED_CONTENT = new HashSet<String>(Arrays.asList("note", "attribute-set"));

    // instructions whose location Saxon reports as that of their first child element (xsl:choose only in Saxon 13)
    private static final Set<String> REPORTED_AT_FIRST_CHILD = new HashSet<String>(Arrays.asList("try", "array", "choose"));

    /** a start tag: the lines it spans, and whether execution can stop at it */
    private static final class Tag {
        final int startLine;
        final int endLine;
        final String name;
        final String untracedReason;
        int firstChildEndLine;
        final List<XPathAttribute> xpathAttributes = new ArrayList<XPathAttribute>();

        Tag(int startLine, int endLine, String name, String untracedReason) {
            this.startLine = startLine;
            this.endLine = endLine;
            this.name = name;
            this.untracedReason = untracedReason;
        }
    }

    // XPath attributes whose expressions are evaluated in the instruction's own context - so they can be evaluated
    // separately there, for stepping through (others, e.g. group-by, are evaluated for each item)
    private static final Set<String> XPATH_ATTRIBUTES = new HashSet<String>(Arrays.asList("select", "test", "value"));

    /** a multi-line XPath expression in an instruction's attribute */
    static final class XPathAttribute {
        final String elementName;
        final String name;
        // the expression, as the XML parser would give it to Saxon - except that newlines outside string literals
        // are kept, so its line numbers are those of the stylesheet
        final String xpath;
        // where the expression starts: the attribute value's first character
        final int line;
        final int column;
        final int lastLine;
        // the stylesheet lines with the start of an expression on them
        final Set<Integer> expressionLines = new HashSet<Integer>();

        XPathAttribute(String elementName, String name, String xpath, int line, int column, int lastLine) {
            this.elementName = elementName;
            this.name = name;
            this.xpath = xpath;
            this.line = line;
            this.column = column;
            this.lastLine = lastLine;
        }
    }

    /** where a breakpoint requested at a line goes */
    static final class Resolution {
        final boolean verified;
        final int line;
        // further lines where Saxon may report the same instruction
        final List<Integer> aliasLines;
        final String message;

        Resolution(boolean verified, int line, List<Integer> aliasLines, String message) {
            this.verified = verified;
            this.line = line;
            this.aliasLines = aliasLines;
            this.message = message;
        }
    }

    private final List<Tag> tags = new ArrayList<Tag>();

    private BreakableLines() { }

    /** the stylesheet's breakable lines - null if it can't be parsed, when all breakpoints are accepted */
    static BreakableLines forFile(String path) {
        try {
            return parse(new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8), new File(path).toURI().toString());
        } catch (Exception e) {
            return null;
        }
    }

    static BreakableLines parse(final String text, String systemId) throws Exception {
        final BreakableLines result = new BreakableLines();
        final int[] lineStarts = lineStarts(text);
        SAXParserFactory factory = SAXParserFactory.newInstance();
        factory.setNamespaceAware(true);
        try {
            factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        } catch (Exception e) {
            // not supported by this parser
        }
        SAXParser parser = factory.newSAXParser();
        DefaultHandler handler = new DefaultHandler() {
            private Locator locator;
            // for each open element: its tag, and whether its descendants are executed
            private final Deque<Tag> open = new ArrayDeque<Tag>();
            private final Deque<Boolean> executed = new ArrayDeque<Boolean>();

            @Override
            public void setDocumentLocator(Locator locator) {
                this.locator = locator;
            }

            @Override
            public InputSource resolveEntity(String publicId, String systemId) {
                return new InputSource(new StringReader(""));
            }

            @Override
            public void startElement(String uri, String localName, String qName, Attributes attributes) {
                // the locator is at the end of the start tag; the tag starts at the '<' before it - which can't
                // appear within an attribute value
                int endLine = locator.getLineNumber();
                int endOffset = Math.min(text.length(), lineStarts[Math.min(endLine, lineStarts.length) - 1] + Math.max(locator.getColumnNumber() - 1, 0));
                int startOffset = text.lastIndexOf('<', Math.max(endOffset - 1, 0));
                int startLine = startOffset < 0 ? endLine : lineOf(lineStarts, startOffset);

                Tag parent = open.peek();
                boolean parentExecuted = executed.isEmpty() || executed.peek();
                boolean isXslt = XSLT_NS.equals(uri);
                String reason = null;
                if (!parentExecuted) {
                    reason = "isn't executed";
                } else if (isXslt && UNTRACED.contains(localName)) {
                    reason = "isn't an instruction Saxon can stop at";
                } else if (isXslt && localName.equals("param") && parent != null &&
                        (parent.name.equals("xsl:function") || parent.name.equals("xsl:iterate"))) {
                    reason = "isn't an instruction Saxon can stop at";
                } else if (!isXslt && parent != null && parent.name.matches("xsl:(stylesheet|transform|package)")) {
                    reason = "is a top-level data element, which isn't executed";
                } else if (isXslt && UNEXECUTED_CONTENT.contains(localName)) {
                    reason = "isn't executed";
                }
                Tag tag = new Tag(startLine, endLine, isXslt ? "xsl:" + localName : qName, reason);
                if (isXslt && reason == null && startOffset >= 0 && startLine < endLine) {
                    addXPathAttributes(tag, text, lineStarts, startOffset, endOffset);
                }
                if (parent != null && parent.firstChildEndLine == 0) {
                    parent.firstChildEndLine = endLine;
                }
                result.tags.add(tag);
                open.push(tag);
                executed.push(parentExecuted && !(isXslt && UNEXECUTED_CONTENT.contains(localName)) &&
                        !(reason != null && reason.startsWith("is a top-level")));
            }

            @Override
            public void endElement(String uri, String localName, String qName) {
                open.pop();
                executed.pop();
            }
        };
        InputSource source = new InputSource(new StringReader(text));
        source.setSystemId(systemId);
        parser.parse(source, handler);
        return result;
    }

    Resolution resolve(int line) {
        Tag best = null;
        for (Tag tag : tags) {
            if (tag.startLine <= line && line <= tag.endLine) {
                // a breakable tag ending on this line, else the first that does from a start tag spanning it
                if (best == null || (tag.untracedReason == null && (best.untracedReason != null || tag.endLine < best.endLine))) {
                    best = tag;
                }
                if (tag.untracedReason == null && tag.endLine == line) {
                    break;
                }
            }
        }
        if (best == null) {
            return new Resolution(false, line, new ArrayList<Integer>(), "No XSLT instruction or literal result element starts on this line");
        } else if (best.untracedReason != null) {
            return new Resolution(false, line, new ArrayList<Integer>(), best.name + " " + best.untracedReason);
        }
        if (line != best.endLine && line != best.startLine) {
            // within a multi-line XPath expression: stops there when the expression is stepped through (on the
            // start tag's first or last line, the breakpoint is for the instruction)
            for (XPathAttribute attribute : best.xpathAttributes) {
                if (attribute.line <= line && line <= attribute.lastLine) {
                    return attribute.expressionLines.contains(line) ? new Resolution(true, line, new ArrayList<Integer>(), null) :
                            new Resolution(false, line, new ArrayList<Integer>(), "No XPath expression starts on this line");
                }
            }
        }
        List<Integer> aliases = new ArrayList<Integer>();
        String localName = best.name.startsWith("xsl:") ? best.name.substring(4) : "";
        if (REPORTED_AT_FIRST_CHILD.contains(localName) && best.firstChildEndLine > 0 && best.firstChildEndLine != best.endLine) {
            aliases.add(best.firstChildEndLine);
        }
        return new Resolution(true, best.endLine, aliases, null);
    }

    /** the multi-line XPath attributes of the traced instruction whose start tag ends on this line */
    List<XPathAttribute> xpathAttributesAt(int endLine) {
        for (Tag tag : tags) {
            if (tag.endLine == endLine && !tag.xpathAttributes.isEmpty()) {
                return tag.xpathAttributes;
            }
        }
        return new ArrayList<XPathAttribute>();
    }

    private static final java.util.regex.Pattern ATTRIBUTE = java.util.regex.Pattern.compile("\\s([\\w.:-]+)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')");
    // keywords that don't start an expression of their own (an operator's expression starts at its first operand)
    private static final Set<String> NON_STARTING_KEYWORDS = new HashSet<String>(Arrays.asList(
            "return", "then", "else", "satisfies", "in", "at", "and", "or", "div", "idiv", "mod", "eq", "ne", "lt",
            "le", "gt", "ge", "is", "to", "union", "intersect", "except", "instance", "of", "treat", "as",
            "castable", "cast", "otherwise"));
    private static final java.util.regex.Pattern TOKEN = java.util.regex.Pattern.compile(
            "\\(:.*?:\\)|\"(?:[^\"]|\"\")*\"?|'(?:[^']|'')*'?|\\d+(?:\\.\\d*)?(?:[eE][+-]?\\d+)?|\\.\\d+|[$@.\\[]|[\\p{L}_][\\p{L}\\p{N}_.\\-]*(?::[\\p{L}_*][\\p{L}\\p{N}_.\\-]*)?");

    // whether an expression (other than a literal, which isn't stopped at) starts on a line of an expression - as
    // the expression's parts are reported where they start
    static boolean startsExpression(String line) {
        java.util.regex.Matcher m = TOKEN.matcher(line);
        while (m.find()) {
            String token = m.group();
            char first = token.charAt(0);
            if (first == '(' || first == '"' || first == '\'' || Character.isDigit(first) || (first == '.' && token.length() > 1)) {
                // a comment, string literal or number
                continue;
            }
            // a variable reference, attribute, context item, array constructor or predicate, or a name
            if (first == '$' || first == '@' || first == '.' || first == '[' || !NON_STARTING_KEYWORDS.contains(token)) {
                return true;
            }
        }
        return false;
    }

    private static void addXPathAttributes(Tag tag, String text, int[] lineStarts, int startOffset, int endOffset) {
        java.util.regex.Matcher m = ATTRIBUTE.matcher(text.substring(startOffset, endOffset));
        while (m.find()) {
            String value = m.group(2) != null ? m.group(2) : m.group(3);
            int group = m.group(2) != null ? 2 : 3;
            if (!XPATH_ATTRIBUTES.contains(m.group(1)) || value.indexOf('\n') < 0) {
                continue;
            }
            int valueOffset = startOffset + m.start(group);
            int line = lineOf(lineStarts, valueOffset);
            int column = valueOffset - lineStarts[line - 1] + 1;
            String[] valueLines = value.split("\n", -1);
            XPathAttribute attribute = new XPathAttribute(tag.name, m.group(1), xpathText(value), line, column, line + valueLines.length - 1);
            for (int i = 0; i < valueLines.length; i++) {
                if (startsExpression(valueLines[i])) {
                    attribute.expressionLines.add(line + i);
                }
            }
            tag.xpathAttributes.add(attribute);
        }
    }

    // an attribute value as the XML parser gives it: character and entity references replaced, and whitespace
    // characters as spaces - except, outside string literals, newlines, so the expression keeps its line numbers
    static String xpathText(String value) {
        String text = value.replace("\r\n", "\n");
        StringBuilder decoded = new StringBuilder();
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            int semicolon = c == '&' ? text.indexOf(';', i) : -1;
            if (semicolon > i) {
                String name = text.substring(i + 1, semicolon);
                String replacement = name.equals("lt") ? "<" : name.equals("gt") ? ">" : name.equals("amp") ? "&" :
                        name.equals("quot") ? "\"" : name.equals("apos") ? "'" : null;
                if (replacement == null && name.startsWith("#")) {
                    try {
                        int code = name.startsWith("#x") ? Integer.parseInt(name.substring(2), 16) : Integer.parseInt(name.substring(1));
                        replacement = new String(Character.toChars(code));
                    } catch (Exception e) {
                        replacement = null;
                    }
                }
                if (replacement != null) {
                    decoded.append(replacement);
                    i = semicolon;
                    continue;
                }
            }
            decoded.append(c);
        }
        StringBuilder result = new StringBuilder();
        char quote = 0;
        for (int i = 0; i < decoded.length(); i++) {
            char c = decoded.charAt(i);
            if (quote == 0 && (c == '"' || c == '\'')) {
                quote = c;
            } else if (quote != 0 && c == quote) {
                // a doubled quote is an escaped quote, still in the literal
                if (i + 1 < decoded.length() && decoded.charAt(i + 1) == quote) {
                    result.append(c);
                    i++;
                } else {
                    quote = 0;
                }
            }
            result.append(quote == 0 && c == '\n' ? '\n' : Character.isWhitespace(c) ? ' ' : c);
        }
        return result.toString();
    }

    private static int[] lineStarts(String text) {
        List<Integer> starts = new ArrayList<Integer>();
        starts.add(0);
        for (int i = 0; i < text.length(); i++) {
            if (text.charAt(i) == '\n') {
                starts.add(i + 1);
            }
        }
        int[] result = new int[starts.size()];
        for (int i = 0; i < result.length; i++) {
            result[i] = starts.get(i);
        }
        return result;
    }

    // the 1-based line of an offset
    private static int lineOf(int[] lineStarts, int offset) {
        int index = Arrays.binarySearch(lineStarts, offset);
        return (index >= 0 ? index : -index - 2) + 1;
    }
}
