/**
 * Test suite for XPath 4.0's node comparison operators - is-not, precedes, follows, precedes-or-is and follows-or-is, as
 * well as XPath 3.1's is, << and >> - which Saxon 13 supports, and Saxon 12.8 doesn't, even with syntax extensions: they
 * are operators after an operand, as 'is' is - otherwise names, e.g. of an element named 'precedes' - and they're
 * reported before XPath 4.0, and offered as completions after an operand.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { TokenLevelState } from '../../src/xpLexer';

const stylesheet = (select: string, version: string) => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="${version}">
<xsl:template match="/"><xsl:variable name="a" select="*"/><xsl:variable name="doc" select="/"/><xsl:sequence select="${select}"/><xsl:sequence select="$a, $doc"/></xsl:template>
</xsl:stylesheet>`;

// the diagnostics, and the token type of each token of the select
async function analyse(select: string, version: string) {
	const text = stylesheet(select, version);
	const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
	const lexer = new XslLexer(XSLTConfiguration.configuration);
	lexer.provideCharLevelState = true;
	const tokens = lexer.analyse(text);
	const isVersion4 = version === '4.0';
	const messages = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4 }, isVersion4 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT, document, tokens, lexer.globalInstructionData, [], []).map((d) => d.message);
	const start = text.indexOf(select);
	const types = tokens.filter((t) => t.tokenType < XslLexer.getXsltStartTokenNumber()).filter((t) => {
		const offset = document.offsetAt(new vscode.Position(t.line, t.startCharacter));
		return offset >= start && offset < start + select.length;
	}).map((t) => `${t.value}:${TokenLevelState[t.tokenType]}`);
	return { messages, types };
}

const operators = ['is-not', 'precedes', 'follows', 'precedes-or-is', 'follows-or-is'];

suite('Node comparisons', () => {
	operators.forEach((operator) => {
		test(`XPath 4.0: ${operator} is an operator`, async () => {
			const { messages, types } = await analyse(`$a ${operator} $a`, '4.0');
			assert.deepEqual(messages, []);
			assert.deepEqual(types, ['$a:variable', `${operator}:operator`, '$a:variable']);
		});

		test(`XSLT 3.0: ${operator} requires XPath 4.0`, async () => {
			const { messages } = await analyse(`$a ${operator} $a`, '3.0');
			assert.deepEqual(messages, [`XPath: The '${operator}' operator requires XPath 4.0`]);
		});
	});

	test('is, as in XPath 3.1', async () => {
		assert.deepEqual((await analyse('$a is $a', '3.0')).messages, []);
	});

	test('after a parenthesized operand', async () => {
		const { messages, types } = await analyse('($a) is-not ($a)', '4.0');
		assert.deepEqual(messages, []);
		assert.include(types, 'is-not:operator');
	});

	test('elements named precedes and follows are names', async () => {
		const { messages, types } = await analyse('$doc/precedes precedes $doc/follows, count(precedes/x), count(a[follows])', '4.0');
		assert.deepEqual(messages, []);
		assert.deepEqual(types.filter((t) => /^(precedes|follows)/.test(t)), ['precedes:nodeNameTest', 'precedes:operator', 'follows:nodeNameTest', 'precedes:nodeNameTest', 'follows:nodeNameTest']);
	});

	async function completionLabels(select: string, version: string) {
		const text = stylesheet(select, version);
		const offset = text.indexOf('¦');
		const document = await vscode.workspace.openTextDocument({ content: text.replace('¦', ''), language: 'xslt' });
		const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
		return (Array.isArray(result) ? result : result?.items ?? []).map((item) => typeof item.label === 'string' ? item.label : item.label.label);
	}

	test('completion: the operators after an operand, in XPath 4.0', async () => {
		assert.includeMembers(await completionLabels('$a ¦', '4.0'), operators);
	});

	test('completion: not before XPath 4.0', async () => {
		const labels = await completionLabels('$a ¦', '3.0');
		operators.forEach((operator) => assert.notInclude(labels, operator));
	});
});
