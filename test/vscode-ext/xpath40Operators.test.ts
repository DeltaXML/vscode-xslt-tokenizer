/**
 * Test suite for XPath 4.0's operators: the method call '=?>', e.g. $r =?> area() - whose name is a key of the map, not
 * a function - the multiplication and division signs '×' and '÷', and the positional variable of a for clause, e.g.
 * for $x at $i in $seq. Saxon 13 supports them all; Saxon 12.8 only '×' and '÷', with syntax extensions - so all are
 * reported before XPath 4.0.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { TokenLevelState } from '../../src/xpLexer';

const stylesheet = (select: string, version: string) => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="${version}">
<xsl:template match="/"><xsl:variable name="r" select="map{'w': 2, 'h': 3, 'area': function($m) { $m?w * $m?h }}"/><xsl:sequence select="${select}"/><xsl:sequence select="$r"/></xsl:template>
</xsl:stylesheet>`;

// the diagnostics, and the token type of each token of the select
async function analyse(select: string, version: string) {
	const text = stylesheet(select, version);
	const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
	const lexer = new XslLexer(XSLTConfiguration.configuration);
	lexer.provideCharLevelState = true;
	const tokens = lexer.analyse(text);
	const isVersion4 = version === '4.0';
	const messages = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4 }, isVersion4 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT, document, tokens, lexer.globalInstructionData, [], []).map((d) => d.message).filter((m) => m !== 'variable is unused');
	const start = text.indexOf(select);
	const types = tokens.filter((t) => t.tokenType < XslLexer.getXsltStartTokenNumber()).filter((t) => {
		const offset = document.offsetAt(new vscode.Position(t.line, t.startCharacter));
		return offset >= start && offset < start + select.length;
	}).map((t) => `${t.value}:${TokenLevelState[t.tokenType]}`);
	return { messages, types };
}

suite('XPath 4.0 operators', () => {
	const cases: [string, string, string[], string][] = [
		['× multiplies', '6 × 7', ['6:number', '×:operator', '7:number'], `XPath: The '×' operator requires XPath 4.0`],
		['÷ divides', '84 ÷ 2', ['84:number', '÷:operator', '2:number'], `XPath: The '÷' operator requires XPath 4.0`],
		['=?> calls a method of a map', '$r =?> area()', ['$r:variable', '=?>:operator', 'area:mapNameLookup', '():operator'], `XPath: The '=?>' operator requires XPath 4.0`],
		['a positional variable', `for $x at $i in ('a', 'b') return $i`, ['for:complexExpression', '$x:variable', 'at:complexExpression', '$i:variable', 'in:complexExpression', '(:operator', `'a':string`, ',:operator', `'b':string`, '):operator', 'return:complexExpression', '$i:variable'], `XPath: A positional variable, 'at $var', in a for clause requires XPath 4.0`],
	];
	cases.forEach(([label, select, types, message]) => {
		test(`XPath 4.0: ${label}`, async () => {
			const result = await analyse(select, '4.0');
			assert.deepEqual(result.messages, []);
			assert.deepEqual(result.types, types);
		});
		test(`XSLT 3.0: ${label} - requires XPath 4.0`, async () => {
			assert.deepEqual((await analyse(select, '3.0')).messages, [message]);
		});
	});

	// Saxon 13 needs a space after a number, e.g. 2 ×3, and after a lookup's name, e.g. $r?w ×2
	test('× and ÷ with other operators, without spaces', async () => {
		assert.deepEqual((await analyse('($r?w)×(3)÷$r?h + $r?w ×2', '4.0')).messages, []);
	});

	test('=?> with arguments, and after a lookup', async () => {
		assert.deepEqual((await analyse(`map{'s': $r} ?s =?> area(), $r=?>area()`, '4.0')).messages, []);
	});

	test('a positional variable with the typed binding and more bindings', async () => {
		assert.deepEqual((await analyse(`for $x as xs:string at $i in ('a', 'b'), $y at $j in (1, 2) return ($x, $i, $y, $j)`, '4.0')).messages, []);
	});

	test('a positional variable is only in scope in the return clause', async () => {
		assert.deepEqual((await analyse(`(for $x at $i in ('a', 'b') return $i), $i`, '4.0')).messages, [`XPath: The variable/parameter $i cannot be resolved`]);
	});

	test('=?> on a record type: the name is a field of the record', async () => {
		const text = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="4.0">
<xsl:item-type name="shape" as="record(w as xs:integer, area as function(*))"/>
<xsl:template match="/"><xsl:variable name="s" as="shape" select="{'w': 2, 'area': fn($m) { $m?w }}"/><xsl:sequence select="$s =?> area(), $s =?> perimeter()"/></xsl:template>
</xsl:stylesheet>`;
		const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
		const lexer = new XslLexer(XSLTConfiguration.configuration);
		lexer.provideCharLevelState = true;
		const messages = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, lexer.analyse(text), lexer.globalInstructionData, [], []).map((d) => d.message);
		assert.deepEqual(messages, [`XPath: Lookup of 'perimeter' - this is not a field of the record type: shape`]);
	});

	test('an element named at is a name', async () => {
		const { messages, types } = await analyse('count(at), at/x', '4.0');
		assert.deepEqual(messages, []);
		assert.deepEqual(types.filter((t) => t.startsWith('at:')), ['at:nodeNameTest', 'at:nodeNameTest']);
	});
});
