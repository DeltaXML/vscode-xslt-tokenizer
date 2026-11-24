
/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */

/*
 ISO Schematron (ISO/IEC 19757-3:2025, the 4th edition), as SchXslt2 implements it - the Schematron processor bundled
 with XSpec (xslt-resources/xspec/lib/schxslt2/transpile.xsl). Maintained by hand: the standard's schema is RELAX NG.

 Elements are keyed with the prefix sch:, whatever prefix - or none - a file uses for the Schematron namespace.

 XSLT elements: SchXslt2 copies only these XSLT declarations of sch:schema into the validation stylesheet - any other
 XSLT element is ignored (e.g. xsl:param, xsl:variable or xsl:template) - and within sch:property, xsl:copy-of. XSLT
 elements elsewhere, e.g. xsl:value-of in an assertion's message, are not run: they're copied into the report as they are.
*/

import { SchemaData, ComplexType, SimpleType } from './xsltSchema';
import { DocumentTypes } from './xslLexer';

export interface SubstitutionGroupType {
    type: string;
    elements: { [name: string]: ComplexType };
}

export interface AttributeItem {
    name: string;
    enum?: string[];
}

// the XSLT declarations SchXslt2 copies from sch:schema into the validation stylesheet
export const SCHXSLT2_XSLT_DECLARATIONS = ['xsl:accumulator', 'xsl:function', 'xsl:include', 'xsl:import', 'xsl:import-schema', 'xsl:key', 'xsl:use-package'];

// the content of an assertion's or report's message, and of a diagnostic or property
const messageContent = ['sch:name', 'sch:value-of', 'sch:emph', 'sch:dir', 'sch:span'];
// the attributes that some elements share: rich (icon, see, fpi, xml:lang, xml:space) and linkable (role, subject)
const rich = { 'icon': 'sch:URI', 'see': 'sch:URI', 'fpi': 'sch:FPI', 'xml:lang': '', 'xml:space': 'SPACE' };
const linkable = { 'role': 'xs:NMTOKEN', 'subject': 'sch:PATH' };

export class SchSchema implements SchemaData {
    docType = DocumentTypes.SCH;
    simpleTypes: { [name: string]: SimpleType } = {
        "URI": { base: ['xs:string'] },
        "PATH": { base: ['xs:string'] },
        "EXPR": { base: ['xs:string'] },
        "FPI": { base: ['xs:string'] },
        // SchXslt2 transpiles to XSLT 3.0 whatever the query binding is - others, e.g. xslt4 or xquery31, are allowed
        "QB": {
            base: ['xs:string'], enum: ['xslt3', 'xslt2'], open: true,
            detail: { 'xslt3': 'XSLT 3.0 and XPath 3.1', 'xslt2': 'XSLT 2.0 and XPath 2.0 - run as XSLT 3.0 by SchXslt2' }
        },
        // SchXslt2 also allows a variable reference, e.g. $level, an expression in braces, or another value - as fatal
        "SEVERITY": {
            base: ['xs:string'], enum: ['info', 'warning', 'error', 'fatal'], open: true,
            detail: { 'info': 'information', 'warning': 'a warning', 'error': 'an error', 'fatal': 'a fatal error - the default' }
        },
        "SPACE": { base: ['xs:string'], enum: ['default', 'preserve'] },
        "DIR": { base: ['xs:string'], enum: ['ltr', 'rtl'] },
        "BOOLEAN": { base: ['xs:string'], enum: ['true', 'false'] },
        "EDITION": { base: ['xs:string'], enum: ['2025', '2020', '2016'] }
    };
    complexTypes: { [name: string]: ComplexType } = {};
    elements: { [name: string]: ComplexType } = {
        "sch:schema": {
            elementNames: ['sch:title', 'sch:ns', 'sch:p', 'sch:include', 'sch:extends', 'sch:param', 'sch:let', 'sch:phase', 'sch:pattern', 'sch:group',
                'sch:rules', 'sch:diagnostics', 'sch:properties', ...SCHXSLT2_XSLT_DECLARATIONS],
            attributeGroup: 'sch:attlist.schema',
            detail: 'The schema: its namespaces, variables, phases and patterns'
        },
        "sch:library": {
            elementNames: ['sch:title', 'sch:ns', 'sch:p', 'sch:include', 'sch:extends', 'sch:let', 'sch:phase', 'sch:pattern', 'sch:group',
                'sch:rules', 'sch:diagnostics', 'sch:properties'],
            attributeGroup: 'sch:attlist.library',
            detail: 'A library of patterns, rules, diagnostics and properties for schemas to extend - SchXslt2 doesn\'t validate with a library on its own'
        },
        "sch:title": {
            elementNames: ['sch:dir'],
            detail: 'The title of the schema, a pattern or a group'
        },
        "sch:ns": {
            attributeGroup: 'sch:attlist.ns',
            detail: 'A namespace prefix for the schema\'s XPath expressions - the only prefixes declared in the validation stylesheet'
        },
        "sch:p": {
            elementNames: ['sch:dir', 'sch:emph', 'sch:span'],
            attributeGroup: 'sch:attlist.p',
            detail: 'A paragraph of documentation'
        },
        "sch:include": {
            attributeGroup: 'sch:attlist.include',
            detail: 'Replaced by the element in another file'
        },
        "sch:extends": {
            attributeGroup: 'sch:attlist.extends',
            detail: 'In a rule: the content of an abstract rule (rule), or of the rules in a file (href) - in a schema or library: the content of a library (href)'
        },
        "sch:param": {
            attributeGroup: 'sch:attlist.param',
            detail: 'In a schema: a parameter of the validation, whose value can be set when it\'s run - in a pattern with is-a: a value for a parameter of the abstract pattern'
        },
        "sch:let": {
            elementNames: [],
            attributeGroup: 'sch:attlist.let',
            detail: 'A variable: in the schema, a phase, a pattern or a rule - with a value attribute, or content'
        },
        "sch:phase": {
            elementNames: ['sch:p', 'sch:let', 'sch:active'],
            attributeGroup: 'sch:attlist.phase',
            detail: 'A phase: the patterns and groups that are active when it\'s chosen'
        },
        "sch:active": {
            elementNames: ['sch:dir', 'sch:emph', 'sch:span'],
            attributeGroup: 'sch:attlist.active',
            detail: 'A pattern or group that\'s active in the phase'
        },
        "sch:pattern": {
            elementNames: ['sch:title', 'sch:p', 'sch:let', 'sch:rule', 'sch:param', 'sch:include'],
            attributeGroup: 'sch:attlist.pattern',
            detail: 'A pattern: its rules - for each node, the first rule whose context matches it is used'
        },
        "sch:group": {
            elementNames: ['sch:title', 'sch:p', 'sch:let', 'sch:rule', 'sch:param', 'sch:include'],
            attributeGroup: 'sch:attlist.pattern',
            detail: 'A group of rules: unlike a pattern\'s, every rule whose context matches a node is used'
        },
        "sch:rules": {
            elementNames: ['sch:rule', 'sch:include'],
            detail: 'Abstract rules, for rules to extend'
        },
        "sch:rule": {
            elementNames: ['sch:let', 'sch:assert', 'sch:report', 'sch:extends', 'sch:p', 'sch:include'],
            attributeGroup: 'sch:attlist.rule',
            detail: 'A rule: the assertions and reports for each node its context matches'
        },
        "sch:assert": {
            elementNames: messageContent,
            attributeGroup: 'sch:attlist.assert',
            detail: 'An assertion: its message is reported when its test is false'
        },
        "sch:report": {
            elementNames: messageContent,
            attributeGroup: 'sch:attlist.report',
            detail: 'A report: its message is reported when its test is true'
        },
        "sch:name": {
            attributeGroup: 'sch:attlist.name',
            detail: 'In a message: the name of the context node - or of the node its path selects'
        },
        "sch:value-of": {
            attributeGroup: 'sch:attlist.value-of',
            detail: 'In a message: the value of an XPath expression - xsl:value-of isn\'t run by SchXslt2'
        },
        "sch:emph": {
            type: 'xs:string',
            detail: 'Emphasised text'
        },
        "sch:dir": {
            attributeGroup: 'sch:attlist.dir',
            detail: 'Text in a direction, left-to-right or right-to-left'
        },
        "sch:span": {
            attributeGroup: 'sch:attlist.span',
            detail: 'Text with a class'
        },
        "sch:diagnostics": {
            elementNames: ['sch:diagnostic', 'sch:include'],
            detail: 'The diagnostics that assertions and reports refer to'
        },
        "sch:diagnostic": {
            elementNames: ['sch:value-of', 'sch:emph', 'sch:dir', 'sch:span'],
            attributeGroup: 'sch:attlist.diagnostic',
            detail: 'More information for an assertion or report that refers to it in its diagnostics attribute'
        },
        "sch:properties": {
            elementNames: ['sch:property', 'sch:include'],
            detail: 'The properties that assertions and reports refer to'
        },
        "sch:property": {
            elementNames: [...messageContent, 'xsl:copy-of'],
            attributeGroup: 'sch:attlist.property',
            detail: 'A property reported with an assertion or report that refers to it in its properties attribute'
        },
    };
    attributeGroups: { [name: string]: any } = {
        "sch:attlist.schema": {
            attrs: {
                'id': 'xs:ID',
                ...rich,
                'schemaVersion': '',
                'defaultPhase': 'xs:IDREF',
                'queryBinding': 'QB',
                'schematronEdition': 'EDITION',
                'xsi:schemaLocation': ''
            }
        },
        "sch:attlist.library": {
            attrs: {
                'id': 'xs:ID',
                ...rich,
                'schemaVersion': '',
                'queryBinding': 'QB',
                'schematronEdition': 'EDITION'
            }
        },
        "sch:attlist.ns": {
            attrs: {
                'prefix': 'xs:NCName',
                'uri': 'sch:URI'
            }
        },
        "sch:attlist.p": {
            attrs: {
                'id': 'xs:ID',
                'class': '',
                'icon': 'sch:URI',
                'xml:lang': '',
                'xml:space': 'SPACE'
            }
        },
        "sch:attlist.include": {
            attrs: {
                'href': 'sch:URI'
            }
        },
        "sch:attlist.extends": {
            attrs: {
                'rule': 'xs:IDREF',
                'href': 'sch:URI'
            }
        },
        "sch:attlist.param": {
            attrs: {
                'name': 'xs:NCName',
                'value': 'sch:EXPR',
                'as': ''
            }
        },
        "sch:attlist.let": {
            attrs: {
                'name': 'xs:NCName',
                'value': 'sch:EXPR',
                'as': ''
            }
        },
        "sch:attlist.phase": {
            attrs: {
                'id': 'xs:ID',
                ...rich,
                'from': 'sch:EXPR',
                'when': 'sch:EXPR'
            }
        },
        "sch:attlist.active": {
            attrs: {
                'pattern': 'xs:IDREF'
            }
        },
        "sch:attlist.pattern": {
            attrs: {
                'id': 'xs:ID',
                ...rich,
                'abstract': 'BOOLEAN',
                'is-a': 'xs:IDREF',
                'documents': 'sch:EXPR'
            }
        },
        "sch:attlist.rule": {
            attrs: {
                'id': 'xs:ID',
                'context': 'sch:PATH',
                'abstract': 'BOOLEAN',
                'visit-each': 'sch:EXPR',
                'flag': '',
                ...rich,
                ...linkable
            }
        },
        "sch:attlist.assert": {
            attrs: {
                'test': 'sch:EXPR',
                'id': 'xs:ID',
                'severity': 'SEVERITY',
                'diagnostics': 'xs:IDREFS',
                'properties': 'xs:IDREFS',
                'flag': '',
                ...rich,
                ...linkable
            }
        },
        "sch:attlist.report": {
            attrs: {
                'test': 'sch:EXPR',
                'id': 'xs:ID',
                'severity': 'SEVERITY',
                'diagnostics': 'xs:IDREFS',
                'properties': 'xs:IDREFS',
                'flag': '',
                ...rich,
                ...linkable
            }
        },
        "sch:attlist.name": {
            attrs: {
                'path': 'sch:PATH'
            }
        },
        "sch:attlist.value-of": {
            attrs: {
                'select': 'sch:PATH'
            }
        },
        "sch:attlist.dir": {
            attrs: {
                'value': 'DIR'
            }
        },
        "sch:attlist.span": {
            attrs: {
                'class': ''
            }
        },
        "sch:attlist.diagnostic": {
            attrs: {
                'id': 'xs:ID',
                ...rich
            }
        },
        "sch:attlist.property": {
            attrs: {
                'id': 'xs:ID',
                'role': 'xs:NMTOKEN',
                'scheme': ''
            }
        }
    };
}
