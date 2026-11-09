/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT profile
 */

// Saxon's timing profile (-TP), as XML: Saxon applies the stylesheet given with -TPxsl to its profile data, and
// xslt-resources/profile/profile-xml.xsl copies it unchanged. It's flat - one entry for each template, function and
// global variable or parameter that ran, with no record of which called which:
//
//   <trace t-total="16.4655">
//     <fn match="element(Q{}order)" construct="xsl:template" file="file:/.../order-report.xsl" line="85" count="2"
//         t-sum-net="1.376834" t-avg-net="0.688417" t-sum="4.874209" t-avg="2.4371045"/>
//
// Times are in milliseconds: t-sum and t-avg are gross (including the templates and functions called), t-sum-net and
// t-avg-net net (excluding them). A named component has name, a match template match - in Saxon's normalised form,
// e.g. document-node()/element(Q{}orders) for /orders. line is where the declaration's start tag ends

export interface ProfileEntry {
    // e.g. 'xsl:template', 'xsl:function', 'xsl:variable', 'xsl:param'
    construct: string;
    name?: string;
    match?: string;
    // a file: URI
    file: string;
    // 1-based: the line of the end of the declaration's start tag
    line: number;
    count: number;
    net: number;
    avgNet: number;
    gross: number;
    avgGross: number;
}

export interface Profile {
    // the whole run, in milliseconds - also the time outside templates, functions and globals, e.g. parsing the source
    total: number;
    entries: ProfileEntry[];
    // how many runs the file has a trace for - with more than one, the entries and total are the average of all but the
    // first (see parse)
    runs: number;
}

// where a profile entry's declaration is in its module's text, and its attributes as written
export interface ProfileDeclaration {
    attributes: Map<string, string>;
    // 0-based
    line: number;
    character: number;
    // the name or match attribute's value, else the element name - the part to select on going to the declaration
    selection: { line: number; character: number; endLine: number; endCharacter: number };
}

export class XsltProfile {

    // the profile in Saxon's XML, or undefined if it isn't one. With -repeat:N, Saxon writes a trace for each run, one
    // after another: the first run's times are mostly the JVM's start-up and warm-up, so it's left out, and the times
    // are the average of the other runs - each entry's calls, net and gross times their mean, and its times a call
    // those totals over its calls
    public static parse(xml: string): Profile | undefined {
        const traces = XsltProfile.traces(xml);
        if (traces.length === 0) {
            return undefined;
        }
        if (traces.length === 1) {
            return { ...traces[0], runs: 1 };
        }
        const warm = traces.slice(1);
        const sums = new Map<string, ProfileEntry>();
        for (const trace of warm) {
            for (const e of trace.entries) {
                const key = [e.construct, e.name, e.match, e.file, e.line].join('\u0000');
                const sum = sums.get(key);
                if (sum) {
                    sum.count += e.count;
                    sum.net += e.net;
                    sum.gross += e.gross;
                } else {
                    sums.set(key, { ...e });
                }
            }
        }
        const n = warm.length;
        const entries = [...sums.values()].map((sum) => ({
            ...sum, count: sum.count / n, net: sum.net / n, gross: sum.gross / n,
            avgNet: sum.count > 0 ? sum.net / sum.count : 0, avgGross: sum.count > 0 ? sum.gross / sum.count : 0
        }));
        const total = warm.reduce((s, trace) => s + trace.total, 0) / n;
        return { total, entries, runs: traces.length };
    }

    // each run's trace in the file
    private static traces(xml: string): { total: number; entries: ProfileEntry[] }[] {
        const traces: { total: number; entries: ProfileEntry[] }[] = [];
        const tagRgx = /<(trace|fn)\b((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/g;
        let tag: RegExpExecArray | null;
        while ((tag = tagRgx.exec(xml))) {
            const a = XsltProfile.attributes(tag[2]);
            const number = (name: string) => Number(a.get(name) ?? NaN);
            if (tag[1] === 'trace') {
                traces.push({ total: number('t-total'), entries: [] });
            } else if (traces.length > 0) {
                traces[traces.length - 1].entries.push({
                    construct: a.get('construct') ?? '',
                    name: a.get('name'),
                    match: a.get('match'),
                    file: a.get('file') ?? '',
                    line: number('line'),
                    count: number('count'),
                    net: number('t-sum-net'),
                    avgNet: number('t-avg-net'),
                    gross: number('t-sum'),
                    avgGross: number('t-avg'),
                });
            }
        }
        return traces;
    }

    // how the runs a profile is from are described, e.g. 'average of runs 2-5' - with the runs asked for, if fewer ran
    public static runsText(runs: number, requestedRuns: number): string {
        const text = runs <= 1 ? '1 run' : runs === 2 ? 'run 2, after a warm-up run' : `average of runs 2–${runs}`;
        return runs < requestedRuns ? `${text} (${runs} of ${requestedRuns} ran)` : text;
    }

    // a task's stylesheet parameters as the Profile view shows them: '$name' and the value - for a value from a tasks.json
    // input that asks for it (an id starting with inputPrefix, then the parameter's name), the value entered, if known.
    // A name starting with '?' is Saxon's for a value that's an XPath expression
    public static parameterSettings(parameters: { name: string; value: string }[] | undefined, inputPrefix: string,
        entered: (name: string) => string | undefined): { label: string; value: string; note?: string }[] {
        return (parameters ?? []).map(({ name, value }) => {
            const xpath = name.startsWith('?');
            const label = '$' + (xpath ? name.substring(1) : name);
            const input = /^\$\{input:([^}]+)\}$/.exec(value)?.[1];
            const enteredValue = input?.startsWith(inputPrefix) ? entered(input.substring(inputPrefix.length)) : undefined;
            const note = enteredValue !== undefined ? (xpath ? 'entered, XPath' : 'entered') : xpath ? 'XPath' : undefined;
            return { label, value: enteredValue ?? value, note };
        });
    }

    // of the profiles kept (newest first), those to keep and those to remove: at most perStylesheet for each stylesheet,
    // and at most overall in all
    public static prune<T extends { stylesheet: string }>(history: T[], perStylesheet: number, overall: number): { kept: T[]; removed: T[] } {
        const counts = new Map<string, number>();
        const kept: T[] = [];
        const removed: T[] = [];
        for (const entry of history) {
            const count = counts.get(entry.stylesheet) ?? 0;
            if (count < perStylesheet && kept.length < overall) {
                counts.set(entry.stylesheet, count + 1);
                kept.push(entry);
            } else {
                removed.push(entry);
            }
        }
        return { kept, removed };
    }

    // the time spent in templates, functions and globals: the sum of the net times. Each net time is then a share of
    // it - the shares add up to 100%, as gross times, which include each other, wouldn't
    public static netTotal(profile: Profile): number {
        return profile.entries.reduce((sum, e) => sum + (Number.isFinite(e.net) ? e.net : 0), 0);
    }

    // the declaration for a profile entry in its module's text: the element of the construct (with any prefix) whose start
    // tag ends on the entry's line - or for a start tag over several lines, the last that starts by then
    public static declarationAt(text: string, construct: string, line: number): ProfileDeclaration | undefined {
        const tagRgx = XsltProfile.startTagRegExp(construct);
        if (!tagRgx) {
            return undefined;
        }
        const lineStarts = XsltProfile.lineStarts(text);
        if (line < 1 || line > lineStarts.length) {
            return undefined;
        }
        const lineStart = lineStarts[line - 1];
        const lineEnd = line < lineStarts.length ? lineStarts[line] : text.length;
        // the start tag ending on the line, else (e.g. for a line Saxon counts differently) the last starting by its end
        let endsOnLine: RegExpExecArray | undefined;
        let startsBefore: RegExpExecArray | undefined;
        let m: RegExpExecArray | null;
        while ((m = tagRgx.exec(text)) && m.index < lineEnd) {
            const tagEnd = m.index + m[0].length;
            if (tagEnd > lineStart && tagEnd <= lineEnd) {
                endsOnLine = m;
            }
            startsBefore = m;
        }
        const found = endsOnLine ?? startsBefore;
        return found ? XsltProfile.declaration(found, lineStarts) : undefined;
    }

    // what identifies a profiled declaration in its module as it's edited: a match template by its pattern and mode,
    // anything else by its name - undefined if it has neither
    public static declarationKey(construct: string, attributes: Map<string, string>): string | undefined {
        const name = attributes.get('name');
        if (name !== undefined) {
            return construct.replace(/^[^:]*:/, '') + ' ' + name;
        }
        const match = attributes.get('match');
        return match !== undefined ? 'match ' + match.replace(/\s+/g, ' ').trim() + ' mode ' + (attributes.get('mode') ?? '') : undefined;
    }

    // the declaration with the key in the module's text as it is now - of several (e.g. a function's overloads by arity,
    // or a global variable and a local one with its name), the one nearest the 0-based line where it was
    public static relocate(text: string, construct: string, key: string, line: number): ProfileDeclaration | undefined {
        return XsltProfile.nearest(XsltProfile.declarationsOf(text, construct), construct, key, line);
    }

    // every element of the construct in the module's text - to find several declarations in it with nearest
    public static declarationsOf(text: string, construct: string): ProfileDeclaration[] {
        const tagRgx = XsltProfile.startTagRegExp(construct);
        if (!tagRgx) {
            return [];
        }
        const lineStarts = XsltProfile.lineStarts(text);
        const declarations: ProfileDeclaration[] = [];
        let m: RegExpExecArray | null;
        while ((m = tagRgx.exec(text))) {
            declarations.push(XsltProfile.declaration(m, lineStarts));
        }
        return declarations;
    }

    // of the declarations with the key, the one nearest the 0-based line
    public static nearest(declarations: ProfileDeclaration[], construct: string, key: string, line: number): ProfileDeclaration | undefined {
        let nearest: ProfileDeclaration | undefined;
        for (const declaration of declarations) {
            if (XsltProfile.declarationKey(construct, declaration.attributes) === key &&
                (!nearest || Math.abs(declaration.line - line) < Math.abs(nearest.line - line))) {
                nearest = declaration;
            }
        }
        return nearest;
    }

    // a start tag of the construct's element, with any prefix: the element name, then the attributes
    private static startTagRegExp(construct: string): RegExp | undefined {
        const localName = construct.replace(/^[^:]*:/, '');
        if (!/^[\w.-]+$/.test(localName)) {
            return undefined;
        }
        return new RegExp(`<((?:[\\w.-]+:)?${localName.replace(/[.]/g, '\\.')})(?=[\\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'g');
    }

    private static declaration(found: RegExpExecArray, lineStarts: number[]): ProfileDeclaration {
        const position = (offset: number) => {
            const l = XsltProfile.lineOf(lineStarts, offset);
            return { line: l, character: offset - lineStarts[l] };
        };
        const attributesText = found[2];
        const attributesOffset = found.index + 1 + found[1].length;
        // as written, for the selection's length - the values shown have references replaced
        const written = XsltProfile.attributes(attributesText, false);
        const attributes = XsltProfile.attributes(attributesText);
        let selectionStart = found.index + 1;
        let selectionEnd = selectionStart + found[1].length;
        for (const attributeName of ['name', 'match']) {
            const valueRgx = new RegExp(`(?:^|\\s)${attributeName}\\s*=\\s*(["'])`);
            const valueMatch = valueRgx.exec(attributesText);
            if (valueMatch) {
                selectionStart = attributesOffset + valueMatch.index + valueMatch[0].length;
                selectionEnd = selectionStart + (written.get(attributeName) ?? '').length;
                break;
            }
        }
        const start = position(found.index);
        const selStart = position(selectionStart);
        const selEnd = position(selectionEnd);
        return {
            attributes, line: start.line, character: start.character,
            selection: { line: selStart.line, character: selStart.character, endLine: selEnd.line, endCharacter: selEnd.character }
        };
    }

    // how a profile entry is shown: its kind, e.g. 'template', and for a match template, the pattern as written in the
    // declaration (Saxon reports it normalised, e.g. element(Q{}order) for order) and its mode - for a named template or
    // function, the name, and for a global, '$' and the name. Saxon's values are used if the declaration isn't found
    public static rowLabel(entry: ProfileEntry, declaration: ProfileDeclaration | undefined): { kind: string; label: string; mode?: string } {
        const kind = entry.construct.replace(/^[^:]*:/, '');
        const attributes = declaration?.attributes;
        const name = attributes?.get('name') ?? entry.name;
        const match = attributes?.get('match') ?? entry.match;
        const mode = kind === 'template' && match !== undefined ? attributes?.get('mode') : undefined;
        if (kind === 'variable' || kind === 'param') {
            return { kind, label: '$' + (name ?? '?') };
        }
        return { kind, label: name ?? match ?? '?', mode: name === undefined ? mode : undefined };
    }

    // an attribute list's names and values - with entity and character references replaced, unless decode is false
    public static attributes(text: string, decode = true): Map<string, string> {
        const result = new Map<string, string>();
        const rgx = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let m: RegExpExecArray | null;
        while ((m = rgx.exec(text))) {
            const value = m[2] ?? m[3];
            result.set(m[1], decode ? XsltProfile.decode(value) : value);
        }
        return result;
    }

    private static decode(value: string) {
        return value.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_all, ref: string) => {
            switch (ref) {
                case 'lt': return '<';
                case 'gt': return '>';
                case 'amp': return '&';
                case 'quot': return '"';
                case 'apos': return '\'';
            }
            return String.fromCodePoint(ref.startsWith('#x') ? parseInt(ref.substring(2), 16) : parseInt(ref.substring(1), 10));
        });
    }

    private static lineStarts(text: string) {
        const starts = [0];
        for (let i = 0; i < text.length; i++) {
            if (text.charCodeAt(i) === 10) {
                starts.push(i + 1);
            }
        }
        return starts;
    }

    private static lineOf(lineStarts: number[], offset: number) {
        let low = 0;
        let high = lineStarts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (lineStarts[mid] <= offset) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        return low;
    }
}
