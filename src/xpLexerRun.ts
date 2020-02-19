// tslint:disable
import { XPathLexer, Token, TokenLevelState, ExitCondition, LexPosition } from "./xpLexer";
import { Debug } from "./diagnostics";
import { Position } from "vscode";

// -------------
let testXpath: string =
`let $ac := function($a) as function(*) {function($b) {$b + 1}} return $a`;
let testTitle = `declaration`;
let generateTest = false;
let timerOnly = false;
let flatten = false; // set true for vscode extension tokens
// =============

generateTest = timerOnly? false: generateTest;
let debugOn;
if (timerOnly) {
	debugOn = false;
	testXpath = testXpath.repeat(5000);
} else {
	debugOn = !generateTest;
}

let lexer: XPathLexer = new XPathLexer();
lexer.debug = debugOn;
lexer.flatten = flatten;
lexer.timerOn = timerOnly;
let pos: LexPosition = {line: 0, startCharacter: 0, documentOffset: 0};
let tokens: Token[] = lexer.analyse(testXpath, ExitCondition.CurlyBrace, pos);


if (generateTest) {
	Debug.printMinSerializedTokens(testTitle, testXpath, tokens);
} else if (timerOnly) {
	console.log("XPath length: " + testXpath.length);
	console.log("Token Count:" + tokens.length);
} else {
	console.log('---------------');
	console.log(testXpath);
	console.log('---------------');
	Debug.printResultTokens(tokens);
	if (flatten) {
		console.log('===============');
		printTokenValues(testXpath);
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

