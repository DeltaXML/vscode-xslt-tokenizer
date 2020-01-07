// tslint:disable
import { XPathLexer, Token, TokenLevelState } from "./xpLexer";
import { Debug } from "./diagnostics";

// -------------
let testXpath: string =
	`for $a in 1 to 10 return ($a * 2)`;
let testTitle = `declaration`;
let generateTest = false;
let timerOnly = false;
let flatten = false;
// =============

generateTest = timerOnly? false: generateTest;
let debugOn;
if (timerOnly) {
	debugOn = false;
} else {
	debugOn = !generateTest;
}

let lexer: XPathLexer = new XPathLexer();
lexer.setDebug(debugOn);
lexer.setFlatten(flatten);
let tokens: Token[] = lexer.analyse(testXpath);


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
	console.log('===============');
	printTokenValues(testXpath);
}

function printTokenValues(xpathExpr: string) {
	let lines = testXpath.split(/\r\n|\r|\n/);
	for (let i = 0; i < tokens.length; i++) {
		let t: Token = tokens[i];
		if (t.tokenType.valueOf() !== TokenLevelState.Whitespace.valueOf()) {
			let line = t.line ? lines[t.line] : '';
			let sc = t.startCharacter ? t.startCharacter : 0;
			console.log(line.substr(sc, t.length) + '_');
		}
	}
}

