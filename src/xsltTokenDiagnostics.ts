/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - xmlDocumentFormattingProvider
 */
import * as vscode from 'vscode';
import { XslLexer, XMLCharState, XSLTokenLevelState, LanguageConfiguration} from './xslLexer';
import { CharLevelState, TokenLevelState, BaseToken } from './xpLexer';

enum HasCharacteristic {
	unknown,
	yes,
	no
}

enum TagType {
	XSLTstart,
	XMLstart,
	XSLTvar,
	Start,
	NonStart
}

enum AttributeType {
	None,
	Variable
}

interface ElementData {
	variables: VariableData[]
	currentVariable?: VariableData,

}

interface VariableData {
	token: BaseToken,
	name: string;
}

export class XsltTokenDiagnostics {

	private static readonly xsltStartTokenNumber = XslLexer.getXsltStartTokenNumber();
	private static readonly xslVariable = ['xsl:variable', 'xsl:param'];
	private static readonly xslFunction = 'xsl:function';

	private static readonly xslNameAtt = 'name';

	public static calculateDiagnostics = (document: vscode.TextDocument, allTokens: BaseToken[]): vscode.Diagnostic[] => {
		let lineNumber = -1;

		let inScopeVariablesList: VariableData[] = [];
		let elementStack: ElementData[] = [];
		let tagType = TagType.NonStart;
		let attType = AttributeType.None;
		let tagElementName = '';
		let preXPathVariable = false;
		let variableData: VariableData|null = null;
		let xsltVariableDeclarations: BaseToken[] = [];

		allTokens.forEach((token) => {
			lineNumber = token.line;

			let isXMLToken = token.tokenType >= XsltTokenDiagnostics.xsltStartTokenNumber;
			if (isXMLToken) {
				let xmlCharType = <XMLCharState>token.charType;
				let xmlTokenType = <XSLTokenLevelState>(token.tokenType - XsltTokenDiagnostics.xsltStartTokenNumber);
				switch (xmlTokenType) {
					case XSLTokenLevelState.xslElementName:
						if (tagType === TagType.Start) {
							tagElementName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							tagType = (XsltTokenDiagnostics.xslVariable.indexOf(tagElementName) > -1)? TagType.XSLTvar: TagType.XSLTstart;
						}
						break;
					case XSLTokenLevelState.elementName:
						if (tagType === TagType.Start) tagType = TagType.XMLstart;
						break;
					case XSLTokenLevelState.xmlPunctuation:
						switch (xmlCharType) {
							case XMLCharState.lSt:
								variableData = null;
								tagElementName = '';
								tagType = TagType.Start;
								break;
							case XMLCharState.rStNoAtt:
							case XMLCharState.rSt:
								// start-tag ended, we're now within the new element scope:
								if (variableData != null) {
									elementStack.push({currentVariable: variableData, variables: inScopeVariablesList});
									xsltVariableDeclarations.push(variableData.token);
								} else {
									elementStack.push({variables: inScopeVariablesList});
								}
								inScopeVariablesList = [];
								tagType = TagType.NonStart;
								break;
							case XMLCharState.rSelfCt:
								// it may be a self-closed variable:
								if (variableData != null) {
									inScopeVariablesList.push(variableData);
									xsltVariableDeclarations.push(variableData.token);
								}
								break;
							case XMLCharState.lCt:
								// start of an element close-tag:
								if (elementStack.length > 0) {
									let poppedData = elementStack.pop();
									inScopeVariablesList = (poppedData)? poppedData.variables: [];
									if (poppedData?.currentVariable) {
										inScopeVariablesList.push(poppedData.currentVariable);
									}
								}
								break;
						}
						break;
					case XSLTokenLevelState.attributeName:
						if (tagType === TagType.XSLTvar) {
							let attNameText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							attType = attNameText === XsltTokenDiagnostics.xslNameAtt? AttributeType.Variable: AttributeType.None;
						}
						break;
					case XSLTokenLevelState.attributeValue:
						if (attType === AttributeType.Variable) {
							let fullVariableName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							let variableName = fullVariableName.substring(1, fullVariableName.length - 1);
							variableData = {token: token, name: variableName};
						}
						attType = AttributeType.None;
						break;
				}

			} else {
				let xpathCharType = <CharLevelState>token.charType;
				let xpathTokenType = <TokenLevelState>token.tokenType;


				switch (xpathTokenType) {
					case TokenLevelState.variable:
						if (!preXPathVariable) {
							XsltTokenDiagnostics.resolveVariableReference(document, token, inScopeVariablesList, elementStack);
						}
						preXPathVariable = false;
						break;
					case TokenLevelState.complexExpression:
						let valueText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						switch (valueText) {
							case 'every':
							case 'for':
							case 'let':
							case 'some':
								preXPathVariable = true;
							case 'then':
								//ifElseStack.push(1);
								break;
							case 'return':
							case 'satisfies':
							case 'else':
								// if (ifElseStack.length > 0) {
								// 	ifElseStack.pop();
								// }
								break;
						}
						break;
					case TokenLevelState.operator:
						switch (xpathCharType) {
							case CharLevelState.lB:
							case CharLevelState.lPr:
							case CharLevelState.lBr:	
								//complexStateStack.push([0, []]);							
								break;
							case CharLevelState.rB:
							case CharLevelState.rPr:
							case CharLevelState.rBr:
								// if (complexStateStack.length > 0) {
								// 	complexStateStack.pop();
								// } else {
								// }
								break;
							case CharLevelState.dSep:
								let valueText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
								if (valueText === ':=') {

								}
								break;
						}
						break;
				}
			}
		});
		return XsltTokenDiagnostics.getProblemTokens(xsltVariableDeclarations);
	}

	private static getTextForToken(lineNumber: number, token: BaseToken, document: vscode.TextDocument) {
		let startPos = new vscode.Position(lineNumber, token.startCharacter);
		let endPos = new vscode.Position(lineNumber, token.startCharacter + token.length);
		const currentLine = document.lineAt(lineNumber);
		let valueRange = currentLine.range.with(startPos, endPos);
		let valueText = document.getText(valueRange);
		return valueText;
	}

	private static resolveVariableReference(document: vscode.TextDocument, variableReference: BaseToken, inScopeVariables: VariableData[], elementStack: ElementData[]) {
		let fullVarName = XsltTokenDiagnostics.getTextForToken(variableReference.line, variableReference, document);
		let varName = fullVarName.substr(1);

		let resolved = false;
		for (let data of inScopeVariables) {
			if (data.name === varName) {
				resolved = true;
				data.token['referenced'] = true;
				break;
			}
		}
		if (!resolved) {
			for (let i = elementStack.length - 1; i > -1; i--) {
				let inheritedVariables = elementStack[i].variables;
				for (let data of inheritedVariables) {
					if (data.name === varName) {
						resolved = true;
						data.token['referenced'] = true;
						break;
					}
				}
				if (resolved) {
					break;
				}
			}			
		}
	}

	private static getProblemTokens(tokens: BaseToken[]): vscode.Diagnostic[] {
		let result = [];
		for (let token of tokens) {
			if (token.referenced === undefined) {
				result.push(this.createDiagnostic(token));
			}
		}
		return result;
	}


	private static createDiagnostic(token: BaseToken): vscode.Diagnostic {
		let line = token.line;
		let endChar = token.startCharacter + token.length;
		return {
			code: '',
			message: 'variable is unused',
			range: new vscode.Range(new vscode.Position(line, token.startCharacter), new vscode.Position(line, endChar)),
			severity: vscode.DiagnosticSeverity.Hint,
			tags: [vscode.DiagnosticTag.Unnecessary],
			source: '',
		}
	}

	private static createDiagnosticExtra(document: vscode.TextDocument, token: BaseToken): vscode.Diagnostic {
		let line = token.line;
		let endChar = token.startCharacter + token.length;
		return {
			code: '',
			message: 'variable is unused',
			range: new vscode.Range(new vscode.Position(line, token.startCharacter), new vscode.Position(line, endChar)),
			severity: vscode.DiagnosticSeverity.Hint,
			tags: [vscode.DiagnosticTag.Unnecessary],
			source: '',
			relatedInformation: [
				new vscode.DiagnosticRelatedInformation(new vscode.Location(document.uri, new vscode.Range(new vscode.Position(1, 8), new vscode.Position(1, 9))), 'first assignment to `x`')
			]
		}
	}
}
