import {} from './schemaQuery';
import { DocumentTypes } from './xslLexer';

export interface SimpleType {
    base?: string[],
    enum?: string[],
    list?: string,
    detail?: {[name: string]: string}
}

export interface ComplexType {
    attrs?: any,
    base?: string,
    type?: string,
    elementNames?: string[],
    attributeList?: AttributeItem[];
    primitive?: string,
    detail?: string,
    attributeGroup?: string
}

export interface SubstitutionGroupType {
    type: string,
    elements: { [name: string]: ComplexType}
}

export interface AttributeItem {
    name: string,
    enum?: string[];
}

export interface SchemaData {
    attributeGroups: { [name: string]: any },
    simpleTypes: { [name: string]: SimpleType },
    complexTypes: { [name: string]: ComplexType },
    substitutionGroups?: { [name: string]: SubstitutionGroupType },
    elements: {[name: string]: ComplexType},
    docType: DocumentTypes
}

export class XSLTSchema implements SchemaData {
    docType = DocumentTypes.XSLT;
    attributeGroups: { [name: string]: any } = {
        "xsl:literal-result-element-attributes": {
            attrs: {
                'xsl:default-collation': 'xsl:uri-list',
                'xsl:default-mode': 'xsl:default-mode-type',
                'xsl:default-validation': 'xsl:validation-strip-or-preserve',
                'xsl:expand-text': 'xsl:yes-or-no',
                'xsl:extension-element-prefixes': 'xsl:prefixes',
                'xsl:exclude-result-prefixes': 'xsl:prefixes',
                'xsl:xpath-default-namespace': 'xs:anyURI',
                'xsl:inherit-namespaces': 'xsl:yes-or-no',
                'xsl:use-attribute-sets': 'xsl:EQNames',
                'xsl:use-when': 'xsl:expression',
                'xsl:version': 'xs:decimal',
                'xsl:type': 'xsl:EQName',
                'xsl:validation': 'xsl:validation-type'
            }
        }
    }
    simpleTypes: { [name: string]: SimpleType } = {
        "xsl:accumulator-names": { base: ['xs:token'], list: 'xsl:EQName', enum: ['#all'] },
        "xsl:avt": { base: ['xs:string'] },
        "xsl:char": { base: ['xs:string'] },
        "xsl:component-kind-type": { base: ['xs:token'], enum: ['template', 'function', 'variable', 'attribute-set', 'mode', '*'] },
        "xsl:default-mode-type": { base: ['xs:token'], enum: ['#unnamed'] },
        "xsl:expression": { base: ['xs:token'] },
        "xsl:item-type": { base: ['xs:token'] },
        "xsl:input-type-annotations-type": { base: ['xs:token'], enum: ['preserve', 'strip', 'unspecified'] },
        "xsl:level": { base: ['xs:token'], enum: ['single', 'multiple', 'any'] },
        "xsl:mode": { base: ['xs:token'], enum: ['#default', '#unnamed', '#current'] },
        "xsl:modes": { base: ['xs:token'], enum: ['#default', '#unnamed', '#all'] },
        "xsl:nametests": { base: ['xs:token'], enum: ['*'] },
        "xsl:on-multiple-match-type": { base: ['xs:token'], enum: ['use-last', 'fail'] },
        "xsl:on-no-match-type": { base: ['xs:token'], enum: ['deep-copy', 'shallow-copy', 'deep-skip', 'shallow-skip', 'text-only-copy', 'fail'] },
        "xsl:prefixes": { list: 'xs:NCName' },
        "xsl:prefix-list-or-all": { base: ['xs:token'], enum: ['#all'] },
        "xsl:prefix-list": { list: 'xsl:prefix-or-default' },
        "xsl:method": { base: ['xs:token', 'xsl:EQName'], enum: ['xml', 'xhtml', 'html', 'text', 'adaptive', 'json'] },
        "xsl:pattern": { base: ['xsl:expression'] },
        "xsl:prefix-or-default": { base: ['xs:token'], enum: ['#default'] },
        "xsl:EQNames": { list: 'xsl:EQName' },
        "xsl:EQName": { base: ['xs:token'] },
        "xsl:EQName-in-namespace": { base: ['xsl:EQName'] },
        "xsl:sequence-type": { base: ['xs:token'] },
        "xsl:streamability-type": { base: ['xs:token'], enum: ['unclassified', 'absorbing', 'inspection', 'filter', 'shallow-descent', 'deep-descent', 'ascent'] },
        "xsl:typed-type": { base: ['xs:token'], enum: ['yes', 'no', 'true', 'false', '1', '0', 'strict', 'lax', 'unspecified'] },
        "xsl:uri-list": { list: 'xs:anyURI' },
        "xsl:validation-strip-or-preserve": { base: ['xsl:validation-type'], enum: ['preserve', 'strip'] },
        "xsl:validation-type": { base: ['xs:token'], enum: ['strict', 'lax', 'preserve', 'strip'] },
        "xsl:visibility-type": { base: ['xs:token'], enum: ['public', 'private', 'final', 'abstract', 'hidden'] },
        "xsl:visibility-not-hidden-type": { base: ['xsl:visibility-type'], enum: ['public', 'private', 'final', 'abstract'] },
        "xsl:yes-or-no": { base: ['xs:token'], enum: ['yes', 'no', 'true', 'false', '1', '0'] },
        "xsl:yes-or-no-or-maybe": { base: ['xs:token'], enum: ['yes', 'no', 'true', 'false', '1', '0', 'maybe'] },
        "xsl:yes-or-no-or-omit": { base: ['xs:token'], enum: ['yes', 'no', 'true', 'false', '1', '0', 'omit'] },
        "xsl:zero-digit": { base: ['xsl:char'] },
    };
    complexTypes: { [name: string]: ComplexType } = {
        "xsl:generic-element-type": {
            attrs: {
                'default-collation': 'xsl:uri-list',
                'default-mode': 'xsl:default-mode-type',
                'default-validation': 'xsl:validation-strip-or-preserve',
                'exclude-result-prefixes': 'xsl:prefix-list-or-all',
                'expand-text': 'xsl:yes-or-no',
                'extension-element-prefixes': 'xsl:prefix-list',
                'use-when': 'xsl:expression',
                'xpath-default-namespace': 'xs:anyURI',
                '_default-collation': 'xs:string',
                '_default-mode': 'xs:string',
                '_default-validation': 'xs:string',
                '_exclude-result-prefixes': 'xs:string',
                '_expand-text': 'xs:string',
                '_extension-element-prefixes': 'xs:string',
                '_use-when': 'xs:string',
                '_xpath-default-namespace': 'xs:string'
            }
        },
        "xsl:versioned-element-type": {
            base: 'xsl:generic-element-type',
            attrs: {
                'version': 'xs:decimal',
                '_version': 'xs:string'
            }
        },
        "xsl:element-only-versioned-element-type": {
            base: 'xsl:versioned-element-type'
        },
        "xsl:sequence-constructor": {
            base: 'xsl:versioned-element-type',
            elementNames: ['xsl:instruction']
        },
        "xsl:sequence-constructor-and-select": {
            base: 'xsl:sequence-constructor',
            attrs: {
                'select': 'xsl:expression',
                '_select': 'xs:string'
            }
        },
        "xsl:sequence-constructor-or-select": {
            base: 'xsl:sequence-constructor-and-select',
            elementNames: ['xsl:instruction']
        },
        "xsl:text-element-base-type": {
            primitive: 'xs:string',
            base: 'xsl:versioned-element-type'
        },
        "xsl:text-element-type": {
            base: 'xsl:text-element-base-type',
            attrs: {
                'disable-output-escaping': 'xsl:yes-or-no',
                '_disable-output-escaping': 'xs:string'
            }
        },
        "xsl:transform-element-base-type": {
            base: 'xsl:element-only-versioned-element-type',
            attrs: {
                'version': 'xs:decimal',
                '_version': 'xs:string'
            }
        },
    }
    substitutionGroups: { [name: string]: SubstitutionGroupType } = {
        instruction: {
            type: 'generic-element-type',
            elements: {
                "xsl:analyze-string": {
                    base: 'xsl:element-only-versioned-element-type',
                    attrs: {
                        'select': 'xsl:expression',
                        'regex': 'xsl:avt',
                        'flags': 'xsl:avt',
                        '_select': 'xs:string',
                        '_regex': 'xs:string',
                        '_flags': 'xs:string'
                    },
                    elementNames: ['xsl:matching-substring', 'xsl:non-matching-substring', 'xsl:fallback']
                },
                "xsl:apply-imports": {
                    base: 'xsl:element-only-versioned-element-type',
                    elementNames: ['xsl:with-param']
                },
                "xsl:apply-templates": {
                    base: 'xsl:element-only-versioned-element-type',
                    attrs: {
                        'select': 'xsl:expression',
                        'mode': 'xsl:mode',
                        '_select': 'xs:string',
                        '_mode': 'xs:string'
                    },
                    elementNames: ['xsl:sort', 'xsl:with-param']
                },
                "xsl:assert": {
                    base: 'xsl:sequence-constructor',
                    attrs: {
                        'test': 'xsl:expression',
                        'select': 'xsl:expression',
                        'error-code': 'xsl:avt',
                        '_test': 'xs:string',
                        '_select': 'xs:string',
                        '_error-code': 'xs:string'
                    }
                },
                "xsl:attribute": {
                    base: 'xsl:sequence-constructor-or-select',
                    attrs: {
                        'name': 'xsl:avt',
                        'namespace': 'xsl:avt',
                        'separator': 'xsl:avt',
                        'type': 'xsl:EQName',
                        'validation': 'xsl:validation-type',
                        '_name': 'xs:string',
                        '_namespace': 'xs:string',
                        '_separator': 'xs:string',
                        '_type': 'xs:string',
                        '_validation': 'xs:string'
                    }
                },
                "xsl:break": { type: 'xsl:sequence-constructor-or-select' },
                "xsl:call-template": {
                    base: 'xsl:element-only-versioned-element-type',
                    attrs: {
                        'name': 'xsl:EQName',
                        '_name': 'xs:string'
                    },
                    elementNames: ['xsl:with-param']
                },
                "xsl:choose": {
                    base: 'xsl:element-only-versioned-element-type',
                    elementNames: ['xsl:when', 'xsl:otherwise']
                },
                "xsl:comment": { type: 'xsl:sequence-constructor-or-select' },
                "xsl:copy": {
                    base: 'xsl:sequence-constructor',
                    attrs: {
                        'select': 'xsl:expression',
                        'copy-namespaces': 'xsl:yes-or-no',
                        'inherit-namespaces': 'xsl:yes-or-no',
                        'use-attribute-sets': 'xsl:EQNames',
                        'type': 'xsl:EQName',
                        'validation': 'xsl:validation-type',
                        '_select': 'xs:string',
                        '_copy-namespaces': 'xs:string',
                        '_inherit-namespaces': 'xs:string',
                        '_use-attribute-sets': 'xs:string',
                        '_type': 'xs:string',
                        '_validation': 'xs:string'
                    }
                },
                "xsl:copy-of": {
                    base: 'xsl:versioned-element-type',
                    attrs: {
                        'select': 'xsl:expression',
                        'copy-accumulators': 'xsl:yes-or-no',
                        'copy-namespaces': 'xsl:yes-or-no',
                        'type': 'xsl:EQName',
                        'validation': 'xsl:validation-type',
                        '_select': 'xs:string',
                        '_copy-accumulators': 'xs:string',
                        '_copy-namespaces': 'xs:string',
                        '_type': 'xs:string',
                        '_validation': 'xs:string'
                    }
                },
                "xsl:document": {
                    base: 'xsl:sequence-constructor',
                    attrs: {
                        'type': 'xsl:EQName',
                        'validation': 'xsl:validation-type',
                        '_type': 'xs:string',
                        '_validation': 'xs:string'
                    }
                },
                "xsl:element": {
                    base: 'xsl:sequence-constructor',
                    attrs: {
                        'name': 'xsl:avt',
                        'namespace': 'xsl:avt',
                        'inherit-namespaces': 'xsl:yes-or-no',
                        'use-attribute-sets': 'xsl:EQNames',
                        'type': 'xsl:EQName',
                        'validation': 'xsl:validation-type',
                        '_name': 'xs:string',
                        '_namespace': 'xs:string',
                        '_inherit-namespaces': 'xs:string',
                        '_use-attribute-sets': 'xs:string',
                        '_type': 'xs:string',
                        '_validation': 'xs:string'
                    }
                },
                "xsl:evaluate": {
                    base: 'xsl:element-only-versioned-element-type',
                    attrs: {
                        'xpath': 'xsl:expression',
                        'as': 'xsl:sequence-type',
                        'base-uri': 'xsl:avt',
                        'context-item': 'xsl:expression',
                        'namespace-context': 'xsl:expression',
                        'schema-aware': 'xsl:avt',
                        'with-params': 'xsl:expression',
                        '_xpath': 'xs:string',
                        '_as': 'xs:string',
                        '_base-uri': 'xs:string',
                        '_context-item': 'xs:string',
                        '_namespace-context': 'xs:string',
                        '_schema-aware': 'xs:string',
                        '_with-params': 'xs:string'
                    },
                    elementNames: ['xsl:with-param', 'xsl:fallback']
                },
                "xsl:fallback": { type: 'xsl:sequence-constructor'},
                "xsl:for-each": {
                    base: 'xsl:versioned-element-type',
                    attrs: {
                        'select': 'xsl:expression',
                        '_select': 'xs:string'
                    },
                    elementNames: ['xsl:sort', 'xsl:instruction']
                },
                "xsl:for-each-group": {
                    base: 'xsl:versioned-element-type',
                    attrs: {
                        'select': 'xsl:expression',
                        'group-by': 'xsl:expression',
                        'group-adjacent': 'xsl:expression',
                        'group-starting-with': 'xsl:pattern',
                        'group-ending-with': 'xsl:pattern',
                        'composite': 'xsl:yes-or-no',
                        'collation': 'xsl:avt',
                        '_select': 'xs:string',
                        '_group-by': 'xs:string',
                        '_group-adjacent': 'xs:string',
                        '_group-starting-with': 'xs:string',
                        '_group-ending-with': 'xs:string',
                        '_composite': 'xs:string',
                        '_collation': 'xs:string'
                    },
                    elementNames: ['xsl:sort', 'xsl:instruction']
                },
                "xsl:fork": {
                    base: 'xsl:versioned-element-type',
                    elementNames: ['xsl:fallback', 'xsl:sequence', 'xsl:fallback', 'xsl:for-each-group', 'xsl:fallback']
                },
                "xsl:if": {
                    base: 'xsl:sequence-constructor',
                    attrs: {
                        'test': 'xsl:expression',
                        '_test': 'xs:string'
                    }
                },
                "xsl:iterate": {
                    base: 'xsl:versioned-element-type',
                    attrs: {
                        'select': 'xsl:expression',
                        '_select': 'xs:string'
                    },
                    elementNames: ['xsl:param', 'xsl:on-completion', 'xsl:instruction']
                },
                "xsl:map": { type: 'xsl:sequence-constructor' },
                "xsl:map-entry": {
                    base: 'xsl:sequence-constructor-and-select',
                    attrs: {
                        'key': 'xsl:expression',
                        '_key': 'xs:string'
                    }
                },
                "xsl:merge": {
                    base: 'xsl:element-only-versioned-element-type',
                    elementNames: ['xsl:merge-source', 'xsl:merge-action', 'xsl:fallback']
                },
                "xsl:merge-key": {
                    base: 'xsl:versioned-element-type',
                    attrs: {
                        'select': 'xsl:expression',
                        'lang': 'xsl:avt',
                        'order': 'xsl:avt',
                        'collation': 'xs:anyURI',
                        'case-order': 'xsl:avt',
                        'data-type': 'xsl:avt',
                        '_select': 'xs:string',
                        '_lang': 'xs:string',
                        '_order': 'xs:string',
                        '_collation': 'xs:string',
                        '_case-order': 'xs:string',
                        '_data-type': 'xs:string'
                    },
                    elementNames: ['xsl:instruction']
                },
                "xsl:message": {
                    base: 'xsl:sequence-constructor',
                    attrs: {
                        'select': 'xsl:expression',
                        'terminate': 'xsl:avt',
                        'error-code': 'xsl:avt',
                        '_select': 'xs:string',
                        '_terminate': 'xs:string',
                        '_error-code': 'xs:string'
                    }
                },
                "xsl:next-iteration": {
                    base: 'xsl:element-only-versioned-element-type',
                    elementNames: ['xsl:with-param']
                },
                "xsl:namespace": {
                    base: 'xsl:sequence-constructor-or-select',
                    attrs: {
                        'name': 'xsl:avt',
                        '_name': 'xs:string'
                    }
                },
                "xsl:next-match": {
                    base: 'xsl:element-only-versioned-element-type',
                    elementNames: ['xsl:with-param', 'xsl:fallback']
                },
                "xsl:number": {
                    base: 'xsl:versioned-element-type',
                    attrs: {
                        'value': 'xsl:expression',
                        'select': 'xsl:expression',
                        'level': 'xsl:level',
                        'count': 'xsl:pattern',
                        'from': 'xsl:pattern',
                        'format': 'xsl:avt',
                        'lang': 'xsl:avt',
                        'letter-value': 'xsl:avt',
                        'ordinal': 'xsl:avt',
                        'start-at': 'xsl:avt',
                        'grouping-separator': 'xsl:avt',
                        'grouping-size': 'xsl:avt',
                        '_value': 'xs:string',
                        '_select': 'xs:string',
                        '_level': 'xs:string',
                        '_count': 'xs:string',
                        '_from': 'xs:string',
                        '_format': 'xs:string',
                        '_lang': 'xs:string',
                        '_letter-value': 'xs:string',
                        '_ordinal': 'xs:string',
                        '_start-at': 'xs:string',
                        '_grouping-separator': 'xs:string',
                        '_grouping-size': 'xs:string'
                    }
                },
                "xsl:on-empty": { type: 'xsl:sequence-constructor-or-select' },
                "xsl:on-non-empty": { type: 'xsl:sequence-constructor-or-select' },
                "xsl:perform-sort": {
                    base: 'xsl:versioned-element-type',
                    attrs: {
                        'select': 'xsl:expression'
                    },
                    elementNames: ['xsl:sort', 'xsl:instruction']
                },
                "xsl:processing-instruction": {
                    base: 'xsl:sequence-constructor-or-select',
                    attrs: {
                        'name': 'xsl:avt',
                        '_name': 'xs:string'
                    }
                },
                "xsl:result-document": {
                    base: 'xsl:sequence-constructor',
                    attrs: {
                        'format': 'xsl:avt',
                        'href': 'xsl:avt',
                        'type': 'xsl:EQName',
                        'validation': 'xsl:validation-type',
                        'method': 'xsl:avt',
                        'allow-duplicate-names': 'xsl:avt',
                        'build-tree': 'xsl:avt',
                        'byte-order-mark': 'xsl:avt',
                        'cdata-section-elements': 'xsl:avt',
                        'doctype-public': 'xsl:avt',
                        'doctype-system': 'xsl:avt',
                        'encoding': 'xsl:avt',
                        'escape-uri-attributes': 'xsl:avt',
                        'html-version': 'xsl:avt',
                        'include-content-type': 'xsl:avt',
                        'indent': 'xsl:avt',
                        'item-separator': 'xsl:avt',
                        'json-node-output-method': 'xsl:avt',
                        'media-type': 'xsl:avt',
                        'normalization-form': 'xsl:avt',
                        'omit-xml-declaration': 'xsl:avt',
                        'parameter-document': 'xsl:avt',
                        'standalone': 'xsl:avt',
                        'suppress-indentation': 'xsl:avt',
                        'undeclare-prefixes': 'xsl:avt',
                        'use-character-maps': 'xsl:EQNames',
                        'output-version': 'xsl:avt',
                        '_format': 'xs:string',
                        '_href': 'xs:string',
                        '_type': 'xs:string',
                        '_validation': 'xs:string',
                        '_method': 'xs:string',
                        '_byte-order-mark': 'xs:string',
                        '_cdata-section-elements': 'xs:string',
                        '_doctype-public': 'xs:string',
                        '_doctype-system': 'xs:string',
                        '_encoding': 'xs:string',
                        '_escape-uri-attributes': 'xs:string',
                        '_html-version': 'xs:string',
                        '_include-content-type': 'xs:string',
                        '_indent': 'xs:string',
                        '_item-separator': 'xs:string',
                        '_media-type': 'xs:string',
                        '_normalization-form': 'xs:string',
                        '_omit-xml-declaration': 'xs:string',
                        '_parameter-document': 'xs:string',
                        '_standalone': 'xs:string',
                        '_suppress-indentation': 'xs:string',
                        '_undeclare-prefixes': 'xs:string',
                        '_use-character-maps': 'xs:string',
                        '_output-version': 'xs:string'
                    }
                },
                "xsl:sequence": { type: 'xsl:sequence-constructor-or-select' },
                "xsl:source-document": {
                    base: 'xsl:sequence-constructor',
                    attrs: {
                        'href': 'xsl:avt',
                        'streamable': 'xsl:yes-or-no',
                        'use-accumulators': 'xsl:accumulator-names',
                        'type': 'xsl:EQName',
                        'validation': 'xsl:validation-type',
                        '_href': 'xs:string',
                        '_streamable': 'xs:string',
                        '_use-accumulators': 'xs:string',
                        '_type': 'xs:string',
                        '_validation': 'xs:string'
                    }
                },
                "xsl:text": { type: 'xsl:text-element-type' },
                "xsl:try": {
                    base: 'xsl:versioned-element-type',
                    attrs: {
                        'rollback-output': 'xsl:yes-or-no',
                        'select': 'xsl:expression',
                        '_rollback-output': 'xs:string',
                        '_select': 'xs:string'
                    },
                    elementNames: ['xsl:catch', 'xsl:catch', 'xsl:fallback', 'xsl:instruction']
                },
                "xsl:value-of": {
                    base: 'xsl:sequence-constructor-or-select',
                    attrs: {
                        'separator': 'xsl:avt',
                        'disable-output-escaping': 'xsl:yes-or-no',
                        '_separator': 'xs:string',
                        '_disable-output-escaping': 'xs:string'
                    }
                },
                "xsl:variable": {
                    base: "xsl:sequence-constructor-or-select",
                    attrs: {
                        'name': 'xsl:EQName',
                        'as': 'xsl:sequence-type',
                        'visibility': 'xsl:visibility-type',
                        'static': 'xsl:yes-or-no',
                        '_name': 'xs:string',
                        '_as': 'xs:string',
                        '_visibility': 'xs:string',
                        '_static': 'xs:string',
                    }
                },
                "xsl:where-populated": { type: 'xsl:sequence-constructor' },
            }

        },
        declaration: {
            type: 'versioned-element-type',
            elements: {
                "xsl:accumulator": {
                    base: 'xsl:element-only-versioned-element-type',
                    attrs: {
                        'name': 'xsl:EQName',
                        'initial-value': 'xsl:expression',
                        'as': 'xsl:sequence-type',
                        'streamable': 'xsl:yes-or-no',
                        '_name': 'xs:string',
                        '_initial-value': 'xs:string',
                        '_as': 'xs:string',
                        '_streamable': 'xs:string'
                    },
                    elementNames: ['xsl:accumulator-rule']
                },
                "xsl:attribute-set": {
                    base: 'xsl:element-only-versioned-element-type',
                    attrs: {
                        'name': 'xsl:EQName',
                        'streamable': 'xsl:yes-or-no',
                        'use-attribute-sets': 'xsl:EQNames',
                        'visibility': 'xsl:visibility-type',
                        '_name': 'xs:string',
                        '_streamable': 'xs:string',
                        '_use-attribute-sets': 'xs:string',
                        '_visibility': 'xs:string'
                    },
                    elementNames: ['xsl:attribute']
                },
                "xsl:character-map": {
                    base: 'xsl:element-only-versioned-element-type',
                    attrs: {
                        'name': 'xsl:EQName',
                        'use-character-maps': 'xsl:EQNames',
                        '_name': 'xs:string',
                        '_use-character-maps': 'xs:string'
                    },
                    elementNames: ['xsl:output-character']
                },
                "xsl:decimal-format": {
                    base: 'xsl:element-only-versioned-element-type',
                    attrs: {
                        'name': 'xsl:EQName',
                        'decimal-separator': 'xsl:char',
                        'grouping-separator': 'xsl:char',
                        'infinity': 'xs:string',
                        'minus-sign': 'xsl:char',
                        'exponent-separator': 'xsl:char',
                        'NaN': 'xs:string',
                        'percent': 'xsl:char',
                        'per-mille': 'xsl:char',
                        'zero-digit': 'xsl:zero-digit',
                        'digit': 'xsl:char',
                        'pattern-separator': 'xsl:char',
                        '_name': 'xs:string',
                        '_decimal-separator': 'xs:string',
                        '_grouping-separator': 'xs:string',
                        '_infinity': 'xs:string',
                        '_minus-sign': 'xs:string',
                        '_exponent-separator': 'xs:string',
                        '_NaN': 'xs:string',
                        '_percent': 'xs:string',
                        '_per-mille': 'xs:string',
                        '_zero-digit': 'xs:string',
                        '_digit': 'xs:string',
                        '_pattern-separator': 'xs:string'
                    }
                },
                "xsl:function": {
                    base: 'xsl:versioned-element-type',
                    attrs: {
                        'name': 'xsl:EQName-in-namespace',
                        'override': 'xsl:yes-or-no',
                        'as': 'xsl:sequence-type',
                        'visibility': 'xsl:visibility-type',
                        'streamability': 'xsl:streamability-type',
                        'override-extension-function': 'xsl:yes-or-no',
                        'new-each-time': 'xsl:yes-or-no-or-maybe',
                        'cache': 'xsl:yes-or-no',
                        '_name': 'xs:string',
                        '_override': 'xs:string',
                        '_as': 'xs:string',
                        '_visibility': 'xs:string',
                        '_streamability': 'xs:string',
                        '_override-extension-function': 'xs:string',
                        '_identity-sensitive': 'xs:string',
                        '_cache': 'xs:string'
                    },
                    elementNames: ['xsl:param', 'xsl:instruction']
                },
                "xsl:global-context-item": {
                    base: 'xsl:element-only-versioned-element-type',
                    attrs: {
                        'as': 'xsl:item-type',
                        '_as': 'xs:string',
                        '_use': 'xs:string'
                    },
                    attributeList: [{ name: 'use', enum: ['required', 'optional', 'absent'] },
                    ]
                },
                "xsl:import": {
                    base: 'xsl:element-only-versioned-element-type',
                    attrs: {
                        'href': 'xs:anyURI',
                        '_href': 'xs:string'
                    }
                },
                "xsl:import-schema": {
                    base: 'xsl:element-only-versioned-element-type',
                    attrs: {
                        'namespace': 'xs:anyURI',
                        'schema-location': 'xs:anyURI',
                        '_namespace': 'xs:string',
                        '_schema-location': 'xs:string'
                    },
                    elementNames: ['xs:schema']
                },
                "xsl:include": {
                    base: 'xsl:element-only-versioned-element-type',
                    attrs: {
                        'href': 'xs:anyURI',
                        '_href': 'xs:string'
                    }
                },
                "xsl:key": {
                    base: 'xsl:sequence-constructor',
                    attrs: {
                        'name': 'xsl:EQName',
                        'match': 'xsl:pattern',
                        'use': 'xsl:expression',
                        'composite': 'xsl:yes-or-no',
                        'collation': 'xs:anyURI',
                        '_name': 'xs:string',
                        '_match': 'xs:string',
                        '_use': 'xs:string',
                        '_composite': 'xs:string',
                        '_collation': 'xs:string'
                    }
                },
                "xsl:mode": {
                    base: 'xsl:element-only-versioned-element-type',
                    attrs: {
                        'name': 'xsl:EQName',
                        'streamable': 'xsl:yes-or-no',
                        'use-accumulators': 'xsl:accumulator-names',
                        'on-no-match': 'xsl:on-no-match-type',
                        'on-multiple-match': 'xsl:on-multiple-match-type',
                        'warning-on-no-match': 'xsl:yes-or-no',
                        'warning-on-multiple-match': 'xsl:yes-or-no',
                        'typed': 'xsl:typed-type',
                        '_name': 'xs:string',
                        '_streamable': 'xs:string',
                        '_on-no-match': 'xs:string',
                        '_on-multiple-match': 'xs:string',
                        '_warning-on-no-match': 'xs:string',
                        '_warning-on-multiple-match': 'xs:string',
                        '_typed': 'xs:string',
                        '_visibility': 'xs:string'
                    },
                    attributeList: [{ name: 'visibility', enum: ['public', 'private', 'final'] },
                    ]
                },
                "xsl:namespace-alias": {
                    base: 'xsl:element-only-versioned-element-type',
                    attrs: {
                        'stylesheet-prefix': 'xsl:prefix-or-default',
                        'result-prefix': 'xsl:prefix-or-default',
                        '_stylesheet-prefix': 'xs:string',
                        '_result-prefix': 'xs:string'
                    }
                },
                "xsl:output": {
                    base: 'xsl:generic-element-type',
                    attrs: {
                        'name': 'xsl:EQName',
                        'method': 'xsl:method',
                        'allow-duplicate-names': 'xsl:yes-or-no',
                        'build-tree': 'xsl:yes-or-no',
                        'byte-order-mark': 'xsl:yes-or-no',
                        'cdata-section-elements': 'xsl:EQNames',
                        'doctype-public': 'xs:string',
                        'doctype-system': 'xs:string',
                        'encoding': 'xs:string',
                        'escape-uri-attributes': 'xsl:yes-or-no',
                        'html-version': 'xs:decimal',
                        'include-content-type': 'xsl:yes-or-no',
                        'indent': 'xsl:yes-or-no',
                        'item-separator': 'xs:string',
                        'json-node-output-method': 'xsl:method',
                        'media-type': 'xs:string',
                        'normalization-form': 'xs:NMTOKEN',
                        'omit-xml-declaration': 'xsl:yes-or-no',
                        'parameter-document': 'xs:anyURI',
                        'standalone': 'xsl:yes-or-no-or-omit',
                        'suppress-indentation': 'xsl:EQNames',
                        'undeclare-prefixes': 'xsl:yes-or-no',
                        'use-character-maps': 'xsl:EQNames',
                        'version': 'xs:NMTOKEN',
                        '_name': 'xs:string',
                        '_method': 'xs:string',
                        '_byte-order-mark': 'xs:string',
                        '_cdata-section-elements': 'xs:string',
                        '_doctype-public': 'xs:string',
                        '_doctype-system': 'xs:string',
                        '_encoding': 'xs:string',
                        '_escape-uri-attributes': 'xs:string',
                        '_html-version': 'xs:string',
                        '_include-content-type': 'xs:string',
                        '_indent': 'xs:string',
                        '_item-separator': 'xs:string',
                        '_media-type': 'xs:string',
                        '_normalization-form': 'xs:string',
                        '_omit-xml-declaration': 'xs:string',
                        '_parameter-document': 'xs:string',
                        '_standalone': 'xs:string',
                        '_suppress-indentation': 'xs:string',
                        '_undeclare-prefixes': 'xs:string',
                        '_use-character-maps': 'xs:string',
                        '_version': 'xs:string'
                    }
                },
                "xsl:param": {
                    base: 'xsl:sequence-constructor-or-select',
                    attrs: {
                        'name': 'xsl:EQName',
                        'as': 'xsl:sequence-type',
                        'required': 'xsl:yes-or-no',
                        'tunnel': 'xsl:yes-or-no',
                        'static': 'xsl:yes-or-no',
                        '_name': 'xs:string',
                        '_as': 'xs:string',
                        '_required': 'xs:string',
                        '_tunnel': 'xs:string',
                        '_static': 'xs:string'
                    }
                },
                "xsl:preserve-space": {
                    base: 'xsl:element-only-versioned-element-type',
                    attrs: {
                        'elements': 'xsl:nametests',
                        '_elements': 'xs:string'
                    }
                },
                "xsl:strip-space": {
                    base: 'xsl:element-only-versioned-element-type',
                    attrs: {
                        'elements': 'xsl:nametests',
                        '_elements': 'xs:string'
                    }
                },
                "xsl:template": {
                    base: 'xsl:versioned-element-type',
                    attrs: {
                        'match': 'xsl:pattern',
                        'priority': 'xs:decimal',
                        'mode': 'xsl:modes',
                        'name': 'xsl:EQName',
                        'as': 'xsl:sequence-type',
                        'visibility': 'xsl:visibility-type',
                        '_match': 'xs:string',
                        '_priority': 'xs:string',
                        '_mode': 'xs:string',
                        '_name': 'xs:string',
                        '_as': 'xs:string',
                        '_visibility': 'xs:string'
                    },
                    elementNames: ['xsl:context-item', 'xsl:param', 'xsl:instruction']
                },
                "xsl:use-package": {
                    base: 'xsl:element-only-versioned-element-type',
                    attrs: {
                        'name': 'xs:anyURI',
                        'package-version': 'xs:string',
                        '_name': 'xs:string',
                        '_package-version': 'xs:string'
                    },
                    elementNames: ['xsl:accept', 'xsl:override']
                },
                "xsl:variable": {
                    base: "xsl:sequence-constructor-or-select",
                    attrs: {
                        'name': 'xsl:EQName',
                        'as': 'xsl:sequence-type',
                        'visibility': 'xsl:visibility-type',
                        'static': 'xsl:yes-or-no',
                        '_name': 'xs:string',
                        '_as': 'xs:string',
                        '_visibility': 'xs:string',
                        '_static': 'xs:string',
                    }
                },
            }

        }
    }
    elements: {[name: string]: ComplexType} = {
        "xsl:accept": {
            base: 'xsl:element-only-versioned-element-type',
            attrs: {
                'component': 'xsl:component-kind-type',
                'names': 'xsl:EQNames',
                'visibility': 'xsl:visibility-type',
                '_component': 'xs:string',
                '_names': 'xs:string',
                '_visibility': 'xs:string'
            }
        },
        "xsl:accumulator-rule": {
            base: 'xsl:sequence-constructor-or-select',
            attrs: {
                'match': 'xsl:pattern',
                '_match': 'xs:string',
                '_phase': 'xs:string'
            },
            attributeList: [{ name: 'phase', enum: ['start', 'end'] },
            ]
        },
        "xsl:catch": {
            base: 'xsl:sequence-constructor-or-select',
            attrs: {
                'errors': 'xs:token',
                '_errors': 'xs:string'
            }
        },
        "xsl:context-item": {
            base: 'xsl:element-only-versioned-element-type',
            attrs: {
                'as': 'xsl:item-type',
                '_as': 'xs:string',
                '_use': 'xs:string'
            },
            attributeList: [{ name: 'use', enum: ['required', 'optional', 'absent'] },
            ]
        },
        "xsl:expose": {
            base: 'xsl:element-only-versioned-element-type',
            attrs: {
                'component': 'xsl:component-kind-type',
                'names': 'xsl:EQNames',
                'visibility': 'xsl:visibility-not-hidden-type',
                '_component': 'xs:string',
                '_names': 'xs:string',
                '_visibility': 'xs:string'
            }
        },
        "xsl:matching-substring": { type: 'xsl:sequence-constructor' },
        "xsl:merge-action": { type: 'xsl:sequence-constructor' },
        "xsl:merge-source": {
            base: 'xsl:element-only-versioned-element-type',
            attrs: {
                'name': 'xs:NCName',
                'for-each-item': 'xsl:expression',
                'for-each-source': 'xsl:expression',
                'select': 'xsl:expression',
                'streamable': 'xsl:yes-or-no',
                'use-accumulators': 'xsl:accumulator-names',
                'sort-before-merge': 'xsl:yes-or-no',
                'type': 'xsl:EQName',
                'validation': 'xsl:validation-type',
                '_name': 'xs:string',
                '_for-each-item': 'xs:string',
                '_for-each-source': 'xs:string',
                '_select': 'xs:string',
                '_streamable': 'xs:string',
                '_use-accumulators': 'xs:string',
                '_sort-before-merge': 'xs:string',
                '_type': 'xs:string',
                '_validation': 'xs:string'
            },
            elementNames: ['xsl:merge-key']
        },
        "xsl:non-matching-substring": { type: 'xsl:sequence-constructor' },
        "xsl:on-completion": { type: 'xsl:sequence-constructor-or-select' },
        "xsl:otherwise": { type: 'xsl:sequence-constructor' },
        "xsl:output-character": {
            base: 'xsl:element-only-versioned-element-type',
            attrs: {
                'character': 'xsl:char',
                'string': 'xs:string',
                '_character': 'xs:string',
                '_string': 'xs:string'
            }
        },
        "xsl:override": {
            base: 'xsl:element-only-versioned-element-type',
            elementNames: ['xsl:template', 'xsl:function', 'xsl:variable', 'xsl:param', 'xsl:attribute-set']
        },
        "xsl:package": {
            base: 'xsl:element-only-versioned-element-type',
            attrs: {
                'declared-modes': 'xsl:yes-or-no',
                'id': 'xs:ID',
                'name': 'xs:anyURI',
                'package-version': 'xs:string',
                'input-type-annotations': 'xsl:input-type-annotations-type',
                '_declared-modes': 'xs:string',
                '_id': 'xs:string',
                '_name': 'xs:string',
                '_package-version': 'xs:string',
                '_input-type-annotations': 'xs:string'
            },
            elementNames: ['xsl:expose', 'xsl:declaration']
        },
        "xsl:sort": {
            base: 'xsl:sequence-constructor-or-select',
            attrs: {
                'lang': 'xsl:avt',
                'data-type': 'xsl:avt',
                'order': 'xsl:avt',
                'case-order': 'xsl:avt',
                'collation': 'xsl:avt',
                'stable': 'xsl:avt',
                '_lang': 'xs:string',
                '_data-type': 'xs:string',
                '_order': 'xs:string',
                '_case-order': 'xs:string',
                '_collation': 'xs:string',
                '_stable': 'xs:string'
            }
        },
        "xsl:transform": {
            base: 'xsl:transform-element-base-type',
            attrs: {
                'id': 'xs:ID',
                'input-type-annotations': 'xsl:input-type-annotations-type',
                '_id': 'xs:string',
                '_input-type-annotations': 'xs:string'
            },
            elementNames: ['xsl:declaration']
        },
        "xsl:when": {
            base: 'xsl:sequence-constructor',
            attrs: {
                'test': 'xsl:expression',
                '_test': 'xs:string'
            }
        },
        "xsl:with-param": {
            base: 'xsl:sequence-constructor-or-select',
            attrs: {
                'name': 'xsl:EQName',
                'as': 'xsl:sequence-type',
                'tunnel': 'xsl:yes-or-no',
                '_name': 'xs:string',
                '_as': 'xs:string',
                '_tunnel': 'xs:string'
            }
        },
    }
}