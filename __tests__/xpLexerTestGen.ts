import { Console } from 'console';
import { XPathLexer, ExitCondition, LexPosition, TokenLevelState } from '../src/xpLexer';
const fs = require('fs');
const path = require('path');

const generator = () => {
	// Each test case: [label, asAttributeValue]
	const dirName = "__tests__";
	const suite = "xpInAsAttribute";
	const descriptor = "Verify tokens for XPath within 'as' attribute";
	const testCases: Array<[string, string]> = [
		['test1', 'xs:integer'],
		['test2', 'map(xs:integer, map(xs:string, array(xs:integer*)))?'],
		['test3', 'xs:integer+'],
		['test4', 'element(books)'],
		['test5', '(function(element()) as xs:string)?'],
		['test6', 'xs:boolean'],
		['test7', 'document-node(element(abc))'],
		['test8', 'xs:anyAtomicType'],
		['test9', 'xs:numeric'],
		['test10', 'array(*)?'],
		['test11', 'map(*)'],
		['test12', 'array(map(xs:string, xs:integer))?'],
		['test13', 'element(ct:book)'],
		['test14', 'attribute(book)'],
		['test15', 'attribute()'],
		['test16', 'attribute(*, xs:date)'],
		['test17', 'element(*, xs:integer)'],
		['test18', 'element(as)'],
		['test19', 'function(*)'],
	];

	const lexer = new XPathLexer();
	const position: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
	const entries: any[] = [];
	testCases.forEach(([label, xpath]) => {
		const tokensOut = lexer.analyse(xpath, ExitCondition.None, position, true);
		const tokens = tokensOut.map(token => [token.value, TokenLevelState[token.tokenType]]);
		entries.push({ label, xpath, tokens });
	});
	const outputPath = path.join(dirName, suite + ".json");
	fs.writeFileSync(outputPath, JSON.stringify({ suite, description: descriptor, tests: entries }, null, 2));
	console.log("Generated expected test data saved to: " + outputPath);
};
generator();