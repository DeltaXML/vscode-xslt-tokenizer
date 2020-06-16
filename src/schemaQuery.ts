import { XSLTSchema, SimpleType, ComplexType, AttributeItem} from './xsltschema';

export class Expected {
    elements: string[] = [];
    attrs: string[] = [];
    attributeValues = [];
    foundAttributes: string[] = [];
}

export class SchemaQuery {

    private schema = new XSLTSchema();
    public soughtAttributes: string[] = ['name', 'as', 'select', 'test'];
    public emptyElements: string[] = ['xsl:variable','xsl:param','xsl:sequence','xsl:attribute','xsl:output','xsl:apply-templates','xsl:with-param'];


    public getExpected(name: string, attributeName?: string) {
        let result: Expected = new Expected();
        if (!name.startsWith('xsl:')) {
            let attGroup = this.schema.attributeGroups['xsl:literal-result-element-attributes'];
            if (attGroup.attrs) {
                this.mergeAttrArrays(result, Object.keys(attGroup.attrs));
                if (attributeName) {
                    let simpleTypeName = attGroup.attrs[attributeName];
                    if (simpleTypeName) {
                        let sType = this.schema.simpleTypes[simpleTypeName];
                        if (sType) {
                            this.lookupSimpleType(sType, result);
                        }
                    }
                }
            }
            return result;
        }
        let ct = <ComplexType>this.schema.elements[name];
        if (ct) {
            if (ct.elementNames) {
                result.elements = ct.elementNames;
            }
            this.collectAttributeDetails(ct, result, attributeName);
            let typeName: string|undefined = ct.type? ct.type: ct.base;
            if (typeName) {
                    let type = <ComplexType>this.schema.complexTypes[typeName];
                    if (type.elementNames) {
                        this.mergeArrays(result.elements, type.elementNames);
                    }
                    if (type.base) {
                        this.lookupBaseType(type, result, attributeName);
                    }
                    if (type.attrs) {
                        this.mergeAttrArrays(result, Object.keys(type.attrs));
                    }
            }
        }

        if (!ct) {
            let isInstructionSg = true;
            let sgElement = <ComplexType>this.schema.substitutionGroups.instruction.elements[name];
            if (!sgElement) {
                isInstructionSg = false;
                sgElement = <ComplexType>this.schema.substitutionGroups.declaration.elements[name];
            }
            if (sgElement) {
                this.collectAttributeDetails(sgElement, result, attributeName);
                this.lookupBaseType(sgElement, result);
                let sgType: ComplexType;
                if (isInstructionSg) {
                    sgType = this.schema.complexTypes['xsl:versioned-element-type'];
                } else {
                    sgType = this.schema.complexTypes['xsl:generic-element-type'];
                }
                if (sgType && sgType.base) {
                    this.lookupBaseType(sgType, result);
                }
                if (sgType.attrs) {
                    this.mergeAttrArrays(result, Object.keys(sgType.attrs));
                }
                if (sgElement.elementNames) {
                    this.mergeArrays(result.elements, sgElement.elementNames);
                }
            } else {
                // literal result element - provide 'xsl:literal-result-element-attributes' attributeGoup?
            }
        }
        result.elements = this.performSubstitutions(result.elements);
        return result;
    }

    private collectAttributeDetails(ct: ComplexType, result: Expected, attributeName: string|undefined) {
        if (ct.attrs) {
            this.mergeAttrArrays(result, Object.keys(ct.attrs));
            if (attributeName) {
                let simpleTypeName = ct.attrs[attributeName];
                if (simpleTypeName) {
                    let sType = this.schema.simpleTypes[simpleTypeName];
                    if (sType) {
                        this.lookupSimpleType(sType, result);
                    }
                }
            }
        }
        if (ct.attributeList) {
            let attNames: string[] = [];
            let findAtt = attributeName ? true : false;

            ct.attributeList.forEach((item) => {
                attNames.push(item.name);
                if (findAtt && item.name === attributeName) {
                    findAtt = false;
                    if (item.enum) {
                        this.mergeArrays(result.attributeValues, item.enum);
                    }
                }
            });
            this.mergeAttrArrays(result, attNames);
        }
    }

    private lookupBaseType(sgType: ComplexType, result: Expected, attributeName?: string) {
        if (sgType.base) {
            let baseType = <ComplexType>this.schema.complexTypes[sgType.base];
            if (baseType && baseType.attrs) {
                this.mergeAttrArrays(result, Object.keys(baseType.attrs));
                if (attributeName) {
                    let attrType = baseType.attrs[attributeName];
                    if (attrType) {
                        let simpleType = <SimpleType>this.schema.simpleTypes[attributeName];
                        if (simpleType.enum) {
                            this.mergeArrays(result.attributeValues, simpleType.enum);
                        }
                    }
                }
            }
            if (baseType && baseType.elementNames) {
                this.mergeArrays(result.elements, baseType.elementNames);
            }
            // recursive call;
            if (baseType.base) {
                this.lookupBaseType(baseType, result);
            }
        }
    }

    private lookupSimpleType(sgType: SimpleType, result: Expected) {
        if (sgType.enum) {
            this.mergeArrays(result.attributeValues, sgType.enum);
        }
        // all simpleTypes here are restrictions on a base we should NOT make this recursive call;
        // if (sgType.base) {
        //     sgType.base.forEach((item) => {
        //         let baseType = <SimpleType>this.schema.simpleTypes[item];
        //         if (baseType) {
        //             this.lookupSimpleType(baseType, result);
        //         }
        //     });
        // }
    }

    private mergeArrays(target: string[], source: string[]) {
        source.forEach((item) => {
            if (target.indexOf(item) === -1) {
                target.push(item);
            }
        });
        return target;
    }

    private mergeAttrArrays(expected: Expected, source: string[]) {
        let target = expected.attrs;
        source.forEach((item) => {
            if (target.indexOf(item) === -1) {
                if (this.soughtAttributes.indexOf(item) > -1) {
                    expected.foundAttributes.push(item)
                }
                target.push(item);
            }
        });
        return target;
    }

    private performSubstitutions(elements: string[]) {
        let newElements: string[] = [];
        elements.forEach((item) => {
            if (item === 'xsl:instruction') {
                let subElements = Object.keys(this.schema.substitutionGroups.instruction.elements);
                newElements = newElements.concat(subElements);
            } else if (item === 'xsl:declaration') {
                let subElements = Object.keys(this.schema.substitutionGroups.declaration.elements);
                newElements = newElements.concat(subElements);
            } else {
                newElements.push(item);
            }
        });
        return newElements;
    }
}

//let s1 = new SchemaQuery();
// an element in the instruction substitutionGroup:
//let result = s1.getExpected('xsl:analyze-string');
// an element declared on its own:
//let result = s1.getExpected('xsl:matching-substring');
//an element requiring recursive looku:
//let result = s1.getExpected('xsl:accumulator-rule');
// an element with attributeList:
//let result = s1.getExpected('xsl:global-context-item');
//let result = s1.getExpected('xsl:expose', 'visibility');
// let result = s1.getExpected('xsl:attribute', 'validation');
//let result = s1.getExpected('anyelement', 'xsl:expand-text');
//console.log(result);

