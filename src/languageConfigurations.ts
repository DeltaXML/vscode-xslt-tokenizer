import {LanguageConfiguration, DocumentTypes} from './xslLexer';
import { DCPSymbolProvider } from './dcpSymbolProvider';
import { DCPSchema } from './dcpSchema';
import { XSLTSchema } from './xsltSchema';

export class XSLTConfiguration {
	// Note: Non-standard 'else', 'then', 'on-duplicates' can be used in Saxon 10.0
	static expressionAtts = ['context-item', 'count', 'else', 'from', 'group-adjacent', 'group-by', 'group-ending-with', 'group-starting-with', 'from', 'for-each-item', 'for-each-source', 'initial-value', 
	'key', 'match', 'namespace-context', 'on-duplicates', 'select', 'test', 'then', 'use', 'use-when', 'value', 'with-params', 'xpath' ];

	static avtAtts = ['allow-duplicate-names', 'base-uri', 'build-tree', 'byte-order-mark', 'case-order', 'cdata-section-elements', 'collation', 'data-type', 'doctype-public', 'doctype-system', 'encoding', 'error-code',
		'escape-uri-attributes', 'flags', 'format', 'grouping-separator', 'grouping-size', 'href', 'html-version', 'include-context-type', 'indent', 'item-separator', 'json-node-output-method',
		'lang', 'letter-value', 'media-type', 'method', 'name', 'namespace', 'normalization-form', 'omit-xml-declaration', 'order', 'ordinal', 'ordinal-type', 'output-version',
		'parameter-document', 'regex', 'separator', 'schema-aware', 'stable', 'standalone', 'suppress-indentaion', 'terminate', 'undeclar-prefixes', 'start-at'];

	static xsltPrefix = 'xsl';

	static configuration: LanguageConfiguration = {
		expressionAtts: XSLTConfiguration.expressionAtts,
		avtAtts: XSLTConfiguration.avtAtts,
		nativePrefix: XSLTConfiguration.xsltPrefix,
		tvtAttributes: ['expand-text'],
		nonNativeAvts: true,
		schemaData: new XSLTSchema(),
		docType: DocumentTypes.XSLT
	} 
}

export class DCPConfiguration {
	// initial configuration is for basic XProc support only
	public static configuration: LanguageConfiguration = {
		expressionAtts: ['xpath', 'when'],
		variableElementNames: ['stringParameter', 'booleanParameter'],
		linkElementAttrNames: ['file', 'path'],
		nativePrefix: '',
		tvtAttributes: [],
		nonNativeAvts: false,
		schemaData: new DCPSchema(),
		docType: DocumentTypes.DCP,
		resourceNames: [
			'xsl/apply-ignore-changes.xsl',
			'xsl/attribute-ignore-changes-marker.xsl',
			'xsl/clean-house.xsl',
			'xsl/clean-non-delta-dxml-content.xsl',
			'xsl.propagate-ignore-changes.xsl',
			'xsl/schema-input-filter.xsl',
			'xsl/extract-format-version.xsl',
			'xsl/split-adjacent-ignorable-whitespace.xsl'
		],
		featureNames: [
			'http://apache.org/xml/features/validation/schema',
			'http://apache.org/xml/features/nonvalidating/load-dtd-grammar',
			'http://apache.org/xml/features/nonvalidating/load-external-dtd',
			'http://apache.org/xml/features/validation/dynamic',
			'http://apache.org/xml/features/validation/schema'
		],
		propertyNames: [
			'http://apache.org/xml/properties/schema/external-schemaLocation',
			'http://apache.org/xml/properties/schema/external-noNamespaceSchemaLocation',
		]
	} 
}

export class XProcConfiguration {
	// initial configuration is for basic XProc support only
	public static configuration: LanguageConfiguration = {
		expressionAtts: ['select', 'test'],
		nativePrefix: 'p',
		tvtAttributes: ['expand-text', 'inline-expand-text'],
		nonNativeAvts: true,
		docType: DocumentTypes.Other
	} 
}

export class XMLConfiguration {
	// initial configuration is for basic XProc support only
	public static configuration: LanguageConfiguration = {
		expressionAtts: [],
		nativePrefix: 'qz',
		tvtAttributes: [],
		nonNativeAvts: false,
		docType: DocumentTypes.Other
	} 
}

export class XSLTLightConfiguration {
	// used for global instruction processing only
	public static configuration: LanguageConfiguration = {
		expressionAtts: [],
		nativePrefix: 'xsl',
		tvtAttributes: [],
		nonNativeAvts: false,
		docType: DocumentTypes.XSLT
	} 
}