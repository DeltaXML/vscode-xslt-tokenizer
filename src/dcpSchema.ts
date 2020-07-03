
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
  to transform core-dcp-v1_0.xsd - included in XML Compare
 */

export interface SimpleType {
  base?: string[],
  enum?: string[],
  list?: string,
}

export interface ComplexType {
  attrs?: any,
  base?: string,
  type?: string,
  elementNames?: string[],
  attributeList?: AttributeItem[];
  primitive?: string
}

export interface SubstitutionGroupType {
  type: string,
  elements: { [name: string]: ComplexType }
}

export interface AttributeItem {
  name: string,
  enum?: string[];
}
export class DCPSchema {
  simpleTypes: { [name: string]: SimpleType } = {
    "Percentage": { base: ['xs:integer'] },
    "advancedEntityReferenceUsageType": {
      base: ['xs:string'],
      enum: ['useDefault', 'change', 'replace', 'split']
    },
    "processingModeEnumType": {
      base: ['xs:string'],
      enum: ['useDefault', 'A', 'AB', 'AdB', 'B', 'BA', 'BdA', 'change']
    },
    "outputTypeEnumType": {
      base: ['xs:string'],
      enum: ['useDefault', 'encoded', 'normal']
    },
    "xpathExpressionType": { base: ['xs:string'] },
    "mathMlGranularityType": {
      base: ['xs:string'],
      enum: ['adjacent', 'detailed-adjacent', 'inline']
    },
    "invalidBehaviourType": {
      base: ['xs:string'],
      enum: ['compareAsXml', 'fail', 'propagateUp']
    },
    "relBaseType": {
      base: ['xs:string'],
      enum: ['current', 'home', 'dxp']
    },
    "modifiedAttributeModeType": {
      base: ['xs:string'],
      enum: ['useDefault', 'change', 'A', 'AB', 'B', 'BA', 'encode-as-attributes']
    },
    "modifiedWhitespaceType": {
      base: ['xs:string'],
      enum: ['useDefault', 'ignore', 'keepA', 'normalize', 'show']
    },
    "MixedContentDetectionScopeType": {
      base: ['xs:string'],
      enum: ['document', 'local']
    },
    "resultFormatType": {
      base: ['xs:string'],
      enum: ['arbortext-tc', 'delta', 'oxygen-tc', 'xmetal-tc', 'framemaker-tc']
    },
    "modifiedFormatOutputType": {
      base: ['xs:string'],
      enum: ['useDefault', 'A', 'B', 'AB', 'BA', 'change', 'content-group']
    },
    "xmetalTableChangeModeType": {
      base: ['xs:string'],
      enum: ['down', 'ignore', 'up']
    },
    "frameMakerTableChangeModeType": {
      base: ['xs:string'],
      enum: ['down', 'ignore', 'up']
    },
    "orderlessPresentationModeType": {
      base: ['xs:string'],
      enum: ['a_adds', 'a_matches_deletes_adds', 'b_deletes', 'b_matches_adds_deletes']
    },
    "validationLevelType": {
      base: ['xs:string'],
      enum: ['relaxed', 'strict']
    },
    "warningReportModeType": {
      base: ['xs:string'],
      enum: ['comments', 'message', 'processingInstructions']
    },
    "anyNameType": { base: ['xs:string'] },
  }
  complexTypes: { [name: string]: ComplexType } = {
    "processingModeType": {
      attrs: {
        'literalValue': 'processingModeEnumType'
      }
    },
    "featureContainerType": { elementNames: ['feature'] },
    "retainWithModes": { elementNames: ['retain', 'processingMode', 'outputType'] },
    "retainType": { elementNames: ['retain'] },
    "anyMixedContent": { elementNames: ['xs:lax'] },
    "booleanParameterType": {
      attrs: {
        'name': 'xs:NCName',
        'defaultValue': 'xs:boolean'
      }, elementNames: ['description']
    },
    "stringParameterType": {
      attrs: {
        'name': 'xs:NCName',
        'defaultValue': 'xs:string'
      }, elementNames: ['description']
    },
    "propertyContainer": { elementNames: ['property'] },
    "typedPropertyContainer": { elementNames: ['stringProperty', 'booleanProperty'] },
    "simpleStringParameterType": {
      attrs: {
        'name': 'anyNameType',
        'literalValue': 'xs:string'
      }
    },
    "simpleBooleanParameterType": {
      attrs: {
        'name': 'anyNameType',
        'literalValue': 'xs:boolean'
      }
    },
    "filterChainType": { elementNames: ['filter'] },
    "inputExtensionPointsType": { elementNames: ['preTablePoint', 'postTablePoint'] },
    "outputExtensionPointsType": { elementNames: ['preTablePoint', 'postTablePoint', 'preAttributePoint', 'finalPoint'] },
  }
  elements: { [name: string]: ComplexType } = {
    "lexicalPreservation": { elementNames: ['defaults', 'overrides'] },
    "overrides": { elementNames: ['preserveItems', 'outerPiAndCommentProcessingMode', 'advancedEntityReferenceUsage'] },
    "defaults": { type: 'retainWithModes' },
    "preserveItems": { elementNames: ['CDATA', 'comments', 'defaultAttributeInfo', 'entityReferences', 'doctype', 'entityReplacementText', 'contentModel', 'documentLocation', 'ignorableWhitespace', 'nestedEntityReferences', 'processingInstructions', 'XMLDeclaration'] },
    "advancedEntityReferenceUsage": {
      attrs: {
        'literalValue': 'advancedEntityReferenceUsageType'
      }
    },
    "CDATA": { type: 'retainWithModes' },
    "comments": { type: 'retainWithModes' },
    "defaultAttributeInfo": { type: 'retainWithModes' },
    "entityReferences": { type: 'retainWithModes' },
    "doctype": { type: 'retainWithModes' },
    "entityReplacementText": { type: 'retainType' },
    "contentModel": { type: 'retainType' },
    "documentLocation": { type: 'retainType' },
    "ignorableWhitespace": { type: 'retainWithModes' },
    "nestedEntityReferences": { type: 'retainType' },
    "processingInstructions": { type: 'retainWithModes' },
    "XMLDeclaration": { type: 'retainWithModes' },
    "retain": {
      attrs: {
        'literalValue': 'xs:boolean'
      }
    },
    "processingMode": { type: 'processingModeType' },
    "outerPiAndCommentProcessingMode": { type: 'processingModeType' },
    "outputType": {
      attrs: {
        'literalValue': 'outputTypeEnumType'
      }
    },
    "feature": {
      attrs: {
        'literalValue': 'xs:boolean',
        'name': 'xs:anyURI'
      }
    },
    "documentComparator": {
      attrs: {
        'id': 'anyNameType',
        'version': 'xs:string',
        'description': 'xs:string'
      }, elementNames: ['fullDescription', 'pipelineParameters', 'extensionPoints', 'standardConfig', 'advancedConfig']
    },
    "fullDescription": { type: 'anyMixedContent' },
    "pipelineParameters": { elementNames: ['booleanParameter', 'stringParameter'] },
    "description": { type: 'xs:string' },
    "extensionPoints": { elementNames: ['inputPreFlatteningPoint', 'inputExtensionPoints', 'inputAExtensionPoints', 'inputBExtensionPoints', 'outputExtensionPoints'] },
    "inputPreFlatteningPoint": { type: 'filterChainType' },
    "inputExtensionPoints": { type: 'inputExtensionPointsType' },
    "inputAExtensionPoints": { type: 'inputExtensionPointsType' },
    "inputBExtensionPoints": { type: 'inputExtensionPointsType' },
    "outputExtensionPoints": { type: 'outputExtensionPointsType' },
    "standardConfig": { elementNames: ['lexicalPreservation', 'outputFormatConfiguration', 'resultReadabilityOptions', 'tableConfiguration', 'calsTableConfiguration', 'htmlTableConfiguration', 'mathmlConfiguration'] },
    "outputFormatConfiguration": { elementNames: ['attributeChangeMarked', 'modifiedAttributeMode', 'modifiedFormatOutput', 'orderlessPresentationMode', 'resultFormat', 'trackChangesAuthor', 'trackChangesDate', 'xmetalTcsTableChangeMode', 'frameMakerTcsTableChangeMode', 'grouping'] },
    "attributeChangeMarked": {
      attrs: {
        'literalValue': 'xs:boolean'
      }
    },
    "modifiedAttributeMode": {
      attrs: {
        'literalValue': 'modifiedAttributeModeType'
      }
    },
    "modifiedFormatOutput": {
      attrs: {
        'literalValue': 'modifiedFormatOutputType'
      }
    },
    "resultFormat": {
      attrs: {
        'literalValue': 'resultFormatType'
      }
    },
    "trackChangesAuthor": {
      attrs: {
        'literalValue': 'xs:string'
      }
    },
    "trackChangesDate": {
      attrs: {
        'literalValue': 'xs:dateTime'
      }
    },
    "xmetalTcsTableChangeMode": {
      attrs: {
        'literalValue': 'xmetalTableChangeModeType'
      }
    },
    "frameMakerTcsTableChangeMode": {
      attrs: {
        'literalValue': 'frameMakerTableChangeModeType'
      }
    },
    "grouping": {
      attrs: {
        'literalValue': 'xs:boolean'
      }
    },
    "orderlessPresentationMode": {
      attrs: {
        'literalValue': 'orderlessPresentationModeType'
      }
    },
    "resultReadabilityOptions": { elementNames: ['changeGatheringEnabled', 'detectMoves', 'elementSplittingEnabled', 'elementSplittingThreshold', 'modifiedWhitespaceBehaviour', 'moveAttributeXpath', 'orphanedWordDetectionEnabled', 'orphanedWordLengthLimit', 'orphanedWordMaxPercentage', 'mixedContentDetectionScope'] },
    "changeGatheringEnabled": {
      attrs: {
        'literalValue': 'xs:boolean'
      }
    },
    "detectMoves": {
      attrs: {
        'literalValue': 'xs:boolean'
      }
    },
    "elementSplittingEnabled": {
      attrs: {
        'literalValue': 'xs:boolean'
      }
    },
    "elementSplittingThreshold": {
      attrs: {
        'literalValue': 'Percentage'
      }
    },
    "modifiedWhitespaceBehaviour": {
      attrs: {
        'literalValue': 'modifiedWhitespaceType'
      }
    },
    "mixedContentDetectionScope": {
      attrs: {
        'literalValue': 'MixedContentDetectionScopeType'
      }
    },
    "moveAttributeXpath": {
      attrs: {
        'literalValue': 'xs:string'
      }
    },
    "orphanedWordDetectionEnabled": {
      attrs: {
        'literalValue': 'xs:boolean'
      }
    },
    "orphanedWordLengthLimit": {
      attrs: {
        'literalValue': 'xs:unsignedLong'
      }
    },
    "orphanedWordMaxPercentage": {
      attrs: {
        'literalValue': 'Percentage'
      }
    },
    "tableConfiguration": { elementNames: ['warningReportMode', 'processHtmlTables', 'processCalsTables', 'calsValidationLevel', 'invalidCalsTableBehaviour'] },
    "calsTableConfiguration": { elementNames: ['warningReportMode', 'processCalsTables', 'calsValidationLevel', 'invalidCalsTableBehaviour'] },
    "htmlTableConfiguration": { elementNames: ['warningReportMode', 'processHtmlTables', 'htmlValidationLevel', 'invalidHtmlTableBehaviour', 'normalizeHtmlTables'] },
    "warningReportMode": {
      attrs: {
        'literalValue': 'warningReportModeType'
      }
    },
    "processHtmlTables": {
      attrs: {
        'literalValue': 'xs:boolean'
      }
    },
    "processCalsTables": {
      attrs: {
        'literalValue': 'xs:boolean'
      }
    },
    "calsValidationLevel": {
      attrs: {
        'literalValue': 'validationLevelType'
      }
    },
    "htmlValidationLevel": {
      attrs: {
        'literalValue': 'validationLevelType'
      }
    },
    "invalidCalsTableBehaviour": {
      attrs: {
        'literalValue': 'invalidBehaviourType'
      }
    },
    "invalidHtmlTableBehaviour": {
      attrs: {
        'literalValue': 'invalidBehaviourType'
      }
    },
    "normalizeHtmlTables": {
      attrs: {
        'literalValue': 'xs:boolean'
      }
    },
    "mathmlConfiguration": { elementNames: ['enableMathml', 'mathmlGranularity'] },
    "enableMathml": {
      attrs: {
        'literalValue': 'xs:boolean'
      }
    },
    "mathmlGranularity": {
      attrs: {
        'literalValue': 'mathMlGranularityType'
      }
    },
    "advancedConfig": { elementNames: ['outputProperties', 'parserFeatures', 'parserProperties', 'transformerConfigurationProperties'] },
    "outputProperties": { type: 'propertyContainer' },
    "parserFeatures": { type: 'featureContainerType' },
    "parserProperties": { type: 'propertyContainer' },
    "transformerConfigurationProperties": { type: 'typedPropertyContainer' },
    "filter": {
      attrs: {
        'if': 'xs:NCName',
        'unless': 'xs:NCName',
        'when': 'xs:string'
      }, elementNames: ['class', 'http', 'resource', 'file', 'parameter']
    },
    "class": {
      attrs: {
        'name': 'anyNameType'
      }
    },
    "http": {
      attrs: {
        'url': 'xs:anyURI'
      }
    },
    "resource": {
      attrs: {
        'name': 'anyNameType'
      }
    },
    "file": {
      attrs: {
        'path': 'xs:string',
        'relBase': 'relBaseType'
      }
    },
    "property": { type: 'simpleStringParameterType' },
    "parameter": { type: 'simpleStringParameterType' },
    "stringProperty": { type: 'simpleStringParameterType' },
    "booleanProperty": { type: 'simpleBooleanParameterType' },
    "preTablePoint": { type: 'filterChainType' },
    "postTablePoint": { type: 'filterChainType' },
  }
  attributeGroups: { [name: string]: any } = {
    "parameterRefGroup": {
      attrs: {
        'parameterRef': 'xs:string',
        'xpath': 'xpathExpressionType'
      }
    },
  }
}
