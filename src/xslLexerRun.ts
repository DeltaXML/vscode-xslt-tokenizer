// tslint:disable
import { Token, TokenLevelState, ExitCondition, LexPosition } from "./xpLexer";
import { XslLexer, XslToken } from "./xslLexer";
import { XslDebug } from "./xslDiagnostics";
import { Position } from "vscode";

// -------------
let testXslt: string =
`new`;
let testTitle = `declaration`;
let generateTest = false;
let timerOnly = false;
let flatten = true; // set true for vscode extension tokens
// =============

generateTest = timerOnly? false: generateTest;
let debugOn;
if (timerOnly) {
	debugOn = false;
	testXslt = testXslt.repeat(5000);
} else {
	debugOn = !generateTest;
}

let lexer: XslLexer = new XslLexer();
lexer.debug = debugOn;
lexer.flatten = flatten;
lexer.timerOn = timerOnly;
let pos: LexPosition = {line: 0, startCharacter: 0};
let tokens: XslToken[]|Token[] = lexer.analyse(testXslt);


if (generateTest) {
	XslDebug.printMinSerializedTokens(testTitle, testXslt, tokens);
} else if (timerOnly) {
	console.log("XPath length: " + testXslt.length);
	console.log("Token Count:" + tokens.length);
} else {
	console.log('---------------');
	console.log(testXslt);
	console.log('---------------');
	XslDebug.printResultTokens(tokens);
	if (flatten) {
		console.log('===============');
		printTokenValues(testXslt);
	}
}

function printTokenValues(xpathExpr: string) {
	let lines = xpathExpr.split(/\r\n|\r|\n/);
	console.log('line count: ' + lines.length);
	console.log('token count: ' + tokens.length);
	for (let i = 0; i < tokens.length; i++) {
		let t: Token = tokens[i];
		if (t.tokenType.valueOf() !== TokenLevelState.Whitespace.valueOf()) {
			let line = lines[t.line];
			let sc = t.startCharacter ? t.startCharacter : 0;
			console.log(line.substr(sc, t.length) + '_');
		}
	}
}

