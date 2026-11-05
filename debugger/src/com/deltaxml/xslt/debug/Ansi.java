package com.deltaxml.xslt.debug;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * ANSI color in text for the Debug Console, e.g. from xdm:debug-color or a logpoint's values. VS Code's Debug Console
 * shows each line of an output event on its own, with its colors - unlike a terminal, a color set on one line isn't
 * carried to the next - so text whose color spans lines is written with each line's color set at its start, and reset
 * at its end.
 */
final class Ansi {
    private static final Pattern SGR = Pattern.compile("\u001B\\[([0-9;]*)m");
    private static final String RESET = "\u001B[0m";

    private Ansi() {
    }

    // the text, with each line's colors its own - unchanged if it has none
    static String perLine(String text) {
        return perLine(text, new String[1]);
    }

    // the same, for text that continues text before it, e.g. in an earlier output event: active holds the color set
    // and not reset at its end, if any - updated for the text's end
    static String perLine(String text, String[] active) {
        return text.indexOf('\u001B') < 0 && active[0] == null ? text : perLine(text, active[0], active);
    }

    private static String perLine(String text, String initial, String[] last) {
        StringBuilder sb = new StringBuilder(text.length() + 32);
        // the last color set, and not reset since
        String active = initial;
        int start = 0;
        while (start < text.length()) {
            int end = text.indexOf('\n', start);
            String line = end < 0 ? text.substring(start) : text.substring(start, end);
            if (active != null && !line.isEmpty()) {
                sb.append(active);
            }
            sb.append(line);
            Matcher m = SGR.matcher(line);
            while (m.find()) {
                String parameters = m.group(1);
                active = parameters.isEmpty() || parameters.matches("0+") ? null : m.group();
            }
            if (active != null && !line.isEmpty()) {
                sb.append(RESET);
            }
            if (end < 0) {
                break;
            }
            sb.append('\n');
            start = end + 1;
        }
        last[0] = active;
        return sb.toString();
    }
}
