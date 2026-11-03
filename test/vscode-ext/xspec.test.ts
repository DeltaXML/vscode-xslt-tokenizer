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
import { XSpecLabels } from '../../src/xspecLabels';
import { XSpecCompat } from '../../src/xspecCompat';
import { XSpecTestController } from '../../src/xspecTestController';
import { XSpecCleanup } from '../../src/xspecCleanup';

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
  <x:expect label="same" test="doc/p"><p>text</p></x:expect>
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
		file('module.xqm', 'module namespace f = "urn:f";');
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

	test('completion: namespace declarations on x:description - the stylesheet under test\'s, then common ones - not those declared', async () => {
		const labels = await completions(`<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" stylesheet="sut.xsl" xmlns:map="http://www.w3.org/2005/xpath-functions/map" |>\n</x:description>`);
		const xmlns = labels.filter((label) => label.startsWith('xmlns:'));
		assert.include(xmlns, 'xmlns:f');
		assert.include(xmlns, 'xmlns:xs');
		assert.include(xmlns, 'xmlns:array');
		for (const declared of ['xmlns:x', 'xmlns:map', 'xmlns:xsl']) {
			assert.notInclude(xmlns, declared);
		}
		// with another prefix for XSpec: x is offered for XSpec, as it isn't declared
		const prefixed = (await completions(`<t:description xmlns:t="http://www.jenitennison.com/xslt/xspec" stylesheet="sut.xsl" |>\n</t:description>`)).filter((label) => label.startsWith('xmlns:'));
		assert.include(prefixed, 'xmlns:f');
		assert.include(prefixed, 'xmlns:x');
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

	test('labels: a scenario\'s, to show in bold, and an expectation\'s, in italic - as an attribute or x:label, with the XSpec prefix', () => {
		const text = `<t:description xmlns:t="http://www.jenitennison.com/xslt/xspec" stylesheet="sut.xsl">
  <t:scenario label="the total">
    <t:context><scenario label="user content"/></t:context>
    <t:expect label='is 2' select="2"/>
    <t:scenario><t:label>with a discount</t:label>
      <t:expect-not-assert id="a" label="no error"/>
    </t:scenario>
  </t:scenario>
</t:description>`;
		const { scenarios, expectations } = XSpecLabels.find(text);
		const texts = (offsets: [number, number][]) => offsets.map(([start, end]) => text.substring(start, end));
		assert.deepEqual(texts(scenarios), ['the total', 'with a discount']);
		assert.deepEqual(texts(expectations), ['is 2', 'no error']);
	});

	test('x:expect tests: boolean, or not, from the top level of the expression - or either', () => {
		const types: [string, string | undefined][] = [
			['exists(tgroup/row[2][@a])', 'boolean'], ['not(exists(row))', 'boolean'], ['tgroup/@k eq \'One\'', 'boolean'], ['$x:result/p = 1', 'boolean'],
			['count($x:result) > 2 and $x:result/p', 'boolean'], ['every $p in $x:result/p satisfies $p/@a', 'boolean'], ['$x:result instance of element()', 'boolean'],
			['$x:result/p/deltaxml:space[@v=\'A=B\']', 'non-boolean'], ['(\'a\', \'b\')[not(. = in-scope-prefixes($x:result))]', 'non-boolean'],
			['distinct-values(//p/@a)', 'non-boolean'], ['string(//para/@id)', 'non-boolean'],
			['$x:result', undefined], ['$x:result/exists(p)', undefined], ['if ($x:result) then 1 else 2', undefined], ['$x:result => f:check()', undefined], ['f:valid($x:result)', undefined]
		];
		assert.deepEqual(types.map(([xpath]) => [xpath, XSpecCompat.testType(xpath)]), types);
	});

	test('x:expect tests XSpec 4 stops the run for: warnings, and quick fixes for the form it runs', async () => {
		const content = xspec(`<x:scenario label="s"><x:context><p/></x:context>
  <x:expect label="b" select="$x:result" test="exists(p[@a])"/>
  <x:expect label="n" test="$x:result/p[@a]"/>
  <x:expect label="fine" test="exists(p)"/>
  <x:expect label="fine too" test="$x:result/p" select="()"/>
</x:scenario>`);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file(`compat${count++}.xspec`, content)));
		const diagnostics = XSpecCompat.problems(document);
		assert.deepEqual(diagnostics.map((d) => [d.code, document.getText(d.range)]), [
			[XSpecCompat.booleanWithExpected, 'exists(p[@a])'], [XSpecCompat.nonBooleanWithoutExpected, '$x:result/p[@a]']]);
		const actions = XSpecCompat.codeActions(document, diagnostics);
		assert.deepEqual(actions.map((a) => a.title), ['Remove select, as and href - the boolean test decides',
			'Wrap the test in empty() - as XSpec before 1.0 ran it: it passes if the test returns nothing', 'Wrap the test in exists() - it passes if the test returns something']);
		assert.isTrue(await vscode.workspace.applyEdit(actions[0].edit!));
		assert.include(document.getText(), '<x:expect label="b" test="exists(p[@a])"/>');
		const after = XSpecCompat.problems(document);
		assert.isTrue(await vscode.workspace.applyEdit(XSpecCompat.codeActions(document, after)[0].edit!));
		assert.include(document.getText(), '<x:expect label="n" test="empty($x:result/p[@a])"/>');
		assert.deepEqual(XSpecCompat.problems(document), []);
	});

	test('a run of more than one file: a summary of the expectations, and the files that stopped - with the setting for old XSpec tests', async () => {
		const outcomes: Parameters<typeof XSpecTestController.summary>[0] = [
			{ file: '/w/a.xspec', passed: 10, failed: 1, pending: 2 },
			{ file: '/w/b.xspec', passed: 5, failed: 0, pending: 0 },
			{ file: '/w/c.xspec', passed: 0, failed: 0, pending: 0, stopped: 'ERROR in x:expect (\'e\'): Boolean @test must not be accompanied by @as, @href, @select, or child node.' },
			{ file: '/w/d.xspec', passed: 0, failed: 0, pending: 0, stopped: 'XTSE0165  I/O error reported by XML parser' }
		];
		outcomes.push({ file: '/w/e.xspec', passed: 0, failed: 0, pending: 0, stopped: 'XTSE0165  I/O error reported by XML parser', stoppedDetail: 'missing.xsl' });
		const lines = XSpecTestController.summary(outcomes).trim().split('\n').slice(1).map((line) => line.replace(/\/w\//, ''));
		// by reason, the most first - with the file's detail: the x:expect's label, or the file not found
		assert.deepEqual(lines, [
			'XSpec: 5 files - 15 passed, 1 failed, 2 pending - 2 ran to the end, 3 stopped:',
			'  XTSE0165  I/O error reported by XML parser - 2 files:',
			'    d.xspec',
			'    e.xspec - missing.xsl',
			'  x:expect with a boolean @test and @select, @as, @href or content:',
			'    c.xspec - \'e\'',
			'1 of them stopped for tests written for XSpec before 1.0 - the XSLT.xspec.legacyCompatibility setting runs them as that did'
		]);
		outcomes.pop();
		// all run to the end
		assert.deepEqual(XSpecTestController.summary(outcomes.slice(0, 2)).trim().split('\n').slice(1), ['XSpec: 2 files - 15 passed, 1 failed, 2 pending - 2 ran to the end']);
		// cancelled: of all the files requested
		assert.match(XSpecTestController.summary(outcomes.slice(0, 2), 60), /XSpec: 2 files of 60 - the run was cancelled - 15 passed/);
	});

	test('generated files: those a run names, in the xspec folder beside their XSpec file - not the XSpec files, in a folder named xspec too', () => {
		// as in a project with its tests in an xspec folder: the runs' files are in xspec/xspec
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-'));
		const tests = path.join(root, 'xspec');
		fs.mkdirSync(path.join(tests, 'xspec'), { recursive: true });
		const write = (file: string) => {
			fs.writeFileSync(path.join(tests, file), '<a/>');
			return path.join(tests, file);
		};
		write('a.xspec');
		write('a-sch.xspec');
		const generated = ['xspec/a-compiled.xsl', 'xspec/a-result.xml', 'xspec/a-result.html', 'xspec/a-diffs.json', 'xspec/a-sch-preprocessed.xsl'].map(write);
		// not generated: an XSpec file, a stylesheet of the project's that's named like one, without a.xspec beside it, and
		// a package's harness
		const kept = [write('b-compiled.xsl'), write('xspec/c-compiled.xsl'), write('a-xspec-harness.xsl'), path.join(tests, 'a.xspec')];
		const candidates = generated.concat(kept);
		assert.deepEqual(XSpecCleanup.generatedFiles(candidates, false), generated);
		assert.deepEqual(XSpecCleanup.generatedFiles(candidates, true), generated.filter((file) => !file.endsWith('-result.html')));
	});

	test('pending: faded, other than the reason - x:pending\'s label, or a pending attribute\'s value - and once, within x:pending', () => {
		const text = `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" stylesheet="sut.xsl">
  <x:pending label="to do">
    <x:scenario label="a" pending="inner"><x:expect label="e" select="1"/></x:scenario>
  </x:pending>
  <x:scenario label="b" pending="refunds"><x:expect label="f" select="1"/></x:scenario>
  <x:scenario label="c"><x:expect label="g" pending="later" select="1"/></x:scenario>
</x:description>`;
		const { pending } = XSpecLabels.find(text);
		const pendingElement = text.substring(text.indexOf('<x:pending'), text.indexOf('</x:pending>') + '</x:pending>'.length);
		assert.deepEqual(pending.map(([start, end]) => text.substring(start, end)), [
			'<x:pending label="', pendingElement.substring(pendingElement.indexOf('to do') + 'to do'.length),
			'<x:scenario label="b" pending="', '"><x:expect label="f" select="1"/></x:scenario>',
			'<x:expect label="g" pending="', '" select="1"/>'
		]);
	});

	test('hover: x:description\'s stylesheet - where it is, and its functions and templates that have no scenario yet', async () => {
		const text = hoverText(await at(xspec(`<x:scenario label="s"><x:call function="f:double"><x:param select="1"/></x:call><x:expect label="e" select="2"/></x:scenario>`, ' stylesheet="s|ut.xsl"'), 'vscode.executeHoverProvider'));
		assert.include(text, 'module sut.xsl');
		assert.include(text, `Stylesheet under test: ${path.join(dir, 'sut.xsl')}`);
		assert.include(text, '1 of its 3 functions and templates have a scenario - not: template `f:named`, template rule `p`');
	});

	test('global parameters: completion of those of the stylesheet not set - required first - their hover and definition, and a warning for a required one not set', async () => {
		file('params.xsl', `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="urn:f" version="3.0">
  <xsl:param name="f:currency" as="xs:string" select="'GBP'"/>
  <xsl:param name="rate" as="xs:decimal" required="yes"/>
</xsl:stylesheet>`);
		const attributes = ' stylesheet="params.xsl"';
		const labels = await completions(xspec(`  <|`, attributes));
		const params = labels.filter((label) => label.startsWith('x:param '));
		assert.deepEqual(params, ['x:param rate', 'x:param f:currency']);
		assert.deepEqual((await completions(xspec(`  <x:param name="rate" select="1.2"/>\n  <|`, attributes))).filter((label) => label.startsWith('x:param ')), ['x:param f:currency']);
		// in a scenario's x:call, not the global parameters
		assert.notInclude(await completions(xspec(`<x:scenario label="s"><x:call template="t"><|</x:call></x:scenario>`, attributes)), 'x:param rate');

		const warning = 'XSpec: the stylesheet\'s required parameter $rate isn\'t set - add an x:param for it to x:description, or each test fails with XTDE0050';
		assert.include(await problems(xspec(`<x:scenario label="s"><x:context><p/></x:context><x:expect label="e" select="1"/></x:scenario>`, attributes)), warning);
		assert.notInclude(await problems(xspec(`<x:param name="rate" select="1.2"/>\n<x:scenario label="s"><x:context><p/></x:context><x:expect label="e" select="1"/></x:scenario>`, attributes)), warning);

		// with run-as="external": a scenario's x:param sets them too, for its tests
		const external = ' stylesheet="params.xsl" run-as="external"';
		assert.include((await completions(xspec(`<x:scenario label="s">\n  <|\n</x:scenario>`, external))).filter((label) => label.startsWith('x:param ')), 'x:param f:currency');
		assert.notInclude((await completions(xspec(`<x:scenario label="s">\n  <|\n</x:scenario>`, attributes))), 'x:param f:currency');
		assert.include(hoverText(await at(xspec(`<x:scenario label="s"><x:param name="f:curr|ency" select="'EUR'"/></x:scenario>`, external), 'vscode.executeHoverProvider')), 'f:currency');
		assert.notInclude(await problems(xspec(`<x:scenario label="s"><x:param name="rate" select="1.2"/><x:context><p/></x:context><x:expect label="e" select="1"/></x:scenario>`, external)), warning);

		const definitions = await at(xspec(`  <x:param name="ra|te" select="1.2"/>`, attributes), 'vscode.executeDefinitionProvider') as vscode.Location[];
		assert.deepEqual(definitions.map((l) => `${path.basename(l.uri.fsPath)}:${l.range.start.line + 1}`), ['params.xsl:3']);
		assert.include(hoverText(await at(xspec(`  <x:param name="f:curr|ency" select="'EUR'"/>`, attributes), 'vscode.executeHoverProvider')), 'f:currency');
	});

	test('hover: the function or template x:call calls - its signature and documentation note - and a parameter passed by name', async () => {
		file('noted.xsl', `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="4.0">
  <xsl:function name="f:half" as="xs:double">
    <xsl:note format="xdoc-md">
      Halves a number.

      @param $n the number
    </xsl:note>
    <xsl:param name="n" as="xs:double"/>
    <xsl:sequence select="$n div 2"/>
  </xsl:function>
  <xsl:function name="f:half" as="xs:double">
    <xsl:param name="n" as="xs:double"/>
    <xsl:param name="round" as="xs:boolean"/>
    <xsl:sequence select="$n div 2"/>
  </xsl:function>
  <xsl:template name="f:box">
    <xsl:note format="xdoc-md">
      Draws a box.

      @param $size the width and height, in cm
    </xsl:note>
    <xsl:param name="size" as="xs:integer"/>
  </xsl:template>
</xsl:stylesheet>`);
		const hover = async (body: string) => hoverText(await at(xspec(body, ' stylesheet="noted.xsl"'), 'vscode.executeHoverProvider'));
		// the function with as many parameters as are passed
		const fn = await hover(`<x:scenario label="s"><x:call function="f:ha|lf"><x:param select="1"/></x:call></x:scenario>`);
		assert.include(fn, 'f:half($n as xs:double) as xs:double');
		assert.include(fn, 'Halves a number.');
		const fn2 = await hover(`<x:scenario label="s"><x:call function="f:ha|lf"><x:param select="1"/><x:param select="true()"/></x:call></x:scenario>`);
		assert.include(fn2, '$round as xs:boolean');
		const template = await hover(`<x:scenario label="s"><x:call template="f:b|ox"/></x:scenario>`);
		assert.include(template, 'template f:box');
		assert.include(template, 'Draws a box.');
		assert.include(await hover(`<x:scenario label="s"><x:call template="f:box"><x:param name="si|ze" select="1"/></x:call></x:scenario>`), 'the width and height, in cm');
	});

	test('an x:call that inherits its template or function from an enclosing scenario\'s x:call: its parameters\' completion, hover and definition, and its hover', async () => {
		const nested = (inner: string, outerCall = '<x:call template="f:named"><x:param name="size" select="1"/></x:call>') =>
			xspec(`<x:scenario label="outer">${outerCall}\n<x:scenario label="inner">${inner}<x:expect label="e" select="1"/></x:scenario>\n</x:scenario>`);
		// completion: the parameters not passed, by it or the x:call it inherits from
		const params = (await completions(nested('<x:call><|</x:call>'))).filter((label) => label.startsWith('x:param '));
		assert.deepEqual(params, ['x:param colour']);
		// the hover of the x:call: what it calls, and where it's from
		const callHover = hoverText(await at(nested('<x:ca|ll><x:param name="colour" select="2"/></x:call>'), 'vscode.executeHoverProvider'));
		assert.include(callHover, 'template f:named');
		assert.include(callHover, 'enclosing scenario \'outer\'');
		// a parameter's hover and definition
		assert.include(hoverText(await at(nested('<x:call><x:param name="col|our" select="2"/></x:call>'), 'vscode.executeHoverProvider')), 'Parameter of the template: `f:named`');
		const locations = await at(nested('<x:call><x:param name="col|our" select="2"/></x:call>'), 'vscode.executeDefinitionProvider') as vscode.Location[];
		assert.deepEqual(locations.map((l) => `${path.basename(l.uri.fsPath)}:${l.range.start.line + 1}`), ['sut.xsl:4']);
		// a function
		assert.include(hoverText(await at(nested('<x:ca|ll><x:param select="2"/></x:call>', '<x:call function="f:double"/>'), 'vscode.executeHoverProvider')), 'f:double(');
		// not for one with its own
		assert.notInclude(hoverText(await at(nested('<x:ca|ll template="f:named"/>'), 'vscode.executeHoverProvider')), 'enclosing scenario');
	});

	test('go to definition: the function or template x:call calls, a parameter it passes, and the mode of x:context', async () => {
		const where = async (body: string) => {
			const locations = await at(xspec(body), 'vscode.executeDefinitionProvider') as (vscode.Location | vscode.LocationLink)[];
			return locations.map((l) => 'uri' in l ? `${path.basename(l.uri.fsPath)}:${l.range.start.line + 1}` : `${path.basename(l.targetUri.fsPath)}:${l.targetRange.start.line + 1}`).join(',');
		};
		assert.strictEqual(await where(`<x:scenario label="s"><x:call function="f:dou|ble"><x:param select="1"/></x:call></x:scenario>`), 'sut.xsl:3');
		assert.strictEqual(await where(`<x:scenario label="s"><x:call template="f:na|med"/></x:scenario>`), 'sut.xsl:4');
		assert.strictEqual(await where(`<x:scenario label="s"><x:call template="f:named"><x:param name="si|ze" select="1"/></x:call></x:scenario>`), 'sut.xsl:4');
		assert.strictEqual(await where(`<x:scenario label="s"><x:context mode="f:pa|ra"><p/></x:context></x:scenario>`), 'sut.xsl:5');
	});

	test('find all references to a function or template of the stylesheet: its uses in the XSpec files testing it, with any prefix', async () => {
		const tested = file(`refs${count++}.xspec`, `<x:description ${xspecNs} xmlns:g="urn:f" stylesheet="sut.xsl">
  <x:scenario label="s"><x:call function="g:double"><x:param select="1"/></x:call><x:expect label="e" test="g:double(1) = 2"/></x:scenario>
  <x:scenario label="t"><x:call template="g:named"/><x:expect label="e" select="()"/></x:scenario>
</x:description>`);
		await vscode.workspace.openTextDocument(vscode.Uri.file(tested));
		const sut = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(dir, 'sut.xsl')));
		const referencesAt = async (name: string) => {
			const offset = sut.getText().indexOf(`name="${name}"`) + 7;
			const locations = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', sut.uri, sut.positionAt(offset));
			return locations.filter((l) => l.uri.fsPath === tested).map((l) => `${l.range.start.line + 1}:${(vscode.workspace.textDocuments.find((d) => d.uri.fsPath === tested)!).getText(l.range)}`);
		};
		assert.deepEqual(await referencesAt('f:double'), ['2:g:double', '2:g:double']);
		assert.deepEqual(await referencesAt('f:named'), ['3:g:named']);
		// renamed in the XSpec file too, keeping its prefix
		const offset = sut.getText().indexOf('name="f:double"') + 7;
		const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', sut.uri, sut.positionAt(offset), 'f:triple');
		assert.deepEqual(edit.get(vscode.Uri.file(tested)).map((e) => e.newText), ['g:triple', 'g:triple']);
	});

	test('files: a link for each file an XSpec file refers to, e.g. x:context\'s href - and a problem for one that isn\'t found', async () => {
		file('input.xml', '<doc/>');
		fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
		fs.writeFileSync(path.join(dir, 'data', 'expected.xml'), '<doc/>');
		const content = xspec(`<x:import href="shared.xspec"/>
<x:scenario label="s"><x:context href="input.xml?strip-space=yes"/><x:expect label="e" href="expected.xml" xml:base="data/"/></x:scenario>
<x:scenario label="t"><x:context href="missing.xml"/><x:expect label="e" select="1"/></x:scenario>`);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file(`files${count++}.xspec`, content)));
		const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', document.uri);
		const targets = links.map((link) => `${document.getText(link.range)} ${path.relative(dir, link.target!.fsPath)}`);
		assert.includeMembers(targets, ['sut.xsl sut.xsl', 'shared.xspec shared.xspec', 'input.xml?strip-space=yes input.xml', `expected.xml ${path.join('data', 'expected.xml')}`, 'missing.xml missing.xml']);
		const reported = await problems(content);
		assert.lengthOf(reported, 1, reported.join('\n'));
		assert.match(reported[0], /^XSpec: the file 'missing\.xml' of the href attribute isn't found/);
	});
});
