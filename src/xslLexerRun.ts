// tslint:disable
import { BaseToken } from "./xpLexer";
import { XslLexer } from "./xslLexer";

// -------------
let testXslt: string =
`<xsl:f select="$a" expand-text="yes"><xsl:a select="$b"`;
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

let tokens: BaseToken[] = lexer.analyse(testXslt);

