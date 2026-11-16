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
import { XMLDocumentFormattingProvider } from '../../src/xmlDocumentFormattingProvider';

const xsltNamespace = 'http://www.w3.org/1999/XSL/Transform';

// the module with XSLT as its default namespace: its element names lose the prefix xsl, which stays bound, e.g. for
// system-property('xsl:version')
// - declared at the end of the outermost start tag, which keeps its layout, e.g. with its attributes on the lines after
const toDefault = (text: string) => text.replace(/(<\/?)xsl:/g, '$1').replace(/(<(?:stylesheet|transform|package)\b[^>]*?)(\/?>)/, `$1 xmlns="${xsltNamespace}"$2`);

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

	samples.forEach((sample) => {
		test(`the same formatting: ${sample.name}`, async () => {
			// as the xsl prefix's, apart from a continuation line aligned with an attribute of the tag it continues: less
			// indented by the length of 'xsl:', e.g. version="3.0" under xmlns:xs on <stylesheet
			const formattedDefault = await formatted(toDefault(sample.text));
			const expected = toDefault((await formatted(sample.text)).join('\n')).split('\n');
			const differences = formattedDefault.map((line, i) => ({ line, expected: expected[i], i })).filter((d) => d.line !== d.expected);
			assert.deepEqual(differences.filter((d) => !isAlignedContinuation(formattedDefault, d.i) || d.expected === undefined || ' '.repeat(4) + d.line !== d.expected), []);
		});
	});

	test('formatting: elements are indented by nesting level, end tags outdented, and xsl:text and xsl:note kept', async () => {
		const withDefault = (body: string[]) => [`<stylesheet xmlns="${xsltNamespace}" xmlns:out="urn:out" version="3.0">`, ...body, '</stylesheet>'];
		const lines = await formatted(withDefault(['<template match="/">', '<if test="true()">', '<out:a>', '<value-of select="1"/>', '</out:a>', '</if>',
			'<text>  a', '     b</text>', '</template>']).join('\n'));
		assert.deepEqual(lines, withDefault(['  <template match="/">', '    <if test="true()">', '      <out:a>', '        <value-of select="1"/>', '      </out:a>', '    </if>',
			'    <text>  a', '     b</text>', '  </template>']));
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

// the lines of a module, formatted with 2 spaces for each level
async function formatted(text: string) {
	const file = path.join(problemsDir, `module${problemsCount++}.xsl`);
	fs.writeFileSync(file, text);
	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
	const edits = new XMLDocumentFormattingProvider(XSLTConfiguration.configuration).provideDocumentFormattingEdits(document, { tabSize: 2, insertSpaces: true }, new vscode.CancellationTokenSource().token);
	return applied(text, edits.map((e) => ({ start: document.offsetAt(e.range.start), end: document.offsetAt(e.range.end), text: e.newText }))).split('\n');
}

// the text with the edits made, which don't overlap
function applied(text: string, edits: { start: number, end: number, text: string }[]) {
	return [...edits].sort((a, b) => b.start - a.start).reduce((result, e) => result.substring(0, e.start) + e.text + result.substring(e.end), text);
}

// whether a line continues a tag or an expression from the line before - not the start of an element or other markup
function isAlignedContinuation(lines: string[], index: number) {
	return index > 0 && !/^\s*<(?!=)/.test(lines[index]);
}

// the diagnostics of a document once it's linted, waiting up to 10 seconds for the first
async function waitForDiagnostics(uri: vscode.Uri) {
	for (let i = 0; i < 100 && vscode.languages.getDiagnostics(uri).length === 0; i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return vscode.languages.getDiagnostics(uri);
}
