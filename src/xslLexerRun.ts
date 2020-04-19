// tslint:disable
import { BaseToken } from "./xpLexer";
import { XslLexer } from "./xslLexer";
import { Debug } from "./diagnostics";
import {XSLTConfiguration} from './languageConfigurations';


// -------------
let testXslt: string =
`<b s="q{{k}}"/>`;
let testTitle = `declaration`;
let generateTest = false;
let timerOnly = false;
// =============

generateTest = timerOnly? false: generateTest;
let debugOn;
if (timerOnly) {
	debugOn = false;
	testXslt = testXslt.repeat(5000);
} else {
	debugOn = !generateTest;
}

let lexer = new XslLexer(XSLTConfiguration.configuration);

lexer.debug = debugOn;
lexer.timerOn = timerOnly;

let tokens: BaseToken[] = lexer.analyse(testXslt);
Debug.printTokenValues(testXslt, tokens);

