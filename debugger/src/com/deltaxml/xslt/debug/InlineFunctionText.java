/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debug adapter
 */
package com.deltaxml.xslt.debug;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Where an inline function's body is in the text of the XPath expression it's in - e.g. 'function($x) { $x * 2 }' or,
 * in XPath 4.0, 'fn($x) { ... }' - found from its parameters, as Saxon compiles them: those it declares, then one for
 * each variable from outside it that it uses. Found in the text, rather than from the compiled expression, as Saxon's
 * locations within an attribute don't give the line each part is on.
 */
final class InlineFunctionText {

    private static final Pattern KEYWORD = Pattern.compile("(?<![\\w.:$-])(function|fn)\\s*([({])");
    private static final Pattern PARAMETER = Pattern.compile("\\$\\s*((?:[\\p{L}_][\\p{L}\\p{N}_.\\-]*:)?[\\p{L}_][\\p{L}\\p{N}_.\\-]*)");

    // the body: from just after its '{' to its '}' - and the number of parameters the function declares
    final int bodyStart;
    final int bodyEnd;
    final int declaredParameters;

    private InlineFunctionText(int bodyStart, int bodyEnd, int declaredParameters) {
        this.bodyStart = bodyStart;
        this.bodyEnd = bodyEnd;
        this.declaredParameters = declaredParameters;
    }

    // the first inline function in the text whose declared parameters are the first of these, and whose body uses the
    // others, as variables from outside it - null if there's none
    static InlineFunctionText find(String xpath, List<String> parameters) {
        String text = blanked(xpath);
        Matcher m = KEYWORD.matcher(text);
        while (m.find()) {
            List<String> declared = new ArrayList<String>();
            int braceOpen;
            if (m.group(2).equals("{")) {
                // an XPath 4.0 focus function, 'fn { ... }': its one parameter is the context item
                braceOpen = m.end() - 1;
                declared.add(null);
            } else {
                int close = closing(text, m.end() - 1, '(', ')');
                if (close < 0) {
                    continue;
                }
                Matcher p = PARAMETER.matcher(text.substring(m.end(), close));
                while (p.find()) {
                    declared.add(p.group(1));
                }
                // after the parameters, an optional 'as' type, then the body - not, e.g., 'instance of function(*)'
                braceOpen = bodyBrace(text, close + 1);
                if (braceOpen < 0) {
                    continue;
                }
            }
            int braceClose = closing(text, braceOpen, '{', '}');
            if (braceClose < 0 || !matches(declared, parameters, xpath.substring(braceOpen + 1, braceClose))) {
                continue;
            }
            return new InlineFunctionText(braceOpen + 1, braceClose, declared.size());
        }
        return null;
    }

    private static boolean matches(List<String> declared, List<String> parameters, String body) {
        if (parameters.size() < declared.size()) {
            return false;
        }
        for (int i = 0; i < declared.size(); i++) {
            // a focus function's parameter has a name Saxon makes up
            if (declared.get(i) != null && !declared.get(i).equals(parameters.get(i))) {
                return false;
            }
        }
        for (String captured : parameters.subList(declared.size(), parameters.size())) {
            if (!Pattern.compile("\\$\\s*" + Pattern.quote(captured) + "(?![\\p{L}\\p{N}_.\\-])").matcher(body).find()) {
                return false;
            }
        }
        return true;
    }

    // after an inline function's parameter list: the offset of its body's '{' - after any 'as' type - or -1
    private static int bodyBrace(String text, int from) {
        int i = skipSpace(text, from);
        if (text.startsWith("{", i)) {
            return i;
        }
        if (!text.startsWith("as", i) || i + 2 >= text.length() || !Character.isWhitespace(text.charAt(i + 2)) && text.charAt(i + 2) != '(') {
            return -1;
        }
        int depth = 0;
        for (int j = i + 2; j < text.length(); j++) {
            char c = text.charAt(j);
            if (c == '(' || c == '[') {
                depth++;
            } else if (c == ')' || c == ']') {
                if (depth == 0) {
                    return -1;
                }
                depth--;
            } else if (depth == 0 && c == '{') {
                return j;
            } else if (depth == 0 && (c == ',' || c == '}' || c == ';')) {
                return -1;
            }
        }
        return -1;
    }

    private static int skipSpace(String text, int i) {
        while (i < text.length() && Character.isWhitespace(text.charAt(i))) {
            i++;
        }
        return i;
    }

    // the offset of the bracket closing the one at 'open', or -1 - in text with strings and comments blanked
    private static int closing(String text, int open, char openChar, char closeChar) {
        int depth = 0;
        for (int i = open; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == openChar) {
                depth++;
            } else if (c == closeChar && --depth == 0) {
                return i;
            }
        }
        return -1;
    }

    // the text with the contents of string literals and comments replaced by spaces - so brackets and keywords in
    // them aren't counted - keeping every offset, and newline, as it is
    static String blanked(String xpath) {
        StringBuilder sb = new StringBuilder(xpath);
        for (int i = 0; i < sb.length(); i++) {
            char c = sb.charAt(i);
            if (c == '"' || c == '\'') {
                int j = i + 1;
                while (j < sb.length() && !(sb.charAt(j) == c && (j + 1 >= sb.length() || sb.charAt(j + 1) != c))) {
                    j += sb.charAt(j) == c ? 2 : 1;
                }
                blank(sb, i + 1, Math.min(j, sb.length()));
                i = j;
            } else if (c == '(' && i + 1 < sb.length() && sb.charAt(i + 1) == ':') {
                int end = sb.indexOf(":)", i + 2);
                int stop = end < 0 ? sb.length() : end + 2;
                blank(sb, i, stop);
                i = stop - 1;
            }
        }
        return sb.toString();
    }

    private static void blank(StringBuilder sb, int from, int to) {
        for (int k = from; k < to; k++) {
            if (sb.charAt(k) != '\n') {
                sb.setCharAt(k, ' ');
            }
        }
    }
}
