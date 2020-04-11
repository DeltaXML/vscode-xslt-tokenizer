import {LanguageConfiguration} from './xslLexer';


export class XSLTConfiguration {
	// Note: Non-standard 'else', 'then', 'on-duplicates' can be used in Saxon 10.0
	static expressionAtts = ['context-item', 'count', 'else', 'from', 'group-adjacent', 'group-by', 'group-ending-with', 'group-starting-with', 'from', 'for-each-item', 'for-each-source', 'initial-value', 
	'key', 'match', 'namespace-context', 'on-duplicates', 'select', 'test', 'then', 'use', 'use-when', 'value', 'with-params', 'xpath' ];

	static avtAtts = ['allow-duplicate-names', 'base-uri', 'build-tree', 'byte-order-mark', 'case-order', 'cdata-section-elements', 'collation', 'data-type', 'doctype-public', 'doctype-system', 'encoding', 'error-code',
		'escape-uri-attributes', 'flags', 'format', 'grouping-separator', 'grouping-size', 'href', 'html-version', 'include-context-type', 'indent', 'item-separator', 'json-node-output-method',
		'lang', 'letter-value', 'media-type', 'method', 'name', 'namespace', 'normalization-form', 'omit-xml-declaration', 'order', 'ordinal', 'ordinal-type', 'output-version',
		'parameter-document', 'regex', 'separator', 'schema-aware', 'stable', 'standalone', 'suppress-indentaion', 'terminate', 'undeclar-prefixes', 'start-at'];

	public static configuration: LanguageConfiguration = {
		expressionAtts: XSLTConfiguration.expressionAtts,
		avtAtts: XSLTConfiguration.avtAtts,
		nativePrefix: 'xsl'
	} 
}

export class XMLConfiguration {
	public static configuration: LanguageConfiguration = {
		nativePrefix: ''
	} 
}