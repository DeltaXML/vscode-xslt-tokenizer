// tslint:disable
import { XPathLexer, Token, TokenLevelState } from "./xpLexer";
import { Debug } from "./diagnostics";

// -------------
let testXpath: string =
`$a eq &apos;
the quick brown
&apos; and $b`;
let testTitle = `declaration`;
let generateTest = false;
let timerOnly = false;
let flatten = true; // set true for vscode extension tokens
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

