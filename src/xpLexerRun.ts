// tslint:disable
import { XPathLexer, Token, TokenLevelState, ExitCondition, LexPosition } from "./xpLexer";
import { Debug } from "./diagnostics";

// -------------
let testXpath: string =
`let $ac := function($a) as function(*) {function($b) {$b + 1}} return $a`;
let testTitle = `declaration`;
let generateTest = true;
let timerOnly = false;
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
	console.log('===============');
	Debug.printTokenValues(testXpath, tokens);
}

