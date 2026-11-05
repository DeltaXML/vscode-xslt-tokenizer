/**
 * Test suite for XPath operators with '<' or '>' written as a character reference, e.g. =&gt;, &lt;= or &#62; - as
 * an attribute value must write '<' that way, and usually does '>' too: the linter takes each as the operator it
 * stands for - in XSLT 3.0 and 4.0, in attributes and text value templates
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function problems(xslt: string) {
	const lexer = new XslLexer(XSLTConfiguration.configuration);
	lexer.provideCharLevelState = true;
	const tokens = lexer.analyse(xslt);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const isVersion4 = lexer.isXSLT40;
	return XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4 }, isVersion4 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT, document, tokens, lexer.globalInstructionData, [], [])
		.filter((d) => d.severity !== vscode.DiagnosticSeverity.Hint).map((d) => `${d.message} [${document.getText(d.range)}]`);
}

// the XPath in a select attribute, or in a text value template
const select = (xpath: string, version = '3.0') => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:map="http://www.w3.org/2005/xpath-functions/map" version="${version}">
  <xsl:template match="/"><xsl:param name="a" select="1"/><xsl:param name="b" select="2"/><xsl:sequence select="${xpath}"/></xsl:template>
</xsl:stylesheet>`;
const text = (xpath: string, version = '3.0') => select('', version).replace('<xsl:sequence select=""/>', `<out xsl:expand-text="yes">{${xpath}}</out>`);

suite('XPath operators with < or > as a character reference', () => {
	// each XPath with its problems
	const reported = async (xpaths: string[], version = '3.0', wrap = select) => {
		const all: [string, string[]][] = [];
		for (const xpath of xpaths) {
			all.push([xpath, await problems(wrap(xpath, version))]);
		}
		return all.filter(([, messages]) => messages.length > 0);
	};

	test('comparisons, including node comparisons, and with numeric character references', async () => {
		assert.deepEqual(await reported(['$a &gt; 1', '$a &gt;= 1', '$a &lt; 1', '$a&lt;=$b', '/ &lt;&lt; /', '/&gt;&gt;/', '. &gt;= 1', '$a ! (. &lt;= 1)',
			'$a[. &gt; 1]', '1&#60;=2', '2 &#x3E;= 1', '1 &#060; 2', '(1, 2) &gt; 1 and $a &lt; $b']), []);
	});

	test('the arrow operator - and the function after it has the arrow\'s argument too', async () => {
		assert.deepEqual(await reported(['$a =&gt; string()', '$a=&gt;string()', '$a =&gt; string() =&gt; upper-case()', '$a =&gt; (string#1)()',
			'map{1:2} =&gt; map:keys()', '$a =&#62; string()', '$a =&#x3e; string()']), []);
		assert.deepEqual(await problems(select('$a =&gt; substring()')), ["XPath: Function: 'substring' with 1 arguments not found [substring]"]);
		assert.deepEqual(await problems(select('$a =&gt; 1')), ['XPath: Expected function after arrow operator [1]']);
	});

	test('XSLT 4.0: the mapping arrow, the pipeline operator and the method call', async () => {
		assert.deepEqual(await reported(['$a =!&gt; string()', '$a -&gt; string()', '$a -&gt; (. &gt; 1)', '$a =&gt; { . }()', 'map{\'f\': fn{1}} =?&gt; f()'], '4.0'), []);
	});

	test('in a text value template', async () => {
		assert.deepEqual(await reported(['$a =&gt; string()', '$a &gt;= 1', '$a &lt;= 1', '$a => string()', '$a >= 1'], '3.0', text), []);
		assert.deepEqual(await reported(['$a -&gt; string()'], '4.0', text), []);
	});

	test('still reported: an operator split by whitespace, one that isn\'t XPath, and a raw \'<\' in an attribute', async () => {
		assert.deepEqual(await problems(select('$a &lt; = 1')), ['XPath: Expression context - unexpected token here: =  [=]']);
		assert.deepEqual(await problems(select('$a = &gt; 1')), ['XPath: Expression context - unexpected token here: >  [&gt;]']);
		assert.deepEqual(await problems(select('$a &lt;&gt; 1')), ['XPath: Expression context - unexpected token here: >  [&gt;]']);
		assert.deepEqual(await problems(select('$a < 1')), ["XML: A '<' character is not allowed in an attribute value - use '&lt;' instead: '<' [<]"]);
	});
});
