
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
    docType = DocumentTypes.DCP;
    simpleTypes: { [name: string]: SimpleType } = {
        "URI": { base: ['xs:string'] },
        "PATH": { base: ['xs:string'] },
        "EXPR": { base: ['xs:string'] },
        "FPI": { base: ['xs:string'] },
    }
    complexTypes: { [name: string]: ComplexType } = {}
    elements: { [name: string]: ComplexType } = {
        "schema": {
            elementNames: ['sch:title', 'sch:ns', 'sch:p', 'sch:phase', 'sch:key', 'sch:pattern', 'sch:p', 'sch:diagnostics'],
            attributeGroup: 'sch:attlist.schema'
        },
        "active": {
            elementNames: ['sch:dir', 'sch:emph', 'sch:span'],
            attributeGroup: 'sch:attlist.active'
        },
        "assert": {
            elementNames: ['sch:name', 'sch:emph', 'sch:dir', 'sch:span'],
            attributeGroup: 'sch:attlist.assert'
        },
        "dir": {
            attributeGroup: 'sch:attlist.dir'
        },
        "emph": {
            type: 'xs:string'
        },
        "extends": {
            attributeGroup: 'sch:attlist.extends'
        },
        "diagnostic": {
            elementNames: ['sch:value-of', 'sch:emph', 'sch:dir', 'sch:span'],
            attributeGroup: 'sch:attlist.diagnostic'
        },
        "diagnostics": {
            elementNames: ['sch:diagnostic']
        },
        "key": {
            attributeGroup: 'sch:attlist.key'
        },
        "name": {
            attributeGroup: 'sch:attlist.name'
        },
        "ns": {
            attributeGroup: 'sch:attlist.ns'
        },
        "p": {
            elementNames: ['sch:dir', 'sch:emph', 'sch:span'],
            attributeGroup: 'sch:attlist.p'
        },
        "pattern": {
            elementNames: ['sch:p', 'sch:rule'],
            attributeGroup: 'sch:attlist.pattern'
        },
        "phase": {
            elementNames: ['sch:p', 'sch:active'],
            attributeGroup: 'sch:attlist.phase'
        },
        "report": {
            elementNames: ['sch:name', 'sch:emph', 'sch:dir', 'sch:span'],
            attributeGroup: 'sch:attlist.report'
        },
        "rule": {
            elementNames: ['sch:assert', 'sch:report', 'sch:key', 'sch:extends'],
            attributeGroup: 'sch:attlist.rule'
        },
        "span": {
            attributeGroup: 'sch:attlist.span'
        },
        "title": {
            elementNames: ['sch:dir']
        },
        "value-of": {
            attributeGroup: 'sch:attlist.value-of'
        },
    }
    attributeGroups: { [name: string]: any } = {
        "attlist.schema": {
            attrs: {
                'xsi:schemaLocation': '',
                'id': 'xs:ID',
                'fpi': 'sch:FPI',
                'ns': 'sch:FPI',
                'schemaVersion': '',
                'defaultPhase': 'xs:IDREF',
                'icon': 'sch:URI',
                'version': ''
            }
        },
        "attlist.active": {
            attrs: {
                'pattern': 'xs:IDREF'
            }
        },
        "attlist.assert": {
            attrs: {
                'test': 'sch:EXPR',
                'role': 'xs:NMTOKEN',
                'id': 'xs:ID',
                'diagnostics': 'xs:IDREFS',
                'icon': 'sch:URI',
                'subject': 'sch:PATH'
            }
        },
        "attlist.dir": {
            attrs: {
                'value': ['ltr','rtl']
            }
        },
        "attlist.extends": {
            attrs: {
                'rule': 'xs:IDREF'
            }
        },
        "attlist.diagnostic": {
            attrs: {
                'id': 'xs:ID',
                'icon': 'sch:URI'
            }
        },
        "attlist.key": {
            attrs: {
                'match': '',
                'name': 'xs:NMTOKEN',
                'path': 'sch:PATH',
                'icon': 'sch:URI'
            }
        },
        "attlist.name": {
            attrs: {
                'path': 'sch:PATH'
            }
        },
        "attlist.p": {
            attrs: {
                'id': 'xs:ID',
                'class': '',
                'icon': 'sch:URI'
            }
        },
        "attlist.pattern": {
            attrs: {
                'name': '',
                'see': 'sch:URI',
                'id': 'xs:ID',
                'icon': 'sch:URI'
            }
        },
        "attlist.ns": {
            attrs: {
                'uri': 'sch:URI',
                'prefix': 'xs:NMTOKEN'
            }
        },
        "attlist.phase": {
            attrs: {
                'id': 'xs:ID',
                'fpi': 'sch:FPI',
                'icon': 'sch:URI'
            }
        },
        "attlist.span": {
            attrs: {
                'class': ''
            }
        },
        "attlist.report": {
            attrs: {
                'test': 'sch:EXPR',
                'role': 'xs:NMTOKEN',
                'id': 'xs:ID',
                'diagnostics': 'xs:IDREFS',
                'icon': 'sch:URI',
                'subject': 'sch:PATH'
            }
        },
        "attlist.rule": {
            attrs: {
                'context': 'sch:PATH',
                'abstract': ['true', 'false'],
                'role': 'xs:NMTOKEN',
                'id': 'xs:ID'
            }
        },
        "attlist.value-of": {
            attrs: {
                'select': 'sch:PATH'
            }
        },
    }
}
