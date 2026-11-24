/**
 * Test suite for the XPath version of 'Find Nodes with XPath's query file (queries.xpath), chosen in the status bar:
 * as XPath 3.1 (as in XSLT 3.0), its expressions are checked and completed as 3.1 - XPath 4.0 syntax and functions are
 * reported, and 4.0 functions and axes aren't offered - and as 4.0, as other XPath documents always are.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XPathConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes } from '../../src/xslLexer';
import { ExitCondition, LexPosition, XPathLexer } from '../../src/xpLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { XPathVersion } from '../../src/xpathVersion';

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'xpath-query-version-'));
let fileCount = 0;

// in a folder of its own: a file already open isn't read again
async function openXPath(fileName: string, text: string) {
	const fileFolder = path.join(folder, String(++fileCount));
	fs.mkdirSync(fileFolder);
	const file = path.join(fileFolder, fileName);
	fs.writeFileSync(file, text);
	const document = await vscode.workspace.openTextDocument(file);
	return document.languageId === 'xpath' ? document : vscode.languages.setTextDocumentLanguage(document, 'xpath');
}

// as the extension checks an XPath document (XPathSemanticTokensProvider.provideXPathProblems)
function problems(document: vscode.TextDocument) {
	const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
	const allTokens = new XPathLexer().analyse(document.getText(), ExitCondition.None, lexPosition);
	return XsltTokenDiagnostics.calculateDiagnostics(XPathConfiguration.configuration, DocumentTypes.XPath, document, allTokens, [], [], [])
		.map((d) => d.message);
}

async function completionLabels(document: vscode.TextDocument) {
	const end = document.positionAt(document.getText().length);
	const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, end);
	return list.items.map((item) => typeof item.label === 'string' ? item.label : item.label.label);
}

async function setVersion(version: '3.1' | '4.0') {
	if (XPathVersion.getQueryFileVersion() !== version) {
		await vscode.commands.executeCommand('xslt-xpath.toggleXPathQueryVersion');
	}
	assert.strictEqual(XPathVersion.getQueryFileVersion(), version);
}

const xpath40Only = ["{ 'a': 1 }", "characters('abc')", '(-1, -2) =!> abs()', 'if (true()) { 1 }', '0x1F'];
// '->' too: Saxon allows it in XPath 3.1, even without syntax extensions
const xpath31 = ["map { 'a': 1 }?a", 'count(//item)', 'for $i in 1 to 3 return $i * 2', '(1, 2) -> sum(.)'];

suite('Find Nodes with XPath: the query file\'s XPath version', () => {
	let original: '3.1' | '4.0';
	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		original = XPathVersion.getQueryFileVersion();
	});
	suiteTeardown(async () => {
		await setVersion(original);
	});

	test('as XPath 3.1, XPath 4.0 syntax and functions are reported', async () => {
		await setVersion('3.1');
		for (const xpath of xpath40Only) {
			assert.isNotEmpty(problems(await openXPath('queries.xpath', xpath)), xpath);
		}
		for (const xpath of xpath31) {
			assert.deepEqual(problems(await openXPath('queries.xpath', xpath)), [], xpath);
		}
	});

	test('as XPath 4.0, they are not', async () => {
		await setVersion('4.0');
		for (const xpath of xpath40Only.concat(xpath31)) {
			assert.deepEqual(problems(await openXPath('queries.xpath', xpath)), [], xpath);
		}
	});

	test('other XPath documents are XPath 4.0, whatever the query file\'s version', async () => {
		await setVersion('3.1');
		for (const xpath of xpath40Only) {
			assert.deepEqual(problems(await openXPath('other.xpath', xpath)), [], xpath);
		}
	});

	test('completion offers XPath 4.0 functions only as XPath 4.0', async () => {
		await setVersion('3.1');
		const labels31 = await completionLabels(await openXPath('queries.xpath', 'count(//item) + c'));
		assert.isTrue(labels31.some((label) => label.startsWith('count')), 'count in 3.1');
		assert.isFalse(labels31.some((label) => label.startsWith('characters')), 'no characters in 3.1');
		await setVersion('4.0');
		const labels40 = await completionLabels(await openXPath('queries.xpath', 'count(//item) + c'));
		assert.isTrue(labels40.some((label) => label.startsWith('characters')), 'characters in 4.0');
	});
});
