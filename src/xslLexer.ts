export enum XMLCharState {
    init,// 0 initial state
    lSt,  // 1 left start tag
    rSt,  // 2 right start tag
    lC,  // 3 left comment
	rC,  // 4 right comment
	lPi, // 5 left processing instruction
	rPi, // 6 right processing instruction
	lCd, // 7 left cdata
	rCd, // 8 right cdata
    lSq, // 9 left single quote att
    rSq, // 10 right single quote att
    lDq, // 11 left double quote att
    rDq, // 12 right double quote att
    lDtd, // 8 left dtd declaration
    rDtd, // 10 right dtd declaration
	lWs,  // 13 whitspace char start
	lCt,  // 1 left close tag
	rCt,  // 2 right close tag
	lEn,  // left element-name
	rEn,  // right element-name
	lAn,  // left atrribute-name
	rAn,  // right attribute-name  
	eqA,  // attribute = symbol
}

export enum XSLTokenState {
    // the comment shows the adopted TM name:
    TemplateName,    // struct
    VariableName,
    ParameterName,
    FunctionName,       // macro
    TemplateMatch,
    LiteralElement,
    Whitespace, // not used
    XslSelect,
    XslAttribute, // constant
    XslInstruction,   // parameter
}
