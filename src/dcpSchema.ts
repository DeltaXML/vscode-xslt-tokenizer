
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
export class DCPSchema implements SchemaData {
    docType = DocumentTypes.DCP;
    simpleTypes: { [name: string]: SimpleType } = {
        "Percentage": { base: ['xs:integer'] },
        "advancedEntityReferenceUsageType": {
            base: ['xs:string'],
            enum: ['useDefault', 'change', 'replace', 'split'],
            detail: {
                'useDefault': `Choose one of the other three behaviours in a context dependent manner.`,
                'change': `Keep the encoded form of the entity reference, with its change markup.`,
                'replace': `Extract the replacement text from the encoded entity reference.`,
                'split': `The encoded entity references have their replacement text removed and are split into 'new' and 'old' versions on detection of change.`
            }
        },
        "processingModeEnumType": {
            base: ['xs:string'],
            enum: ['useDefault', 'A', 'AB', 'AdB', 'B', 'BA', 'BdA', 'change'],
            detail: {
                'useDefault': `Use the default ProcessingMode`,
                'A': `Keep the A version`,
                'AB': `Keep the A version if it exists, otherwise keep the B version`,
                'AdB': `Same as A, except when handling internal subset declarations which are treated as AB`,
                'B': `Keep the B version`,
                'BA': `Keep the B version if it exists, otherwise keep the A version`,
                'BdA': `Same as B, except when handling internal subset declarations which are treated as BA`,
                'change': `Keep change information as-is`
            }
        },
        "outputTypeEnumType": {
            base: ['xs:string'],
            enum: ['useDefault', 'encoded', 'normal'],
            detail: {
                'useDefault': `Specifies that the default encoding style should be used.`,
                'encoded': `The encoded preservation element should appear encoded in the output.`,
                'normal': `The encoded preservation element should be decoded by the final output transformation (which is typically part of serialisation process).`
            }
        },
        "xpathExpressionType": { base: ['xs:string'] },
        "mathMlGranularityType": {
            base: ['xs:string'],
            enum: ['adjacent', 'detailed-adjacent', 'inline'],
            detail: {
                'adjacent': `Reports the differences by repeating A and B MathML adjacent to each other.`,
                'detailed-adjacent': `Reports the differences by repeating the A and B MathML adjacent to each other. Content within the adjacent A and B views is highlighted at the specific parts where it is different.`,
                'inline': `Reports the differences inline within the MathML without duplicating A and B. If the differences are too complex to easily render inline, the 'detailed-adjacent' view is used.`
            }
        },
        "invalidBehaviourType": {
            base: ['xs:string'],
            enum: ['compareAsXml', 'fail', 'propagateUp'],
            detail: {
                'compareAsXml': `Compare tables as 'plain' XML.`,
                'fail': `Throw an Exception when invalid tables are encountered.`,
                'propagateUp': `Propagate the changes to the <tgroup> level of the table.`
            }
        },
        "relBaseType": {
            base: ['xs:string'],
            enum: ['current', 'home', 'dxp'],
            detail: {
                'current': `Resolve using the current working directory, obtained from the Java user.dir system property.`,
                'home': `Resolve using the user's home directory.`,
                'dxp': `Resolve using the directory containing the DXP file, when it is loaded from a file.`
            }
        },
        "modifiedAttributeModeType": {
            base: ['xs:string'],
            enum: ['useDefault', 'change', 'A', 'AB', 'B', 'BA', 'encode-as-attributes'],
            detail: {
                'useDefault': `The behaviour will depend on other parameter settings, primarily the output-format.`,
                'change': `The associated modified attribute filter will be skipped, thus leaving the delta attribute change markup alone.`,
                'A': `Output the 'A' version of modified attributes and any deleted ('A') attributes.`,
                'AB': `Output the 'A' version of modified attributes.`,
                'B': `Output the 'B' version of modified attributes and any added ('B') attributes.`,
                'BA': `Output the 'B' version of modified attributes.`,
                'encode-as-attributes': `Output the 'B' version of modified attributes and any added ('B') attributes but additionally show the changes encoded as attributes in the attribute-change ('ac') namespace.`
            }
        },
        "modifiedWhitespaceType": {
            base: ['xs:string'],
            enum: ['useDefault', 'ignore', 'keepA', 'normalize', 'show'],
            detail: {
                'useDefault': `The context dependent automatic whitespace setting.`,
                'ignore': `Ignore differences in whitespace that is not explicitly preserved.`,
                'keepA': `Similar to 'ignore' except that 'A' document's whitespace is kept (instead of the 'B' document's whitespace).`,
                'normalize': `Normalize whitespace in inputs before comparison.`,
                'show': `Display the differences in whitespace where possible`
            }
        },
        "MixedContentDetectionScopeType": {
            base: ['xs:string'],
            enum: ['document', 'local'],
            detail: {
                'document': `Determine if an element is mixed-content using information from elements of the same name in the document. Using this scope significantly slows processing for large files.`,
                'local': `Determine mixed content information for each element in turn, based on the contents of that element alone.`
            }
        },
        "resultFormatType": {
            base: ['xs:string'],
            enum: ['arbortext-tc', 'delta', 'oxygen-tc', 'xmetal-tc', 'framemaker-tc'],
            detail: {
                'arbortext-tc': `Reports changes using the Arbortext editor track changes format.`,
                'delta': `Reports changes using the DeltaXML delta file result.`,
                'oxygen-tc': `Reports changes using oXygen Author track changes processing instructions.`,
                'xmetal-tc': `Reports changes using XMetaL track changes processing instructions.`,
                'framemaker-tc': `Reports changes using FrameMaker track changes processing instructions.`
            }
        },
        "modifiedFormatOutputType": {
            base: ['xs:string'],
            enum: ['useDefault', 'A', 'B', 'AB', 'BA', 'change', 'content-group'],
            detail: {
                'useDefault': `Choose the most relevant behaviour based on other configuration settings.`,
                'A': `Output the formatting elements from the A input.`,
                'B': `Output the formatting elements from the B input.`,
                'AB': `Output the A and B formatting elements. Where A and B formatting elements overlap or are nested, use formatting elements from the A input.`,
                'BA': `Output the A and B formatting elements. Where A and B formatting elements overlap or are nested, use formatting elements from the B input.`,
                'change': `Represent all formatting element changes using the deltaV2.1 format.`,
                'content-group': `Output each formatting element change using a content group.`
            }
        },
        "xmetalTableChangeModeType": {
            base: ['xs:string'],
            enum: ['down', 'ignore', 'up'],
            detail: {
                'down': `Changes in rows and cells are pushed down to the cell content level.`,
                'ignore': `All changes in a table are ignored.`,
                'up': `Changes in rows and cells are pushed up to the table level.`
            }
        },
        "frameMakerTableChangeModeType": {
            base: ['xs:string'],
            enum: ['down', 'ignore', 'up'],
            detail: {
                'down': `Changes in rows and cells are pushed down to the cell content level.`,
                'ignore': `All changes in a table are ignored.`,
                'up': `Changes in rows and cells are pushed up to the table level.`
            }
        },
        "orderlessPresentationModeType": {
            base: ['xs:string'],
            enum: ['a_adds', 'a_matches_deletes_adds', 'b_deletes', 'b_matches_adds_deletes'],
            detail: {
                'a_adds': `Outputs elements from the A input, in order, followed by elements only in the B input, in order.`,
                'a_matches_deletes_adds': `Outputs elements from both inputs in their A order, followed by elements only in A and then elements only in B.`,
                'b_deletes': `Outputs elements from the B input, in order, followed by elements only in the A input, in order.`,
                'b_matches_adds_deletes': `Outputs elements from both inputs in their B order, followed by elements only in B and then elements only in A.`
            }
        },
        "validationLevelType": {
            base: ['xs:string'],
            enum: ['relaxed', 'strict'],
            detail: {
                'relaxed': `Performs relaxed validation.`,
                'strict': `Performs strict validation.`
            }
        },
        "warningReportModeType": {
            base: ['xs:string'],
            enum: ['comments', 'message', 'processingInstructions'],
            detail: {
                'comments': `Reports warnings using XML comments.`,
                'message': `Reports warnings using <xsl:message/>.`,
                'processingInstructions': `Reports warning using processing instructions with the format <?dxml_warn warning content ?>.`
            }
        },
        "columnKeyingModeType": {
            base: ['xs:string'],
            enum: ['auto', 'colname', 'position'],
            detail: {
                'auto': `Automatically handles table column keying.`,
                'colname': `Uses @colname attribute values as keys.`,
                'position': `Uses table column positions as keys.`
            }
        },
        "anyNameType": { base: ['xs:string'] },
    };
    complexTypes: { [name: string]: ComplexType } = {
        "processingModeType": {
            attrs: {
                'literalValue': 'processingModeEnumType'
            }
        },
        "featureContainerType": {
            elementNames: ['feature']
        },
        "retainWithModes": {
            elementNames: ['retain', 'processingMode', 'outputType']
        },
        "retainType": {
            elementNames: ['retain']
        },
        "anyMixedContent": {
            elementNames: ['xs:lax']
        },
        "booleanParameterType": {
            attrs: {
                'name': 'xs:NCName',
                'defaultValue': 'xs:boolean'
            },
            elementNames: ['description']
        },
        "stringParameterType": {
            attrs: {
                'name': 'xs:NCName',
                'defaultValue': 'xs:string'
            },
            elementNames: ['description']
        },
        "propertyContainer": {
            elementNames: ['property']
        },
        "typedPropertyContainer": {
            elementNames: ['stringProperty', 'booleanProperty']
        },
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
        "filterChainType": {
            elementNames: ['filter']
        },
        "inputExtensionPointsType": {
            elementNames: ['preTablePoint', 'postTablePoint']
        },
        "outputExtensionPointsType": {
            elementNames: ['preTablePoint', 'postTablePoint', 'preAttributePoint', 'finalPoint']
        },
    };
    elements: { [name: string]: ComplexType } = {
        "lexicalPreservation": {
            elementNames: ['defaults', 'overrides'],
            detail: `Configures the way lexical information is preserved. This is mostly for lexical artifacts that
 are not included in the standards for the XPath Data Model or XML Infoset. The exceptions are
 comment and processing-instruction nodes that are controlled here also.`},
        "overrides": {
            elementNames: ['preserveItems', 'outerPiAndCommentProcessingMode', 'advancedEntityReferenceUsage'],
            detail: `Container for elements that override defaults for specific lexical preservation artifacts`
        },
        "defaults": {
            type: 'retainWithModes',
            detail: `This required element is the container for elements that set the defaults for all lexical preservation artifacts.`
        },
        "preserveItems": {
            elementNames: ['CDATA', 'comments', 'defaultAttributeInfo', 'entityReferences', 'doctype', 'entityReplacementText', 'contentModel', 'documentLocation', 'ignorableWhitespace', 'nestedEntityReferences', 'processingInstructions', 'XMLDeclaration'],
            detail: `Container for preservation of specific lexical preservation artifacts, these override general preservation settings
 for all artifacts contained in the 'defaults' element.`},
        "advancedEntityReferenceUsage": {
            attrs: {
                'literalValue': 'advancedEntityReferenceUsageType'
            },
            detail: `For controlling some specialist use cases, where both the entity
 references and their replacement text are compared.
 
 One use case where you might want to set this variable explicitly is: when you configure the comparator for standard 'round trip' 
 lexical preservation, but the final output format cannot represent entity references. In this case, the REPLACE value can be used. 
 This is an alternative to specifying a custom processing mode that performs round trip processing, 
 except for entity references which are substituted for their values (i.e. their replacement text) prior to the comparison.
`},
        "CDATA": {
            type: 'retainWithModes',
            detail: `Controls preservation of CDATA sections found in the input documents.`
        },
        "comments": {
            type: 'retainWithModes',
            detail: `Controls preservation of XML comment nodes found in the input documents.`
        },
        "defaultAttributeInfo": {
            type: 'retainWithModes',
            detail: `Controls how information is preserved on DTD/Schema-defined default attributes added by the parser.`
        },
        "entityReferences": {
            type: 'retainWithModes',
            detail: `Controls preservation of entity references found in the input documents.`
        },
        "doctype": {
            type: 'retainWithModes',
            detail: `Controls preservation of DocType declarations and the internal DTD subset.`
        },
        "entityReplacementText": {
            type: 'retainType',
            detail: `Controls preservation of text to be used when entities are resolved.`
        },
        "contentModel": {
            type: 'retainType',
            detail: `Controls preservation of DTD/Schema Element Content Model.`
        },
        "documentLocation": {
            type: 'retainType',
            detail: `Controls preservation of the original document location (the systemId).`
        },
        "ignorableWhitespace": {
            type: 'retainWithModes',
            detail: `Controls preservation of whitespace identified as ignorable by a DTD or XML Schema.`
        },
        "nestedEntityReferences": {
            type: 'retainType',
            detail: `Controls preservation of entities references actually occurring within entities.`
        },
        "processingInstructions": {
            type: 'retainWithModes',
            detail: `Controls preservation of XML processing-instruction nodes found in the input documents.`
        },
        "XMLDeclaration": {
            type: 'retainWithModes',
            detail: `Controls preservation XML declarations in the input documents.`
        },
        "retain": {
            attrs: {
                'literalValue': 'xs:boolean'
            },
            detail: `Sets whether information on a lexical preservation artifact is
 preserved in the pipeline. The Java API equivalent is: 'setPreserve[artifactName]'.`},
        "processingMode": {
            type: 'processingModeType',
            detail: `Sets the 'PreservationProcessingMode' for controlling behaviour when preserved lexical artifacts have changed.`
        },
        "outerPiAndCommentProcessingMode": {
            type: 'processingModeType',
            detail: `Set processingMode for processing-instructions and comments occurring before
 or after the root element.`},
        "outputType": {
            attrs: {
                'literalValue': 'outputTypeEnumType'
            },
            detail: `Set the default PreservationOutputType for changes to preserved items.
 
 Used to specify how the lexically preserved items should be styled. Here, the two available styles are either 'normal' or 'encoded'. 
 A third option of 'auto' enables the specified default style to be applied. Note that when 'auto' is selected for the default style then the default style is treated as 'normal'.
`},
        "feature": {
            attrs: {
                'literalValue': 'xs:boolean',
                'name': 'xs:anyURI'
            },
            detail: `
 Sets the boolean value of a named feature.
`},
        "documentComparator": {
            attrs: {
                'id': 'anyNameType',
                'version': 'xs:string',
                'description': 'xs:string'
            },
            elementNames: ['fullDescription', 'pipelineParameters', 'extensionPoints', 'standardConfig', 'advancedConfig'],
            detail: `The root element for defining the overrides to a DocumentComparator whose
 defaults are as described in the API documentation. A Document Comparator instance with
 default settings is created if no child elements are present.`},
        "fullDescription": {
            type: 'anyMixedContent',
            detail: `Designed to provide meaningful description and basic help information to the
 user. It can contain PCDATA content. It should include a description of the Document
 Comparator configuration defined by the DCP. How this information is presented to users is a
 tool-dependent operation, for example a GUI-based tool may provide a pop-up
 window and show HTML formatted content.`},
        "pipelineParameters": {
            elementNames: ['booleanParameter', 'stringParameter'],
            detail: `Container for all pipeline parameters. Pipeline parameters have global
 scope and are referenced using the 'paremeterRef' attribute. Pipeline parameters have a
 default value that can be overridden through the API. The maximum number of child elements
 is not restricted.`},
        "booleanParameter": {
            type: 'booleanParameterType',
            detail: `Declare a boolean parameter that may be referenced by 'parameterRef'
 attributes or as \$variables from within XPath expressions.`},
        "stringParameter": {
            type: 'stringParameterType',
            detail: `Declare a string parameter that may be referenced by 'parameterRef'
 attributes or as \$variables from within XPath expressions.`},
        "description": {
            type: 'xs:string',
            detail: `Short summary of the purpose of the parameter.`
        },
        "extensionPoints": {
            elementNames: ['inputPreFlatteningPoint', 'inputExtensionPoints', 'inputAExtensionPoints', 'inputBExtensionPoints', 'outputExtensionPoints'],
            detail: `Declare the extension points and contained filters to be inserted within
 the DocumentComparator pipeline. In EBNF the required sequence S of child elements is:
 S := 'inputPreFlatteningPoint'? IP 'outputExtensionPoints'?IP := 'inputExtensionPoints'? | ( 'inputAExtensionPoints'? 'inputBExtensionPoints'? )`},
        "inputPreFlatteningPoint": {
            type: 'filterChainType',
            detail: `Extension point for modifying A and B input filters, before element
 flattening.`},
        "inputExtensionPoints": {
            type: 'inputExtensionPointsType',
            detail: `Extension points for modifying A and B input filter chains, after element
 flattening.`},
        "inputAExtensionPoints": {
            type: 'inputExtensionPointsType',
            detail: `Extension points for modifying input A filter chains, after element
 flattening.`},
        "inputBExtensionPoints": {
            type: 'inputExtensionPointsType',
            detail: `Extension points for modifying input B filter chains, after element
 flattening.`},
        "outputExtensionPoints": {
            type: 'outputExtensionPointsType',
            detail: `Extension points for modifying output filter chains, after element
 flattening.`},
        "standardConfig": {
            elementNames: ['lexicalPreservation', 'outputFormatConfiguration', 'resultReadabilityOptions', 'tableConfiguration', 'calsTableConfiguration', 'htmlTableConfiguration', 'mathmlConfiguration'],
            detail: `Genaral configuration options for the DocumentComparator - see
 'advancedConfig' for further options.`},
        "outputFormatConfiguration": {
            elementNames: ['attributeChangeMarked', 'modifiedAttributeMode', 'modifiedFormatOutput', 'orderlessPresentationMode', 'resultFormat', 'trackChangesAuthor', 'trackChangesDate', 'xmetalTcsTableChangeMode', 'frameMakerTcsTableChangeMode', 'grouping'],
            detail: `Specifies configuration options related to the format of the comparison
 result from a DocumentComparator.`},
        "attributeChangeMarked": {
            attrs: {
                'literalValue': 'xs:boolean'
            },
            detail: `Sets the behaviour for marking elements with an attribute changed marker -
 for cases where attribute changes can not otherwise be represented.`},
        "modifiedAttributeMode": {
            attrs: {
                'literalValue': 'modifiedAttributeModeType'
            },
            detail: `Determines how modified attributes are represented in the
 output.`},
        "modifiedFormatOutput": {
            attrs: {
                'literalValue': 'modifiedFormatOutputType'
            },
            detail: `Sets the behaviour for outputting elements with modified
 formatting.`},
        "resultFormat": {
            attrs: {
                'literalValue': 'resultFormatType'
            },
            detail: `Specifies the format of results output from the DocumentComparator. The
 default resultFormat is 'delta'.`},
        "trackChangesAuthor": {
            attrs: {
                'literalValue': 'xs:string'
            },
            detail: `Author name to use when generating tracked changes in the result
 document.`},
        "trackChangesDate": {
            attrs: {
                'literalValue': 'xs:dateTime'
            },
            detail: `The date-time to be used for tracked change representations, otherwise the
 current date-time is used.`},
        "xmetalTcsTableChangeMode": {
            attrs: {
                'literalValue': 'xmetalTableChangeModeType'
            },
            detail: `Specify how table changes are propagated for XMetal tracked changes
 representations, the default is down.`},
        "frameMakerTcsTableChangeMode": {
            attrs: {
                'literalValue': 'frameMakerTableChangeModeType'
            },
            detail: `Specify how table changes are propagated for FrameMaker tracked changes
 representations, the default is down.`},
        "grouping": {
            attrs: {
                'literalValue': 'xs:boolean'
            },
            detail: `Sets the behaviour for grouping adjacent changes.`
        },
        "orderlessPresentationMode": {
            attrs: {
                'literalValue': 'orderlessPresentationModeType'
            },
            detail: `Specifies how the child elements of 'orderless' elements should be output.`
        },
        "resultReadabilityOptions": {
            elementNames: ['changeGatheringEnabled', 'detectMoves', 'elementSplittingEnabled', 'elementSplittingThreshold', 'modifiedWhitespaceBehaviour', 'moveAttributeXpath', 'orphanedWordDetectionEnabled', 'orphanedWordLengthLimit', 'orphanedWordMaxPercentage', 'mixedContentDetectionScope'],
            detail: `Sets options to change the granularity and ordering of changes in the result
 in order to improve readability.`},
        "changeGatheringEnabled": {
            attrs: {
                'literalValue': 'xs:boolean'
            },
            detail: `Sets whether to change the order of consecutive changed items to improve
 readability. If the result contains a sequence of elements whose deltaxml:deltaV2 attribute
 values are mixed up in a sequence of As and Bs, enabling this feature will cause them to be
 reordered so that they are not mixed.`},
        "detectMoves": {
            attrs: {
                'literalValue': 'xs:boolean'
            },
            detail: `Sets the moves detection feature on or off. The move detection feature uses unique ids to identify moves.
 These unique ids can be set using the option 'moveAttributeXpath'.`},
        "elementSplittingEnabled": {
            attrs: {
                'literalValue': 'xs:boolean'
            },
            detail: `Sets whether modified elements containing text should be split when the
 amount of unchanged text falls below a given percentage.`},
        "elementSplittingThreshold": {
            attrs: {
                'literalValue': 'Percentage'
            },
            detail: `Sets the percentage of unchanged text present in a modified element below which the element will be split.`
        },
        "modifiedWhitespaceBehaviour": {
            attrs: {
                'literalValue': 'modifiedWhitespaceType'
            },
            detail: `Set the ModifiedWhitespaceBehaviour to use for changes to whitespace. Here,
 both documents must have some whitespace at a given point in order for there to be a change
 in whitespace. This will then be processed in accordance with the specified behaviour.
 Whitespace insertions and deletions are not affected by the modified whitespace behaviour.
`},
        "mixedContentDetectionScope": {
            attrs: {
                'literalValue': 'MixedContentDetectionScopeType'
            },
            detail: `Set the scope to use for determining if each element in the document is of a mixed-content type.
 The mixed content type affects whitespace processing. If DTD or XML Schema validation is used this setting has no effect.
`},
        "moveAttributeXpath": {
            attrs: {
                'literalValue': 'xs:string'
            },
            detail: `Sets id attribute XPath to be used during moves detection. This id attribute must be an unique identifier for an element. It
 is used to identify and detect source and target for an element move.`},
        "orphanedWordDetectionEnabled": {
            attrs: {
                'literalValue': 'xs:boolean'
            },
            detail: `States whether or not orphaned word detection is enabled.
`},
        "orphanedWordLengthLimit": {
            attrs: {
                'literalValue': 'xs:unsignedLong'
            },
            detail: `Sets the maximum number of words to consider for orphaned word detection.
 Sequences of words longer than the specified length will never be detected as orphaned
 words, regardless of the amount of changed words around them.`},
        "orphanedWordMaxPercentage": {
            attrs: {
                'literalValue': 'Percentage'
            },
            detail: `Sets the maximum proportion of the total change size that orphaned words
 can take while still being considered orphans. If the percentage value for a possibly
 orphaned section is less than or equal to this value, then it is classified as orphaned
 (unless there are more words than the length limit allows). The percentage value for a
 possibly orphaned section is calculated as follows:`},
        "tableConfiguration": {
            elementNames: ['warningReportMode', 'processHtmlTables', 'processCalsTables', 'calsValidationLevel', 'invalidCalsTableBehaviour'],
            detail: `Specifies configuration options for table comparison. These configuration
 options can be specified on a DocumentComparator to configure its behaviour when comparing
 tables.`},
        "calsTableConfiguration": {
            elementNames: ['warningReportMode', 'processCalsTables', 'calsValidationLevel', 'invalidCalsTableBehaviour', 'ignoreColumnOrder', 'columnKeyingMode'],
            detail: `Specifies configuration options for CALS table comparison. These configuration
 options can be specified on a DocumentComparator to configure its behaviour when comparing
 tables.`},
        "htmlTableConfiguration": {
            elementNames: ['warningReportMode', 'processHtmlTables', 'htmlValidationLevel', 'invalidHtmlTableBehaviour', 'normalizeHtmlTables'],
            detail: `Specifies configuration options for HTML table comparison. These configuration
 options can be specified on a DocumentComparator to configure its behaviour when comparing
 tables.`},
        "warningReportMode": {
            attrs: {
                'literalValue': 'warningReportModeType'
            },
            detail: `Specifies how table invalidity warnings should be reported.
`},
        "processHtmlTables": {
            attrs: {
                'literalValue': 'xs:boolean'
            },
            detail: `Sets whether the DocumentComparator should process HTML tables. HTML table
 processing is recommended as it will perform sophisticated processing when comparing two
 HTML tables to ensure that the resulting HTML table is valid.`},
        "processCalsTables": {
            attrs: {
                'literalValue': 'xs:boolean'
            },
            detail: `Sets whether the DocumentComparator should process CALS tables. CALS table
 processing is recommended as it will perform sophisticated processing when comparing two
 CALS tables to ensure that the resulting CALS table is valid.`},
        "calsValidationLevel": {
            attrs: {
                'literalValue': 'validationLevelType'
            },
            detail: `Sets the ValidationLevel to use for CALS table validation. A value of
 ValidationLevel.STRICT will cause the InvalidTableBehaviour mode to be used for any CALS
 invalidity. A value of ValidationLevel.RELAXED means that invalidities which are known to
 have no effect on CALS processing will not prevent CALS processing from running. N.B.
 Warnings will be reported according to the WarningReportMode regardless of the setting used
 here.`},
        "htmlValidationLevel": {
            attrs: {
                'literalValue': 'validationLevelType'
            },
            detail: `Sets the ValidationLevel to use for HTML table validation. A value of
 ValidationLevel.STRICT will cause the InvalidTableBehaviour mode to be used for any HTML
 invalidity. A value of ValidationLevel.RELAXED means that invalidities which are known to
 have no effect on HTML processing will not prevent HTML processing from running. N.B.
 Warnings will be reported according to the WarningReportMode regardless of the setting used
 here.`},
        "invalidCalsTableBehaviour": {
            attrs: {
                'literalValue': 'invalidBehaviourType'
            },
            detail: `Sets the behaviour to use when inputs contain invalid CALS tables. Some of
 the processing used for CALS table comparison makes the assumption that the tables conform
 to the CALS specification. In order to avoid errors in this processing, the tables are first
 validated to ensure that it will work as expected. When tables are not valid, there are
 several options for the behaviour that the comparison should take. This enum is used to
 specify the options`},
        "invalidHtmlTableBehaviour": {
            attrs: {
                'literalValue': 'invalidBehaviourType'
            },
            detail: `Sets the behaviour to use when inputs contain invalid HTML tables. Some of
 the processing used for HTML table comparison makes the assumption that the tables conform
 to the HTML specification. In order to avoid errors in this processing, the tables are first
 validated to ensure that it will work as expected. When tables are not valid, there are
 several options for the behaviour that the comparison should take. This enum is used to
 specify the options`},
        "normalizeHtmlTables": {
            attrs: {
                'literalValue': 'xs:boolean'
            },
            detail: `Sets whether the Document Comparator should normalize the specification of columns in HTML tables. 
 This setting is recommended when there is a difference between inputs of specifying columns, e.g. if one uses just
 * <colgroup> and another uses <col> without <colgroup>.`},
 "ignoreColumnOrder": {
    attrs: {
        'literalValue': 'xs:boolean'
    },
    detail: `Sets whether the DocumentComparator should ignore CALS table column order.`
},
"columnKeyingMode": {
    attrs: {
        'literalValue': 'columnKeyingModeType'
    },
    detail: `Sets the column keying mode used to align CALS table columns when the table
processing is enabled. In AUTO mode, the comparator will automatically handle the entire keying process.
Only AUTO mode allows for user-defined keys in the input files. This is not possible in other modes.
In COLNAME mode, comparator will use column names (defined by @colname) as keys. In POSITION mode,
comparator will use column positions as keys. Indexing starts from 1 and the maximum position
is defined by the number of columns described by @cols attribute.`},
        "mathmlConfiguration": {
            elementNames: ['enableMathml', 'mathmlGranularity'],
            detail: `Specifies configuration options for MathML processing. These configuration options can be specified on a
 DocumentComparator to configure its behaviour when comparing MathML.`},
        "enableMathml": {
            attrs: {
                'literalValue': 'xs:boolean'
            },
            detail: `Sets whether the DocumentComparator should use MathML-specific processing. MathML
 processing is recommended as it will use MATHML-aware features when comparing
 two MathML expressions to ensure that the result can be rendered.`},
        "mathmlGranularity": {
            attrs: {
                'literalValue': 'mathMlGranularityType'
            },
            detail: `Sets the granularity at which the differences between two MathML expressions will be represented.`
        },
        "advancedConfig": {
            elementNames: ['outputProperties', 'parserFeatures', 'parserProperties', 'transformerConfigurationProperties'],
            detail: `Configuration options providing low-level control of the comparison, more
 general configuration options are in 'standardConfig'`},
        "outputProperties": {
            type: 'propertyContainer',
            detail: `Set 
 Serializer property settings for the built in Saxon Serializer.
`},
        "parserFeatures": {
            type: 'featureContainerType',
            detail: `Set features on the underlying SAX parser used in the pipeline. For more detail, see
 setParserFeature in the API documentation.
`},
        "parserProperties": {
            type: 'propertyContainer',
            detail: `Set properties on the underlying SAX parser used in the pipeline.
 For more detail, see
 setParserProperty in the API documentation.
`},
        "transformerConfigurationProperties": {
            type: 'typedPropertyContainer',
            detail: `Set configuration option on the Saxon XSLT transformers used in the
 pipeline. The maximum number of child elements is not restricted.`},
        "filter": {
            attrs: {
                'if': 'xs:NCName',
                'unless': 'xs:NCName',
                'when': 'xs:string'
            },
            elementNames: ['class', 'http', 'resource', 'file', 'parameter'],
            detail: `An XSLT or Java XML processing filter to be loaded into the
 DocumentComparator pipeline. There must be one 'class', 'http', 'resource' or 'file' child
 element for a filter element as this defines the filter type and how it is to be loaded.
 Attributes on the filter element may be used to control whether the filter is enabled or
 disabled.Child 'parameter' elements may also be added so that parameter values are passed
 on to matching parameters in the XML filter. Any number of filter elements may be added to
 an extension point, filters are processed in the pipeline in order of occurrence.
`},
        "class": {
            attrs: {
                'name': 'anyNameType'
            },
            detail: `Load a Java class implementing the SAX XMLFilter interface from the
 ClassPath.`},
        "http": {
            attrs: {
                'url': 'xs:anyURI'
            },
            detail: `Load XSLT filter from an identified HTTP resource.`
        },
        "resource": {
            attrs: {
                'name': 'anyNameType'
            },
            detail: `Load an XSLT filter as a resource in a jar file.`
        },
        "file": {
            attrs: {
                'path': 'xs:string',
                'relBase': 'relBaseType'
            },
            detail: `Load an XSLT filter from the file system.`
        },
        "property": {
            type: 'simpleStringParameterType',
            detail: `Sets the string value of a named property`
        },
        "parameter": {
            type: 'simpleStringParameterType',
            detail: `A named parameter to supply to a filter - any XPath-item type (including a
 sequence) can be supplied to an XSLT filter using the xpath attribute.`},
        "stringProperty": {
            type: 'simpleStringParameterType',
            detail: `A named string property`
        },
        "booleanProperty": {
            type: 'simpleBooleanParameterType',
            detail: `A named boolean property`
        },
        "preAttributePoint": {
            type: 'filterChainType',
            detail: `The filter extension point after table processing and just before
 attribute processing in the DocumentComparator output pipeline. The element must be
 placed after any ...TablePoint elements.`},
        "finalPoint": {
            type: 'filterChainType',
            detail: `The final filter extension point in the DocumentComparator output
 pipeline.`},
        "preTablePoint": {
            type: 'filterChainType',
            detail: `The filter extension point immediately before table processing. The
 preTablePoint element must be placed before the postTablePoint element.`},
        "postTablePoint": {
            type: 'filterChainType',
            detail: `The filter extension point immediately after table processing.
`},
    };
    attributeGroups: { [name: string]: any } = {
        "parameterRefGroup": {
            attrs: {
                'parameterRef': 'xs:string',
                'xpath': 'xpathExpressionType'
            }
        },
    };
}
