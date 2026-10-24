/**
 * Test suite for functions that the stylesheet's processing system provides, e.g. Java extension functions: calls of
 * functions with a prefix in the XSLT.validation.externalFunctionPrefixes setting aren't checked. An unknown function
 * with a prefix has a quick fix that adds the prefix to the setting - in the workspace's settings, or with no workspace,
 * the user's
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { DiagnosticCode, XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { XSLTCodeActions } from '../../src/xsltCodeActions';

const section = 'XSLT.validation';
const setting = 'externalFunctionPrefixes';

function stylesheet(select: string, namespaces = '') {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:ext="http://example.com/ext"${namespaces} version="3.0">\n  <xsl:template match="/"><xsl:sequence select="${select}"/></xsl:template>\n</xsl:stylesheet>`;
}

async function lint(select: string, namespaces = '') {
	const xslt = stylesheet(select, namespaces);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const lexer = new XslLexer(XSLTConfiguration.configuration);
	lexer.provideCharLevelState = true;
	const tokens = lexer.analyse(xslt);
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, DocumentTypes.XSLT, document, tokens, lexer.globalInstructionData, [], []);
	return { document, diagnostics };
}

const messages = async (select: string) => (await lint(select)).diagnostics.map((d) => d.message);

suite('Functions the processing system provides: XSLT.validation.externalFunctionPrefixes', () => {
	const config = () => vscode.workspace.getConfiguration(section);
	let saved: string[] | undefined;
	suiteSetup(() => {
		saved = config().inspect<string[]>(setting)?.globalValue;
	});
	teardown(async () => {
		await config().update(setting, saved, vscode.ConfigurationTarget.Global);
	});

	test('not in the setting: an unknown function with a prefix is reported, with its own code', async () => {
		const { diagnostics } = await lint('ext:lookup(1)');
		assert.deepEqual(diagnostics.map((d) => [d.message, d.code]), [['XPath: Function: \'ext:lookup\' with 1 arguments not found', DiagnosticCode.prefixedFunctionNotFound]]);
	});

	test('in the setting: not checked - a call, or a function reference', async () => {
		await config().update(setting, ['ext'], vscode.ConfigurationTarget.Global);
		assert.deepEqual(await messages('ext:lookup(1), ext:other(1, 2, 3)'), []);
		assert.deepEqual(await messages('ext:lookup#2'), []);
	});

	test('a prefix in the setting may be written with its colon', async () => {
		await config().update(setting, ['ext:'], vscode.ConfigurationTarget.Global);
		assert.deepEqual(await messages('ext:lookup(1)'), []);
	});

	test('a \'java:\' namespace\'s functions - Saxon calls the Java class\'s methods - aren\'t checked, without the setting', async () => {
		await config().update(setting, undefined, vscode.ConfigurationTarget.Global);
		// including 'math', when it's bound to a Java class rather than the XPath math functions
		const namespaces = ' xmlns:g="java:demo.Greeter" xmlns:math="java:java.lang.Math"';
		assert.deepEqual((await lint('g:greet(\'a\'), g:greet#1, math:abs(-1), math:floorMod(7, 2)', namespaces)).diagnostics.map((d) => d.message), []);
		// a namespace that isn't 'java:' is still checked
		assert.lengthOf((await lint('ext:lookup(1)', namespaces)).diagnostics, 1);
	});

	test('still reported: a prefix that isn\'t declared, and an unknown function without one', async () => {
		await config().update(setting, ['ext', 'other'], vscode.ConfigurationTarget.Global);
		const { diagnostics } = await lint('other:f(1), nosuch(1)');
		assert.lengthOf(diagnostics, 2);
		assert.match(diagnostics[0].message, /other/);
		assert.strictEqual(diagnostics[1].code, DiagnosticCode.unresolvedGenericRef);
	});

	test('the quick fix: adds the prefix to the setting', async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		await config().update(setting, undefined, vscode.ConfigurationTarget.Global);
		const { document, diagnostics } = await lint('ext:lookup(1), ext:other(2)');
		const actions = new XSLTCodeActions().provideCodeActions(document, diagnostics[0].range, { diagnostics, triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
		const fixes = actions.filter((a) => a.command?.command === 'xslt-xpath.addExternalFunctionPrefix');
		const where = vscode.workspace.workspaceFolders ? 'this workspace' : 'user settings';
		// one fix for the prefix, though two functions have it
		assert.deepEqual(fixes.map((a) => a.title), [`Don't report unknown 'ext:' functions in ${where}`]);
		if (!vscode.workspace.workspaceFolders) {
			await vscode.commands.executeCommand(fixes[0].command!.command, ...fixes[0].command!.arguments!);
			assert.deepEqual(config().inspect<string[]>(setting)?.globalValue, ['ext']);
			assert.deepEqual(await messages('ext:lookup(1)'), []);
			// not added twice
			await vscode.commands.executeCommand(fixes[0].command!.command, ...fixes[0].command!.arguments!);
			assert.deepEqual(config().inspect<string[]>(setting)?.globalValue, ['ext']);
		}
	});
});
