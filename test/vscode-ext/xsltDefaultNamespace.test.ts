/**
 * Test suite for an XSLT module with XSLT as its default namespace, e.g. <stylesheet xmlns="http://www.w3.org/1999/XSL/Transform">
 * with <template> and <function> elements: its XSLT elements are those with no prefix. Each sample stylesheet without
 * literal result elements in no namespace, with its xsl: element names written without the prefix, has the same problems
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { RecordTypes } from '../../src/recordTypes';

const xsltNamespace = 'http://www.w3.org/1999/XSL/Transform';

// the module with XSLT as its default namespace: its element names lose the prefix xsl, which stays bound, e.g. for
// system-property('xsl:version')
const toDefault = (text: string) => text.replace(/(<\/?)xsl:/g, '$1').replace(/(<(?:stylesheet|transform|package)\b)/, `$1 xmlns="${xsltNamespace}"`);

// the documents checked: files, not untitled documents (see xsltPrefix.test.ts)
const problemsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-default-ns-'));
let problemsCount = 0;

async function problems(text: string) {
	const lexer = new XslLexer(XSLTConfiguration.configuration);
	lexer.provideCharLevelState = true;
	const tokens = lexer.analyse(text);
	const file = path.join(problemsDir, `module${problemsCount++}.xsl`);
	fs.writeFileSync(file, text);
	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
	const config = { ...XSLTConfiguration.configuration, isVersion4: lexer.isXSLT40 };
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(config, DocumentTypes.XSLT, document, tokens, lexer.globalInstructionData, [], []);
	return { lines: diagnostics.map((d) => `${d.range.start.line}: ${d.message}`), globals: lexer.globalInstructionData.map((g) => `${g.type} ${g.name}`) };
}

suite('XSLT as the default namespace', function () {
	this.timeout(60000);
	suiteTeardown(() => fs.rmSync(problemsDir, { recursive: true, force: true }));
	const sampleDir = path.join(__dirname, '..', '..', '..', 'sample');
	const withoutComments = (text: string) => text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
	const samples = fs.readdirSync(sampleDir).filter((f) => f.endsWith('.xsl'))
		.map((f) => ({ name: f, text: fs.readFileSync(path.join(sampleDir, f), 'utf8') }))
		.filter((s) => /<xsl:(stylesheet|transform|package)[\s>]/.test(s.text) && /xmlns:xsl=/.test(s.text) && !/\sxmlns\s*=/.test(s.text) &&
			// no literal result elements in no namespace, which would become XSLT elements
			!/<[A-Za-z_][\w.-]*[\s/>]/.test(withoutComments(s.text).replace(/<\?[\s\S]*?\?>/g, '')));

	test('the samples', () => {
		assert.isAbove(samples.length, 20);
	});

	samples.forEach((sample) => {
		test(`the same problems and declarations: ${sample.name}`, async () => {
			assert.deepEqual(await problems(toDefault(sample.text)), await problems(sample.text));
		});
	});

	test('the lexer: elements with no prefix are XSLT, and prefixed ones literal result elements', () => {
		const text = `<stylesheet xmlns="${xsltNamespace}" xmlns:f="urn:f" xmlns:out="urn:out" version="3.0">\n` +
			'<function name="f:double"><param name="n"/><sequence select="$n * 2"/></function>\n' +
			'<template match="/"><out:result><value-of select="f:double(2)"/></out:result></template>\n</stylesheet>';
		const lexer = new XslLexer(XSLTConfiguration.configuration);
		lexer.analyse(text);
		assert.strictEqual(lexer.nativePrefix, '');
		assert.deepEqual(lexer.globalInstructionData.map((g) => g.name), ['f:double', '#1']);
		assert.strictEqual(XslLexer.rootPrefix(text), '');
	});

	test('a root element with no prefix in another namespace: a missing namespace declaration', async () => {
		const result = await problems('<stylesheet version="3.0">\n<template match="/"/>\n</stylesheet>');
		assert.deepEqual(result.lines, [`0: Expected on the root element: xmlns='${xsltNamespace}' default namespace declaration`]);
	});

	test('text helpers: names, patterns and inserted text', () => {
		const text = `<stylesheet xmlns="${xsltNamespace}" version="3.0"><iterate select="1"></iterate></stylesheet>`;
		assert.strictEqual(RecordTypes.xsltPrefix(text), '');
		assert.strictEqual(RecordTypes.xsltName('iterate', ''), 'xsl:iterate');
		assert.strictEqual(RecordTypes.xsltName('out:iterate', ''), 'out:iterate');
		assert.strictEqual(RecordTypes.xsltTag(text, 'iterate'), '<iterate');
		assert.isTrue(RecordTypes.xsltPattern(/<xsl:iterate[\s>]/, text).test(text));
		assert.isTrue(RecordTypes.xsltPattern(/<(xsl:iterate|xsl:break)[\s>]/, text).test(text));
		assert.strictEqual(RecordTypes.withXsltPrefix('<xsl:when test="xsl:original()"></xsl:when>', ''), '<when test="xsl:original()"></when>');
		assert.deepEqual(RecordTypes.openElements(text, text.indexOf('select')).map((e) => e.name), ['xsl:stylesheet', 'xsl:iterate']);
	});

	test('a Schematron schema: functions from an included module with XSLT as its default namespace', async () => {
		const dir = fs.mkdtempSync(path.join(problemsDir, 'sch-'));
		fs.writeFileSync(path.join(dir, 'functions.xsl'), `<stylesheet xmlns="${xsltNamespace}" xmlns:f="urn:f" version="2.0">\n` +
			'<function name="f:double"><param name="n"/><sequence select="$n * 2"/></function>\n</stylesheet>');
		const schFile = path.join(dir, 'rules.sch');
		fs.writeFileSync(schFile, '<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" queryBinding="xslt2">\n' +
			'<sch:ns prefix="f" uri="urn:f"/>\n<xsl:include href="functions.xsl"/>\n' +
			'<sch:pattern><sch:rule context="/"><sch:assert test="f:double(1) = 2 and f:missing(1)">ok</sch:assert></sch:rule></sch:pattern>\n</sch:schema>');
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(schFile));
		await vscode.window.showTextDocument(document);
		// linted: f:missing isn't declared - but f:double, declared in the included module, is
		const diagnostics = await waitForDiagnostics(document.uri);
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		assert.strictEqual(diagnostics.length, 1, diagnostics.map((d) => d.message).join('\n'));
		assert.include(diagnostics[0].message, 'f:missing');
	});
});

// the diagnostics of a document once it's linted, waiting up to 10 seconds for the first
async function waitForDiagnostics(uri: vscode.Uri) {
	for (let i = 0; i < 100 && vscode.languages.getDiagnostics(uri).length === 0; i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return vscode.languages.getDiagnostics(uri);
}
