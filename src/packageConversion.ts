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
import { DocumentTypes, GlobalInstructionData, GlobalInstructionType, XslLexer } from './xslLexer';
import * as vscode from 'vscode';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';
import { XslLexerLight } from './xslLexerLight';
import { XSLTConfiguration, XSLTLightConfiguration } from './languageConfigurations';
import { TokenLevelState } from './xpLexer';
import { XdocNotes } from './xdocNote';
import { HrefPaths } from './hrefPaths';
import { PackageEdits, TextEdit } from './packageEdits';
import { PackageScope } from './packageScope';

// a line of a module (0-based) - and the offset of the element there, where it's known
export interface Place {
	path: string;
	line: number;
	offset?: number;
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
	// where the library shares the unnamed mode: a name for the package's mode it becomes, with the library's prefixes
	unnamedModeName: string;
	items: ConversionItem[];
	// what a conversion does - see PackageConversion.convert
	plan: ConversionPlan;
}

export interface ConversionPlan {
	scans: Map<string, ModuleScan>;
	trees: Map<string, Set<string>>;
	// the library's declarations made public, and the stylesheets' declarations moved into xsl:override - with their
	// top-level stylesheet - for overrides, and callbacks, which get an abstract declaration in the package
	publicDeclarations: Declaration[];
	overrides: { declaration: Declaration, top: string }[];
	callbacks: Declaration[];
	// the library's named modes made public - with their xsl:mode, if they have one - and the stylesheets' template rules
	// in them, moved into xsl:override
	publicModes: { mode: string, declaration?: Declaration }[];
	movedRules: { rule: ModeUse, top: string }[];
	// the library's declarations copied into each top-level stylesheet: keys, xsl:strip-space, xsl:output etc.
	copies: { place: Place, kind: string, name?: string }[];
	// the conversion waits for these: what has to be reworked first
	preventing: ConversionItem[];
	// the library shares the unnamed mode with the stylesheets: it becomes a named, public mode of the package
	renameUnnamed: boolean;
}

export type Kind = 'function' | 'template' | 'variable' | 'attribute-set' | 'mode' | 'key' | 'accumulator' | 'decimal-format' | 'character-map';

// a top-level declaration of a module
export interface Declaration {
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
export interface Use {
	kind: Kind;
	name: string;
	expandedName: string;
	place: Place;
	arity?: number;
}

// a template rule's modes, or an xsl:apply-templates's - '#unnamed' for the unnamed mode, '#all' for a rule in all modes
export interface ModeUse {
	modes: string[];
	place: Place;
	// the mode attribute, as written - and for a template rule, whether it's also a named template
	modeAttribute?: string;
	isNamed?: boolean;
	// a template rule with xsl:next-match or xsl:apply-imports in it, which depend on the current template rule
	callsNext?: boolean;
}

export interface ModuleScan {
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
	// the global variables and parameters - to check whether their values use the context item, which a library package
	// doesn't have (see contextVariables)
	globalVariables: Declaration[];
	// its top-level xsl:mode elements without a name, which declare the unnamed mode - and whether its outermost element
	// has a default-mode attribute
	unnamedModes: Place[];
	hasDefaultMode: boolean;
	isPackage: boolean;
	text: string;
	// the module's prefix for XSLT, and its namespace bindings
	prefix: string;
	bindings?: Map<string, string>;
	// its top-level xsl:import and xsl:include elements, with the modules they refer to
	references: { path: string, offset: number, isImport: boolean }[];
	// its xsl:import and xsl:include hrefs that aren't found, e.g. a URI an XML catalog would resolve
	unresolved: { href: string, place: Place }[];
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
	public static async analyse(libraryPath: string): Promise<ConversionAnalysis | string> {
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
		const plan: ConversionPlan = { scans, trees, publicDeclarations: [], overrides: [], callbacks: [], publicModes: [], movedRules: [], copies: [], preventing: [], renameUnnamed: false };
		// a module whose code moves into xsl:override is changed: it must be in the workspace, and used only by the top-level
		// stylesheets that use the library - each gets the code moved, in its own xsl:override
		const topsOf = (file: string) => topLevels.filter((top) => trees.get(top)!.has(file));
		const movable = (file: string) => ImportIndex.instance.has(file) && ImportIndex.instance.topLevelCandidates(file).every((top) => topLevels.includes(top));
		const notMovable = (subject: string, place: Place) => items.push({
			section: 'blockers', severity: 'blocker', subject,
			text: `it would move into xsl:override from ${path.basename(place.path)} - which ${ImportIndex.instance.has(place.path) ? 'stylesheets that don\'t use the library use too' : 'isn\'t in the workspace'}, so they'd lose it`,
			places: [place]
		});

		// the library's components that the stylesheets use - a global parameter is public anyway
		for (const declaration of libraryDeclarations.filter((d) => components.includes(d.kind) && !d.isParam)) {
			const uses = userUses.filter((u) => PackageConversion.refersTo(u, declaration));
			if (uses.length > 0) {
				plan.publicDeclarations.push(declaration);
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
				if (!overridden) {
					continue;
				}
				const reported = items.some((i) => (i.section === 'override' || i.section === 'blockers') && i.places[0]?.path === declaration.place.path && i.places[0]?.line === declaration.place.line);
				if (reported) {
					// for another top-level stylesheet with the module: the declaration moves into its xsl:override too
					if (plan.overrides.some((o) => o.declaration === declaration)) {
						plan.overrides.push({ declaration, top });
					}
					continue;
				}
				// an override's signature must be the library's (XTSE3070) - an import's needn't be
				const mismatch = rank(declaration.place.path) > rank(overridden.place.path) ? PackageConversion.signatureMismatch(scan(declaration.place.path), declaration, scan(overridden.place.path), overridden) : undefined;
				if (mismatch) {
					items.push({
						section: 'blockers', severity: 'blocker', subject: PackageConversion.label(declaration),
						text: `it overrides the library's by import precedence, but in a package an override must have the same signature (XTSE3070): ${mismatch}`, places: [declaration.place, overridden.place]
					});
					continue;
				}
				if (rank(declaration.place.path) > rank(overridden.place.path) && !movable(declaration.place.path)) {
					notMovable(PackageConversion.label(declaration), declaration.place);
					continue;
				}
				if (rank(declaration.place.path) > rank(overridden.place.path)) {
					plan.overrides.push({ declaration, top });
					if (!overridden.isParam) {
						plan.publicDeclarations.push(overridden);
					}
				}
				items.push(rank(declaration.place.path) > rank(overridden.place.path) ?
					{ section: 'override', severity: 'change', subject: PackageConversion.label(declaration), text: `moved into xsl:override - it overrides the library's by import precedence${overridden.isParam ? '' : ', and the library\'s is made public'}`, places: [declaration.place, overridden.place] } :
					{ section: 'override', severity: 'decision', subject: PackageConversion.label(declaration), text: 'the library\'s declaration has the higher import precedence, so it\'s used now - in a package, the stylesheet\'s would conflict with it (XTSE3050): remove it, or move it into xsl:override', places: [declaration.place, overridden.place] });
			}
		}

		// the library's references to declarations that only the stylesheets have - and to those found nowhere, e.g. in a
		// module whose import isn't resolved, which a package can't have: functions in a namespace with user-defined
		// functions, named templates and attribute sets (variables aside, as local ones aren't told apart)
		const callbacks = new Map<string, { declaration: Declaration, uses: Use[] }>();
		const unresolved = new Map<string, Use[]>();
		const functionNamespaces = new Set(libraryDeclarations.concat(userDeclarations).filter((d) => d.kind === 'function').map((d) => /^Q\{([^}]*)\}/.exec(d.expandedName)?.[1]));
		const checked = (use: Use) => use.kind === 'template' || use.kind === 'attribute-set' || (use.kind === 'function' && functionNamespaces.has(/^Q\{([^}]*)\}/.exec(use.expandedName)?.[1]));
		for (const use of libraryUses.filter((u) => components.includes(u.kind))) {
			if (libraryDeclarations.some((d) => PackageConversion.refersTo(use, d))) {
				continue;
			}
			const declaration = userDeclarations.find((d) => PackageConversion.refersTo(use, d));
			if (!declaration && checked(use)) {
				const key = `${use.kind} ${use.name}`;
				unresolved.set(key, (unresolved.get(key) ?? []).concat(use));
			}
			if (declaration) {
				const key = `${declaration.kind} ${declaration.expandedName}#${declaration.arity ?? ''}`;
				const entry = callbacks.get(key) ?? { declaration, uses: [] };
				entry.uses.push(use);
				callbacks.set(key, entry);
			}
		}
		const unresolvedImports = libraryScans.concat(userScans).flatMap((s) => s.unresolved);
		const notFound = unresolvedImports.length > 0 ? ` - these imports or includes aren't found, so what they declare isn't known: ${[...new Set(unresolvedImports.map((u) => u.href))].join(', ')} (the XML catalog setting may resolve them)` : '';
		unresolved.forEach((uses, key) => items.push({
			section: 'blockers', severity: 'blocker', subject: key.replace(/^attribute-set /, 'attribute set '),
			text: `the library uses it, but it isn't declared in the library or the stylesheets found to use it - a package must declare all it uses, as abstract if a stylesheet provides it${notFound}`,
			places: uses.map((u) => u.place)
		}));
		callbacks.forEach(({ declaration }) => {
			plan.callbacks.push(declaration);
			if (movable(declaration.place.path)) {
				topsOf(declaration.place.path).forEach((top) => plan.overrides.push({ declaration, top }));
			} else {
				notMovable(PackageConversion.label(declaration), declaration.place);
			}
		});
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
					// a package's unnamed mode is private to it: it becomes a named, public mode
					plan.renameUnnamed = true;
					items.push({
						section: 'modes', severity: 'change', subject: 'the unnamed mode',
						text: `a package's unnamed mode is private to it, so it becomes a named, public mode of the package - its name is asked for when converting. The library's ${libraryModeRules.length} template ${libraryModeRules.length === 1 ? 'rule' : 'rules'} in it stay as they are; the stylesheets' ${rules.length} ${rules.length === 1 ? 'rule moves' : 'rules move'} into xsl:override, their ${applies.length} xsl:apply-templates get the mode, and each top-level stylesheet gets a template rule that starts the transformation in it`,
						places: [...libraryModeRules.slice(0, 3), ...applies.slice(0, 3), ...rules.slice(0, 3)].map((u) => u.place)
					});
					userScans.flatMap((s) => s.unnamedModes).forEach((place) => items.push({
						section: 'blockers', severity: 'blocker', subject: 'xsl:mode for the unnamed mode',
						text: 'the stylesheet sets properties of the unnamed mode, e.g. on-no-match - once it\'s the package\'s mode, the stylesheet can\'t change them, as a mode can\'t be overridden: move them to the library\'s xsl:mode', places: [place]
					}));
					userRules.filter((r) => r.modes.includes('#all')).forEach((rule) => items.push({
						section: 'modes', severity: 'decision', subject: 'a template rule in all modes',
						text: 'it won\'t apply in the package\'s mode the unnamed mode becomes - only the stylesheet\'s own modes: if it should, copy it into xsl:override with the mode', places: [rule.place]
					}));
					PackageConversion.namedRuleItems(rules, items);
					rules.filter((rule) => !movable(rule.place.path)).forEach((rule) => notMovable('a template rule in the unnamed mode', rule.place));
					rules.filter((r) => r.modes.some((m) => m !== '#unnamed')).forEach((rule) => items.push({
						section: 'blockers', severity: 'blocker', subject: 'a template rule in the unnamed mode and others',
						text: 'only a rule in the package\'s mode can move into xsl:override: split it into a rule for the unnamed mode and one for the others', places: [rule.place]
					}));
				}
				continue;
			}
			if (applies.length > 0 || rules.length > 0) {
				plan.publicModes.push({ mode, declaration: libraryDeclarations.find((d) => d.kind === 'mode' && d.name === mode) });
				items.push({ section: 'modes', severity: 'change', subject: `mode ${mode}`, text: 'declared public with xsl:mode, as the stylesheets use it', places: [...libraryModeRules.slice(0, 1), ...applies, ...rules].map((u) => u.place) });
			}
			PackageConversion.namedRuleItems(rules, items);
			if (rules.length > 0) {
				rules.filter((rule) => !movable(rule.place.path)).forEach((rule) => notMovable(`a template rule in mode ${mode}`, rule.place));
				rules.filter((rule) => movable(rule.place.path)).forEach((rule) => topsOf(rule.place.path).forEach((top) => plan.movedRules.push({ rule, top })));
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
					plan.copies.push({ place: declaration.place, kind, name: declaration.expandedName });
					items.push({ section: 'not-shared', severity: 'change', subject: `${label} ${declaration.name}`, text: `copied into the stylesheets that use it - a package's ${label}s aren't shared`, places: [declaration.place, ...uses.map((u) => u.place)] });
				}
			}
		}
		libraryScans.flatMap((s) => s.stripSpace).forEach((place) => plan.copies.push({ place, kind: 'strip-space' }));
		libraryScans.flatMap((s) => s.outputs).forEach((place) => plan.copies.push({ place, kind: 'output' }));
		libraryScans.flatMap((s) => s.stripSpace).forEach((place) => items.push({ section: 'not-shared', severity: 'change', subject: 'xsl:strip-space / xsl:preserve-space', text: 'copied into each top-level stylesheet - in a package, it doesn\'t apply to the documents processed', places: [place] }));
		libraryScans.flatMap((s) => s.outputs).forEach((place) => items.push({ section: 'not-shared', severity: 'change', subject: 'xsl:output', text: 'copied into each top-level stylesheet without one - a package\'s output declarations are ignored', places: [place] }));
		libraryScans.flatMap((s) => s.namespaceAliases).forEach((place) => items.push({ section: 'not-shared', severity: 'decision', subject: 'xsl:namespace-alias', text: 'applies only to the package\'s own literal result elements', places: [place] }));

		// what must be reworked first
		libraryScans.flatMap((s) => s.globalContextItem).forEach((place) => items.push({ section: 'blockers', severity: 'blocker', subject: 'xsl:global-context-item', text: 'a package that declares a global context item can\'t be used as a library package (XTTE0590)', places: [place] }));
		const contextVariables = (await Promise.all(libraryScans.map((s) => PackageConversion.contextVariables(s)))).flat();
		contextVariables.forEach((declaration) => items.push({
			section: 'blockers', severity: 'blocker', subject: PackageConversion.label(declaration),
			text: 'its value may use the context item - a library package has no global context item, so it would fail (XPDY0002): pass the document as a parameter, or move the variable into the stylesheet', places: [declaration.place]
		}));

		plan.preventing.push(...items.filter((i) => i.severity === 'blocker'));
		const packageName = PackageConversion.proposedName(library, libraryDeclarations);
		// with the library's prefix for the package's namespace, if it has one
		const prefix = [...(scan(library).bindings ?? new Map<string, string>())].find(([, uri]) => uri === packageName)?.[0];
		return {
			library, libraryModules, topLevels, userModules, packageName, packageVersion: '1.0',
			unnamedModeName: prefix ? `${prefix}:default` : 'default',
			items, plan
		};
	}

	// the edits that convert the library to a package, by module - or why it can't be converted. The library's root
	// element becomes xsl:package, with the name and version, and declared-modes="no", so its modes needn't all be
	// declared - its components that the stylesheets use or override get visibility="public", its named modes they use
	// a public xsl:mode, and their callbacks an abstract declaration. In each top-level stylesheet's tree, the xsl:import
	// or xsl:include of the library becomes an xsl:use-package, with an xsl:override for the declarations and template
	// rules that override the library's - moved there, with xsl:apply-imports changed to xsl:next-match - and the
	// stylesheet gets copies of the declarations a package doesn't share. The edits' XSLT names have the prefix xsl.
	// Where the library shares the unnamed mode with the stylesheets, it becomes the named, public mode unnamedMode, with
	// the library's prefixes: the library's modules get default-mode="..." and its unnamed xsl:mode the name - the
	// stylesheets' template rules in the unnamed mode move into xsl:override, in the mode, and their xsl:apply-templates
	// get the mode - and each top-level stylesheet gets a template rule in its unnamed mode, where the transformation
	// starts, that applies templates in the mode, as a package's mode can't be the initial mode
	public static convert(analysis: ConversionAnalysis, packageName: string, packageVersion: string, unnamedMode?: string): Map<string, TextEdit[]> | string {
		const plan = analysis.plan;
		if (plan.preventing.length > 0) {
			return `${plan.preventing.length} ${plan.preventing.length === 1 ? 'item needs' : 'items need'} reworking first: ${[...new Set(plan.preventing.map((i) => i.subject))].join(', ')}`;
		}
		if (plan.renameUnnamed && !unnamedMode) {
			return 'the library shares the unnamed mode with the stylesheets: a name is needed for the package\'s mode it becomes';
		}
		const edits = new Map<string, TextEdit[]>();
		const add = (file: string, edit: TextEdit | undefined) => {
			if (!edit) {
				throw new Error(`An element in ${path.basename(file)} wasn't found`);
			}
			const fileEdits = edits.get(file) ?? [];
			// insertions at the same place are made in order
			const same = fileEdits.find((e) => e.start === edit.start && e.end === edit.start && edit.end === edit.start);
			if (same) {
				same.text += edit.text;
			} else {
				fileEdits.push(edit);
			}
			edits.set(file, fileEdits);
		};
		const scanOf = (file: string) => plan.scans.get(file)!;
		// an element removed once, though in the trees of more than one top-level stylesheet
		const removed = new Set<string>();
		const remove = (file: string, offset: number) => {
			if (!removed.has(`${file}#${offset}`)) {
				removed.add(`${file}#${offset}`);
				add(file, PackageEdits.removeElement(scanOf(file).text, markupOf(file), offset));
			}
		};
		const markups = new Map<string, string>();
		const markupOf = (file: string) => {
			let markup = markups.get(file);
			if (markup === undefined) {
				markup = RecordTypes.blankMarkup(scanOf(file).text);
				markups.set(file, markup);
			}
			return markup;
		};
		const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
		try {
			// the library: its root element, components, modes and abstract declarations
			const library = scanOf(analysis.library);
			const libraryMarkup = markupOf(analysis.library);
			const root = XdocNotes.rootOffset(libraryMarkup);
			const rootElement = root !== undefined ? PackageEdits.elementExtent(libraryMarkup, root) : undefined;
			if (root === undefined || !rootElement || rootElement.selfClosing) {
				return 'The library\'s xsl:stylesheet element isn\'t found';
			}
			const renaming = plan.renameUnnamed && unnamedMode !== undefined;
			// the mode, as written in a module
			const modeIn = (scan: ModuleScan) => PackageScope.translatePrefixes(unnamedMode ?? '', library.bindings, scan.bindings);
			const withMode = (scan: ModuleScan, value: string | undefined) => (value?.trim().split(/\s+/) ?? ['#default']).map((m) => m === '#unnamed' || m === '#default' ? modeIn(scan) : m).join(' ');
			const rootChanges: [string, string | undefined][] = [['name', packageName], ['package-version', packageVersion], ['declared-modes', 'no']];
			if (renaming && !library.hasDefaultMode) {
				rootChanges.push(['default-mode', modeIn(library)]);
			}
			const rootTag = PackageEdits.withAttributes(library.text, libraryMarkup, root, rootChanges)!;
			rootTag.text = rootTag.text.replace(/^<([\w.-]+:)?(stylesheet|transform)\b/, '<$1package');
			add(analysis.library, rootTag);
			const endTag = /^<\/([\w.-]+:)?(stylesheet|transform)/.exec(library.text.substring(rootElement.endTagStart));
			if (endTag) {
				add(analysis.library, { start: rootElement.endTagStart, end: rootElement.endTagStart + endTag[0].length, text: `</${endTag[1] ?? ''}package` });
			}
			const madePublic = new Set<string>();
			const makePublic = (place: Place) => {
				const key = `${place.path}#${place.offset}`;
				if (place.offset !== undefined && !madePublic.has(key)) {
					madePublic.add(key);
					add(place.path, PackageEdits.withAttributes(scanOf(place.path).text, markupOf(place.path), place.offset, [['visibility', 'public']]));
				}
			};
			plan.publicDeclarations.filter((d) => !d.isParam).forEach((d) => makePublic(d.place));
			// new declarations, at the end of the library's root element
			const step = PackageConversion.indentStep(library.text, rootElement.startTagEnd);
			const added: string[] = [];
			plan.publicModes.forEach(({ mode, declaration }) => declaration?.place.offset !== undefined ? makePublic(declaration.place) :
				added.push(`<xsl:mode name="${escape(mode)}" visibility="public"/>`));
			if (renaming) {
				// the library's other modules, the template rules and xsl:apply-templates naming the unnamed mode, and its
				// declarations - which with the mode's name, declare the mode
				for (const module of analysis.libraryModules) {
					const scan = scanOf(module);
					const moduleRoot = XdocNotes.rootOffset(markupOf(module));
					if (module !== analysis.library && !scan.hasDefaultMode && moduleRoot !== undefined) {
						add(module, PackageEdits.withAttributes(scan.text, markupOf(module), moduleRoot, [['default-mode', modeIn(scan)]]));
					}
					scan.rules.concat(scan.applies).filter((r) => r.modeAttribute?.split(/\s+/).includes('#unnamed') && r.place.offset !== undefined)
						.forEach((r) => add(module, PackageEdits.withAttributes(scan.text, markupOf(module), r.place.offset!, [['mode', withMode(scan, r.modeAttribute)]])));
					scan.unnamedModes.forEach((place) => add(module, PackageEdits.withAttributes(scan.text, markupOf(module), place.offset!, [['name', modeIn(scan)], ['visibility', 'public']])));
				}
				if (analysis.libraryModules.every((module) => scanOf(module).unnamedModes.length === 0)) {
					added.push(`<xsl:mode name="${escape(modeIn(library))}" visibility="public"/>`);
				}
			}
			plan.callbacks.forEach((callback) => added.push(PackageConversion.abstractDeclaration(scanOf(callback.place.path), markupOf(callback.place.path), callback, library.bindings, step)));
			if (added.length > 0) {
				const lineStart = library.text.lastIndexOf('\n', rootElement.endTagStart - 1) + 1;
				const text = added.map((declaration) => step + declaration.replace(/\n/g, '\n' + step)).join('\n') + '\n';
				add(analysis.library, library.text.substring(lineStart, rootElement.endTagStart).trim() === '' ?
					{ start: lineStart, end: lineStart, text } : { start: rootElement.endTagStart, end: rootElement.endTagStart, text: '\n' + text });
			}

			// the elements moved into an xsl:override - the xsl:apply-templates in them are changed as they're moved
			const movedElements: { path: string, start: number, end: number }[] = [];
			// each top-level stylesheet's tree
			for (const top of analysis.topLevels) {
				const tree = plan.trees.get(top)!;
				const users = [...tree].filter((file) => !analysis.libraryModules.includes(file));
				// the references to the library's modules: the library's own first
				const references = users.flatMap((file) => scanOf(file).references.filter((r) => analysis.libraryModules.includes(r.path)).map((r) => ({ ...r, file })))
					.sort((a, b) => Number(b.path === analysis.library) - Number(a.path === analysis.library));
				if (references.length === 0) {
					continue;
				}
				// xsl:use-package can't be in an imported module (XTSE3008): it goes in the top-level module, after its
				// imports, and the references to the library's modules are removed
				references.forEach((r) => remove(r.file, r.offset));
				const importer = scanOf(top);
				const importerMarkup = markupOf(top);
				const topRoot = XdocNotes.rootOffset(importerMarkup);
				const topRootElement = topRoot !== undefined ? PackageEdits.elementExtent(importerMarkup, topRoot) : undefined;
				if (!topRootElement) {
					throw new Error(`The xsl:stylesheet element of ${path.basename(top)} wasn't found`);
				}
				const imports = importer.references.filter((r) => r.isImport);
				const lastImport = imports.length > 0 ? imports[imports.length - 1] : undefined;
				const insertAt = lastImport ? PackageEdits.elementExtent(importerMarkup, lastImport.offset)!.end : topRootElement.startTagEnd;
				const topStep = PackageConversion.indentStep(importer.text, topRootElement.startTagEnd);
				const indent = lastImport ? PackageEdits.lineIndent(importer.text, lastImport.offset) : topStep;
				// the declarations and template rules moved into the xsl:override
				const moved: string[] = [];
				const move = (place: Place, isRule: boolean, inUnnamedMode = false, isNamed = false) => {
					const source = scanOf(place.path);
					const sourceMarkup = markupOf(place.path);
					if (isNamed) {
						// a rule that calls the named template, which stays
						const ruleMode = inUnnamedMode ? withMode(importer, RecordTypes.attributeOfElementAt(source.text, place.offset! + 1, 'mode')) : undefined;
						const split = PackageConversion.splitNamedRule(source, sourceMarkup, place.offset!, indent + topStep + topStep, topStep, ruleMode,
							(name) => PackageScope.translatePrefixes(name, source.bindings, importer.bindings));
						const key = `${place.path}#${place.offset}`;
						if (!removed.has(key)) {
							removed.add(key);
							add(place.path, split.edit);
						}
						moved.push(PackageConversion.withNamespaces(split.rule, source.bindings, importer.bindings));
						return;
					}
					let text = PackageEdits.reindented(source.text, sourceMarkup, place.offset!, indent + topStep + topStep);
					if (text === undefined) {
						throw new Error(`An element in ${path.basename(place.path)} wasn't found`);
					}
					movedElements.push({ path: place.path, start: place.offset!, end: PackageEdits.elementExtent(sourceMarkup, place.offset!)!.end });
					if (renaming) {
						// in the stylesheet's module, the mode has its prefix
						text = PackageConversion.withApplyTemplatesMode(text, source.prefix, withMode.bind(undefined, importer));
						if (inUnnamedMode) {
							// the rule's mode
							const tagStart = text.indexOf('<');
							const ruleMode = PackageEdits.withAttributes(text, RecordTypes.blankMarkup(text), tagStart, [['mode', withMode(importer, RecordTypes.attributeOfElementAt(text, tagStart + 1, 'mode'))]])!;
							text = text.substring(0, ruleMode.start) + ruleMode.text + text.substring(ruleMode.end);
						}
					}
					if (isRule) {
						text = text.replace(new RegExp(`(</?${source.prefix}:)apply-imports\\b`, 'g'), '$1next-match');
					} else {
						// the declaration's name, with the importing module's prefix for its namespace
						text = text.replace(/^(\s*<[^\s/>]+[^>]*?\sname\s*=\s*)(["'])([^"']*)\2/, (_match, before, quote, name) =>
							before + quote + PackageScope.translatePrefixes(name, source.bindings, importer.bindings) + quote);
					}
					moved.push(PackageConversion.withNamespaces(text, source.bindings, importer.bindings));
					remove(place.path, place.offset!);
				};
				plan.overrides.filter((o) => o.top === top).forEach((o) => move(o.declaration.place, false));
				plan.movedRules.filter((r) => r.top === top).forEach((r) => move(r.rule.place, true, false, r.rule.isNamed));
				if (renaming) {
					users.flatMap((file) => scanOf(file).rules).filter((r) => r.modes.includes('#unnamed') && r.place.offset !== undefined).forEach((r) => move(r.place, true, true, r.isNamed));
					// the template rule that starts the transformation - in the unnamed mode - in the package's mode
					const lineStart = importer.text.lastIndexOf('\n', topRootElement.endTagStart - 1) + 1;
					const entry = [`<!-- the transformation starts in the unnamed mode: this applies templates in the mode of package ${escape(packageName)} that it became -->`,
						'<xsl:template match=".">', `${topStep}<xsl:apply-templates select="." mode="${escape(modeIn(importer))}"/>`, '</xsl:template>']
						.map((line) => topStep + line).join('\n') + '\n';
					add(top, importer.text.substring(lineStart, topRootElement.endTagStart).trim() === '' ? { start: lineStart, end: lineStart, text: entry } :
						{ start: topRootElement.endTagStart, end: topRootElement.endTagStart, text: '\n' + entry });
				}
				const name = `name="${escape(packageName)}" package-version="${escape(packageVersion)}"`;
				const usePackage = moved.length === 0 ? `<xsl:use-package ${name}/>` :
					`<xsl:use-package ${name}>\n${indent + topStep}<xsl:override>\n${moved.join('\n')}\n${indent + topStep}</xsl:override>\n${indent}</xsl:use-package>`;
				// after the imports, which must come first - the removed import of the library, if it's the last, aside
				const insertAfter = lastImport && references.some((r) => r.file === top && r.offset === lastImport.offset) ?
					(imports.length > 1 ? PackageEdits.elementExtent(importerMarkup, imports[imports.length - 2].offset)!.end : topRootElement.startTagEnd) : insertAt;
				add(top, { start: insertAfter, end: insertAfter, text: `\n${indent}${usePackage}` });

				// copies of the declarations a package doesn't share, after the xsl:use-package
				const topScan = scanOf(top);
				const topMarkup = markupOf(top);
				const has = (kind: string, name?: string) => kind === 'strip-space' ? topScan.stripSpace.length > 0 : kind === 'output' ? topScan.outputs.length > 0 :
					topScan.declarations.some((d) => d.kind === kind && d.expandedName === name);
				const copies = plan.copies.filter((c) => !has(c.kind, c.name) && c.place.offset !== undefined);
				if (copies.length > 0) {
					const after = insertAfter;
					const copyIndent = indent;
					const text = copies.map((c) => {
						const source = scanOf(c.place.path);
						const copy = PackageEdits.reindented(source.text, markupOf(c.place.path), c.place.offset!, copyIndent)!;
						return '\n' + PackageConversion.withNamespaces(copy, source.bindings, topScan.bindings);
					}).join('');
					add(top, { start: after, end: after, text });
				}
			}
			// the stylesheets' xsl:apply-templates in the unnamed mode, other than in elements moved, get the mode
			if (renaming) {
				const changed = new Set<string>();
				for (const module of analysis.userModules) {
					const scan = scanOf(module);
					scan.applies.filter((a) => a.modes.includes('#unnamed') && a.place.offset !== undefined && !changed.has(`${module}#${a.place.offset}`) &&
						!movedElements.some((m) => m.path === module && a.place.offset! > m.start && a.place.offset! < m.end))
						.forEach((a) => {
							changed.add(`${module}#${a.place.offset}`);
							add(module, PackageEdits.withAttributes(scan.text, markupOf(module), a.place.offset!, [['mode', withMode(scan, a.modeAttribute)]]));
						});
				}
			}
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
		// with the prefix each module uses for XSLT
		edits.forEach((fileEdits, file) => {
			fileEdits.forEach((edit) => edit.text = RecordTypes.withXsltPrefix(edit.text, scanOf(file).prefix));
			fileEdits.sort((a, b) => a.start - b.start);
		});
		return edits;
	}

	// how a stylesheet's declaration's signature differs from the library's it would override - undefined if they match
	private static signatureMismatch(userScan: ModuleScan, declaration: Declaration, libraryScan: ModuleScan, overridden: Declaration) {
		const asGlobal = (scan: ModuleScan, d: Declaration): GlobalInstructionData => {
			const offset = d.place.offset ?? 0;
			const lineStart = scan.text.lastIndexOf('\n', offset - 1) + 1;
			const type = d.kind === 'function' ? GlobalInstructionType.Function : d.kind === 'template' ? GlobalInstructionType.Template :
				d.kind === 'variable' ? (d.isParam ? GlobalInstructionType.Parameter : GlobalInstructionType.Variable) : GlobalInstructionType.AttributeSet;
			return { type, name: d.name, idNumber: d.arity ?? 0, href: scan.path, prefixBindings: scan.bindings, token: { line: d.place.line, startCharacter: offset - lineStart + 1, length: 0, value: '', tokenType: 0 } };
		};
		return PackageScope.signatureMismatch(userScan.text, asGlobal(userScan, declaration), asGlobal(libraryScan, overridden));
	}

	// a template rule that's also a named template can't move into xsl:override - where it would also override a named
	// template the package doesn't have (XTSE3058) - so it's split: the named template stays, and a template rule that
	// calls it moves - unless it uses xsl:next-match or xsl:apply-imports, which depend on the current template rule
	private static namedRuleItems(rules: ModeUse[], items: ConversionItem[]) {
		rules.filter((r) => r.isNamed).forEach((rule) => items.push(rule.callsNext ?
			{
				section: 'blockers', severity: 'blocker', subject: 'a template rule that\'s also a named template',
				text: 'it can\'t move into xsl:override as it is, where it would also override a named template the package doesn\'t have (XTSE3058) - nor be split into a template rule calling the named template, as it uses xsl:next-match or xsl:apply-imports: split it by hand', places: [rule.place]
			} : {
				section: 'modes', severity: 'change', subject: 'a template rule that\'s also a named template',
				text: 'split: the named template stays, and a template rule that calls it, with its parameters, moves into xsl:override - as a rule there that\'s also a named template would override one the package doesn\'t have (XTSE3058)', places: [rule.place]
			}));
	}

	// a template rule that's also a named template, split: an edit that leaves the named template - without its match,
	// mode and priority - and a template rule that calls it, passing its parameters, other than tunnel parameters, which
	// are passed on anyway. The rule's lines start with the indent; mode gives its mode attribute's new value, if it's
	// changing, and calledName the template's name as written where the rule goes
	private static splitNamedRule(scan: ModuleScan, markup: string, offset: number, indent: string, step: string, mode: string | undefined, calledName: (name: string) => string): { edit: TextEdit, rule: string } {
		const text = scan.text;
		const attribute = (at: number, name: string) => RecordTypes.attributeOfElementAt(text, at + 1, name, true);
		const named = PackageEdits.withAttributes(text, markup, offset, [['match', undefined], ['mode', undefined], ['priority', undefined]])!;
		const ruleAttributes = [['match', attribute(offset, 'match')], ['mode', mode ?? attribute(offset, 'mode')], ['priority', attribute(offset, 'priority')]]
			.filter(([, value]) => value !== undefined).map(([name, value]) => ` ${name}="${value}"`).join('');
		const params = RecordTypes.childElements(text, markup, offset, 'xsl:param').filter((p) => !/^(yes|true|1)$/.test((attribute(p, 'tunnel') ?? '').trim()));
		const declared = params.map((p) => PackageEdits.reindented(text, markup, p, indent + step)!);
		const passed = params.map((p) => `${indent + step + step}<${scan.prefix}:with-param name="${attribute(p, 'name')}" select="$${attribute(p, 'name')}"/>`);
		const call = `<${scan.prefix}:call-template name="${calledName(attribute(offset, 'name') ?? '')}"`;
		const rule = [`${indent}<${scan.prefix}:template${ruleAttributes}>`, ...declared,
			passed.length > 0 ? [`${indent + step}${call}>`, ...passed, `${indent + step}</${scan.prefix}:call-template>`].join('\n') : `${indent + step}${call}/>`,
			`${indent}</${scan.prefix}:template>`].join('\n');
		return { edit: named, rule };
	}

	// the text of an element, with the xsl:apply-templates in it that are in the unnamed mode - without a mode, or with
	// #default or #unnamed - given the mode (mode gives their mode attribute's new value)
	private static withApplyTemplatesMode(text: string, prefix: string, mode: (value: string | undefined) => string) {
		const markup = RecordTypes.blankMarkup(text);
		const tagRgx = new RegExp(RecordTypes.tagPattern, 'g');
		const changes: TextEdit[] = [];
		let match: RegExpExecArray | null;
		while ((match = tagRgx.exec(markup)) !== null) {
			if (match[1] || match[2] !== `${prefix}:apply-templates`) {
				continue;
			}
			const value = RecordTypes.attributeOfElementAt(text, match.index + 1, 'mode');
			if (value === undefined || value.trim().split(/\s+/).some((m) => m === '#default' || m === '#unnamed')) {
				const edit = PackageEdits.withAttributes(text, markup, match.index, [['mode', mode(value)]]);
				if (edit) {
					changes.push(edit);
				}
			}
		}
		return changes.sort((a, b) => b.start - a.start).reduce((result, e) => result.substring(0, e.start) + e.text + result.substring(e.end), text);
	}

	// an abstract declaration in the package for a declaration of a stylesheet that the library uses - with its name,
	// type and parameters, in the library's prefixes
	private static abstractDeclaration(scan: ModuleScan, markup: string, declaration: Declaration, libraryBindings: Map<string, string> | undefined, step: string) {
		const text = scan.text;
		const tagStart = declaration.place.offset!;
		const translate = (value: string) => PackageScope.translatePrefixes(value, scan.bindings, libraryBindings);
		const attribute = (offset: number, name: string, value = RecordTypes.attributeOfElementAt(text, offset + 1, name, true)) => value === undefined ? '' : ` ${name}="${translate(value)}"`;
		const name = translate(declaration.name);
		const as = attribute(tagStart, 'as');
		const params = RecordTypes.childElements(text, markup, tagStart, 'xsl:param').map((offset) =>
			`${step}<xsl:param${attribute(offset, 'name')}${attribute(offset, 'as')}${attribute(offset, 'required')}${attribute(offset, 'tunnel')}/>`);
		switch (declaration.kind) {
			case 'function':
				return `<xsl:function name="${name}"${as} visibility="abstract">${params.length > 0 ? '\n' + params.join('\n') + '\n' : ''}</xsl:function>`;
			case 'template':
				return `<xsl:template name="${name}"${as} visibility="abstract">${params.length > 0 ? '\n' + params.join('\n') + '\n' : ''}</xsl:template>`;
			case 'variable':
				return `<xsl:variable name="${name}"${as} visibility="abstract"/>`;
			default:
				return `<xsl:attribute-set name="${name}" visibility="abstract"/>`;
		}
	}

	// an element moved or copied to another module, with declarations of the namespaces of its prefixes that the other
	// module doesn't declare as the module it's from does
	private static withNamespaces(element: string, from: Map<string, string> | undefined, to: Map<string, string> | undefined) {
		if (!from) {
			return element;
		}
		const used = new Set([...element.matchAll(/(?<![\w.{}-])([A-Za-z_][\w.-]*):[A-Za-z_*]/g)].map((m) => m[1]));
		const missing = [...used].filter((prefix) => prefix !== 'xml' && from.has(prefix) && to?.get(prefix) !== from.get(prefix) && from.get(prefix) !== 'http://www.w3.org/1999/XSL/Transform');
		if (missing.length === 0) {
			return element;
		}
		const declarations = missing.map((prefix) => ` xmlns:${prefix}="${from.get(prefix)!.replace(/"/g, '&quot;')}"`).join('');
		return element.replace(/^(\s*<[^\s/>]+)/, `$1${declarations}`);
	}

	private static indentStep(text: string, offset: number) {
		return PackageScope.lineIndent(text, offset) || /\n([ \t]+)\S/.exec(text)?.[1] || '\t';
	}

	// a problem with a name for the mode the unnamed mode becomes - a QName with a prefix the library declares, or an
	// EQName - undefined if there's none
	public static modeNameProblem(analysis: ConversionAnalysis, name: string): string | undefined {
		const match = /^(?:Q\{[^}]*\}|([\p{L}_][\p{L}\p{N}_.-]*):)?[\p{L}_][\p{L}\p{N}_.-]*$/u.exec(name.trim());
		if (!match) {
			return 'A mode name, e.g. lib:default';
		}
		return match[1] && !analysis.plan.scans.get(analysis.library)?.bindings?.has(match[1]) ? `The library doesn't declare the prefix '${match[1]}'` : undefined;
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
			namespaceAliases: [], globalVariables: [], unnamedModes: [], hasDefaultMode: false, isPackage: ImportIndex.packageDeclaration(text) !== undefined,
			text, prefix: 'xsl', references: [], unresolved: []
		};
		const light = new XslLexerLight(XSLTLightConfiguration.configuration);
		const globals = light.analyseLight(text);
		const bindings = light.prefixBindings;
		result.bindings = bindings;
		const expanded = (name: string) => ModulePrefixes.expandedName(name.trim(), bindings);
		const place = (line: number, offset?: number): Place => ({ path: file, line, offset });
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
				kind, name: global.name, expandedName: expanded(global.name),
				place: place(global.token.line, text.lastIndexOf('<', XdocNotes.offsetAt(text, global.token.line, Math.max(0, global.token.startCharacter)))),
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
		result.prefix = prefix;
		const attribute = (offset: number, name: string) => RecordTypes.attributeOfElementAt(text, offset + 1, name);
		const lineOf = (offset: number) => text.substring(0, offset).split('\n').length - 1;
		const stack: { name: string, defaultMode: string, rule?: ModeUse }[] = [];
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
						result.stripSpace.push(place(line, offset));
						break;
					case 'xsl:output':
						if (attribute(offset, 'name') === undefined) {
							result.outputs.push(place(line, offset));
						}
						break;
					case 'xsl:global-context-item':
						result.globalContextItem.push(place(line));
						break;
					case 'xsl:import':
					case 'xsl:include': {
						const href = attribute(offset, 'href');
						const referenced = href !== undefined ? HrefPaths.toPath(HrefPaths.fromAttribute(href), file) : undefined;
						if (referenced && fs.existsSync(referenced)) {
							result.references.push({ path: path.normalize(referenced), offset, isImport: name === 'xsl:import' });
						} else if (href !== undefined) {
							result.unresolved.push({ href, place: place(line, offset) });
						}
						break;
					}
					case 'xsl:namespace-alias':
						result.namespaceAliases.push(place(line));
						break;
					case 'xsl:decimal-format': {
						const formatName = attribute(offset, 'name');
						if (formatName) {
							result.declarations.push({ kind: 'decimal-format', name: formatName, expandedName: expanded(formatName), place: place(line, offset) });
						}
						break;
					}
					case 'xsl:variable':
					case 'xsl:param': {
						const variableName = attribute(offset, 'name');
						if (variableName) {
							result.globalVariables.push({ kind: 'variable', name: variableName, expandedName: expanded(variableName), place: place(line, offset), isParam: name === 'xsl:param' });
						}
						break;
					}
				}
			}
			if (stack.length === 0) {
				result.hasDefaultMode = attribute(offset, isXslt ? 'default-mode' : `${prefix}:default-mode`) !== undefined;
			} else if (stack.length === 1 && name === 'xsl:mode' && attribute(offset, 'name') === undefined) {
				result.unnamedModes.push(place(line, offset));
			}
			let rule: ModeUse | undefined;
			if (name === 'xsl:apply-imports' || name === 'xsl:next-match') {
				const enclosing = [...stack].reverse().find((e) => e.rule)?.rule;
				if (enclosing) {
					enclosing.callsNext = true;
				}
			}
			if (name === 'xsl:template' && attribute(offset, 'match') !== undefined) {
				rule = { modes: modes(attribute(offset, 'mode')), place: place(line, offset), modeAttribute: attribute(offset, 'mode'), isNamed: attribute(offset, 'name') !== undefined };
				result.rules.push(rule);
			} else if (name === 'xsl:apply-templates') {
				result.applies.push({ modes: modes(attribute(offset, 'mode')).filter((m) => m !== '#current'), place: place(line, offset), modeAttribute: attribute(offset, 'mode') });
			} else if (name === 'xsl:apply-imports') {
				result.applyImports.push(place(line, offset));
			} else if (name === 'xsl:call-template') {
				names(attribute(offset, 'name')).forEach((n) => use('template', n, line));
			}
			names(attribute(offset, isXslt ? 'use-attribute-sets' : `${prefix}:use-attribute-sets`)).forEach((n) => use('attribute-set', n, line));
			names(attribute(offset, 'use-character-maps')).forEach((n) => use('character-map', n, line));
			if (isXslt) {
				names(attribute(offset, 'use-accumulators')).filter((n) => n !== '#all').forEach((n) => use('accumulator', n, line));
			}
			if (!match[3]) {
				stack.push({ name, defaultMode, rule });
			}
		}
		// format-number with a decimal format's name
		for (const formatNumber of text.matchAll(/format-number\s*\([^()]*,\s*(["'])([^"']+)\1\s*\)/g)) {
			use('decimal-format', formatNumber[2], lineOf(formatNumber.index!));
		}
		return result;
	}

	// the global variables and parameters of a module whose values use the context item: each value - its select, or
	// its content - is linted as the body of a function, where there's no context item, so the linter reports what needs
	// one, e.g. a path, '.' or name()
	private static async contextVariables(scan: ModuleScan): Promise<Declaration[]> {
		const candidates = scan.globalVariables.filter((v) => v.place.offset !== undefined);
		const markup = RecordTypes.blankMarkup(scan.text);
		const root = XdocNotes.rootOffset(markup);
		const rootElement = root !== undefined ? PackageEdits.elementExtent(markup, root) : undefined;
		if (candidates.length === 0 || root === undefined || !rootElement) {
			return [];
		}
		const xsl = scan.prefix;
		const rootTag = scan.text.substring(root, rootElement.startTagEnd).replace(/^<([\w.-]+:)?(stylesheet|transform|package)\b/, `<${xsl}:stylesheet`)
			.replace(/\/?>$/, ' xmlns:zcx="urn:x-context-check">');
		const lines: string[] = [rootTag];
		const ranges: { variable: Declaration, start: number, end: number }[] = [];
		candidates.forEach((variable, index) => {
			const extent = PackageEdits.elementExtent(markup, variable.place.offset!);
			if (!extent) {
				return;
			}
			const select = RecordTypes.attributeOfElementAt(scan.text, variable.place.offset! + 1, 'select', true);
			const body = select !== undefined ? `<${xsl}:sequence select="${select.replace(/"/g, '&quot;')}"/>` : extent.selfClosing ? undefined : scan.text.substring(extent.startTagEnd, extent.endTagStart);
			if (body === undefined) {
				return;
			}
			const start = lines.join('\n').split('\n').length;
			lines.push(`<${xsl}:function name="zcx:v${index}">`, body, `</${xsl}:function>`);
			ranges.push({ variable, start, end: lines.join('\n').split('\n').length - 1 });
		});
		lines.push(`</${xsl}:stylesheet>`);
		const document = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'xslt' });
		const lexer = new XslLexer(XSLTConfiguration.configuration);
		lexer.provideCharLevelState = true;
		const tokens = lexer.analyse(document.getText());
		const diagnostics = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: lexer.isXSLT40 }, DocumentTypes.XSLT, document, tokens, lexer.globalInstructionData, [], []);
		const lines_ = diagnostics.filter((d) => /Context-item is missing/.test(d.message)).map((d) => d.range.start.line);
		return ranges.filter((r) => lines_.some((line) => line >= r.start && line <= r.end)).map((r) => r.variable);
	}
}
