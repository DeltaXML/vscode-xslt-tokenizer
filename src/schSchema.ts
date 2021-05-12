
/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */

/*
 NOTE: this code was auto-generated using .resources/xsd-to-typescript
*/

import { SchemaData, ComplexType, SimpleType } from './xsltSchema'
import { DocumentTypes } from './xslLexer';

export interface SubstitutionGroupType {
    type: string,
    elements: { [name: string]: ComplexType }
}

export interface AttributeItem {
    name: string,
    enum?: string[];
}
export class SchSchema implements SchemaData {
    docType = DocumentTypes.SCH;
    simpleTypes: { [name: string]: SimpleType } = {
        "URI": { base: ['xs:string'] },
        "PATH": { base: ['xs:string'] },
        "EXPR": { base: ['xs:string'] },
        "FPI": { base: ['xs:string'] },
        "QB": { base: ['xs:string'], enum: ['xslt3'] },
    }
    complexTypes: { [name: string]: ComplexType } = {}
    elements: { [name: string]: ComplexType } = {
        "sch:schema": {
            elementNames: ['sch:title', 'sch:ns', 'sch:p', 'sch:phase', 'sch:key', 'sch:pattern', 'sch:p', 'sch:diagnostics'],
            attributeGroup: 'sch:attlist.schema'
        },
        'sch:let': {
            elementNames: [],
            attributeGroup: 'sch:attlist.let'
        },
        "sch:active": {
            elementNames: ['sch:dir', 'sch:emph', 'sch:span'],
            attributeGroup: 'sch:attlist.active'
        },
        "sch:assert": {
            elementNames: ['sch:name', 'sch:emph', 'sch:dir', 'sch:span', 'sch:value-of'],
            attributeGroup: 'sch:attlist.assert'
        },
        "sch:dir": {
            attributeGroup: 'sch:attlist.dir'
        },
        "sch:emph": {
            type: 'xs:string'
        },
        "sch:extends": {
            attributeGroup: 'sch:attlist.extends'
        },
        "sch:diagnostic": {
            elementNames: ['sch:value-of', 'sch:emph', 'sch:dir', 'sch:span'],
            attributeGroup: 'sch:attlist.diagnostic'
        },
        "sch:diagnostics": {
            elementNames: ['sch:diagnostic']
        },
        "sch:key": {
            attributeGroup: 'sch:attlist.key'
        },
        "sch:name": {
            attributeGroup: 'sch:attlist.name'
        },
        "sch:ns": {
            attributeGroup: 'sch:attlist.ns'
        },
        "sch:p": {
            elementNames: ['sch:dir', 'sch:emph', 'sch:span'],
            attributeGroup: 'sch:attlist.p'
        },
        "sch:pattern": {
            elementNames: ['sch:p', 'sch:rule'],
            attributeGroup: 'sch:attlist.pattern'
        },
        "sch:phase": {
            elementNames: ['sch:p', 'sch:active'],
            attributeGroup: 'sch:attlist.phase'
        },
        "sch:report": {
            elementNames: ['sch:name', 'sch:emph', 'sch:dir', 'sch:span'],
            attributeGroup: 'sch:attlist.report'
        },
        "sch:rule": {
            elementNames: ['sch:assert', 'sch:report', 'sch:key', 'sch:extends', 'sch:let'],
            attributeGroup: 'sch:attlist.rule'
        },
        "sch:span": {
            attributeGroup: 'sch:attlist.span'
        },
        "sch:title": {
            elementNames: ['sch:dir']
        },
        "sch:value-of": {
            attributeGroup: 'sch:attlist.value-of'
        },
    }
    attributeGroups: { [name: string]: any } = {
        "sch:attlist.schema": {
            attrs: {
                'xsi:schemaLocation': '',
                'id': 'xs:ID',
                'fpi': 'sch:FPI',
                'ns': 'sch:FPI',
                'schemaVersion': '',
                'defaultPhase': 'xs:IDREF',
                'queryBinding': 'QB',
                'icon': 'sch:URI',
                'version': ''
            }
        },
        "sch:attlist.active": {
            attrs: {
                'pattern': 'xs:IDREF'
            }
        },
        "sch:attlist.assert": {
            attrs: {
                'test': 'sch:EXPR',
                'role': 'xs:NMTOKEN',
                'id': 'xs:ID',
                'diagnostics': 'xs:IDREFS',
                'icon': 'sch:URI',
                'subject': 'sch:PATH'
            }
        },
        "sch:attlist.dir": {
            attrs: {
                'value': ['ltr','rtl']
            }
        },
        "sch:attlist.extends": {
            attrs: {
                'rule': 'xs:IDREF'
            }
        },
        "sch:attlist.diagnostic": {
            attrs: {
                'id': 'xs:ID',
                'icon': 'sch:URI'
            }
        },
        "sch:attlist.key": {
            attrs: {
                'match': '',
                'name': 'xs:NMTOKEN',
                'path': 'sch:PATH',
                'icon': 'sch:URI'
            }
        },
        "sch:attlist.name": {
            attrs: {
                'path': 'sch:PATH'
            }
        },
        "sch:attlist.p": {
            attrs: {
                'id': 'xs:ID',
                'class': '',
                'icon': 'sch:URI'
            }
        },
        "sch:attlist.pattern": {
            attrs: {
                'name': '',
                'see': 'sch:URI',
                'id': 'xs:ID',
                'icon': 'sch:URI'
            }
        },
        "sch:attlist.ns": {
            attrs: {
                'uri': 'sch:URI',
                'prefix': 'xs:NMTOKEN'
            }
        },
        "sch:attlist.phase": {
            attrs: {
                'id': 'xs:ID',
                'fpi': 'sch:FPI',
                'icon': 'sch:URI'
            }
        },
        "sch:attlist.span": {
            attrs: {
                'class': ''
            }
        },
        "sch:attlist.report": {
            attrs: {
                'test': 'sch:EXPR',
                'role': 'xs:NMTOKEN',
                'id': 'xs:ID',
                'diagnostics': 'xs:IDREFS',
                'icon': 'sch:URI',
                'subject': 'sch:PATH'
            }
        },
        "sch:attlist.rule": {
            attrs: {
                'context': 'sch:PATH',
                'abstract': ['true', 'false'],
                'role': 'xs:NMTOKEN',
                'id': 'xs:ID'
            }
        },
        "sch:attlist.value-of": {
            attrs: {
                'select': 'sch:PATH'
            }
        },
        "sch:attlist.let": {
            attrs: {
                'name': 'xs:string',
                'value': 'sch:PATH'
            }
        }
    }
}
