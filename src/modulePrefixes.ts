/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import { GlobalInstructionData, GlobalInstructionType } from './xslLexer';
import { RecordTypes } from './recordTypes';
import { FixedNamespaces } from './fixedNamespaces';

// The name of a declaration, e.g. of a function, is a QName: as Saxon does, a declaration in one module is matched with
// a reference in another by its namespace and local name, not its prefix - e.g. f:double declared with
// xmlns:f="urn:fns" is called as my:double in a module with xmlns:my="urn:fns". The prefixes are those bound on the
// module's outermost element - or with XSLT 4.0, by its fixed-namespaces attribute - not those declared on an inner
// element. The lexers give each declaration the bindings of its module (see resolve), and the declarations imported
// into a module are named with the module's own prefixes (see toModule)
export class ModulePrefixes {

	// the namespace bindings for the names of a module's declarations, from the attributes of its outermost element as
	// the lexer found them: its namespace declarations, e.g. xmlns:f, and fixed-namespaces - with the values as written
	public static fromRootAttributes(attributes: Map<string, string>): Map<string, string> {
		const declarations = new Map<string, string>();
		attributes.forEach((value, name) => {
			if (name.startsWith('xmlns:')) {
				declarations.set(name.substring(6), RecordTypes.decodeReferences(value).text);
			}
		});
		const fixed = attributes.get('fixed-namespaces');
		// a URI in fixed-namespaces, for the declarations of another document, isn't read: its prefixes aren't resolved
		const bindings = fixed !== undefined ? FixedNamespaces.bindings(RecordTypes.decodeReferences(fixed).text, declarations, undefined, () => undefined).bindings : declarations;
		bindings.set('xml', FixedNamespaces.xmlNamespace);
		return bindings;
	}

	// an attribute of a module's outermost element that its bindings depend on
	public static isBindingAttribute(name: string) {
		return name.startsWith('xmlns:') || name === 'fixed-namespaces';
	}

	// gives each declaration with a QName for its name the bindings of its module
	public static resolve(globals: GlobalInstructionData[], bindings: Map<string, string> | undefined) {
		if (bindings) {
			globals.filter((global) => ModulePrefixes.hasQName(global)).forEach((global) => global.prefixBindings = bindings);
		}
	}

	// the name of the declaration as it's written in a module with the bindings: each prefix of the name is replaced by
	// one bound to its namespace in the module - its own, if that is - or, when none is, the name is an EQName, e.g.
	// Q{urn:fns}double. A mode's name may be a list of names
	public static nameIn(global: GlobalInstructionData, bindings: Map<string, string> | undefined): string {
		const declared = global.prefixBindings;
		if (!declared || !bindings || !global.name.includes(':') || declared === bindings) {
			return global.name;
		}
		return global.name.replace(/(^|\s)([^\s:{}]+):([^\s:]+)/g, (qname: string, space: string, prefix: string, local: string) => {
			const uri = declared.get(prefix);
			if (uri === undefined || bindings.get(prefix) === uri) {
				return qname;
			}
			const other = [...bindings.entries()].find(([, bound]) => bound === uri);
			return space + (other ? `${other[0]}:${local}` : `Q{${uri}}${local}`);
		});
	}

	// a name as written in a module with the bindings, as an EQName - e.g. Q{urn:fns}double for f:double - to compare it
	// with a name in another module: a name in no namespace, e.g. double or Q{}double, is its local name, and one whose
	// prefix isn't bound is as written
	public static expandedName(name: string, bindings: Map<string, string> | undefined): string {
		const qname = /^([^:{}]+):(.+)$/.exec(name);
		const uri = qname ? bindings?.get(qname[1]) : undefined;
		return uri !== undefined ? `Q{${uri}}${qname![2]}` : name.startsWith('Q{}') ? name.substring(3) : name;
	}

	// names the imported declarations with the prefixes of the module with the bindings, which they're imported into
	public static toModule(globals: GlobalInstructionData[], bindings: Map<string, string> | undefined) {
		globals.filter((global) => bindings && global.prefixBindings).forEach((global) => {
			global.name = ModulePrefixes.nameIn(global, bindings);
			// its prefixes are now the module's
			global.prefixBindings = bindings;
		});
	}

	// the declarations named as they're written in a module with the bindings - copies, where a name is different
	public static inModule(globals: GlobalInstructionData[], bindings: Map<string, string> | undefined): GlobalInstructionData[] {
		return globals.map((global) => {
			const name = ModulePrefixes.nameIn(global, bindings);
			return name === global.name ? global : { ...global, name, prefixBindings: bindings };
		});
	}

	private static hasQName(global: GlobalInstructionData) {
		switch (global.type) {
			case GlobalInstructionType.Variable:
			case GlobalInstructionType.Parameter:
			case GlobalInstructionType.Function:
			case GlobalInstructionType.Mode:
			case GlobalInstructionType.ModeInstruction:
			case GlobalInstructionType.ModeTemplate:
			case GlobalInstructionType.Accumulator:
			case GlobalInstructionType.AccumulatorUse:
			case GlobalInstructionType.AttributeSet:
			case GlobalInstructionType.Key:
			case GlobalInstructionType.Template:
			case GlobalInstructionType.ItemType:
			case GlobalInstructionType.CharacterMap:
				return true;
			default:
				return false;
		}
	}
}
