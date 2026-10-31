/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT package visibility
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BaseToken } from './xpLexer';
import { GlobalInstructionData, GlobalInstructionType, XslLexer } from './xslLexer';
import { XslLexerLight } from './xslLexerLight';
import { XSLTLightConfiguration } from './languageConfigurations';
import { HrefPaths } from './hrefPaths';
import { ModulePrefixes } from './modulePrefixes';
import { XsltPackages } from './xsltPackages';
import { RecordTypes } from './recordTypes';
import { XdocNotes } from './xdocNote';
import { ImportIndex } from './importIndex';
import { PackageEdits, TextEdit } from './packageEdits';
import type { XsltPackage } from './xsltSymbolProvider';

// a module of a package: the package's xsl:package module, or one it imports or includes
interface PackageModule {
	path: string;
	mtime: number;
	text: string;
	data: GlobalInstructionData[];
	exposes: GlobalInstructionData[];
	bindings?: Map<string, string>;
}

// a component of a used package, as the using module sees it
export interface PackageComponent extends GlobalInstructionData {
	packageName: string;
	packageVersion?: string;
	// in the package, after its xsl:expose elements, and in the using module, after its xsl:accept elements
	packageVisibility: string;
	visibility: string;
}

type SignatureParam = NonNullable<ReturnType<typeof PackageScope['signature']>>['params'][number];

// a declaration in xsl:override, with the package component it overrides
export interface OverridingDeclaration extends GlobalInstructionData {
	overridden?: PackageComponent;
}

export interface PackageProblem {
	token: BaseToken;
	message: string;
	isWarning?: boolean;
	// a problem with the element of the token as a whole: shown on its element name
	onElement?: boolean;
	// for an abstract component that isn't overridden: the fixes, which override it
	fixes?: PackageFix[];
}

// a fix: edits of the module's text (see PackageEdits)
export interface PackageFix {
	title: string;
	edits: TextEdit[];
}

// an abstract component of a used package that the module doesn't override - named with the module's prefixes, as
// it's referred to, e.g. 'a:shape' and its arity, for a function - with the fix that overrides it
export interface AbstractComponent {
	kind: string;
	name: string;
	arity?: number;
	packageName: string;
	fix: PackageFix;
}

// a name in the names attribute of an xsl:accept or xsl:expose: how well it matches a component - 0 for not at all, 1
// for '*', 2 for a namespace or local-name wildcard, 3 for the name
type NamePriority = 0 | 1 | 2 | 3;

/**
 * XSLT 3.0 packages (section 3.5): which components of the packages a stylesheet uses with xsl:use-package it can
 * refer to - and problems with its xsl:accept and xsl:override elements. As Saxon 13 applies the rules:
 * - in the package, a component's visibility is its visibility attribute, else that of the best match of the package's
 *   xsl:expose elements, else private - but public for a global xsl:param, which has no visibility attribute
 * - keys, accumulators, character maps and template rules in the unnamed mode aren't shared
 * - the using module may narrow a component's visibility with xsl:accept, e.g. to hidden, and replace a public or
 *   abstract component with xsl:override - an abstract component that isn't overridden can't be used
 * - a component the package accepts from a package it uses itself is private, unless the package's xsl:accept or
 *   xsl:expose makes it public
 * Lexical only (see the linter's scope): names are compared by namespace URI, and functions by arity.
 */
export class PackageScope {
	private static modules = new Map<string, PackageModule>();
	// for each document, the fixes of its diagnostics, by XsltTokenDiagnostics.recordFixKey
	public static readonly fixes = new Map<string, Map<string, PackageFix[]>>();
	private static readonly maxDepth = 8;

	// the component kind, as in the component attribute of xsl:expose and xsl:accept, of a declaration - undefined
	// for one that isn't a component
	public static componentKind(type: GlobalInstructionType): string | undefined {
		switch (type) {
			case GlobalInstructionType.Function: return 'function';
			case GlobalInstructionType.Template: return 'template';
			case GlobalInstructionType.Variable:
			case GlobalInstructionType.Parameter: return 'variable';
			case GlobalInstructionType.AttributeSet: return 'attribute-set';
			case GlobalInstructionType.ModeInstruction: return 'mode';
			case GlobalInstructionType.ItemType: return 'item-type';
			default: return undefined;
		}
	}

	// the components of the packages that the module uses (usePackages, from XslLexerLight, with their accepts and
	// overrides) as the module sees them - not hidden, not abstract, and not overridden (the module's declaration in
	// xsl:override is used instead) - with the template rules of their public modes, as ModeTemplate entries, and the
	// package's path as each one's href
	public static components(usePackages: GlobalInstructionData[], xsltPackages: XsltPackage[], workspace: string | undefined): PackageComponent[] {
		const result: PackageComponent[] = [];
		for (const usePackage of usePackages) {
			const used = PackageScope.usedPackage(usePackage, xsltPackages, workspace, 0, new Set(), true);
			if (used) {
				result.push(...used.available);
			}
		}
		return result;
	}

	// problems with the xsl:accept and xsl:override elements of the module's xsl:use-package elements, and its
	// declarations that have the name of a component it uses from a package - the module's text is for the signatures
	// of its declarations in xsl:override
	public static problems(text: string, usePackages: GlobalInstructionData[], declarations: GlobalInstructionData[], moduleBindings: Map<string, string> | undefined, xsltPackages: XsltPackage[], workspace: string | undefined): PackageProblem[] {
		const problems: PackageProblem[] = [];
		const markup = RecordTypes.blankMarkup(text);
		const offsetOf = (token: BaseToken) => XdocNotes.offsetAt(text, token.line, token.startCharacter);
		// a fix, if each of its edits could be made
		const fix = (title: string, ...edits: (TextEdit | undefined)[]): PackageFix[] => edits.every((e) => e !== undefined) ? [{ title, edits: edits as TextEdit[] }] : [];
		const removeDeclaration = (declaration: GlobalInstructionData) =>
			fix('Remove the declaration', PackageEdits.removeElement(text, markup, text.lastIndexOf('<', offsetOf(declaration.token))));
		// a name token of an attribute value from XslLexerLight, whose value token includes its quotes
		const renameDeclaration = (declaration: GlobalInstructionData, names: string[]) => names.flatMap((name) =>
			fix(`Change to '${name}'`, { start: offsetOf(declaration.token) + 1, end: offsetOf(declaration.token) + declaration.token.length - 1, text: name }));
		for (const usePackage of usePackages) {
			const used = PackageScope.usedPackage(usePackage, xsltPackages, workspace, 0, new Set(), true);
			if (!used) {
				continue;
			}
			const packageName = usePackage.name;
			if (used.abstracts.length > 0) {
				const abstracts = PackageScope.abstractComponents(text, usePackage, used.abstracts, moduleBindings);
				const names = abstracts.map((a) => a.kind === 'function' ? `${a.name}#${a.arity}` : a.kind === 'variable' ? '$' + a.name : a.name);
				const all = PackageScope.overrideFix(text, usePackage, used.abstracts, moduleBindings, `Override the abstract components of package '${packageName}'`);
				problems.push({
					token: usePackage.token, isWarning: true, onElement: true,
					message: `Package '${packageName}' has abstract components that aren't overridden: ${names.join(', ')} - calling a component that depends on one stops the transformation (XTDE3052)`,
					fixes: (all && abstracts.length > 1 ? [all] : []).concat(abstracts.map((a) => a.fix))
				});
			}
			for (const accept of usePackage.accepts ?? []) {
				const kinds = PackageScope.kinds(accept.component);
				const nameTokens = XslLexer.tokensInsideToken(accept.token, accept.name);
				const acceptStart = text.lastIndexOf('<', offsetOf(accept.token));
				// the name removed - or the xsl:accept, if it's the only one
				const remove = (nameToken: BaseToken) => nameTokens.length === 1 ? fix('Remove the xsl:accept', PackageEdits.removeElement(text, markup, acceptStart)) :
					fix(`Remove '${nameToken.value}' from the xsl:accept`, PackageEdits.removeName(text, offsetOf(nameToken), nameToken.value.length));
				const replace = (nameToken: BaseToken, names: string[]) => names.flatMap((name) => fix(`Change to '${name}'`, { start: offsetOf(nameToken), end: offsetOf(nameToken) + nameToken.value.length, text: name }));
				for (const nameToken of nameTokens) {
					const name = nameToken.value;
					if (PackageScope.isWildcard(name)) {
						continue;
					}
					const candidates = used.all.filter((c) => kinds.includes(PackageScope.componentKind(c.type) ?? ''));
					if (name.startsWith('#')) {
						problems.push({ token: nameToken, message: `XTSE0020: '${name}' isn't a name - the unnamed mode can't be accepted`, fixes: remove(nameToken) });
						continue;
					}
					if (kinds.includes('function') && accept.component !== '*' && !name.includes('#')) {
						// the arities of the package's functions with the name
						const arities = [...new Set(candidates.filter((c) => c.type === GlobalInstructionType.Function && PackageScope.namePriority(name, accept.prefixBindings, c) === 3).map((c) => c.idNumber))].sort();
						problems.push({ token: nameToken, message: `XTSE3020: The function name '${name}' must have its arity, e.g. ${name}#1`, fixes: replace(nameToken, arities.map((arity) => `${name}#${arity}`)) });
						continue;
					}
					const matching = candidates.filter((c) => PackageScope.namePriority(name, accept.prefixBindings, c) === 3);
					const kindLabel = accept.component === '*' ? 'component' : accept.component ?? 'component';
					const overridden = matching.length > 0 && (usePackage.overrides ?? []).some((o) => matching.some((c) => PackageScope.overrides(o, c)));
					if (overridden) {
						problems.push({ token: nameToken, message: `XTSE3051: The ${kindLabel} '${name}' is overridden in this xsl:use-package, so it can't also be accepted`, fixes: remove(nameToken) });
					} else if (matching.length === 0) {
						const names = candidates.filter((c) => c.packageVisibility !== 'private').map((c) => PackageScope.label(c, accept.prefixBindings).replace(/^(function|template|variable|parameter|attribute set|mode|item-type) \$?/, ''));
						problems.push({ token: nameToken, message: `XTSE3030: No ${kindLabel} named '${name}' in package '${packageName}'`, fixes: replace(nameToken, RecordTypes.closestNames(name, [...new Set(names)])).concat(remove(nameToken)) });
					} else if (matching.every((c) => c.packageVisibility === 'private')) {
						problems.push({ token: nameToken, message: `XTSE3040: The ${kindLabel} '${name}' is private in package '${packageName}', so it can't be accepted`, fixes: remove(nameToken) });
					} else {
						const widened = matching.find((c) => PackageScope.widens(c.packageVisibility, accept.visibility));
						if (widened) {
							const narrowest = widened.packageVisibility;
							problems.push({
								token: nameToken, message: `XTSE3040: The ${kindLabel} '${name}' is ${narrowest} in package '${packageName}', so it can't be accepted as ${accept.visibility}`,
								fixes: fix(`Change the visibility to '${narrowest}'`, PackageEdits.withAttributes(text, markup, acceptStart, [['visibility', narrowest]])).concat(remove(nameToken))
							});
						}
					}
				}
			}
			for (const override of usePackage.overrides ?? []) {
				const kind = PackageScope.componentKind(override.type);
				if (!kind) {
					continue;
				}
				const matching = used.all.filter((c) => PackageScope.overrides(override, c));
				if (matching.length === 0) {
					// the names of the package's components of the kind that can be overridden
					const names = used.all.filter((c) => PackageScope.componentKind(c.type) === kind && (c.visibility === 'public' || c.visibility === 'abstract'))
						.map((c) => ModulePrefixes.nameIn(c, override.prefixBindings ?? moduleBindings));
					problems.push({
						token: override.token, message: `XTSE3058: There is no ${kind} named '${override.name}' in package '${packageName}' to override`,
						fixes: renameDeclaration(override, RecordTypes.closestNames(override.name, [...new Set(names)])).concat(removeDeclaration(override))
					});
				} else if (!matching.some((c) => c.visibility === 'public' || c.visibility === 'abstract')) {
					problems.push({ token: override.token, message: `XTSE3060: The ${kind} '${override.name}' can't be overridden: it's ${matching[0].visibility} in package '${packageName}'`, fixes: removeDeclaration(override) });
				} else {
					const overridden = matching.find((c) => c.visibility === 'public' || c.visibility === 'abstract')!;
					const mismatch = PackageScope.signatureMismatch(text, override, overridden);
					if (mismatch) {
						const edits = PackageScope.signatureEdits(text, override, overridden, override.prefixBindings ?? moduleBindings);
						problems.push({
							token: override.token, message: `XTSE3070: The overriding ${kind} doesn't match the one in package '${packageName}': ${mismatch}`,
							fixes: edits && edits.length > 0 ? fix(`Change the signature to match package '${packageName}'`, ...edits) : []
						});
					}
				}
			}
			// a declaration of the module with the name of a component it can use from the package - outside xsl:override
			for (const declaration of declarations) {
				const kind = PackageScope.componentKind(declaration.type);
				if (!kind || kind === 'mode') {
					continue;
				}
				const conflict = used.available.find((c) => PackageScope.componentKind(c.type) === kind && PackageScope.sameName(c, declaration.name, declaration.prefixBindings ?? moduleBindings)
					&& (kind !== 'function' || PackageScope.aritiesOverlap(c, declaration)));
				if (conflict) {
					const declarationStart = text.lastIndexOf('<', offsetOf(declaration.token));
					const moved = PackageScope.overrideInsertion(text, usePackage, (indent) => PackageEdits.reindented(text, markup, declarationStart, indent));
					problems.push({
						token: declaration.token, message: `XTSE3050: The ${kind} '${declaration.name}' has the name of a ${conflict.visibility} ${kind} in package '${packageName}' - to replace it, declare it in xsl:override`,
						fixes: fix(`Move into the xsl:override of package '${packageName}'`, PackageEdits.removeElement(text, markup, declarationStart), moved)
					});
				}
			}
		}
		return problems;
	}

	// the components of the packages the document uses that its declarations in xsl:override replace - named with its
	// prefixes: what a reference in the note of such a declaration refers to (see XdocReferences.resolve)
	public static overriddenBy(text: string, documentData: GlobalInstructionData[]): GlobalInstructionData[] {
		const { documentUsePackages, documentBindings } = PackageScope.usePackagesOf(text, documentData, []);
		const packages = XsltPackages.all();
		const workspace = PackageScope.workspaceFolder();
		return ModulePrefixes.inModule(documentUsePackages.flatMap((usePackage) => {
			const used = PackageScope.usedPackage(usePackage, packages, workspace, 0, new Set(), true);
			return used ? used.all.filter((c) => (usePackage.overrides ?? []).some((o) => PackageScope.overrides(o, c))) : [];
		}), documentBindings);
	}

	// for each declaration in an xsl:override of the module, the package component it overrides, if there's one
	public static overrideTargets(text: string): { override: GlobalInstructionData, original: PackageComponent }[] {
		if (!text.includes('use-package')) {
			return [];
		}
		const placeholder: GlobalInstructionData = { type: GlobalInstructionType.UsePackage, name: '', token: { line: 0, startCharacter: 0, length: 0, value: '', tokenType: 0 }, idNumber: 0 };
		const { documentUsePackages } = PackageScope.usePackagesOf(text, [placeholder], []);
		const packages = XsltPackages.all();
		const workspace = PackageScope.workspaceFolder();
		return documentUsePackages.flatMap((usePackage) => {
			const used = (usePackage.overrides ?? []).length > 0 ? PackageScope.usedPackage(usePackage, packages, workspace, 0, new Set(), true) : undefined;
			return (usePackage.overrides ?? []).flatMap((override) => {
				const original = used?.all.find((c) => PackageScope.overrides(override, c) && (c.visibility === 'public' || c.visibility === 'abstract'));
				return original ? [{ override, original }] : [];
			});
		});
	}

	// for the module of a package (its xsl:package module), its public and abstract components, each with the declarations
	// in the workspace that override it - in the xsl:override of a module that uses the package, the version found here
	public static overridesOf(packagePath: string): { component: PackageComponent, overrides: { path: string, declaration: GlobalInstructionData }[] }[] {
		const module = PackageScope.module(packagePath);
		const declaration = module ? ImportIndex.packageDeclaration(module.text) : undefined;
		if (!module || !declaration) {
			return [];
		}
		const packages = XsltPackages.all();
		const workspace = PackageScope.workspaceFolder();
		const pkg: XsltPackage = { name: declaration.name, path: packagePath, version: declaration.version };
		const components = PackageScope.packageComponents(pkg, packagePath, packages, workspace, 0, new Set([packagePath]))
			.filter((c) => c.href === packagePath && (c.packageVisibility === 'public' || c.packageVisibility === 'abstract'));
		const users = ImportIndex.isEnabled() ? ImportIndex.instance.usersOf(declaration.name) : [];
		const overrides = users.flatMap((user) => (PackageScope.module(user)?.data ?? [])
			.filter((g) => {
				const found = g.type === GlobalInstructionType.UsePackage && g.name === declaration.name ? XsltPackages.find(packages, g.name, g.version) : undefined;
				return found !== undefined && HrefPaths.settingsPath(found.path, workspace ?? path.dirname(packagePath)) === packagePath;
			})
			.flatMap((usePackage) => (usePackage.overrides ?? []).map((o) => ({ path: user, declaration: o }))));
		return components.map((component) => ({ component, overrides: overrides.filter((o) => PackageScope.overrides(o.declaration, component)) }));
	}

	// for the name of a public or abstract component of a package (the module at packagePath) at the position, the
	// declarations in the workspace that override it - undefined if the position isn't on one
	public static overridersAt(packagePath: string, position: { line: number, character: number }) {
		return PackageScope.overridesOf(packagePath).find(({ component }) => PackageScope.isOnName(component, position))?.overrides;
	}

	// for the name of a declaration in an xsl:override of the module at the position - or within it, for xsl:original - the
	// package component it overrides
	public static originalAt(text: string, position: { line: number, character: number }, withinDeclaration = false) {
		const targets = PackageScope.overrideTargets(text);
		const onName = targets.find(({ override }) => PackageScope.isOnName(override, position));
		if (onName || !withinDeclaration) {
			return onName?.original;
		}
		// the declaration that's a child of an xsl:override, with the position in it
		const markup = RecordTypes.blankMarkup(text);
		const ancestors = RecordTypes.openElements(markup, XdocNotes.offsetAt(text, position.line, position.character));
		const index = ancestors.findIndex((element, i) => i > 0 && ancestors[i - 1].name === 'xsl:override');
		return index > -1 ? targets.find(({ override }) => text.lastIndexOf('<', XdocNotes.offsetAt(text, override.token.line, override.token.startCharacter)) === ancestors[index].offset)?.original : undefined;
	}

	// a declaration's name, from XslLexerLight: its attribute value, with its quotes
	private static isOnName(declaration: GlobalInstructionData, position: { line: number, character: number }) {
		const token = declaration.token;
		return token.line === position.line && position.character >= token.startCharacter && position.character <= token.startCharacter + token.length;
	}

	// the location of a declaration's name, without its quotes
	public static nameLocation(filePath: string, declaration: GlobalInstructionData) {
		const token = declaration.token;
		return { path: filePath, line: token.line, start: token.startCharacter + 1, end: token.startCharacter + Math.max(1, token.length - 1) };
	}

	// for the hover of an xsl:use-package: the package it uses, its path, and the components available - undefined if the
	// package isn't found
	public static usedBy(usePackage: GlobalInstructionData, xsltPackages: XsltPackage[], workspace: string | undefined) {
		const pkg = XsltPackages.find(xsltPackages, usePackage.name, usePackage.version);
		const used = pkg ? PackageScope.usedPackage(usePackage, xsltPackages, workspace, 0, new Set(), true) : undefined;
		return pkg && used ? { pkg, path: HrefPaths.settingsPath(pkg.path, workspace ?? path.dirname(pkg.path)), available: used.available } : undefined;
	}

	// the abstract components of the module's used packages that it doesn't override - each with a fix to override it
	public static abstractsOf(text: string, usePackages: GlobalInstructionData[], moduleBindings: Map<string, string> | undefined, xsltPackages: XsltPackage[], workspace: string | undefined): AbstractComponent[] {
		return usePackages.flatMap((usePackage) => {
			const used = PackageScope.usedPackage(usePackage, xsltPackages, workspace, 0, new Set(), true);
			return used ? PackageScope.abstractComponents(text, usePackage, used.abstracts, moduleBindings) : [];
		});
	}

	private static abstractComponents(text: string, usePackage: GlobalInstructionData, abstracts: PackageComponent[], moduleBindings: Map<string, string> | undefined): AbstractComponent[] {
		return abstracts.flatMap((component) => {
			const kind = PackageScope.componentKind(component.type)!;
			const name = ModulePrefixes.nameIn(component, moduleBindings);
			const fix = PackageScope.overrideFix(text, usePackage, [component], moduleBindings, `Override abstract ${PackageScope.label(component, moduleBindings)}`);
			return fix ? [{ kind, name, arity: kind === 'function' ? component.idNumber : undefined, packageName: component.packageName, fix }] : [];
		});
	}

	// e.g. 'function a:shape#1', 'template a:t', 'variable $a:v' or 'attribute set a:as' - named with the module's prefixes
	public static label(component: PackageComponent, moduleBindings: Map<string, string> | undefined) {
		const kind = PackageScope.componentKind(component.type);
		const name = ModulePrefixes.nameIn(component, moduleBindings);
		switch (kind) {
			case 'function': return `function ${name}#${component.idNumber}`;
			case 'variable': return `${component.type === GlobalInstructionType.Parameter ? 'parameter' : 'variable'} $${name}`;
			case 'attribute-set': return `attribute set ${name}`;
			default: return `${kind} ${name}`;
		}
	}

	// for an xsl:use-package of the module (at the offset of its start tag), the components it can override: the public
	// and abstract functions, templates, variables and attribute sets of the package that it doesn't already override
	public static overridable(text: string, usePackageOffset: number) {
		const placeholder: GlobalInstructionData = { type: GlobalInstructionType.UsePackage, name: '', token: { line: 0, startCharacter: 0, length: 0, value: '', tokenType: 0 }, idNumber: 0 };
		const { documentUsePackages, documentBindings } = PackageScope.usePackagesOf(text, [placeholder], []);
		const usePackage = documentUsePackages.find((u) => text.lastIndexOf('<', XdocNotes.offsetAt(text, u.token.line, u.token.startCharacter)) === usePackageOffset);
		const used = usePackage ? PackageScope.usedPackage(usePackage, XsltPackages.all(), PackageScope.workspaceFolder(), 0, new Set(), true) : undefined;
		if (!usePackage || !used) {
			return undefined;
		}
		const kinds = ['function', 'template', 'variable', 'attribute-set'];
		const components = used.available.concat(used.abstracts).filter((c) => kinds.includes(PackageScope.componentKind(c.type) ?? '')
			&& (c.packageVisibility === 'public' || c.packageVisibility === 'abstract'));
		return { usePackage, components, bindings: documentBindings };
	}

	// the declaration that overrides the component, for a line with the indent - without the indent on its first line
	public static skeleton(text: string, usePackageOffset: number, component: PackageComponent, moduleBindings: Map<string, string> | undefined, indent: string) {
		return PackageScope.overrideSkeleton(component, moduleBindings, PackageScope.isXslt40(RecordTypes.blankMarkup(text)), indent, PackageScope.indentStep(text, usePackageOffset))?.substring(indent.length);
	}

	// the indentation of the line with the offset
	public static lineIndent(text: string, offset: number) {
		return PackageEdits.lineIndent(text, offset);
	}

	// the indentation step for content within a top-level element at the offset: its own indentation, as it's indented
	// by one step - or if it isn't indented, the document's first indentation
	private static indentStep(text: string, offset: number) {
		const indent = PackageScope.lineIndent(text, offset);
		return indent !== '' ? indent : /\n([ \t]+)\S/.exec(text)?.[1] ?? '\t';
	}

	// an edit that adds declarations overriding the components to the xsl:use-package: to its xsl:override, or a new
	// one - undefined if a component's declaration isn't found
	public static overrideFix(text: string, usePackage: GlobalInstructionData, components: PackageComponent[], moduleBindings: Map<string, string> | undefined, title: string): PackageFix | undefined {
		const edit = PackageScope.overrideInsertion(text, usePackage, (indent, step, isXslt40) => {
			const skeletons: string[] = [];
			for (const component of components) {
				const skeleton = PackageScope.overrideSkeleton(component, moduleBindings, isXslt40, indent, step);
				if (skeleton === undefined) {
					return undefined;
				}
				skeletons.push(skeleton);
			}
			return skeletons.join('\n');
		});
		return edit ? { title, edits: [edit] } : undefined;
	}

	// an edit that adds declarations to the xsl:override of the xsl:use-package, or a new one - written by declarations()
	// for lines with the indent, and the step for each level within them
	private static overrideInsertion(text: string, usePackage: GlobalInstructionData, declarations: (indent: string, step: string, isXslt40: boolean) => string | undefined): TextEdit | undefined {
		const markup = RecordTypes.blankMarkup(text);
		const tagStart = PackageScope.usePackageOffset(text, usePackage);
		const element = tagStart > -1 ? PackageEdits.elementExtent(markup, tagStart) : undefined;
		if (!element) {
			return undefined;
		}
		const lineIndent = (offset: number) => PackageEdits.lineIndent(text, offset);
		const useIndent = lineIndent(tagStart);
		const step = PackageScope.indentStep(text, tagStart);
		const override = RecordTypes.childElements(text, markup, tagStart, 'xsl:override')[0];
		const overrideIndent = override !== undefined ? lineIndent(override) : useIndent + step;
		const content = declarations(overrideIndent + step, step, PackageScope.isXslt40(markup));
		if (content === undefined) {
			return undefined;
		}
		const wrapped = `${overrideIndent}<xsl:override>\n${content}\n${overrideIndent}</xsl:override>`;
		if (element.selfClosing) {
			const slash = markup.lastIndexOf('/', element.startTagEnd);
			const end = markup.substring(0, slash).trimEnd().length;
			return { start: end, end: element.startTagEnd, text: `>\n${wrapped}\n${useIndent}</xsl:use-package>` };
		}
		const overrideElement = override !== undefined ? PackageEdits.elementExtent(markup, override) : undefined;
		if (overrideElement?.selfClosing) {
			return { start: override!, end: overrideElement.startTagEnd, text: wrapped.substring(overrideIndent.length) };
		}
		// before the end tag of the xsl:override, or of the xsl:use-package - on its own line, if it's on one
		const endTag = overrideElement ? overrideElement.endTagStart : element.endTagStart;
		const inserted = overrideElement ? content : wrapped;
		const lineStart = text.lastIndexOf('\n', endTag - 1) + 1;
		return text.substring(lineStart, endTag).trim() === '' ?
			{ start: lineStart, end: lineStart, text: inserted + '\n' } :
			{ start: endTag, end: endTag, text: '\n' + inserted + '\n' + (overrideElement ? overrideIndent : useIndent) };
	}

	// the offset of the start tag of the xsl:use-package (from XslLexerLight)
	private static usePackageOffset(text: string, usePackage: GlobalInstructionData) {
		return text.lastIndexOf('<', XdocNotes.offsetAt(text, usePackage.token.line, usePackage.token.startCharacter));
	}

	private static isXslt40(markup: string) {
		const root = new RegExp(RecordTypes.tagPattern).exec(markup.replace(/<[?!][^>]*>/g, (m) => ' '.repeat(m.length)));
		return !!root && /\sversion\s*=\s*["']\s*4\.0\s*["']/.test(root[0]);
	}

	// XTSE3070: the declaration, in xsl:override, that overrides the component - with its signature, in the module's
	// prefixes, and a note that refers to it with @see (excluded with use-when="false()" before XSLT 4.0). An abstract
	// component's body stops the transformation, as it isn't implemented yet - another's uses xsl:original, as Java's
	// super does. Its lines start with the indent, and are indented by step - undefined for a mode, which isn't overridden
	private static overrideSkeleton(component: PackageComponent, bindings: Map<string, string> | undefined, isXslt40: boolean, indent: string, step: string): string | undefined {
		const module = component.href ? PackageScope.module(component.href) : undefined;
		const signature = module ? PackageScope.signature(module.text, component) : undefined;
		const kind = PackageScope.componentKind(component.type);
		if (!signature || !kind || kind === 'mode' || kind === 'item-type') {
			return undefined;
		}
		const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
		const translate = (value: string) => PackageScope.translatePrefixes(value, component.prefixBindings, bindings);
		const attribute = (name: string, value: string | undefined) => value === undefined ? '' : ` ${name}="${translate(value)}"`;
		const name = ModulePrefixes.nameIn(component, bindings);
		const isAbstract = component.visibility === 'abstract';
		const inner = indent + step;
		const reference = kind === 'function' ? `${name}#${signature.params.length}` : kind === 'template' ? `template ${name}` : kind === 'variable' ? `$${name}` : undefined;
		const label = kind === 'attribute-set' ? 'attribute set' : component.type === GlobalInstructionType.Parameter ? 'parameter' : kind;
		const description = isAbstract ? `TODO: implement the abstract ${label} of package ${escape(component.packageName)}.` : `Overrides the ${label} of package ${escape(component.packageName)}.`;
		const noteLines = [description].concat(reference ? ['', `@see ${reference}`] : []);
		const note = `${inner}<xsl:note ${isXslt40 ? '' : XdocNotes.excludedAttribute + ' '}format="${XdocNotes.format}">\n` +
			noteLines.map((line) => line === '' ? '' : inner + step + line).join('\n') + `\n${inner}</xsl:note>`;
		const stop = `${inner}<xsl:message terminate="yes">${escape(reference?.replace(/^template /, '') ?? name)} is not implemented</xsl:message>`;
		const isTemplate = kind === 'template';
		const params = signature.params.map((p) => inner + PackageScope.paramTag(p, isTemplate, translate));
		const lines = (start: string, body: string[], end: string) => [indent + start, note, ...params, ...body, indent + end].join('\n');
		switch (kind) {
			case 'function':
				return lines(`<xsl:function name="${name}"${attribute('as', signature.rawAs)}>`,
					[isAbstract ? stop : `${inner}<xsl:sequence select="xsl:original(${signature.params.map((p) => '$' + p.name).join(', ')})"/>`], '</xsl:function>');
			case 'template': {
				// tunnel parameters are passed on without xsl:with-param
				const withParams = signature.params.filter((p) => !p.tunnel).map((p) => `${inner}${step}<xsl:with-param name="${p.name}" select="$${p.name}"/>`);
				const call = withParams.length === 0 ? [`${inner}<xsl:call-template name="xsl:original"/>`] :
					[`${inner}<xsl:call-template name="xsl:original">`, ...withParams, `${inner}</xsl:call-template>`];
				return lines(`<xsl:template name="${name}"${attribute('as', signature.rawAs)}>`, isAbstract ? [stop] : call, '</xsl:template>');
			}
			case 'variable':
				if (component.type === GlobalInstructionType.Parameter) {
					// xsl:original can't be used in a global parameter: its default is the package's
					return lines(`<xsl:param name="${name}"${attribute('as', signature.rawAs)}${attribute('required', signature.rawRequired)}${attribute('select', signature.rawSelect)}>`, [], '</xsl:param>');
				}
				return lines(`<xsl:variable name="${name}"${attribute('as', signature.rawAs)}>`, [isAbstract ? stop : `${inner}<xsl:sequence select="$xsl:original"/>`], '</xsl:variable>');
			default:
				return lines(`<xsl:attribute-set name="${name}"${isAbstract ? '' : ' use-attribute-sets="xsl:original"'}>`, [], '</xsl:attribute-set>');
		}
	}

	// an xsl:param of a declaration that overrides the one with the parameter - its value's prefixes translated
	private static paramTag(p: SignatureParam, isTemplate: boolean, translate: (value: string) => string) {
		const attribute = (name: string, value: string | undefined) => value === undefined ? '' : ` ${name}="${translate(value)}"`;
		return `<xsl:param name="${p.name}"${attribute('as', p.rawAs)}` +
			(isTemplate ? (p.required ? ' required="yes"' : '') + (p.tunnel ? ' tunnel="yes"' : '') + attribute('select', p.rawSelect) : attribute('required', p.rawRequired)) + '/>';
	}

	// a value written with the prefixes of one module, with those of another: each prefix is replaced with one the
	// other module binds to its namespace, or the name with an EQName
	public static translatePrefixes(value: string, from: Map<string, string> | undefined, to: Map<string, string> | undefined) {
		if (!from || !to) {
			return value;
		}
		return value.replace(/(?<![\w.{}-])([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)/g, (qname, prefix, local) => {
			const uri = from.get(prefix);
			if (uri === undefined || to.get(prefix) === uri) {
				return qname;
			}
			const other = [...to.entries()].find(([, bound]) => bound === uri);
			return other ? `${other[0]}:${local}` : `Q{${uri}}${local}`;
		});
	}

	// XTSE3070: how a declaration in xsl:override (in the text) differs from the component it overrides - undefined if
	// they match. Saxon requires the same types, so they're compared as written: with their prefixes' namespaces and
	// without whitespace, an omitted 'as' being item()*. A function's parameters are compared by position, and a
	// template's by name, with their required and tunnel attributes - a template may leave out tunnel parameters, and add
	// parameters that aren't required
	public static signatureMismatch(text: string, override: GlobalInstructionData, component: GlobalInstructionData): string | undefined {
		const componentText = component.href ? PackageScope.module(component.href)?.text : undefined;
		const mine = PackageScope.signature(text, override);
		const theirs = componentText !== undefined ? PackageScope.signature(componentText, component) : undefined;
		if (!mine || !theirs) {
			return undefined;
		}
		const shown = (as: string | undefined) => as === undefined ? 'none' : `'${as}'`;
		switch (PackageScope.componentKind(override.type)) {
			case 'variable':
				return PackageScope.typesDiffer(mine.type, theirs.type) ? `its type is ${shown(mine.as)}, not ${shown(theirs.as)}` : undefined;
			case 'function': {
				const param = theirs.params.findIndex((p, i) => mine.params[i] && PackageScope.typesDiffer(mine.params[i].type, p.type));
				if (param > -1) {
					return `the type of parameter ${param + 1}, $${mine.params[param].name}, is ${shown(mine.params[param].as)}, not ${shown(theirs.params[param].as)}`;
				}
				return PackageScope.typesDiffer(mine.type, theirs.type) ? `its return type is ${shown(mine.as)}, not ${shown(theirs.as)}` : undefined;
			}
			case 'template': {
				for (const p of theirs.params) {
					const m = mine.params.find((candidate) => candidate.expandedName === p.expandedName);
					if (!m && p.tunnel) {
						// as Saxon allows (override-t-001)
						continue;
					} else if (!m) {
						return `it has no parameter $${p.name}`;
					} else if (PackageScope.typesDiffer(m.type, p.type)) {
						return `the type of parameter $${p.name} is ${shown(m.as)}, not ${shown(p.as)}`;
					} else if (m.required !== p.required) {
						return `parameter $${p.name} is ${m.required ? 'required' : 'optional'}, not ${p.required ? 'required' : 'optional'}`;
					} else if (m.tunnel !== p.tunnel) {
						return `parameter $${p.name} is ${m.tunnel ? '' : 'not '}a tunnel parameter`;
					}
				}
				const added = mine.params.find((m) => m.required && !theirs.params.some((p) => p.expandedName === m.expandedName));
				if (added) {
					return `its parameter $${added.name} is required, and isn't a parameter of the template it overrides`;
				}
				return PackageScope.typesDiffer(mine.type, theirs.type) ? `its type is ${shown(mine.as)}, not ${shown(theirs.as)}` : undefined;
			}
			default:
				return undefined;
		}
	}

	// XTSE3070: the edits that give a declaration in xsl:override (in the text) the signature of the component it
	// overrides - in the module's prefixes - keeping the names of a function's parameters, and the parameters a template
	// adds, made optional - undefined if they can't be made
	private static signatureEdits(text: string, override: GlobalInstructionData, component: GlobalInstructionData, moduleBindings: Map<string, string> | undefined): TextEdit[] | undefined {
		const componentText = component.href ? PackageScope.module(component.href)?.text : undefined;
		const mine = PackageScope.signature(text, override);
		const theirs = componentText !== undefined ? PackageScope.signature(componentText, component) : undefined;
		if (!mine || !theirs) {
			return undefined;
		}
		const translate = (value: string | undefined) => value === undefined ? undefined : PackageScope.translatePrefixes(value, component.prefixBindings, moduleBindings);
		const edits: (TextEdit | undefined)[] = [];
		const change = (offset: number, changes: [string, string | undefined][]) => edits.push(PackageEdits.withAttributes(text, mine.markup, offset, changes));
		if (PackageScope.typesDiffer(mine.type, theirs.type)) {
			change(mine.tagStart, [['as', translate(theirs.rawAs)]]);
		}
		const kind = PackageScope.componentKind(override.type);
		if (kind === 'function') {
			theirs.params.forEach((p, i) => {
				const m = mine.params[i];
				if (m && PackageScope.typesDiffer(m.type, p.type)) {
					change(m.offset, [['as', translate(p.rawAs)]]);
				}
			});
		} else if (kind === 'template') {
			const missing: SignatureParam[] = [];
			for (const p of theirs.params) {
				const m = mine.params.find((candidate) => candidate.expandedName === p.expandedName);
				if (!m) {
					if (!p.tunnel) {
						missing.push(p);
					}
					continue;
				}
				const changes: [string, string | undefined][] = [];
				if (PackageScope.typesDiffer(m.type, p.type)) {
					changes.push(['as', translate(p.rawAs)]);
				}
				if (m.required !== p.required) {
					changes.push(['required', p.required ? 'yes' : undefined]);
				}
				if (m.tunnel !== p.tunnel) {
					changes.push(['tunnel', p.tunnel ? 'yes' : undefined]);
				}
				if (changes.length > 0) {
					change(m.offset, changes);
				}
			}
			mine.params.filter((m) => m.required && !theirs.params.some((p) => p.expandedName === m.expandedName)).forEach((m) => change(m.offset, [['required', undefined]]));
			if (missing.length > 0) {
				// after the last parameter - or the note, or the start tag
				const declaration = PackageEdits.elementExtent(mine.markup, mine.tagStart);
				if (!declaration || declaration.selfClosing) {
					return undefined;
				}
				const last = mine.params[mine.params.length - 1]?.offset ?? RecordTypes.childElements(text, mine.markup, mine.tagStart, 'xsl:note')[0];
				const position = last !== undefined ? PackageEdits.elementExtent(mine.markup, last)?.end : declaration.startTagEnd;
				if (position === undefined) {
					return undefined;
				}
				const indent = mine.params.length > 0 ? PackageEdits.lineIndent(text, mine.params[0].offset) : PackageEdits.lineIndent(text, mine.tagStart) + PackageScope.indentStep(text, mine.tagStart);
				const inserted = missing.map((p) => `\n${indent}${PackageScope.paramTag(p, true, (value) => translate(value)!)}`).join('');
				// a change of the last parameter's start tag ends where it's inserted: they're one edit
				const adjoining = edits.find((edit) => edit?.end === position);
				if (adjoining) {
					adjoining.text += inserted;
				} else {
					edits.push({ start: position, end: position, text: inserted });
				}
			}
		}
		return edits.every((edit) => edit !== undefined) ? (edits as TextEdit[]).sort((a, b) => a.start - b.start) : undefined;
	}

	// a declaration's 'as' and its xsl:param children - with the types compared (see signatureMismatch)
	private static signature(text: string, declaration: GlobalInstructionData) {
		const tagStart = text.lastIndexOf('<', XdocNotes.offsetAt(text, declaration.token.line, declaration.token.startCharacter));
		if (tagStart < 0) {
			return undefined;
		}
		const bindings = declaration.prefixBindings;
		const isTrue = (value: string | undefined) => value !== undefined && ['yes', 'true', '1'].includes(value.trim());
		const as = RecordTypes.attributeOfElementAt(text, tagStart + 1, 'as');
		const markup = RecordTypes.blankMarkup(text);
		const params = RecordTypes.childElements(text, markup, tagStart, 'xsl:param').map((offset) => {
			const name = (RecordTypes.attributeOfElementAt(text, offset + 1, 'name') ?? '').trim();
			const paramAs = RecordTypes.attributeOfElementAt(text, offset + 1, 'as');
			const required = RecordTypes.attributeOfElementAt(text, offset + 1, 'required');
			return {
				offset, name, expandedName: ModulePrefixes.expandedName(name, bindings), as: paramAs, type: PackageScope.normalType(paramAs, bindings),
				required: isTrue(required), tunnel: isTrue(RecordTypes.attributeOfElementAt(text, offset + 1, 'tunnel')),
				// as written, for a declaration that overrides it (see overrideSkeleton)
				rawAs: RecordTypes.attributeOfElementAt(text, offset + 1, 'as', true), rawRequired: required?.trim(), rawSelect: RecordTypes.attributeOfElementAt(text, offset + 1, 'select', true)
			};
		});
		const raw = (name: string) => RecordTypes.attributeOfElementAt(text, tagStart + 1, name, true);
		return { tagStart, markup, as, type: PackageScope.normalType(as, bindings), params, rawAs: raw('as'), rawSelect: raw('select'), rawRequired: raw('required') };
	}

	// a type as it's compared: without whitespace, and with EQNames for prefixed names - item()* if there's none, and
	// undefined, so it isn't compared, for a prefix the module's outermost element doesn't declare, e.g. one declared on
	// the declaration
	private static normalType(as: string | undefined, bindings: Map<string, string> | undefined) {
		if (as === undefined) {
			return 'item()*';
		}
		let unbound = false;
		const type = RecordTypes.decodeReferences(as).text.replace(/\s+/g, '').replace(/(?<![\w.{}-])([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)/g, (qname, prefix, local) => {
			const uri = bindings?.get(prefix);
			unbound = unbound || uri === undefined;
			return uri !== undefined ? `Q{${uri}}${local}` : qname;
		});
		return unbound ? undefined : type;
	}

	private static typesDiffer(a: string | undefined, b: string | undefined) {
		return a !== undefined && b !== undefined && a !== b;
	}

	// XTSE3085: in an xsl:package - unless it has declared-modes="no" - each mode used must be declared with xsl:mode,
	// in the package's modules, or be a public mode of a package it uses. A mode is used by the mode attribute of a
	// template rule or xsl:apply-templates, or the default-mode attribute of the xsl:package - and the unnamed mode by
	// those without a mode attribute, where it's the default mode. Each mode is reported once, where it's first used. The
	// declarations imported (importedGlobals) have the names of the text's module, with its bindings
	public static modeProblems(text: string, bindings: Map<string, string> | undefined, importedGlobals: GlobalInstructionData[]): { offset: number, length: number, message: string, fixes: PackageFix[] }[] {
		const scan = PackageScope.scanModes(text);
		if (!scan.isPackage || scan.declaredModesNo) {
			return [];
		}
		const expanded = (name: string) => ModulePrefixes.expandedName(name, bindings);
		const declared = new Set(scan.declared.map(expanded));
		importedGlobals.filter((g) => g.type === GlobalInstructionType.ModeInstruction).forEach((g) => declared.add(ModulePrefixes.expandedName(g.name, g.prefixBindings ?? bindings)));
		// the unnamed mode may be declared in a module the package imports or includes
		let unnamedDeclared = scan.unnamedDeclared;
		const modules = new Set(importedGlobals.filter((g) => g.href && !(g as Partial<PackageComponent>).packageName).map((g) => g.href!));
		for (const modulePath of modules) {
			if (unnamedDeclared) {
				break;
			}
			const module = PackageScope.module(modulePath);
			unnamedDeclared = !!module && PackageScope.scanModes(module.text).unnamedDeclared;
		}
		const problems: { offset: number, length: number, message: string, fixes: PackageFix[] }[] = [];
		const reported = new Set<string>();
		const markup = RecordTypes.blankMarkup(text);
		const root = XdocNotes.rootOffset(markup);
		const declaredModesNo = root !== undefined ? PackageEdits.withAttributes(text, markup, root, [['declared-modes', 'no']]) : undefined;
		const modeFixes = (declaration: string): PackageFix[] => {
			const insertion = root !== undefined ? PackageScope.modeInsertion(text, markup, root, declaration) : undefined;
			return (insertion ? [{ title: `Add ${declaration}`, edits: [insertion] }] : [])
				.concat(declaredModesNo ? [{ title: 'Set declared-modes="no" on the xsl:package', edits: [declaredModesNo] }] : []);
		};
		for (const use of scan.uses) {
			const isUnnamed = use.name === '#unnamed';
			const key = isUnnamed ? use.name : expanded(use.name);
			if (reported.has(key) || (isUnnamed ? unnamedDeclared : declared.has(key))) {
				continue;
			}
			reported.add(key);
			problems.push({ offset: use.offset, length: use.length, fixes: modeFixes(isUnnamed ? '<xsl:mode/>' : `<xsl:mode name="${use.name}"/>`), message: isUnnamed ?
				'XTSE3085: The unnamed mode isn\'t declared - in a package, add <xsl:mode/> to use it, or set declared-modes="no" on the xsl:package' :
				`XTSE3085: The mode '${use.name}' isn't declared - in a package, each mode used needs an xsl:mode declaration, unless the xsl:package has declared-modes="no"` });
		}
		return problems;
	}

	// an edit that adds a top-level xsl:mode: after the last one, or before the first template, or at the end
	private static modeInsertion(text: string, markup: string, root: number, declaration: string): TextEdit | undefined {
		const modes = RecordTypes.childElements(text, markup, root, 'xsl:mode');
		if (modes.length > 0) {
			const end = PackageEdits.elementExtent(markup, modes[modes.length - 1])?.end;
			return end === undefined ? undefined : { start: end, end, text: `\n${PackageEdits.lineIndent(text, modes[modes.length - 1])}${declaration}` };
		}
		const template = RecordTypes.childElements(text, markup, root, 'xsl:template')[0];
		if (template !== undefined) {
			const indent = PackageEdits.lineIndent(text, template);
			return { start: template - indent.length, end: template - indent.length, text: `${indent}${declaration}\n` };
		}
		const rootElement = PackageEdits.elementExtent(markup, root);
		if (!rootElement || rootElement.selfClosing) {
			return undefined;
		}
		const lineStart = text.lastIndexOf('\n', rootElement.endTagStart - 1) + 1;
		const ownLine = text.substring(lineStart, rootElement.endTagStart).trim() === '';
		const step = PackageScope.indentStep(text, rootElement.startTagEnd);
		return ownLine ? { start: lineStart, end: lineStart, text: `${step}${declaration}\n` } : { start: rootElement.endTagStart, end: rootElement.endTagStart, text: `\n${step}${declaration}\n` };
	}

	// the modes a module declares with top-level xsl:mode elements, and the modes it uses - with their offsets in the text
	private static scanModes(text: string) {
		const markup = RecordTypes.blankMarkup(text);
		const prefix = RecordTypes.xsltPrefix(markup);
		const attribute = (offset: number, name: string) => RecordTypes.attributeOfElementAt(text, offset + 1, name);
		const result = { isPackage: false, declaredModesNo: false, declared: [] as string[], unnamedDeclared: false, uses: [] as { name: string, offset: number, length: number }[] };
		// for each open element, the default mode within it
		const stack: { name: string, defaultMode: string }[] = [];
		const tagRgx = new RegExp(RecordTypes.tagPattern, 'g');
		let match: RegExpExecArray | null;
		// a mode attribute's names, with their offsets - or the element's name, for the default mode, if it has none
		const useModes = (offset: number, nameLength: number, defaultMode: string, ignored: string[]) => {
			const value = attribute(offset, 'mode');
			if (value === undefined) {
				result.uses.push({ name: defaultMode, offset: offset + 1, length: nameLength });
				return;
			}
			const valueOffset = RecordTypes.attributeValueOffset(text, offset + 1, 'mode') ?? offset + 1;
			for (const token of value.matchAll(/\S+/g)) {
				const name = token[0] === '#default' ? defaultMode : token[0];
				if (!ignored.includes(token[0]) && !name.includes('{')) {
					result.uses.push({ name, offset: valueOffset + token.index!, length: token[0].length });
				}
			}
		};
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
			const isXslt = name.startsWith('xsl:');
			const inherited = stack.length > 0 ? stack[stack.length - 1].defaultMode : '#unnamed';
			const ownDefault = attribute(offset, isXslt ? 'default-mode' : `${prefix}:default-mode`)?.trim();
			const defaultMode = ownDefault || inherited;
			if (stack.length === 0) {
				result.isPackage = name === 'xsl:package';
				result.declaredModesNo = ['no', 'false', '0'].includes(attribute(offset, 'declared-modes')?.trim() ?? '');
				if (ownDefault && ownDefault !== '#unnamed') {
					const valueOffset = RecordTypes.attributeValueOffset(text, offset + 1, 'default-mode') ?? offset + 1;
					result.uses.push({ name: ownDefault, offset: valueOffset, length: ownDefault.length });
				}
			} else if (stack.length === 1 && name === 'xsl:mode') {
				const modeName = attribute(offset, 'name')?.trim();
				if (modeName === undefined || modeName === '#unnamed') {
					result.unnamedDeclared = true;
				} else {
					result.declared.push(modeName);
				}
			} else if (name === 'xsl:template' && attribute(offset, 'match') !== undefined) {
				useModes(offset, match[2].length, defaultMode, ['#all']);
			} else if (name === 'xsl:apply-templates') {
				useModes(offset, match[2].length, defaultMode, ['#current']);
			}
			if (!match[3]) {
				stack.push({ name, defaultMode });
			}
		}
		return result;
	}

	// the components of a used package: all those it declares or accepts, and those available to the using module - for
	// a stylesheet, not abstract ones, which can't be used unless overridden; for a package, which may pass them on, with
	// them
	private static usedPackage(usePackage: GlobalInstructionData, xsltPackages: XsltPackage[], workspace: string | undefined, depth: number, visiting: Set<string>, forStylesheet: boolean) {
		const pkg = XsltPackages.find(xsltPackages, usePackage.name, usePackage.version);
		const pkgPath = pkg ? HrefPaths.settingsPath(pkg.path, workspace ?? path.dirname(pkg.path)) : undefined;
		if (!pkg || !pkgPath || visiting.has(pkgPath) || depth > PackageScope.maxDepth) {
			return undefined;
		}
		visiting.add(pkgPath);
		const all = PackageScope.packageComponents(pkg, pkgPath, xsltPackages, workspace, depth, visiting);
		visiting.delete(pkgPath);
		const available: PackageComponent[] = [];
		// abstract components that aren't overridden - nor passed on, by an xsl:accept with visibility="abstract"
		const abstracts: PackageComponent[] = [];
		for (const component of all) {
			if (component.packageVisibility === 'private' || component.packageVisibility === 'hidden') {
				continue;
			}
			const accept = PackageScope.bestMatch(usePackage.accepts ?? [], component);
			const visibility = accept?.visibility ?? component.packageVisibility;
			const overridden = (usePackage.overrides ?? []).some((o) => PackageScope.overrides(o, component));
			if (visibility === 'abstract' && !overridden && accept?.visibility !== 'abstract') {
				abstracts.push({ ...component, visibility });
			}
			if (visibility === 'hidden' || overridden || (visibility === 'abstract' && forStylesheet)) {
				continue;
			}
			available.push({ ...component, visibility });
		}
		// the template rules of the package's modes that are available
		const modes = available.filter((c) => c.type === GlobalInstructionType.ModeInstruction);
		if (modes.length > 0) {
			for (const module of PackageScope.packageModules(pkgPath)) {
				module.data.filter((g) => g.type === GlobalInstructionType.ModeTemplate && !g.isDefaultMode).forEach((rule) => {
					const ruleBindings = rule.prefixBindings ?? module.bindings;
					if (modes.some((mode) => PackageScope.sameName(mode, rule.name, ruleBindings))) {
						available.push({ ...rule, href: module.path, prefixBindings: ruleBindings, packageName: pkg.name, packageVersion: pkg.version, packageVisibility: 'public', visibility: 'public' });
					}
				});
			}
		}
		return { all, available, abstracts };
	}

	// the components of a package - those it declares, and those it accepts from the packages it uses - each with its
	// visibility in the package
	private static packageComponents(pkg: XsltPackage, pkgPath: string, xsltPackages: XsltPackage[], workspace: string | undefined, depth: number, visiting: Set<string>): PackageComponent[] {
		const modules = PackageScope.packageModules(pkgPath);
		if (modules.length === 0) {
			return [];
		}
		const exposes = modules[0].exposes.map((expose) => ({ ...expose, prefixBindings: modules[0].bindings }));
		const components: PackageComponent[] = [];
		const withVisibility = (component: GlobalInstructionData, declared: string | undefined, fallback: string) => {
			const expose = declared === undefined ? PackageScope.bestMatch(exposes, component) : undefined;
			const packageVisibility = declared ?? expose?.visibility ?? fallback;
			components.push({ ...component, packageName: pkg.name, packageVersion: pkg.version, packageVisibility, visibility: packageVisibility });
		};
		for (const module of modules) {
			for (const global of module.data) {
				if (!PackageScope.componentKind(global.type)) {
					continue;
				}
				const component = { ...global, href: module.path, prefixBindings: global.prefixBindings ?? module.bindings };
				withVisibility(component, global.visibility, global.type === GlobalInstructionType.Parameter ? 'public' : 'private');
			}
		}
		// accepted from the packages the package uses: private, unless its xsl:accept or xsl:expose says otherwise
		for (const module of modules) {
			for (const usePackage of module.data.filter((g) => g.type === GlobalInstructionType.UsePackage)) {
				const used = PackageScope.usedPackage(usePackage, xsltPackages, workspace, depth + 1, visiting, false);
				used?.available.filter((c) => PackageScope.componentKind(c.type)).forEach((c) => {
					const accept = PackageScope.bestMatch(usePackage.accepts ?? [], c);
					withVisibility(c, accept?.visibility, 'private');
				});
			}
		}
		return components;
	}

	// the modules of the package: its xsl:package module, then those it imports or includes, directly or indirectly
	private static packageModules(pkgPath: string): PackageModule[] {
		const result: PackageModule[] = [];
		const visit = (file: string) => {
			if (result.some((m) => m.path === file)) {
				return;
			}
			const module = PackageScope.module(file);
			if (!module) {
				return;
			}
			result.push(module);
			module.data.filter((g) => g.type === GlobalInstructionType.Import || g.type === GlobalInstructionType.Include).forEach((g) => {
				const referenced = HrefPaths.toPath(g.name, file);
				if (referenced) {
					visit(referenced);
				}
			});
		};
		visit(pkgPath);
		return result;
	}

	// a module's declarations, from XslLexerLight - read again only when the file has changed
	private static module(file: string): PackageModule | undefined {
		let mtime: number;
		try {
			mtime = fs.statSync(file).mtimeMs;
		} catch {
			return undefined;
		}
		const cached = PackageScope.modules.get(file);
		if (cached && cached.mtime === mtime) {
			return cached;
		}
		try {
			const lexer = new XslLexerLight(XSLTLightConfiguration.configuration);
			const text = fs.readFileSync(file, 'utf8');
			const data = lexer.analyseLight(text);
			const module: PackageModule = { path: file, mtime, text, data, exposes: lexer.exposes, bindings: lexer.prefixBindings };
			PackageScope.modules.set(file, module);
			return module;
		} catch {
			return undefined;
		}
	}

	// of the xsl:expose or xsl:accept elements, the one whose names best match the component - for equal matches, the
	// last
	private static bestMatch(elements: GlobalInstructionData[], component: GlobalInstructionData): GlobalInstructionData | undefined {
		const kind = PackageScope.componentKind(component.type);
		let best: GlobalInstructionData | undefined;
		let bestPriority = 0;
		for (const element of elements) {
			if (!kind || !PackageScope.kinds(element.component).includes(kind)) {
				continue;
			}
			for (const name of element.name.trim().split(/\s+/).filter((n) => n !== '')) {
				const priority = PackageScope.namePriority(name, element.prefixBindings, component);
				if (priority > 0 && priority >= bestPriority) {
					best = element;
					bestPriority = priority;
				}
			}
		}
		return best;
	}

	private static kinds(component: string | undefined): string[] {
		return component === '*' ? ['function', 'template', 'variable', 'attribute-set', 'mode', 'item-type'] : component ? [component] : [];
	}

	// a names token: '*', 'p:*', '*:local', Q{uri}*, or a name - with #arity for a function
	private static namePriority(name: string, bindings: Map<string, string> | undefined, component: GlobalInstructionData): NamePriority {
		if (name === '*') {
			return 1;
		}
		const componentName = ModulePrefixes.expandedName(component.name, component.prefixBindings);
		const parsed = PackageScope.parseEQName(componentName);
		if (name.startsWith('*:')) {
			return parsed.local === name.substring(2) ? 2 : 0;
		}
		if (name.endsWith(':*') || /^Q\{[^}]*\}\*$/.test(name)) {
			const uri = name.startsWith('Q{') ? name.substring(2, name.length - 2) : bindings?.get(name.substring(0, name.length - 2));
			return uri !== undefined && parsed.uri === uri ? 2 : 0;
		}
		const hash = name.lastIndexOf('#');
		const arity = hash > 0 ? parseInt(name.substring(hash + 1), 10) : undefined;
		const qname = hash > 0 ? name.substring(0, hash) : name;
		if (ModulePrefixes.expandedName(qname, bindings) !== componentName) {
			return 0;
		}
		if (arity !== undefined && component.type === GlobalInstructionType.Function && !XslLexer.functionArityMatches(component, arity)) {
			return 0;
		}
		return 3;
	}

	private static parseEQName(name: string) {
		const match = /^Q\{([^}]*)\}(.*)$/.exec(name);
		return match ? { uri: match[1], local: match[2] } : { uri: '', local: name };
	}

	private static isWildcard(name: string) {
		return name === '*' || name.startsWith('*:') || name.endsWith(':*') || name.endsWith('}*');
	}

	// whether a declaration in xsl:override overrides the component
	private static overrides(override: GlobalInstructionData, component: GlobalInstructionData) {
		const kind = PackageScope.componentKind(override.type);
		return kind !== undefined && PackageScope.componentKind(component.type) === kind && PackageScope.sameName(component, override.name, override.prefixBindings)
			&& (kind !== 'function' || PackageScope.aritiesOverlap(component, override));
	}

	private static sameName(component: GlobalInstructionData, name: string, bindings: Map<string, string> | undefined) {
		return ModulePrefixes.expandedName(component.name, component.prefixBindings) === ModulePrefixes.expandedName(name, bindings);
	}

	private static aritiesOverlap(a: GlobalInstructionData, b: GlobalInstructionData) {
		const range = (g: GlobalInstructionData) => [g.idNumber - (g.memberOptional?.filter((o) => o).length ?? 0), g.idNumber];
		const [aMin, aMax] = range(a);
		const [bMin, bMax] = range(b);
		return a.idNumber < 0 || b.idNumber < 0 || (aMin <= bMax && bMin <= aMax);
	}

	// an xsl:accept may only narrow visibility: final to private or hidden, public to any
	private static widens(packageVisibility: string, acceptVisibility: string | undefined) {
		const allowed: { [v: string]: string[] } = {
			public: ['public', 'private', 'final', 'hidden'],
			final: ['private', 'final', 'hidden'],
			abstract: ['abstract', 'hidden']
		};
		return acceptVisibility !== undefined && allowed[packageVisibility] !== undefined && !allowed[packageVisibility].includes(acceptVisibility);
	}

	// the xsl:use-package elements of a stylesheet's modules: of the document, from its text, and of the modules it
	// imports or includes, from their declarations (with their href)
	public static usePackagesOf(documentText: string, documentData: GlobalInstructionData[], importedGlobals: GlobalInstructionData[]) {
		let documentUsePackages: GlobalInstructionData[] = [];
		let documentBindings: Map<string, string> | undefined;
		if (documentData.some((g) => g.type === GlobalInstructionType.UsePackage)) {
			// the lexer for the document doesn't record xsl:accept and xsl:override
			const lexer = new XslLexerLight(XSLTLightConfiguration.configuration);
			documentUsePackages = lexer.analyseLight(documentText).filter((g) => g.type === GlobalInstructionType.UsePackage);
			documentBindings = lexer.prefixBindings;
		}
		const imported = importedGlobals.filter((g) => g.type === GlobalInstructionType.UsePackage);
		// the document's declarations in xsl:override, which the lexer for the document doesn't record
		const documentOverrides = documentUsePackages.flatMap((u) => u.overrides ?? []);
		return { documentUsePackages, documentBindings, documentOverrides, all: documentUsePackages.concat(imported) };
	}

	// the workspace folder, for package paths in the setting that are relative
	public static workspaceFolder(): string | undefined {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	}
}
