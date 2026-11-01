/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import { fileURLToPath } from 'url';
import { XmlElement, parseXml, localName, descendants } from './xspecXml';

// XSpec's tests, as the Test Explorer shows them (see XSpecTestController): its scenarios and expectations, and their
// outcomes in XSpec's result XML - matched by their labels, as XSpec's IDs are only known once it has gathered the
// imported files and replaced each x:like with the shared scenario's content

export type XSpecTestKind = 'scenario' | 'expect';

export interface XSpecTestNode {
	kind: XSpecTestKind;
	label: string;
	// the labels of its scenarios, and its own
	labelPath: string[];
	// the offsets of the element in the file
	start: number;
	end: number;
	pending: boolean;
	children: XSpecTestNode[];
	// a scenario's x:call or x:context - the offset of its element
	callStart?: number;
}

// a template of a compiled test runner, for a scenario or an expectation: its offsets in the runner - and where the
// stylesheet under test is called, for a scenario, or the expectation is tested
export interface XSpecRunnerTemplate {
	kind: XSpecTestKind;
	id: string;
	file: string | undefined;
	labelPath: string[];
	start: number;
	end: number;
	// the xsl:variable of the scenario's result ($x:result), or of the expectation's outcome
	step?: { start: number, end: number };
}

export type XSpecStatus = 'passed' | 'failed' | 'pending';

export interface XSpecResult {
	kind: XSpecTestKind;
	id: string;
	// the XSpec file it's in, e.g. one imported
	file: string | undefined;
	labelPath: string[];
	status: XSpecStatus;
	pendingReason?: string;
	// for an expectation that failed: the expected and actual results, as XML or an XPath expression
	expected?: string;
	actual?: string;
}

export class XSpecTests {
	public static readonly namespace = 'http://www.jenitennison.com/xslt/xspec';
	// the expectations of a Schematron's XSpec, besides x:expect
	private static readonly expectNames = ['expect', 'expect-assert', 'expect-not-assert', 'expect-report', 'expect-not-report', 'expect-rule', 'expect-valid'];

	public static normalizeSpace(text: string) {
		return text.replace(/\s+/g, ' ').trim();
	}

	// a key for a test with the labels, in a file - for an XSpec result or a test of the tree
	public static key(file: string | undefined, labelPath: string[]) {
		return [file ?? '', ...labelPath].join('\u001f');
	}

	private static isYes(value: string | undefined) {
		return value !== undefined && ['yes', 'true', '1'].includes(value.trim());
	}

	// an element's label: its label attribute, or its x:label child
	private static label(element: XmlElement, prefix: string) {
		const labelElement = element.children.find((child) => child.name === (prefix ? prefix + ':label' : 'label'));
		return XSpecTests.normalizeSpace(element.attributes.get('label') ?? labelElement?.text ?? '');
	}

	// a Schematron expectation's label, as XSpec makes it (src/schematron/schut-to-xspec.xsl, create-expect): its label,
	// the kind, e.g. 'not assert', and its id, role, location, context, count and text
	private static schematronLabel(element: XmlElement) {
		const name = localName(element.name);
		if (name === 'expect-valid') {
			return 'valid';
		}
		const text = XSpecTests.normalizeSpace([element, ...descendants(element)].map((e) => e.text).join(''));
		const attribute = (attributeName: string) => element.attributes.get(attributeName);
		const parts = [attribute('label'), ...name.split('-').filter((part) => ['report', 'assert', 'not', 'rule'].includes(part)),
			attribute('id'), attribute('role'), attribute('location'), attribute('context'),
			...(attribute('count') !== undefined ? ['count:', attribute('count')] : []), ...(text ? ['text:', text] : [])];
		return XSpecTests.normalizeSpace(parts.filter((part) => part !== undefined).join(' '));
	}

	// the scenarios and expectations of an XSpec file - not shared scenarios, which run where x:like uses them
	public static testTree(text: string): XSpecTestNode[] {
		const root = parseXml(text);
		if (!root || localName(root.name) !== 'description') {
			return [];
		}
		const prefix = root.name.includes(':') ? root.name.substring(0, root.name.indexOf(':')) : '';
		const isXSpec = (element: XmlElement, names: string[]) => (prefix ? element.name.startsWith(prefix + ':') : !element.name.includes(':')) && names.includes(localName(element.name));
		const nodes = (parent: XmlElement, labelPath: string[], pending: boolean): XSpecTestNode[] => parent.children.flatMap((element) => {
			if (isXSpec(element, ['pending'])) {
				return nodes(element, labelPath, true);
			}
			const isScenario = isXSpec(element, ['scenario']);
			if ((isScenario && !XSpecTests.isYes(element.attributes.get('shared'))) || isXSpec(element, XSpecTests.expectNames)) {
				const label = isScenario || localName(element.name) === 'expect' ? XSpecTests.label(element, prefix) || localName(element.name) : XSpecTests.schematronLabel(element);
				const elementPending = pending || element.attributes.has('pending');
				const node: XSpecTestNode = { kind: isScenario ? 'scenario' : 'expect', label, labelPath: [...labelPath, label], start: element.start, end: element.end, pending: elementPending, children: [] };
				node.children = isScenario ? nodes(element, node.labelPath, elementPending) : [];
				node.callStart = isScenario ? element.children.find((child) => isXSpec(child, ['call', 'context']))?.start : undefined;
				return [node];
			}
			return [];
		});
		return nodes(root, [], false);
	}

	// the outcomes in XSpec's result XML: for each scenario and test
	public static parseResults(text: string): XSpecResult[] {
		const report = parseXml(text);
		if (!report) {
			return [];
		}
		const results: XSpecResult[] = [];
		const raw = (element: XmlElement | undefined) => element ? XSpecTests.rawContent(text, element) : undefined;
		// a scenario's status: failed if any test in it failed, pending if all are
		const visit = (scenario: XmlElement, labelPath: string[]): XSpecStatus => {
			const file = XSpecTests.filePath(scenario.attributes.get('xspec'));
			const label = XSpecTests.normalizeSpace(scenario.children.find((child) => localName(child.name) === 'label')?.text ?? '');
			const path = [...labelPath, label];
			const tests = scenario.children.filter((child) => localName(child.name) === 'test');
			const actual = raw(scenario.children.find((child) => localName(child.name) === 'result'));
			const statuses: XSpecStatus[] = [];
			tests.forEach((test) => {
				const testLabel = XSpecTests.normalizeSpace(test.children.find((child) => localName(child.name) === 'label')?.text ?? '');
				const pendingReason = test.attributes.get('pending');
				const status: XSpecStatus = pendingReason !== undefined ? 'pending' : test.attributes.get('successful') === 'true' ? 'passed' : 'failed';
				statuses.push(status);
				results.push({
					kind: 'expect', id: test.attributes.get('id') ?? '', file, labelPath: [...path, testLabel], status, pendingReason,
					expected: status === 'failed' ? raw(test.children.find((child) => localName(child.name) === 'expect')) : undefined,
					actual: status === 'failed' ? actual : undefined
				});
			});
			scenario.children.filter((child) => localName(child.name) === 'scenario').forEach((child) => statuses.push(visit(child, path)));
			const pendingReason = scenario.attributes.get('pending');
			const status: XSpecStatus = statuses.includes('failed') ? 'failed' :
				(statuses.length === 0 ? pendingReason !== undefined : statuses.every((s) => s === 'pending')) ? 'pending' : 'passed';
			results.push({ kind: 'scenario', id: scenario.attributes.get('id') ?? '', file, labelPath: path, status, pendingReason });
			return status;
		};
		report.children.filter((child) => localName(child.name) === 'scenario').forEach((scenario) => visit(scenario, []));
		return results;
	}

	// the templates of the scenarios and expectations in a compiled test runner (see XSpecRunner), with their files and
	// labels
	public static runnerTemplates(compiledText: string): XSpecRunnerTemplate[] {
		const stylesheet = parseXml(compiledText);
		if (!stylesheet) {
			return [];
		}
		const pattern = new RegExp(`^Q\\{${XSpecTests.namespace.replace(/[.]/g, '\\.')}\\}(scenario\\d+(?:-scenario\\d+)*)(-expect\\d+)?$`);
		const templates: XSpecRunnerTemplate[] = [];
		const byId = new Map<string, { template: XSpecRunnerTemplate, label: string }>();
		stylesheet.children.forEach((element) => {
			const match = pattern.exec(element.attributes.get('name') ?? '');
			if (!match) {
				return;
			}
			const all = descendants(element);
			const fileAttribute = all.find((e) => localName(e.name) === 'attribute' && e.attributes.get('name') === 'xspec');
			const labelElement = all.find((e) => localName(e.name) === 'element' && e.attributes.get('name') === 'label');
			const label = XSpecTests.normalizeSpace(labelElement ? [labelElement, ...descendants(labelElement)].map((e) => e.text).join('') : '');
			const kind: XSpecTestKind = match[2] ? 'expect' : 'scenario';
			const stepName = kind === 'scenario' ? `Q{${XSpecTests.namespace}}result` : 'Q{urn:x-xspec:compile:impl}successful';
			const step = all.find((e) => localName(e.name) === 'variable' && e.attributes.get('name') === stepName);
			const template: XSpecRunnerTemplate = {
				kind, id: match[1] + (match[2] ?? ''), file: XSpecTests.filePath(fileAttribute ? XSpecTests.normalizeSpace(fileAttribute.text) : undefined),
				labelPath: [], start: element.start, end: element.end, step: step ? { start: step.start, end: step.end } : undefined
			};
			templates.push(template);
			byId.set(template.id, { template, label });
		});
		templates.forEach((template) => {
			// the labels of its scenarios, from its ID, e.g. scenario2-scenario1-expect1 - and an expectation's file is its
			// scenario's
			const parts = template.id.split('-');
			const scenarioParts = template.kind === 'expect' ? parts.slice(0, -1) : parts;
			const labels = scenarioParts.map((_part, i) => byId.get(scenarioParts.slice(0, i + 1).join('-'))?.label ?? '');
			template.labelPath = template.kind === 'expect' ? [...labels, byId.get(template.id)!.label] : labels;
			template.file = template.file ?? byId.get(scenarioParts.join('-'))?.template.file;
		});
		return templates;
	}

	// the IDs of the scenarios in a compiled test runner, by their file and labels - e.g. for XSpec's force-focus, to run
	// one scenario
	public static scenarioIds(compiledText: string): Map<string, string[]> {
		const ids = new Map<string, string[]>();
		XSpecTests.runnerTemplates(compiledText).filter((template) => template.kind === 'scenario').forEach((template) => {
			const key = XSpecTests.key(template.file, template.labelPath);
			ids.set(key, [...(ids.get(key) ?? []), template.id]);
		});
		return ids;
	}

	private static filePath(uri: string | undefined) {
		if (!uri) {
			return undefined;
		}
		try {
			return uri.startsWith('file:') ? fileURLToPath(uri) : uri;
		} catch {
			return uri;
		}
	}

	// the content of a result's element, as XML - without XSpec's wrapper element - or its select attribute; with the
	// indentation of its first line removed from each
	private static rawContent(text: string, element: XmlElement): string {
		const content = element.children.length === 1 && localName(element.children[0].name) === 'content-wrap' ? element.children[0] : element;
		const xml = text.substring(content.contentStart, content.contentEnd).replace(/^\s*\n/, '').replace(/\s+$/, '');
		if (xml.trim() === '') {
			return element.attributes.get('select') ?? '';
		}
		const indent = /^[ \t]*/.exec(xml)?.[0] ?? '';
		return xml.split('\n').map((line) => line.startsWith(indent) ? line.substring(indent.length) : line.trimStart()).join('\n');
	}
}
