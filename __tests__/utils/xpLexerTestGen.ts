/**
 * Test Data Generator for XPath Lexer
 * 
 * This module generates test data for the XPath lexer by processing input test cases
 * and producing expected token outputs. It takes a JSON input file containing test cases
 * and generates a corresponding JSON output file with lexer analysis results.
 * 
 * @module xpLexerTestGen
 * 
 * Usage:
 * ```
 * xpLexerTestGen --file <filename>
 * ```
 * 
 * The input JSON file should contain:
 * - suite: Test suite name
 * - descriptor: Test suite description
 * - testCases: Array of [label, xpath] pairs to be analyzed
 * 
 * Output includes:
 * - Token analysis results for each test case
 * - Metadata about the generator
 * - Version information for the extension when this was generated
 * 
 * The generated output file is saved in the test data directory with "-expected.json" suffix
 */
import { XPathLexer, ExitCondition, LexPosition, TokenLevelState } from '../../src/xpLexer';
import fs = require('fs');
import path = require('path');
import { TestPaths } from './testPaths';
import { RawLexerTestData } from '../types';

function generator() {
	const args = process.argv.slice(2);
	let testDataFile = "";
	if (args.length !== 2) {
		console.log("Usage: xpLexerTestGen --file <filename>");
		return;
	} else {
		testDataFile = args[1];
	}
	console.log("Test Data File: " + testDataFile);
	const rawTestData: RawLexerTestData = JSON.parse(fs.readFileSync(testDataFile, 'utf8'));
	const { suite, descriptor, testCases } = rawTestData;

	const metadata = getMetadata();

	const lexer = new XPathLexer();
	const position: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
	const entries: any[] = [];

	testCases.forEach(([label, xpath]) => {
		const isTypeDeclaration = true;
		const tokensOut = lexer.analyse(xpath, ExitCondition.None, position, isTypeDeclaration);
		const tokens = tokensOut.map(token => [token.value, TokenLevelState[token.tokenType]]);
		entries.push({ label, xpath, tokens });
	});
	const outputPath = path.join(TestPaths.testDataDir, suite + "-expected.json");
	fs.writeFileSync(outputPath, JSON.stringify({ suite, description: descriptor, metadata, tests: entries }, null, 2));
	console.log("Generated expected test data saved to: " + outputPath);
};
generator();

function getMetadata() {
	const generator = path.basename(__filename);
	const packageJsonPath = path.join(__dirname, '../../../package.json');
	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
	const version = packageJson.version;
	return { moduleName: generator, version };
}
