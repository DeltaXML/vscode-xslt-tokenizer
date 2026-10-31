/**
 * Test suite for XSpec files (.xspec): elements and attributes checked against the XSpec schema (src/xspecSchema.ts),
 * XPath expressions with XSpec's variables, and the declarations of the stylesheet under test, its helpers and the
 * XSpec files imported - found with the XSpec project's own tests (see test/xspec-corpus/xspecLint.test.ts)
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import * as vscode from 'vscode';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { XSpecConfiguration, XSLTConfiguration } from '../../src/languageConfigurations';
import { LanguageConfiguration } from '../../src/xslLexer';

const xspecNs = 'xmlns:x="http://www.jenitennison.com/xslt/xspec"';

suite('XSpec', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xspec-'));
	let count = 0;
	const file = (name: string, content: string) => {
		const fsPath = path.join(dir, name);
		fs.writeFileSync(fsPath, content);
		return fsPath;
	};
	file('sut.xsl', `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" version="3.0">
  <xsl:variable name="f:greeting" select="'hello'"/>
  <xsl:function name="f:double"><xsl:param name="n"/><xsl:sequence select="$n * 2"/></xsl:function>
  <xsl:template name="f:named"><xsl:param name="size"/><xsl:param name="colour"/></xsl:template>
  <xsl:template match="p" mode="f:para"/>
</xsl:stylesheet>`);
	file('shared.xspec', `<x:description ${xspecNs} stylesheet="sut.xsl">
  <x:variable name="shared-doc" select="'d'"/>
</x:description>`);

	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
	});

	const moduleDiagnostics = (XsltSymbolProvider as unknown as { moduleDiagnostics(d: vscode.TextDocument, parent: boolean, config: LanguageConfiguration): Promise<vscode.Diagnostic[]> }).moduleDiagnostics;
	const problems = async (content: string) => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file(`test${count++}.xspec`, content)));
		assert.strictEqual(document.languageId, 'xspec');
		const diagnostics = await moduleDiagnostics.call(XsltSymbolProvider, document, false, XSpecConfiguration.configuration);
		return diagnostics.filter((d) => d.severity !== vscode.DiagnosticSeverity.Hint).map((d) => d.message);
	};
	const xspec = (body: string, attributes = ' stylesheet="sut.xsl"', prefix = 'x') =>
		`<${prefix}:description xmlns:${prefix}="http://www.jenitennison.com/xslt/xspec" xmlns:f="urn:f" xmlns:xs="http://www.w3.org/2001/XMLSchema"${attributes}>\n${body}\n</${prefix}:description>`;

	test('a test of a function, a named template and a template rule has no problems', async () => {
		assert.deepEqual(await problems(xspec(`<x:scenario label="double">
  <x:call function="f:double"><x:param select="2"/></x:call>
  <x:expect label="four" select="4"/>
  <x:expect label="an integer" test="$x:result instance of xs:integer"/>
</x:scenario>
<x:scenario label="named"><x:call template="f:named"/><x:expect label="empty" select="()"/></x:scenario>
<x:scenario label="rule">
  <x:context><doc><p>text</p></doc></x:context>
  <x:expect label="same" test="count(doc/p) = 1"><doc><p>text</p></doc></x:expect>
</x:scenario>`)), []);
	});

	test('elements and attributes are checked against the XSpec schema', async () => {
		const reported = await problems(xspec(`<x:scenario label="s" catch="maybe" colour="red">
  <x:expectation label="e" select="1"/>
</x:scenario>`));
		assert.lengthOf(reported, 3, reported.join('\n'));
		assert.include(reported, 'XSpec: element x:expectation is not allowed here');
		assert.isTrue(reported.some((m) => m.includes('colour')));
		assert.isTrue(reported.some((m) => m.includes('maybe')));
	});

	test('the XSpec prefix is the outermost element\'s, e.g. t:description', async () => {
		assert.deepEqual(await problems(xspec(`<t:scenario label="s"><t:call function="f:double"><t:param select="1"/></t:call><t:expect label="e" test="$t:result = 2"/></t:scenario>`, ' stylesheet="sut.xsl"', 't')), []);
	});

	test('XSpec\'s variables, e.g. $x:result and $x:context, with its prefix or as EQNames', async () => {
		assert.deepEqual(await problems(xspec(`<x:scenario label="s"><x:context select="1"/>
  <x:expect label="e" test="$x:result and $x:context and $Q{http://www.jenitennison.com/xslt/xspec}result and $x:xspec-uri"/>
</x:scenario>`)), []);
		// still reported: one XSpec doesn't declare
		assert.deepEqual(await problems(xspec(`<x:scenario label="s"><x:context select="1"/><x:expect label="e" test="$x:outcome"/></x:scenario>`)),
			['XPath: The variable/parameter $x:outcome cannot be resolved']);
	});

	test('the declarations of the stylesheet under test, and of the XSpec files imported', async () => {
		assert.deepEqual(await problems(xspec(`<x:import href="shared.xspec"/>
<x:scenario label="s"><x:call function="f:double"><x:param select="$f:greeting"/></x:call><x:expect label="e" test="$shared-doc"/></x:scenario>`)), []);
		// still reported: a function or variable the stylesheet doesn't declare
		const reported = await problems(xspec(`<x:scenario label="s"><x:call function="f:double"><x:param select="f:triple(1)"/></x:call><x:expect label="e" test="$f:farewell"/></x:scenario>`));
		assert.lengthOf(reported, 2, reported.join('\n'));
	});

	test('variables: x:variable and a global x:param are in scope - not the x:param of a call', async () => {
		assert.deepEqual(await problems(xspec(`<x:param name="g" select="1"/>
<x:scenario label="s"><x:variable name="v" select="$g"/><x:call function="f:double"><x:param select="$v"/></x:call><x:expect label="e" test="$v = 1"/></x:scenario>`)), []);
		assert.deepEqual(await problems(xspec(`<x:scenario label="s"><x:call template="f:named"><x:param name="size" select="1"/></x:call><x:expect label="e" test="$size"/></x:scenario>`)),
			['XPath: The variable/parameter $size cannot be resolved']);
	});

	test('user content: any element, e.g. an XSLT element, or x:text - not other XSpec elements', async () => {
		assert.deepEqual(await problems(xspec(`<x:scenario label="s">
  <x:context><xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"><xsl:template match="/"/></xsl:stylesheet></x:context>
  <x:expect label="e"><doc><x:text>t</x:text></doc></x:expect>
</x:scenario>`)), []);
		const reported = await problems(xspec(`<x:scenario label="s"><x:context><doc><x:scenario label="inner"/></doc></x:context><x:expect label="e" select="1"/></x:scenario>`));
		assert.lengthOf(reported, 1, reported.join('\n'));
		assert.include(reported[0], 'x:scenario');
	});

	test('user content with expand-text: attribute and text value templates are checked', async () => {
		assert.deepEqual(await problems(xspec(`<x:scenario label="s"><x:variable name="v" select="1"/>
  <x:context expand-text="yes"><doc a="{$v}">{$v + 1}</doc></x:context><x:expect label="e" select="1"/></x:scenario>`)), []);
		const reported = await problems(xspec(`<x:scenario label="s"><x:context expand-text="yes"><doc a="{$missing}"/></x:context><x:expect label="e" select="1"/></x:scenario>`));
		assert.deepEqual(reported, ['XPath: The variable/parameter $missing cannot be resolved']);
		// without it, braces are text
		assert.deepEqual(await problems(xspec(`<x:scenario label="s"><x:context><doc a="{$missing}">{$missing}</doc></x:context><x:expect label="e" select="1"/></x:scenario>`)), []);
	});

	test('a test of an XQuery module or a Schematron: its functions and variables aren\'t known, so aren\'t reported', async () => {
		assert.deepEqual(await problems(xspec(`<x:scenario label="s"><x:call function="f:any"><x:param select="$f:anything"/></x:call><x:expect label="e" select="1"/></x:scenario>`,
			' query="urn:f" query-at="module.xqm"')), []);
	});

	test('an arrow operator before an EQName function, e.g. $m => Q{...}find(\'a\') - in XSLT too', async () => {
		assert.deepEqual(await problems(xspec(`<x:scenario label="s"><x:context select="1"/><x:expect label="e" test="map{} => Q{http://www.w3.org/2005/xpath-functions/map}find('a')"/></x:scenario>`)), []);
		const xslt = await vscode.workspace.openTextDocument({ language: 'xslt', content: `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
<xsl:template match="/"><xsl:sequence select="map{} => Q{http://www.w3.org/2005/xpath-functions/map}find('a')"/></xsl:template></xsl:stylesheet>` });
		const xsltProblems = await moduleDiagnostics.call(XsltSymbolProvider, xslt, false, XSLTConfiguration.configuration);
		assert.deepEqual(xsltProblems.map((d) => d.message), []);
	});

	const completions = async (content: string, marker = '|') => {
		const offset = content.indexOf(marker);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file(`complete${count++}.xspec`, content.replace(marker, ''))));
		await vscode.window.showTextDocument(document);
		const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(offset));
		return list.items.map((item) => typeof item.label === 'string' ? item.label : item.label.label);
	};

	test('completion: the elements and attributes the XSpec schema allows', async () => {
		const elements = await completions(xspec(`<x:scenario label="s">\n  <|\n</x:scenario>`));
		for (const name of ['x:call', 'x:context', 'x:expect', 'x:scenario', 'x:variable']) {
			assert.include(elements, name, elements.join(', '));
		}
		assert.notInclude(elements, 'x:description');
		const attributes = await completions(xspec(`<x:scenario |label="s"/>`));
		for (const name of ['pending', 'focus', 'catch', 'shared']) {
			assert.include(attributes, name, attributes.join(', '));
		}
		const values = await completions(xspec(`<x:scenario label="s" catch="|"/>`));
		assert.includeMembers(values, ['yes', 'no']);
	});

	test('completion: with the outermost element\'s prefix for XSpec, e.g. t:', async () => {
		const elements = await completions(xspec(`<t:scenario label="s">\n  <|\n</t:scenario>`, ' stylesheet="sut.xsl"', 't'));
		assert.include(elements, 't:expect', elements.join(', '));
	});

	const at = async (content: string, command: string, marker = '|') => {
		const offset = content.indexOf(marker);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file(`at${count++}.xspec`, content.replace(marker, ''))));
		return vscode.commands.executeCommand<unknown[]>(command, document.uri, document.positionAt(offset));
	};
	const hoverText = (hovers: unknown[]) => (hovers as vscode.Hover[]).flatMap((hover) => hover.contents.map((c) => typeof c === 'string' ? c : c.value)).join('\n');

	test('hover: an XSpec element\'s description, and the signature of a function of the stylesheet under test', async () => {
		assert.include(hoverText(await at(xspec(`<x:scenario label="s"><x:exp|ect label="e" select="1"/></x:scenario>`), 'vscode.executeHoverProvider')), 'x:expect');
		assert.include(hoverText(await at(xspec(`<x:scenario label="s"><x:context select="1"/><x:expect label="e" test="f:dou|ble(1) = 2"/></x:scenario>`), 'vscode.executeHoverProvider')), 'f:double');
	});

	test('go to definition: a function, variable or template of the stylesheet under test', async () => {
		const locations = await at(xspec(`<x:scenario label="s"><x:context select="1"/><x:expect label="e" test="f:dou|ble(1) = 2"/></x:scenario>`), 'vscode.executeDefinitionProvider') as (vscode.Location | vscode.LocationLink)[];
		assert.lengthOf(locations, 1);
		const uri = 'uri' in locations[0] ? locations[0].uri : locations[0].targetUri;
		assert.strictEqual(path.basename(uri.fsPath), 'sut.xsl');
	});

	test('an open XSpec file: its problems in the Problems view, and its outline', async () => {
		const content = xspec(`<x:scenario label="s"><x:call function="f:double"><x:param select="1"/></x:call><x:expect label="e" test="$nothing"/></x:scenario>`);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file(`open${count++}.xspec`, content)));
		await vscode.window.showTextDocument(document);
		const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri);
		assert.isAbove(symbols.length, 0);
		let messages: string[] = [];
		for (let i = 0; i < 50 && messages.length === 0; i++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			messages = vscode.languages.getDiagnostics(document.uri).map((d) => d.message);
		}
		assert.deepEqual(messages, ['XPath: The variable/parameter $nothing cannot be resolved']);
		const scenario = symbols[0].children.find((symbol) => symbol.name.startsWith('x:scenario'));
		assert.strictEqual(scenario?.name, 'x:scenario \u203A s');
		assert.deepEqual(scenario?.children.map((symbol) => symbol.name), ['attributes', 'x:call \u203A f:double', 'x:expect \u203A e']);
	});

	test('x:call and x:context: the function, template and mode of the stylesheet under test, and the template\'s parameters', async () => {
		assert.deepEqual(await problems(xspec(`<x:scenario label="s">
  <x:call template="f:named"><x:param name="size" select="1"/><x:param name="extra" tunnel="yes" select="2"/></x:call>
  <x:expect label="e" select="()"/>
  <x:scenario label="inherits the call"><x:call><x:param name="colour" select="'red'"/></x:call><x:expect label="e" select="()"/></x:scenario>
</x:scenario>
<x:scenario label="f"><x:call function="f:double"><x:param select="1"/></x:call><x:expect label="e" select="2"/></x:scenario>
<x:scenario label="built-in"><x:call function="xs:integer"><x:param select="'1'"/></x:call><x:expect label="e" select="1"/></x:scenario>
<x:scenario label="m"><x:context mode="f:para"><p/></x:context><x:expect label="e" select="()"/></x:scenario>
<x:scenario label="default mode"><x:context mode="#default"><p/></x:context><x:expect label="e" select="()"/></x:scenario>
<x:scenario label="a function in a variable"><x:variable name="fn" select="f:double#1"/><x:call function="fn" call-as="variable"><x:param select="1"/></x:call><x:expect label="e" select="2"/></x:scenario>`)), []);
		const reported = await problems(xspec(`<x:scenario label="s"><x:call template="f:unnamed"/><x:expect label="e" select="()"/></x:scenario>
<x:scenario label="p"><x:call template="f:named"><x:param name="weight" select="1"/></x:call><x:expect label="e" select="()"/></x:scenario>
<x:scenario label="f"><x:call function="f:triple"><x:param select="1"/></x:call><x:expect label="e" select="3"/></x:scenario>
<x:scenario label="m"><x:context mode="f:list"><p/></x:context><x:expect label="e" select="()"/></x:scenario>`));
		assert.deepEqual(reported, [
			'XSpec: template \'f:unnamed\' not found in the stylesheet under test',
			'XSpec: parameter \'weight\' is not declared for template \'f:named\'',
			'XSpec: function \'f:triple\' not found in the stylesheet under test',
			'XSpec: mode \'f:list\' not found in the stylesheet under test']);
	});

	test('completion: the functions, templates and modes of the stylesheet under test, and a called template\'s parameters', async () => {
		assert.include(await completions(xspec(`<x:scenario label="s"><x:call template="|"/></x:scenario>`)), 'f:named');
		assert.include(await completions(xspec(`<x:scenario label="s"><x:call function="|"/></x:scenario>`)), 'f:double');
		assert.include(await completions(xspec(`<x:scenario label="s"><x:context mode="|"/></x:scenario>`)), 'f:para');
		assert.includeMembers(await completions(xspec(`<x:scenario label="s"><x:call template="f:named"><x:param name="|"/></x:call></x:scenario>`)), ['size', 'colour']);
	});
});
