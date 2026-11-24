/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as vscode from 'vscode';
import { ProfileEntry, ProfileDeclaration, XsltProfile } from './xsltProfile';
import { ProfileRow } from './xsltProfileView';
import { SchematronSourceMap } from './schematronSourceMap';
import { XSpecSourceMap } from './xspecSourceMap';
import { parseXml } from './xspecXml';
import { lineOf } from './debugSourceMap';

// Schematron: profiling a schema - the schema is compiled by SchXslt2 as for debugging (see SchematronDebug), and run
// with Saxon's timing profile as a stylesheet is. Saxon times the compiled stylesheet's templates, functions and globals:
// each rule has a template of its own - one for each copy, for the rules of an abstract pattern - so the rows are the
// schema's rules, from the compiled stylesheet's lines (see SchematronSourceMap), and its global sch:let and sch:param.
// SchXslt2's own templates, functions and globals are left out; those of the stylesheets the schema uses, e.g. through
// xsl:include, are the stylesheets' rows as usual - for the caller to make, from the entries that aren't the compiled
// stylesheet's (see isCompiled)
export class SchematronProfile {

    // whether an entry is of the compiled stylesheet
    public static isCompiled(entry: ProfileEntry, compiledPath: string): boolean {
        try {
            return XSpecSourceMap.samePath(vscode.Uri.parse(entry.file).fsPath, compiledPath);
        } catch {
            return false;
        }
    }

    // the rows for the compiled stylesheet's entries: a rule's - added up over its copies - and a global sch:let or
    // sch:param's. textOf gives a schema file's text, and shown how a file is shown (as for a stylesheet's rows)
    public static rows(entries: ProfileEntry[], map: SchematronSourceMap, textOf: (file: string) => string | undefined,
        shown: (fsPath: string) => { module: string; moduleTitle: string }): ProfileRow[] {
        const rows = new Map<string, ProfileRow>();
        const declarations = new Map<string, ProfileDeclaration[]>();
        const declarationsOf = (file: string, construct: string) => {
            const key = file + '\u0000' + construct;
            if (!declarations.has(key)) {
                declarations.set(key, XsltProfile.declarationsOf(textOf(file) ?? '', construct));
            }
            return declarations.get(key)!;
        };
        const add = (kind: string, file: string, declaration: ProfileDeclaration, label: string, detail: string | undefined, entry: ProfileEntry) => {
            const key = `${kind}\u0000${file}\u0000${declaration.line}`;
            const row = rows.get(key);
            if (row) {
                row.count += entry.count;
                row.net += entry.net;
                row.gross += entry.gross;
                row.avgNet = row.count > 0 ? row.net / row.count : 0;
                row.avgGross = row.count > 0 ? row.gross / row.count : 0;
                return;
            }
            const uri = vscode.Uri.file(file);
            rows.set(key, {
                kind, label, mode: detail, file: uri.toString(), construct: kind, key: XsltProfile.declarationKey(kind, declaration.attributes),
                ...shown(file), line: declaration.line + 1, selection: declaration.selection,
                count: entry.count, net: entry.net, avgNet: entry.avgNet, gross: entry.gross, avgGross: entry.avgGross
            });
        };
        for (const entry of entries) {
            if (entry.construct === 'xsl:template') {
                // the rule's template: the line is where its start tag ends
                const source = map.sourceOf(entry.line);
                if (!source?.name?.startsWith('rule ')) {
                    continue;
                }
                const rule = declarationsOf(source.path, 'rule').find((d) => d.line + 1 === source.line);
                if (!rule) {
                    continue;
                }
                const pattern = declarationsOf(source.path, 'pattern').filter((d) => d.line < rule.line).pop();
                add('rule', source.path, rule, rule.attributes.get('context')?.replace(/\s+/g, ' ').trim() ?? '?', pattern?.attributes.get('id'), entry);
            } else if (entry.construct === 'xsl:param' || entry.construct === 'xsl:variable') {
                // the schema's global sch:let or sch:param, named as in the schema - not SchXslt2's own
                const name = entry.name?.replace(/^Q\{[^}]*\}/, '');
                for (const file of name ? [...new Set([map.schemaPath, ...map.sources()])] : []) {
                    const globals = SchematronProfile.globalLines(textOf(file) ?? '');
                    const declaration = [...declarationsOf(file, 'let'), ...declarationsOf(file, 'param')].find((d) => d.attributes.get('name') === name && globals.has(d.line + 1));
                    if (declaration) {
                        add('let', file, declaration, '$' + name, undefined, entry);
                        break;
                    }
                }
            }
        }
        return [...rows.values()];
    }

    // the 1-based lines where the schema's global sch:let and sch:param start - its children, not those of a rule or pattern
    private static globalLines(text: string): Set<number> {
        const root = parseXml(text);
        const line = lineOf(text);
        return new Set((root?.children ?? []).filter((c) => /^(?:[\w.-]+:)?(let|param)$/.test(c.name)).map((c) => line(c.start)));
    }
}
