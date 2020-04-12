// tslint:disable
import { BaseToken } from "./xpLexer";
import { XslLexer } from "./xslLexer";
import { Debug } from "./diagnostics";
import {XSLTConfiguration} from './languageConfigurations';


// -------------
let testXslt: string =
`<?xml version="1.0" encoding="UTF-8"?>`;
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

let lexer = new XslLexer(XSLTConfiguration.configuration);

lexer.debug = debugOn;
lexer.flatten = flatten;
lexer.timerOn = timerOnly;

let tokens: BaseToken[] = lexer.analyse(testXslt);
if (flatten) {
	Debug.printTokenValues(testXslt, tokens);
}

