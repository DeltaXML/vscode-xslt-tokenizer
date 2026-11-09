/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import { XmlElement, parseXml, localName } from './xspecXml';

// XSpec: a function called with a number of parameters it isn't declared with - XSpec's test runner then fails to
// compile (XPST0017), so none of the file's tests run. The call is the one XSpec compiles for a scenario with an
// expectation that isn't pending: its x:call merged with those of the enclosing scenarios
// (compile-child-scenarios-or-expects.xsl) - attributes, the inner replacing the outer, and parameters by position,
// the inner replacing those at the same position: a parameter's position is its position attribute, or else its
// position among the x:param elements of its x:call
export class XSpecCallArity {
	// the problems: on the name of the innermost x:call making the call - arities gives the arities each function is
	// declared with, by its name as written in the XSpec file, or undefined if it isn't known (it's not checked then)
	public static problems(text: string, arities: (name: string) => number[] | undefined): { offset: number, length: number, message: string }[] {
		const root = parseXml(text);
		if (!root || localName(root.name) !== 'description') {
			return [];
		}
		const prefix = root.name.includes(':') ? root.name.substring(0, root.name.indexOf(':') + 1) : '';
		const is = (element: XmlElement, name: string) => element.name === prefix + name;
		const yes = (value: string | undefined) => ['yes', 'true', '1'].includes(value?.trim() ?? '');
		const results = new Map<number, { offset: number, length: number, message: string }>();
		type Call = { attributes: Map<string, string>, positions: Set<number>, element?: XmlElement, labels: string[] };
		const visit = (scenario: XmlElement, inherited: Call | undefined) => {
			const own = scenario.children.find((child) => is(child, 'call'));
			let call = inherited;
			if (own) {
				const params = own.children.filter((child) => is(child, 'param'));
				const positions = new Set(inherited?.positions ?? []);
				params.forEach((param, index) => positions.add(Number(param.attributes.get('position')?.trim() || index + 1)));
				call = { attributes: new Map([...(inherited?.attributes ?? []), ...own.attributes]), positions, element: own,
					labels: [...(inherited?.labels ?? []), scenario.attributes.get('label') ?? ''] };
			}
			const expects = scenario.children.some((child) => is(child, 'expect') && !child.attributes.has('pending'));
			const fn = call?.attributes.get('function')?.trim();
			if (call?.element && fn && expects && call.attributes.get('call-as')?.trim() !== 'variable') {
				const declared = arities(fn);
				const count = call.positions.size;
				if (declared && declared.length > 0 && !declared.includes(count)) {
					const parameters = (n: number) => `${n} parameter${n === 1 ? '' : 's'}`;
					const inheritedFrom = call.element !== own ? ` - the x:call of the scenario '${call.labels[call.labels.length - 1]}'` : '';
					results.set(call.element.start, {
						offset: call.element.start + 1, length: call.element.name.length,
						message: `XSpec: ${fn} is called with ${parameters(count)}${inheritedFrom}, but the stylesheet declares it with ${declared.sort((a, b) => a - b).map(parameters).join(' or ')} - XSpec fails to compile the tests (XPST0017)`
					});
				}
			}
			scenario.children.filter((child) => is(child, 'scenario') && !child.attributes.has('pending') && !yes(child.attributes.get('shared'))).forEach((child) => visit(child, call));
		};
		root.children.filter((child) => is(child, 'scenario') && !child.attributes.has('pending') && !yes(child.attributes.get('shared'))).forEach((scenario) => visit(scenario, undefined));
		return [...results.values()];
	}
}
