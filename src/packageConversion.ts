/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - converting a library to an XSLT package
 */
import * as fs from 'fs';
import * as path from 'path';
import { ImportIndex } from './importIndex';
import { ImportPrecedence } from './importPrecedence';
import { RecordTypes } from './recordTypes';
import { ModulePrefixes } from './modulePrefixes';
import { GlobalInstructionType, XslLexer } from './xslLexer';
import { XslLexerLight } from './xslLexerLight';
import { XSLTConfiguration, XSLTLightConfiguration } from './languageConfigurations';
import { TokenLevelState } from './xpLexer';

// a line of a module (0-based)
export interface Place {
	path: string;
	line: number;
}

// what a conversion does about an item: makes a change - or needs a decision, e.g. code that behaves differently in a
// package - or can't be made until the item is reworked
export type ConversionSeverity = 'change' | 'decision' | 'blocker';

export type ConversionSection = 'visibility' | 'override' | 'abstract' | 'modes' | 'not-shared' | 'blockers';

export interface ConversionItem {
	section: ConversionSection;
	severity: ConversionSeverity;
	// what the item is, e.g. 'function lib:pad#2', and what's done about it, or why it matters
	subject: string;
	text: string;
	places: Place[];
}

export interface ConversionAnalysis {
	library: string;
	// the library: the module, and those it imports or includes, directly or indirectly
	libraryModules: string[];
	// the top-level stylesheets that import or include the library, directly or indirectly - and their other modules
	topLevels: string[];
	userModules: string[];
	// a name and version for the package
	packageName: string;
	packageVersion: string;
	items: ConversionItem[];
}

type Kind = 'function' | 'template' | 'variable' | 'attribute-set' | 'mode' | 'key' | 'accumulator' | 'decimal-format' | 'character-map';

// a top-level declaration of a module
interface Declaration {
	kind: Kind;
	name: string;
	expandedName: string;
	place: Place;
	// for a function, its arity - and the lowest, with XSLT 4.0 optional parameters
	arity?: number;
	minArity?: number;
	isParam?: boolean;
}

// a use of a declaration - for a function, with an arity, if known
interface Use {
	kind: Kind;
	name: string;
	expandedName: string;
	place: Place;
	arity?: number;
}

// a template rule's modes, or an xsl:apply-templates's - '#unnamed' for the unnamed mode, '#all' for a rule in all modes
interface ModeUse {
	modes: string[];
	place: Place;
}

interface ModuleScan {
	path: string;
	declarations: Declaration[];
	uses: Use[];
	rules: ModeUse[];
	applies: ModeUse[];
	applyImports: Place[];
	// top-level declarations that a package doesn't share with the stylesheets that use it
	stripSpace: Place[];
	outputs: Place[];
	globalContextItem: Place[];
	namespaceAliases: Place[];
	// global variables whose value may depend on the context item - which a library package doesn't have
	contextVariables: Declaration[];
	isPackage: boolean;
}

/**
 * The analysis for converting a library - a stylesheet module that other stylesheets import or include, with the
 * modules it imports or includes - to an XSLT 3.0 package, which they use with xsl:use-package: what has to change for
 * them to work as before. Each stylesheet that imports or includes it, directly or indirectly, is checked. As Saxon 13
 * behaves (see PackageScope):
 * - the library's components that a stylesheet uses must be public - a package's are private by default
 * - a stylesheet's declaration with the name of the library's, which overrides it by import precedence, must be in
 *   xsl:override - and the library's must be public, not final
 * - a library's reference to a declaration only in the stylesheet (a callback) needs an abstract declaration in the
 *   package, which the stylesheet overrides
 * - template rules in a package's mode can only be added in xsl:override, and the unnamed mode isn't shared at all
 * - keys, accumulators, decimal formats, character maps, xsl:strip-space and xsl:output aren't shared
 * - a global variable that uses the context item fails in a library package (XPDY0002): it has no global context item
 * - xsl:apply-imports can't be used in xsl:override (XTSE3460) - xsl:next-match can
 * It's lexical: names are compared by namespace URI, and uses found from the lexer's tokens and the attributes that
 * name declarations.
 */
export class PackageConversion {

	// undefined, with the reason, if the module can't be analysed as a library
	public static analyse(libraryPath: string): ConversionAnalysis | string {
		const library = path.normalize(libraryPath);
		const libraryModules = PackageConversion.tree(library);
		const scans = new Map<string, ModuleScan>();
		const scan = (file: string) => {
			let result = scans.get(file);
			if (!result) {
				result = PackageConversion.scan(file);
				scans.set(file, result);
			}
			return result;
		};
		if (scan(library).isPackage) {
			return 'The module is already an xsl:package';
		}
		const topLevels = ImportIndex.instance.topLevelCandidates(library).filter((top) => !libraryModules.includes(top));
		if (topLevels.length === 0) {
			return 'No stylesheet in the workspace imports or includes the module, so it isn\'t used as a library';
		}
		const trees = new Map(topLevels.map((top) => [top, new Set(PackageConversion.tree(top))]));
		const userModules = [...new Set(topLevels.flatMap((top) => [...trees.get(top)!]))].filter((file) => !libraryModules.includes(file));
		const libraryScans = libraryModules.map(scan);
		const userScans = userModules.map(scan);
		const items: ConversionItem[] = [];
		const libraryDeclarations = libraryScans.flatMap((s) => s.declarations);
		const userDeclarations = userScans.flatMap((s) => s.declarations);
		const userUses = userScans.flatMap((s) => s.uses);
		const libraryUses = libraryScans.flatMap((s) => s.uses);
		const components: Kind[] = ['function', 'template', 'variable', 'attribute-set'];

		// the library's components that the stylesheets use - a global parameter is public anyway
		for (const declaration of libraryDeclarations.filter((d) => components.includes(d.kind) && !d.isParam)) {
			const uses = userUses.filter((u) => PackageConversion.refersTo(u, declaration));
			if (uses.length > 0) {
				items.push({ section: 'visibility', severity: 'change', subject: PackageConversion.label(declaration), text: 'made public, as the stylesheets use it', places: [declaration.place, ...uses.map((u) => u.place)] });
			}
		}

		// the stylesheets' declarations with the names of the library's: an override, where it has the higher import
		// precedence, as it does now - else the library's is used now, and the stylesheet's would conflict with it
		for (const top of topLevels) {
			const ranks = ImportPrecedence.ranks(top);
			const rank = (file: string) => ranks.get(path.normalize(file)) ?? -1;
			for (const declaration of userDeclarations.filter((d) => components.includes(d.kind) && trees.get(top)!.has(d.place.path))) {
				const overridden = libraryDeclarations.find((d) => d.kind === declaration.kind && d.expandedName === declaration.expandedName && PackageConversion.aritiesOverlap(d, declaration));
				if (!overridden || items.some((i) => i.section === 'override' && i.places[0].path === declaration.place.path && i.places[0].line === declaration.place.line)) {
					continue;
				}
				items.push(rank(declaration.place.path) > rank(overridden.place.path) ?
					{ section: 'override', severity: 'change', subject: PackageConversion.label(declaration), text: `moved into xsl:override - it overrides the library's by import precedence${overridden.isParam ? '' : ', and the library\'s is made public'}`, places: [declaration.place, overridden.place] } :
					{ section: 'override', severity: 'decision', subject: PackageConversion.label(declaration), text: 'the library\'s declaration has the higher import precedence, so it\'s used now - in a package, the stylesheet\'s would conflict with it (XTSE3050): remove it, or move it into xsl:override', places: [declaration.place, overridden.place] });
			}
		}

		// the library's references to declarations that only the stylesheets have
		const callbacks = new Map<string, { declaration: Declaration, uses: Use[] }>();
		for (const use of libraryUses.filter((u) => components.includes(u.kind))) {
			if (libraryDeclarations.some((d) => PackageConversion.refersTo(use, d))) {
				continue;
			}
			const declaration = userDeclarations.find((d) => PackageConversion.refersTo(use, d));
			if (declaration) {
				const key = `${declaration.kind} ${declaration.expandedName}#${declaration.arity ?? ''}`;
				const entry = callbacks.get(key) ?? { declaration, uses: [] };
				entry.uses.push(use);
				callbacks.set(key, entry);
			}
		}
		callbacks.forEach(({ declaration, uses }) => items.push({
			section: 'abstract', severity: 'change', subject: PackageConversion.label(declaration),
			text: 'declared in the package as abstract, as the library uses it - the stylesheet\'s declaration is moved into xsl:override',
			places: [declaration.place, ...uses.map((u) => u.place)]
		}));

		// modes: the library's named modes the stylesheets use are made public, and the stylesheets' template rules in
		// them moved into xsl:override - the unnamed mode can't be shared
		const libraryRules = libraryScans.flatMap((s) => s.rules);
		const userRules = userScans.flatMap((s) => s.rules);
		const userApplies = userScans.flatMap((s) => s.applies);
		const libraryApplies = libraryScans.flatMap((s) => s.applies);
		const inMode = (mode: string) => (use: ModeUse) => use.modes.includes(mode) || use.modes.includes('#all');
		const libraryModes = new Set(libraryRules.flatMap((r) => r.modes).concat(libraryDeclarations.filter((d) => d.kind === 'mode').map((d) => d.name)).filter((m) => m !== '#all'));
		for (const mode of libraryModes) {
			const libraryModeRules = libraryRules.filter(inMode(mode));
			const applies = userApplies.filter((a) => a.modes.includes(mode));
			const rules = userRules.filter((r) => r.modes.includes(mode));
			if (mode === '#unnamed') {
				const sharedRules = libraryModeRules.length > 0 && applies.length > 0;
				const sharedApplies = rules.length > 0 && libraryApplies.some((a) => a.modes.includes(mode));
				if (sharedRules || sharedApplies) {
					items.push({
						section: 'modes', severity: 'decision', subject: 'the unnamed mode',
						text: `a package's unnamed mode is private to it: the library's ${libraryModeRules.length} template rules in it won't be applied by the stylesheets' xsl:apply-templates, nor the stylesheets' rules by the library's - give the library's rules a named mode, and apply templates in it`,
						places: [...libraryModeRules.slice(0, 3), ...applies.slice(0, 3), ...rules.slice(0, 3)].map((u) => u.place)
					});
				}
				continue;
			}
			if (applies.length > 0 || rules.length > 0) {
				items.push({ section: 'modes', severity: 'change', subject: `mode ${mode}`, text: 'declared public with xsl:mode, as the stylesheets use it', places: [...libraryModeRules.slice(0, 1), ...applies, ...rules].map((u) => u.place) });
			}
			if (rules.length > 0) {
				items.push({ section: 'modes', severity: 'change', subject: `${rules.length} template ${rules.length === 1 ? 'rule' : 'rules'} in mode ${mode}`, text: 'moved into xsl:override - rules can only be added to a package\'s mode there', places: rules.map((r) => r.place) });
			}
		}
		// xsl:apply-imports in the stylesheets' template rules that may reach the library's
		for (const userScan of userScans) {
			userScan.applyImports.forEach((place) => items.push({
				section: 'modes', severity: 'decision', subject: 'xsl:apply-imports',
				text: 'can\'t be used in xsl:override (XTSE3460): if it applies the library\'s template rules, it\'s replaced by xsl:next-match, which also finds rules of lower priority in the stylesheet', places: [place]
			}));
		}

		// declarations a package doesn't share: copied into the stylesheets that use them
		const notShared: [Kind, string][] = [['key', 'key'], ['accumulator', 'accumulator'], ['decimal-format', 'decimal format'], ['character-map', 'character map']];
		for (const [kind, label] of notShared) {
			for (const declaration of libraryDeclarations.filter((d) => d.kind === kind)) {
				const uses = userUses.filter((u) => u.kind === kind && u.expandedName === declaration.expandedName);
				if (uses.length > 0) {
					items.push({ section: 'not-shared', severity: 'change', subject: `${label} ${declaration.name}`, text: `copied into the stylesheets that use it - a package's ${label}s aren't shared`, places: [declaration.place, ...uses.map((u) => u.place)] });
				}
			}
		}
		libraryScans.flatMap((s) => s.stripSpace).forEach((place) => items.push({ section: 'not-shared', severity: 'change', subject: 'xsl:strip-space / xsl:preserve-space', text: 'copied into each top-level stylesheet - in a package, it doesn\'t apply to the documents processed', places: [place] }));
		libraryScans.flatMap((s) => s.outputs).forEach((place) => items.push({ section: 'not-shared', severity: 'change', subject: 'xsl:output', text: 'copied into each top-level stylesheet without one - a package\'s output declarations are ignored', places: [place] }));
		libraryScans.flatMap((s) => s.namespaceAliases).forEach((place) => items.push({ section: 'not-shared', severity: 'decision', subject: 'xsl:namespace-alias', text: 'applies only to the package\'s own literal result elements', places: [place] }));

		// what must be reworked first
		libraryScans.flatMap((s) => s.globalContextItem).forEach((place) => items.push({ section: 'blockers', severity: 'blocker', subject: 'xsl:global-context-item', text: 'a package that declares a global context item can\'t be used as a library package (XTTE0590)', places: [place] }));
		libraryScans.flatMap((s) => s.contextVariables).forEach((declaration) => items.push({
			section: 'blockers', severity: 'blocker', subject: PackageConversion.label(declaration),
			text: 'its value may use the context item - a library package has no global context item, so it would fail (XPDY0002): pass the document as a parameter, or move the variable into the stylesheet', places: [declaration.place]
		}));

		const declaration = ImportIndex.packageDeclaration(fs.readFileSync(library, 'utf8'));
		return {
			library, libraryModules, topLevels, userModules,
			packageName: declaration?.name ?? PackageConversion.proposedName(library, libraryDeclarations),
			packageVersion: '1.0',
			items
		};
	}

	// a name for the package: the namespace of most of the library's function names - or a URN from its file name
	private static proposedName(library: string, declarations: Declaration[]) {
		const namespaces = declarations.filter((d) => d.kind === 'function').map((d) => /^Q\{([^}]+)\}/.exec(d.expandedName)?.[1]).filter((n): n is string => !!n);
		const counts = new Map<string, number>();
		namespaces.forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
		const most = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
		return most ?? `urn:${path.basename(library).replace(/\.[^.]*$/, '')}`;
	}

	// the module, and those it imports or includes, directly or indirectly
	private static tree(file: string): string[] {
		const result: string[] = [];
		const visit = (module: string) => {
			const normalized = path.normalize(module);
			if (result.includes(normalized) || !fs.existsSync(normalized)) {
				return;
			}
			result.push(normalized);
			const references = ImportIndex.instance.has(normalized) ? ImportIndex.instance.referencesOf(normalized) :
				ImportIndex.moduleReferences(fs.readFileSync(normalized, 'utf8'), normalized);
			references.forEach((reference) => visit(reference.path));
		};
		visit(file);
		return result;
	}

	public static label(declaration: Declaration) {
		switch (declaration.kind) {
			case 'function': return `function ${declaration.name}#${declaration.arity}`;
			case 'variable': return `${declaration.isParam ? 'parameter' : 'variable'} $${declaration.name}`;
			case 'attribute-set': return `attribute set ${declaration.name}`;
			default: return `${declaration.kind} ${declaration.name}`;
		}
	}

	private static refersTo(use: Use, declaration: Declaration) {
		return use.kind === declaration.kind && use.expandedName === declaration.expandedName &&
			(use.arity === undefined || declaration.arity === undefined || (use.arity <= declaration.arity && use.arity >= (declaration.minArity ?? declaration.arity)));
	}

	private static aritiesOverlap(a: Declaration, b: Declaration) {
		return a.arity === undefined || b.arity === undefined || ((a.minArity ?? a.arity) <= b.arity && (b.minArity ?? b.arity) <= a.arity);
	}

	// the declarations and uses of a module
	private static scan(file: string): ModuleScan {
		const text = fs.readFileSync(file, 'utf8');
		const result: ModuleScan = {
			path: file, declarations: [], uses: [], rules: [], applies: [], applyImports: [], stripSpace: [], outputs: [], globalContextItem: [],
			namespaceAliases: [], contextVariables: [], isPackage: ImportIndex.packageDeclaration(text) !== undefined
		};
		const light = new XslLexerLight(XSLTLightConfiguration.configuration);
		const globals = light.analyseLight(text);
		const bindings = light.prefixBindings;
		const expanded = (name: string) => ModulePrefixes.expandedName(name.trim(), bindings);
		const place = (line: number): Place => ({ path: file, line });
		const kinds = new Map<GlobalInstructionType, Kind>([
			[GlobalInstructionType.Function, 'function'], [GlobalInstructionType.Template, 'template'], [GlobalInstructionType.Variable, 'variable'],
			[GlobalInstructionType.Parameter, 'variable'], [GlobalInstructionType.AttributeSet, 'attribute-set'], [GlobalInstructionType.ModeInstruction, 'mode'],
			[GlobalInstructionType.Key, 'key'], [GlobalInstructionType.Accumulator, 'accumulator'], [GlobalInstructionType.CharacterMap, 'character-map']
		]);
		for (const global of globals) {
			const kind = kinds.get(global.type);
			if (!kind) {
				continue;
			}
			const optional = global.memberOptional?.filter((o) => o).length ?? 0;
			result.declarations.push({
				kind, name: global.name, expandedName: expanded(global.name), place: place(global.token.line),
				arity: kind === 'function' ? global.idNumber : undefined, minArity: kind === 'function' ? global.idNumber - optional : undefined,
				isParam: global.type === GlobalInstructionType.Parameter
			});
		}

		// uses in XPath: functions, variables, and the names of keys and accumulators
		const tokens = new XslLexer(XSLTConfiguration.configuration).analyse(text);
		const xslStart = XslLexer.getXsltStartTokenNumber();
		const use = (kind: Kind, name: string, line: number, arity?: number) => result.uses.push({ kind, name, expandedName: expanded(name), place: place(line), arity });
		tokens.forEach((token, index) => {
			if (token.tokenType >= xslStart) {
				return;
			}
			if (token.tokenType === TokenLevelState.variable) {
				use('variable', token.value.replace(/^\$/, ''), token.line);
			} else if (token.tokenType === TokenLevelState.function || token.tokenType === TokenLevelState.functionNameTest) {
				const arity = /#(\d+)$/.exec(token.value)?.[1];
				const name = token.value.replace(/#\d+$/, '');
				const literal = tokens.slice(index + 1, index + 4).find((t) => t.tokenType === TokenLevelState.string)?.value.replace(/^["']|["']$/g, '');
				if (name === 'key' && literal) {
					use('key', literal, token.line);
				} else if ((name === 'accumulator-before' || name === 'accumulator-after') && literal) {
					use('accumulator', literal, token.line);
				} else if (name.includes(':')) {
					use('function', name, token.line, arity !== undefined ? Number(arity) : undefined);
				}
			}
		});

		// uses and declarations in XSLT elements and attributes
		const markup = RecordTypes.blankMarkup(text);
		const prefix = RecordTypes.xsltPrefix(markup);
		const attribute = (offset: number, name: string) => RecordTypes.attributeOfElementAt(text, offset + 1, name);
		const lineOf = (offset: number) => text.substring(0, offset).split('\n').length - 1;
		const stack: { name: string, defaultMode: string }[] = [];
		const tagRgx = new RegExp(RecordTypes.tagPattern, 'g');
		let match: RegExpExecArray | null;
		while ((match = tagRgx.exec(markup)) !== null) {
			const name = RecordTypes.xsltName(match[2], prefix);
			if (match[1]) {
				const index = stack.map((e) => e.name).lastIndexOf(name);
				if (index > -1) {
					stack.length = index;
				}
				continue;
			}
			const offset = match.index;
			const line = lineOf(offset);
			const isXslt = name.startsWith('xsl:');
			const inherited = stack.length > 0 ? stack[stack.length - 1].defaultMode : '#unnamed';
			const defaultMode = attribute(offset, isXslt ? 'default-mode' : `${prefix}:default-mode`)?.trim() || inherited;
			const modes = (value: string | undefined) => (value?.trim().split(/\s+/) ?? [defaultMode]).map((m) => m === '#default' ? defaultMode : m);
			const names = (value: string | undefined) => value?.trim().split(/\s+/).filter((n) => n !== '') ?? [];
			if (stack.length === 1) {
				switch (name) {
					case 'xsl:strip-space':
					case 'xsl:preserve-space':
						result.stripSpace.push(place(line));
						break;
					case 'xsl:output':
						if (attribute(offset, 'name') === undefined) {
							result.outputs.push(place(line));
						}
						break;
					case 'xsl:global-context-item':
						result.globalContextItem.push(place(line));
						break;
					case 'xsl:namespace-alias':
						result.namespaceAliases.push(place(line));
						break;
					case 'xsl:decimal-format': {
						const formatName = attribute(offset, 'name');
						if (formatName) {
							result.declarations.push({ kind: 'decimal-format', name: formatName, expandedName: expanded(formatName), place: place(line) });
						}
						break;
					}
					case 'xsl:variable':
					case 'xsl:param': {
						const select = attribute(offset, 'select');
						const variableName = attribute(offset, 'name');
						if (variableName && select !== undefined && PackageConversion.mayUseContext(select)) {
							result.contextVariables.push({ kind: 'variable', name: variableName, expandedName: expanded(variableName), place: place(line), isParam: name === 'xsl:param' });
						}
						break;
					}
				}
			}
			if (name === 'xsl:template' && attribute(offset, 'match') !== undefined) {
				result.rules.push({ modes: modes(attribute(offset, 'mode')), place: place(line) });
			} else if (name === 'xsl:apply-templates') {
				result.applies.push({ modes: modes(attribute(offset, 'mode')).filter((m) => m !== '#current'), place: place(line) });
			} else if (name === 'xsl:apply-imports') {
				result.applyImports.push(place(line));
			} else if (name === 'xsl:call-template') {
				names(attribute(offset, 'name')).forEach((n) => use('template', n, line));
			}
			names(attribute(offset, isXslt ? 'use-attribute-sets' : `${prefix}:use-attribute-sets`)).forEach((n) => use('attribute-set', n, line));
			names(attribute(offset, 'use-character-maps')).forEach((n) => use('character-map', n, line));
			if (isXslt) {
				names(attribute(offset, 'use-accumulators')).filter((n) => n !== '#all').forEach((n) => use('accumulator', n, line));
			}
			if (!match[3]) {
				stack.push({ name, defaultMode });
			}
		}
		// format-number with a decimal format's name
		for (const formatNumber of text.matchAll(/format-number\s*\([^()]*,\s*(["'])([^"']+)\1\s*\)/g)) {
			use('decimal-format', formatNumber[2], lineOf(formatNumber.index!));
		}
		return result;
	}

	// a global variable's select, whose value may depend on the context item: an absolute or relative path, '.', or a
	// function of the context, e.g. root() or name() - string literals aside
	public static mayUseContext(select: string) {
		const expression = select.replace(/"[^"]*"|'[^']*'/g, '""');
		return /(^|[\s(,[!=<>+*|-])\/|^\s*\.|[(,]\s*\.\s*[),]|\b(root|name|local-name|namespace-uri|base-uri|document-uri|position|last|string|data|number|node-name|generate-id|path|has-children)\s*\(\s*\)|^\s*(@|[\p{L}_][\p{L}\p{N}_.-]*(:[\p{L}_][\p{L}\p{N}_.-]*)?\s*($|\/|\[))/u.test(expression);
	}
}
