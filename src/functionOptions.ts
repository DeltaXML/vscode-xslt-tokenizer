/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
/**
 * The options maps of built-in functions, e.g. parse-json($value, map { 'liberal': true() }), and the property names of
 * system-property() - as Saxon 13.1 implements them, where it differs from the XPath and XSLT 4.0 drafts: each option's
 * name, type and allowed values are those Saxon declares for the function (its OptionsParameter). Saxon raises XPTY0004
 * for a value of the wrong type, and an error for a value that isn't allowed. An option it doesn't recognize is an error
 * (XPTY0004) when syntax extensions are on, e.g. for XSLT 4.0, and is otherwise ignored. A key that's a QName, e.g. for a
 * vendor's option, is never checked.
 */
import { RecordField, RecordType } from './recordTypes';

export interface FunctionOption {
	name: string;
	// the type of the value, as a SequenceType - enum(...) for a string with a fixed set of values
	type: string;
	description: string;
	default?: string;
	// where it's defined: XPath 3.1, added in XPath 4.0, or a Saxon extension
	since: '3.1' | '4.0' | 'Saxon';
	// for an enum(...) type: a value with a prefix, e.g. a vendor's serialization method, is allowed too
	allowPrefixed?: boolean;
	// the error code Saxon raises for a value that isn't allowed, if not XPTY0004
	errorCode?: string;
	// the value is an options map of another function, e.g. transform's serialization-params - those of serialize()
	optionsOf?: string;
	// strings allowed as well as the type, e.g. '#unnamed' for apply-templates' mode, a QName
	stringValues?: string[];
}

interface OptionsParameter {
	// the functions' names, as they're written without a prefix (fn:) - map functions with map:
	functions: string[];
	// the position of the options argument (from 0), and its keyword names
	position: number;
	keywords: string[];
	options: FunctionOption[];
}

export interface SystemProperty {
	name: string;
	description: string;
	values?: string;
}

const yesNo = (description: string, defaultValue?: string, since: FunctionOption['since'] = '3.1') => ({ type: 'xs:boolean', description, default: defaultValue, since });

const jsonDuplicates = (values: string[], defaultValue: string): FunctionOption => ({
	name: 'duplicates', type: `enum(${values.map((v) => `'${v}'`).join(', ')})`, errorCode: 'FOJS0005', default: defaultValue, since: '3.1',
	description: 'What to do with an object that has two members with the same name: raise an error (reject), keep the first, keep the last or, for json-to-xml(), keep both (retain)'
});

const parseJsonOptions: FunctionOption[] = [
	{ name: 'liberal', ...yesNo('Whether input that deviates from the JSON grammar (RFC 7159) is accepted - how is implementation-defined', 'false()') },
	jsonDuplicates(['reject', 'use-first', 'use-last'], "'use-first'"),
	{ name: 'escape', ...yesNo('Whether special characters in strings are kept as JSON escape sequences, e.g. \\n, rather than unescaped', 'false()') },
	{ name: 'fallback', type: 'function(xs:string) as xs:anyAtomicType', since: '3.1', description: "A function called for an escape sequence of a character that isn't allowed in XML, e.g. \\u0000 - its result replaces it. Not allowed with 'escape': true()" },
	{ name: 'null', type: 'item()*', since: '4.0', default: '()', description: 'The value that a JSON null is returned as' },
	{ name: 'number-parser', type: 'function(xs:string) as xs:anyAtomicType', since: 'Saxon', description: 'A function called with each JSON number as it is written, returning its value - e.g. xs:decimal#1 for decimals rather than doubles, or xs:string#1 to keep it as written' },
	{ name: 'retain-order', ...yesNo('Whether the maps keep the order of the members of the JSON objects', 'false()', 'Saxon') }
];

const serializeOptions: FunctionOption[] = [
	{ name: 'allow-duplicate-names', ...yesNo('JSON output method: whether a map may give an object with two members of the same name (SERE0022 if not)') },
	{ name: 'byte-order-mark', ...yesNo('Whether a byte order mark is written at the start, for an encoding that has one') },
	{ name: 'canonical', ...yesNo('Whether the output is canonical XML or JSON', undefined, '4.0') },
	{ name: 'cdata-section-elements', type: 'xs:QName*', since: '3.1', description: 'The names of the elements whose text content is written as CDATA sections' },
	{ name: 'doctype-public', type: 'xs:string', since: '3.1', description: 'The public identifier of the DOCTYPE declaration' },
	{ name: 'doctype-system', type: 'xs:string', since: '3.1', description: 'The system identifier of the DOCTYPE declaration - the DOCTYPE is written only with it (or, for HTML5, with method html)' },
	{ name: 'encoding', type: 'xs:string', since: '3.1', description: 'The character encoding of the output, e.g. UTF-8' },
	{ name: 'escape-solidus', ...yesNo("JSON output method: whether '/' is written as '\\/'", 'true()', '4.0') },
	{ name: 'escape-uri-attributes', ...yesNo('HTML and XHTML output methods: whether URI attribute values, e.g. href, are %-escaped') },
	{ name: 'html-version', type: 'xs:decimal', since: '3.1', description: 'The version of HTML for the html and xhtml output methods, e.g. 5' },
	{ name: 'include-content-type', ...yesNo('HTML and XHTML output methods: whether a meta element with the content type is added to the head element') },
	{ name: 'indent', ...yesNo('Whether whitespace is added to indent the output') },
	{ name: 'item-separator', type: 'xs:string', since: '3.1', description: 'The string written between the items of a sequence' },
	{ name: 'json-lines', ...yesNo('JSON output method: whether each item of a sequence is written on a line of its own (JSON Lines)', undefined, '4.0') },
	{ name: 'json-node-output-method', type: "enum('xml', 'xhtml', 'html', 'text')", allowPrefixed: true, errorCode: 'SXCH0004', since: '3.1', description: 'JSON output method: the output method for nodes within maps and arrays' },
	{ name: 'media-type', type: 'xs:string', since: '3.1', description: 'The media type (MIME type) of the output, without a charset' },
	{ name: 'method', type: "enum('xml', 'html', 'xhtml', 'text', 'json', 'adaptive')", allowPrefixed: true, errorCode: 'SXCH0004', since: '3.1', description: 'The output method' },
	{ name: 'normalization-form', type: "enum('NFC', 'NFD', 'NFKC', 'NFKD', 'fully-normalized', 'none')", errorCode: 'SESU0011', since: '3.1', description: 'The Unicode normalization applied to the output' },
	{ name: 'omit-xml-declaration', ...yesNo('Whether the XML declaration is left out') },
	{ name: 'standalone', type: 'xs:boolean?', since: '3.1', description: "The standalone value of the XML declaration - () for none (not 'omit', as in xsl:output)" },
	{ name: 'suppress-indentation', type: 'xs:QName*', since: '3.1', description: 'The names of the elements whose content is not indented' },
	{ name: 'undeclare-prefixes', ...yesNo('XML 1.1: whether namespace undeclarations, e.g. xmlns:p="", are written') },
	{ name: 'use-character-maps', type: 'map(xs:string, xs:string)', since: '3.1', description: 'A map from single characters to the strings that replace them in the output' },
	{ name: 'version', type: 'xs:string', since: '3.1', description: 'The version of the output format, e.g. 1.0 for XML' }
];

const docOptions: FunctionOption[] = [
	{ name: 'dtd-validation', ...yesNo('Whether the document is validated against its DTD', 'false()', '4.0') },
	{ name: 'stable', ...yesNo('Whether the same URI always gives the same document within the transformation', 'true()', '4.0') },
	{ name: 'strip-space', ...yesNo('Whether whitespace text nodes are stripped (in Saxon 13, a boolean)', 'false()', '4.0') },
	{ name: 'trusted', ...yesNo('Whether the document may refer to external resources, e.g. external entities', 'false()', '4.0') },
	{ name: 'use-xsi-schema-location', ...yesNo('Whether xsi:schemaLocation is used to find the schema for validation', 'false()', '4.0') },
	{ name: 'xsd-validation', type: 'xs:string', since: '4.0', default: "'skip'", description: "Schema validation: 'strict', 'lax', 'skip', or 'type Q{uri}local' for validation against a type" },
	{ name: 'xinclude', ...yesNo('Whether XInclude processing is done', 'false()', '4.0') }
];

const unparsedTextOptions = (normalize: boolean): FunctionOption[] => [
	{ name: 'encoding', type: 'xs:string?', since: '4.0', description: 'The character encoding of the file, e.g. UTF-8 - by default, from the file or the protocol, or UTF-8' },
	...(normalize ? [{ name: 'normalize-newlines', ...yesNo('Whether CRLF and CR line endings are changed to LF', 'false()', '4.0') }] : []),
	{ name: 'fallback', ...yesNo("Whether characters that aren't allowed in XML are replaced with U+FFFD, rather than raising an error", 'false()', '4.0') }
];

const mapDuplicates = (defaultValue: string): FunctionOption => ({
	name: 'duplicates', type: "enum('reject', 'use-first', 'use-last', 'use-any', 'combine')", default: defaultValue, since: '3.1',
	description: 'What to do with two entries with the same key: raise an error (reject), keep the first, the last or either, or combine their values as a sequence - in XPath 4.0, also a function that combines the two values'
});

const parameters: OptionsParameter[] = [
	{ functions: ['parse-json', 'json-doc'], position: 1, keywords: ['options'], options: parseJsonOptions },
	{
		functions: ['json-to-xml'], position: 1, keywords: ['options'], options: [
			parseJsonOptions[0],
			jsonDuplicates(['reject', 'use-first', 'retain'], "'retain' ('reject' with validate)"),
			{ name: 'validate', ...yesNo('Whether the XML is schema-validated (needs a schema-aware processor)', 'false()') },
			parseJsonOptions[2], parseJsonOptions[3], parseJsonOptions[5]
		]
	},
	{
		functions: ['xml-to-json'], position: 1, keywords: ['options'], options: [
			{ name: 'indent', ...yesNo('Whether whitespace is added to make the JSON easier to read', 'false()') },
			{ name: 'escape-solidus', ...yesNo("Whether '/' is written as '\\/'", 'true()', '4.0') }
		]
	},
	{ functions: ['serialize'], position: 1, keywords: ['options', 'params'], options: serializeOptions },
	{
		functions: ['transform'], position: 0, keywords: ['options'], options: [
			{ name: 'base-output-uri', type: 'xs:string', since: '3.1', description: 'The URI of the principal result, and the base URI of secondary results' },
			{ name: 'cache', ...yesNo('Whether the compiled stylesheet is kept for another transformation', 'true()') },
			{ name: 'delivery-format', type: "enum('document', 'serialized', 'raw')", errorCode: 'FOXT0002', default: "'document'", since: '3.1', description: 'How the results are delivered: as document nodes, serialized as strings, or as the raw result sequence' },
			{ name: 'enable-assertions', ...yesNo('Whether xsl:assert instructions are evaluated', 'false()') },
			{ name: 'enable-messages', ...yesNo('Whether xsl:message instructions are evaluated') },
			{ name: 'enable-trace', ...yesNo('Whether calls of trace() write their messages') },
			{ name: 'function-params', type: 'array(*)', since: '3.1', description: 'The arguments of the initial function' },
			{ name: 'global-context-item', type: 'item()', since: '3.1', description: 'The global context item - by default, the root of source-node' },
			{ name: 'initial-function', type: 'xs:QName', since: '3.1', description: 'The name of the function to call, with function-params' },
			{ name: 'initial-match-selection', type: 'item()*', since: '3.1', description: 'The items to apply templates to - by default, source-node' },
			{ name: 'initial-mode', type: 'xs:QName', since: '3.1', description: 'The name of the initial mode, e.g. QName(\'\', \'m\')' },
			{ name: 'initial-template', type: 'xs:QName', since: '3.1', description: "The name of the template to call, e.g. QName('', 'main') - a string isn't converted to a QName" },
			{ name: 'package-location', type: 'xs:string', since: '3.1', description: 'The location of the top-level package' },
			{ name: 'package-name', type: 'xs:string', since: '3.1', description: 'The name of the top-level package' },
			{ name: 'package-node', type: 'node()', since: '3.1', description: 'A document or element node with the top-level package' },
			{ name: 'package-text', type: 'xs:string', since: '3.1', description: 'The top-level package as unparsed XML' },
			{ name: 'package-version', type: 'xs:string', since: '3.1', description: 'The version of the top-level package' },
			{ name: 'post-process', type: 'function(xs:string, item()*) as item()*', since: '3.1', description: 'A function applied to each result: its key and its value' },
			{ name: 'requested-properties', type: 'map(*)', since: '3.1', description: 'A map of the system properties requested of the processor, e.g. xsl:is-schema-aware' },
			{ name: 'serialization-params', type: 'map(*)', optionsOf: 'serialize', since: '3.1', description: 'Serialization parameters for the principal result, as for serialize()' },
			{ name: 'source-location', type: 'xs:string', since: '4.0', description: 'The location of the source document, which may be streamed' },
			{ name: 'source-node', type: 'node()', since: '3.1', description: 'The source node: the initial match selection, and its root the global context item' },
			{ name: 'static-params', type: 'map(*)', since: '3.1', description: 'A map of the static parameters, by QName' },
			{ name: 'stylesheet-base-uri', type: 'xs:string', since: '3.1', description: 'The static base URI of the stylesheet' },
			{ name: 'stylesheet-location', type: 'xs:string', since: '3.1', description: 'The URI of the stylesheet, relative to the static base URI' },
			{ name: 'stylesheet-node', type: 'node()', since: '3.1', description: 'A document or element node with the stylesheet' },
			{ name: 'stylesheet-params', type: 'map(*)', since: '3.1', description: "A map of the stylesheet parameters, by QName, e.g. map { QName('', 'p'): 1 }" },
			{ name: 'stylesheet-text', type: 'xs:string', since: '3.1', description: 'The stylesheet as unparsed XML' },
			{ name: 'template-params', type: 'map(*)', since: '3.1', description: 'A map of the parameters of the initial template, by QName' },
			{ name: 'tunnel-params', type: 'map(*)', since: '3.1', description: 'A map of the tunnel parameters of the initial template, by QName' },
			{ name: 'vendor-options', type: 'map(*)', since: '3.1', description: "A map of the processor's own options, by QName" },
			{ name: 'xslt-version', type: 'xs:decimal', since: '3.1', description: 'The minimum XSLT version the processor must support, e.g. 3.0' }
		]
	},
	{
		functions: ['load-xquery-module'], position: 1, keywords: ['options'], options: [
			{ name: 'xquery-version', type: 'xs:decimal', since: '3.1', description: 'The minimum XQuery version the processor must support' },
			{ name: 'location-hints', type: 'xs:string*', since: '3.1', description: 'The URIs of the module' },
			{ name: 'context-item', type: 'item()?', since: '3.1', description: 'The context item for the global variables of the module' },
			{ name: 'content', type: 'xs:string?', since: '4.0', description: 'The module as a string' },
			{ name: 'variables', type: 'map(*)', since: '3.1', description: 'A map of the values of the external variables, by QName' },
			{ name: 'vendor-options', type: 'map(*)', since: '3.1', description: "A map of the processor's own options, by QName" }
		]
	},
	{ functions: ['map:merge'], position: 1, keywords: ['options'], options: [mapDuplicates("'use-first'")] },
	{ functions: ['map:build'], position: 3, keywords: ['options'], options: [mapDuplicates("'combine'")] },
	{
		functions: ['deep-equal'], position: 2, keywords: ['options'], options: [
			...([['base-uri', 'the base URIs of nodes are compared'], ['comments', 'comments are compared'], ['debug', 'the reason the values differ is reported, e.g. as a message'],
				['id-property', 'the is-id property of nodes is compared'], ['idrefs-property', 'the is-idrefs property of nodes is compared'],
				['in-scope-namespaces', 'the in-scope namespaces of elements are compared'], ['map-order', 'the order of map entries is compared'],
				['namespace-prefixes', 'the prefixes of names are compared'], ['nilled-property', 'the nilled property of elements is compared'],
				['processing-instructions', 'processing instructions are compared'], ['timezones', 'the timezones of date and time values are compared'],
				['type-annotations', 'the type annotations of nodes are compared']] as const).map(([name, what]) => ({ name, ...yesNo(`Whether ${what}`, 'false()', '4.0') })),
			{ name: 'collation', type: 'xs:string', since: '4.0', description: 'The collation for comparing strings' },
			{ name: 'items-equal', type: 'function(item(), item()) as xs:boolean?', since: '4.0', description: 'A function that decides whether two items are equal, or () to compare them as usual' },
			{ name: 'normalization-form', type: "enum('NFC', 'NFD', 'NFKC', 'NFKD')", errorCode: 'FOJS0005', since: '4.0', description: 'The Unicode normalization applied to strings before comparing them' },
			{ name: 'ordered', ...yesNo('Whether the order of child elements and of sequence items matters', 'true()', '4.0') },
			{ name: 'type-variety', ...yesNo('Whether elements must have the same variety of type, e.g. simple or complex content', 'true()', '4.0') },
			{ name: 'typed-values', ...yesNo('Whether typed values, rather than string values, are compared', 'true()', '4.0') },
			{ name: 'unordered-elements', type: 'xs:QName*', since: '4.0', description: 'The names of the elements whose children may be in any order' },
			{ name: 'whitespace', type: "enum('preserve', 'strip', 'normalize')", errorCode: 'FOJS0005', default: "'preserve'", since: '4.0', description: 'How whitespace in text is compared' }
		]
	},
	{ functions: ['doc', 'doc-available'], position: 1, keywords: ['options'], options: docOptions },
	{
		functions: ['parse-xml'], position: 1, keywords: ['options'], options: [
			{ name: 'base-uri', type: 'xs:anyURI', since: '4.0', description: 'The base URI of the document' },
			...docOptions.filter((o) => o.name !== 'stable')
		]
	},
	{ functions: ['parse-xml-fragment'], position: 1, keywords: ['options'], options: [{ name: 'base-uri', type: 'xs:anyURI', since: '4.0', description: 'The base URI of the document' }, docOptions[2]] },
	{ functions: ['unparsed-text', 'unparsed-text-available'], position: 1, keywords: ['options'], options: unparsedTextOptions(true) },
	{ functions: ['unparsed-text-lines'], position: 1, keywords: ['options'], options: unparsedTextOptions(false) },
	{
		functions: ['path'], position: 1, keywords: ['options'], options: [
			{ name: 'indexes', ...yesNo('Whether each step has a position, e.g. [1]', 'true()', '4.0') },
			{ name: 'lexical', ...yesNo('Whether names are written as lexical QNames, with their prefixes, rather than as EQNames', 'false()', '4.0') },
			{ name: 'origin', type: 'node()?', since: '4.0', description: 'The node the path starts from - by default, the root' },
			{ name: 'namespaces', type: 'map(*)?', since: '4.0', description: 'A map of prefixes to namespace URIs, for the names in the path' }
		]
	},
	{
		functions: ['apply-templates'], position: 1, keywords: ['options'], options: [
			{ name: 'mode', type: 'xs:QName?', stringValues: ['#unnamed', '#current'], since: '4.0', description: "The mode: its name, e.g. QName('', 'm'), or '#unnamed' or '#current'" },
			{ name: 'params', type: 'map(*)', since: '4.0', description: 'A map of the template parameters, by QName' },
			{ name: 'tunnel-params', type: 'map(*)', since: '4.0', description: 'A map of the tunnel parameters, by QName' }
		]
	}
];

const yesNoValues = "'yes' or 'no'";
const systemProperties: SystemProperty[] = [
	{ name: 'version', description: 'The version of XSLT the processor implements', values: "e.g. '3.0'" },
	{ name: 'vendor', description: 'The name of the vendor of the processor', values: "e.g. 'Saxonica'" },
	{ name: 'vendor-url', description: "The URL of the processor's vendor" },
	{ name: 'product-name', description: 'The name of the processor', values: "e.g. 'SAXON'" },
	{ name: 'product-version', description: 'The version of the processor', values: "e.g. 'PE 13.1'" },
	{ name: 'is-schema-aware', description: 'Whether the processor is schema-aware', values: yesNoValues },
	{ name: 'supports-serialization', description: 'Whether the processor supports serialization', values: yesNoValues },
	{ name: 'supports-backwards-compatibility', description: 'Whether the processor supports XSLT 1.0 backwards compatible behavior', values: yesNoValues },
	{ name: 'supports-namespace-axis', description: 'Whether the processor supports the namespace axis', values: yesNoValues },
	{ name: 'supports-streaming', description: 'Whether the processor supports streaming', values: yesNoValues },
	{ name: 'supports-dynamic-evaluation', description: 'Whether the processor supports xsl:evaluate', values: yesNoValues },
	{ name: 'supports-higher-order-functions', description: 'Whether the processor supports higher-order functions', values: yesNoValues },
	{ name: 'xpath-version', description: 'The version of XPath the processor implements', values: "e.g. '3.1'" },
	{ name: 'xsd-version', description: 'The version of XML Schema the processor implements', values: "e.g. '1.1'" }
];

export class FunctionOptions {

	// the options of the function's argument at the position (from 0) or with the keyword - undefined if it isn't an
	// options argument. The name is as written: fn: is optional, and a map function has the prefix map:
	public static optionsFor(functionName: string, position: number, keyword?: string): { functionName: string, options: FunctionOption[] } | undefined {
		const name = functionName.startsWith('fn:') ? functionName.substring(3) : functionName;
		const parameter = parameters.find((p) => p.functions.includes(name) && (keyword !== undefined ? p.keywords.includes(keyword) : p.position === position));
		return parameter ? { functionName: name, options: parameter.options } : undefined;
	}

	// the options as a record type, for the checks and completion of map constructors - each field is optional
	public static record(functionName: string, position: number, keyword?: string): RecordType | undefined {
		const found = FunctionOptions.optionsFor(functionName, position, keyword);
		return found ? FunctionOptions.recordOf(found.functionName, found.options) : undefined;
	}

	public static recordOf(functionName: string, options: FunctionOption[]): RecordType {
		const fields: RecordField[] = options.map((option) => ({ name: option.name, optional: true, type: option.type, option: { functionName, ...option } }));
		return { name: `${functionName}() options`, fields, optionsOf: functionName };
	}

	// the options of another function that an option's value is, e.g. transform's serialization-params - serialize()'s
	public static nestedRecord(option: FunctionOption): RecordType | undefined {
		const nested = option.optionsOf ? parameters.find((p) => p.functions.includes(option.optionsOf!)) : undefined;
		return nested ? FunctionOptions.recordOf(option.optionsOf!, nested.options) : undefined;
	}

	// the hover text and completion documentation of an option
	public static markdown(functionName: string, option: FunctionOption): string {
		const since = option.since === '3.1' ? '' : option.since === '4.0' ? ' - XPath 4.0' : ' - a Saxon extension';
		const values = option.type.startsWith('enum(') ? `\n\nValues: ${option.type.substring(5, option.type.length - 1)}${option.allowPrefixed ? ', or a prefixed name' : ''}` :
			option.stringValues ? `\n\nOr: ${option.stringValues.map((v) => `'${v}'`).join(', ')}` : '';
		const defaultValue = option.default ? `\n\nDefault: \`${option.default}\`` : '';
		return `**${option.name}** \`as ${option.type}\` - option of \`${functionName}()\`${since}\n\n${option.description}${values}${defaultValue}`;
	}

	// the options of a function, as text - e.g. for the xpath_function MCP tool - undefined if it has none
	public static optionsText(functionName: string): string | undefined {
		const name = functionName.startsWith('fn:') ? functionName.substring(3) : functionName;
		const parameter = parameters.find((p) => p.functions.includes(name));
		if (!parameter) {
			return undefined;
		}
		const lines = parameter.options.map((o) => {
			const since = o.since === '3.1' ? '' : o.since === '4.0' ? ' [XPath 4.0]' : ' [Saxon]';
			return `- '${o.name}' as ${o.type}${o.default ? ` (default ${o.default})` : ''}${since}: ${o.description}`;
		});
		return `Options (as Saxon 13 implements them; a key it doesn't recognize is an error with syntax extensions on, else ignored; QName keys are for vendors' options):\n${lines.join('\n')}`;
	}

	public static isSystemPropertyFunction(name: string) {
		return name === 'system-property' || name === 'fn:system-property';
	}

	public static get systemProperties(): readonly SystemProperty[] {
		return systemProperties;
	}

	// the property for a name in the XSLT namespace, e.g. 'xsl:version' with the prefix 'xsl' - undefined if it's another
	// name, which isn't checked: unprefixed (a Java system property, for Saxon) or in another namespace, e.g. Saxon's or
	// EXPath's. unknown is true for a name in the XSLT namespace that isn't a property - system-property() returns ''
	public static systemProperty(name: string, xsltPrefix: string): { property?: SystemProperty, unknown: boolean } | undefined {
		const colon = name.indexOf(':');
		if (colon < 0 || name.substring(0, colon) !== xsltPrefix) {
			return undefined;
		}
		const localName = name.substring(colon + 1);
		const property = systemProperties.find((p) => p.name === localName);
		return { property, unknown: !property };
	}

	public static systemPropertyMarkdown(name: string, property: SystemProperty): string {
		return `**${name}** - system property\n\n${property.description}${property.values ? `\n\nValue: ${property.values}` : ''}`;
	}
}
