/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */

// a small XML parser for the XSpec test runner (see XSpecTests): the elements of an XSpec file being edited - which may
// not be well-formed, so it's tolerant, ending at the first markup it can't read - and of XSpec's result XML, with the
// offsets of each element's markup in the text
export interface XmlElement {
	name: string;
	attributes: Map<string, string>;
	children: XmlElement[];
	// the text of its own text nodes, with references replaced
	text: string;
	// offsets in the text: the element's '<', the end of its start tag, the start of its end tag, and its end
	start: number;
	contentStart: number;
	contentEnd: number;
	end: number;
	parent?: XmlElement;
}

const attributePattern = /\s*([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;

export function decodeReferences(text: string): string {
	return text.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_match, ref: string) => {
		switch (ref) {
			case 'lt': return '<';
			case 'gt': return '>';
			case 'amp': return '&';
			case 'quot': return '"';
			case 'apos': return '\'';
			default: return String.fromCodePoint(ref.startsWith('#x') ? parseInt(ref.substring(2), 16) : parseInt(ref.substring(1), 10));
		}
	});
}

// the outermost element - undefined if there's none
export function parseXml(text: string): XmlElement | undefined {
	let root: XmlElement | undefined;
	const stack: XmlElement[] = [];
	let i = 0;
	const addText = (value: string) => {
		if (stack.length > 0) {
			stack[stack.length - 1].text += value;
		}
	};
	while (i < text.length) {
		const lt = text.indexOf('<', i);
		if (lt < 0) {
			break;
		}
		addText(decodeReferences(text.substring(i, lt)));
		if (text.startsWith('<!--', lt)) {
			const close = text.indexOf('-->', lt + 4);
			i = close < 0 ? text.length : close + 3;
		} else if (text.startsWith('<![CDATA[', lt)) {
			const close = text.indexOf(']]>', lt + 9);
			addText(text.substring(lt + 9, close < 0 ? text.length : close));
			i = close < 0 ? text.length : close + 3;
		} else if (text.startsWith('<?', lt)) {
			const close = text.indexOf('?>', lt + 2);
			i = close < 0 ? text.length : close + 2;
		} else if (text.startsWith('<!', lt)) {
			// a DOCTYPE, with any internal subset
			const subset = text.indexOf('[', lt);
			const firstClose = text.indexOf('>', lt);
			const close = subset > -1 && subset < firstClose ? text.indexOf(']>', subset) + 1 : firstClose;
			i = close < 1 ? text.length : close + 1;
		} else if (text.startsWith('</', lt)) {
			const close = text.indexOf('>', lt);
			const name = text.substring(lt + 2, close < 0 ? text.length : close).trim();
			// the element it ends, closing any left open inside it
			const index = stack.map((element) => element.name).lastIndexOf(name);
			if (index < 0 || close < 0) {
				break;
			}
			while (stack.length > index) {
				const element = stack.pop()!;
				element.contentEnd = lt;
				element.end = close + 1;
			}
			i = close + 1;
		} else {
			const name = /^<([^\s/>]+)/.exec(text.substring(lt, lt + 200))?.[1];
			if (!name) {
				break;
			}
			const element: XmlElement = { name, attributes: new Map(), children: [], text: '', start: lt, contentStart: -1, contentEnd: -1, end: -1, parent: stack[stack.length - 1] };
			let j = lt + 1 + name.length;
			attributePattern.lastIndex = j;
			let match: RegExpExecArray | null;
			while ((match = attributePattern.exec(text)) !== null) {
				element.attributes.set(match[1], decodeReferences(match[2] ?? match[3]));
				j = attributePattern.lastIndex;
			}
			const tagEnd = /^\s*(\/?)>/.exec(text.substring(j, j + 200));
			if (!tagEnd) {
				break;
			}
			i = j + tagEnd[0].length;
			element.contentStart = i;
			if (element.parent) {
				element.parent.children.push(element);
			} else if (!root) {
				root = element;
			}
			if (tagEnd[1]) {
				element.contentEnd = i;
				element.end = i;
			} else {
				stack.push(element);
			}
		}
	}
	return root;
}

export function localName(name: string) {
	return name.substring(name.indexOf(':') + 1);
}

// the elements within an element, in document order
export function descendants(element: XmlElement): XmlElement[] {
	return element.children.flatMap((child) => [child, ...descendants(child)]);
}
