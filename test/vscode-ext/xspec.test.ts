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
import { XsltPackages } from '../../src/xsltPackages';
import { ImportIndex } from '../../src/importIndex';

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

	test('completion: node names in XPath are those of the test data and of the documents its hrefs refer to - not XSpec\'s own elements or attributes', async () => {
		file('orders-data.xml', '<orders><order id="1"><line product="p"/></order></orders>');
		const scenario = (test: string, prefix = 'x') => xspec(`<${prefix}:scenario label="s">
  <${prefix}:context><invoice number="1"><item/></invoice></${prefix}:context>
  <${prefix}:expect label="e" href="orders-data.xml" test="${test}"/>
</${prefix}:scenario>`, ' stylesheet="sut.xsl"', prefix);
		const names = await completions(scenario('$x:result/|'));
		assert.includeMembers(names, ['invoice', 'item', 'orders', 'order', 'line'], names.join(', '));
		for (const name of ['x:scenario', 'x:context', 'x:expect', 'x:description', 'scenario', '@label', '@href', '@stylesheet']) {
			assert.notInclude(names, name, names.join(', '));
		}
		// a path from the root: the root of each part of the test data, then its children
		assert.includeMembers(await completions(scenario('/|')), ['invoice', 'orders']);
		const children = await completions(scenario('/orders/|'));
		assert.include(children, 'order', children.join(', '));
		assert.notInclude(children, 'invoice', children.join(', '));
		// after a step: only the children of the elements it selects - from a variable, or a relative path
		for (const path of ['$x:result/order/|', 'order/|', '$x:result/invoice/|']) {
			const stepped = await completions(scenario(path));
			const [expected, notExpected] = path.includes('invoice') ? ['item', 'line'] : ['line', 'item'];
			assert.include(stepped, expected, `${path}: ${stepped.join(', ')}`);
			assert.notInclude(stepped, notExpected, `${path}: ${stepped.join(', ')}`);
			assert.notInclude(stepped, 'order', `${path}: ${stepped.join(', ')}`);
		}
		// an attribute step: the attributes of the elements selected
		const attributes = await completions(scenario('$x:result/order/@|'));
		assert.deepEqual(attributes, ['@id']);
		// with another prefix for XSpec
		const withT = await completions(scenario('$t:result/|', 't'));
		assert.includeMembers(withT, ['invoice', 'orders'], withT.join(', '));
		assert.notInclude(withT, 't:scenario', withT.join(', '));
	});

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

	test('required attributes: an error where XSpec fails without one, else a warning - with a quick fix adding it', async () => {
		const content = xspec(`<x:import/>
<x:variable select="1"/>
<x:param select="1"/>
<x:helper/>
<x:scenario>
  <x:like/>
  <x:call template="f:named"><x:param select="1"/></x:call>
  <x:expect select="1"/>
</x:scenario>
<x:scenario label="s"><x:label>ignored</x:label>
  <x:call function="f:double"><x:param select="2"/></x:call>
  <x:expect select="4"><x:label>four</x:label></x:expect>
</x:scenario>
<x:scenario label="rule"><x:context mode="m"><x:param select="1"/><x:variable/><x:scenario/></x:context><x:expect label="e" select="1"/></x:scenario>`);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file(`required${count++}.xspec`, content)));
		const diagnostics = (await moduleDiagnostics.call(XsltSymbolProvider, document, false, XSpecConfiguration.configuration))
			.filter((d) => d.message.includes(' must have '));
		const found = diagnostics.map((d) => `${d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning'} ${document.getText(d.range)}:${d.range.start.line} ${d.message}`);
		assert.deepEqual(found, [
			`error x:import:1 XSpec: x:import must have a 'href' attribute - XSpec fails without it`,
			`warning x:variable:2 XSpec: x:variable must have a 'name' attribute`,
			`warning x:param:3 XSpec: x:param must have a 'name' attribute`,
			`warning x:helper:4 XSpec: x:helper must have one of the attributes 'stylesheet', 'package-name', 'query', 'xproc'`,
			`warning x:scenario:5 XSpec: x:scenario must have a label - a label attribute or an x:label element`,
			`error x:like:6 XSpec: x:like must have a label - a label attribute or an x:label element - XSpec fails without it`,
			`error x:param:7 XSpec: x:param must have a 'name' attribute - XSpec fails without it`,
			`warning x:expect:8 XSpec: x:expect must have a label - a label attribute or an x:label element`,
			// x:context's own x:param - not the elements of its user content
			`error x:param:14 XSpec: x:param must have a 'name' attribute - XSpec fails without it`
		]);
		// the quick fix: the attribute, before the end of the start tag, with its value to give
		const editor = await vscode.window.showTextDocument(document);
		// once the problems are published, as the code actions are given those
		for (let i = 0; i < 50 && !vscode.languages.getDiagnostics(document.uri).some((d) => d.message.includes(' must have ')); i++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		const variable = vscode.languages.getDiagnostics(document.uri).find((d) => d.message.includes('x:variable must have'))!;
		const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', document.uri, variable.range);
		const action = actions.find((a) => a.title === `Add a 'name' attribute`);
		assert.isDefined(action);
		await vscode.workspace.applyEdit(action!.edit!);
		assert.include(editor.document.getText(), '<x:variable select="1" name=""/>');
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	});

	// the problems published for an XSpec file once it's open, and the code actions at an offset - as given those
	const openWithProblems = async (content: string, includes: string) => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file(`open${count++}.xspec`, content)));
		await vscode.window.showTextDocument(document);
		for (let i = 0; i < 50 && !vscode.languages.getDiagnostics(document.uri).some((d) => d.message.includes(includes)); i++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		const actionsAt = async (offset: number) => vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', document.uri,
			new vscode.Range(document.positionAt(offset), document.positionAt(offset)));
		return { document, actionsAt };
	};

	test('x:call of a function: an error for a number of parameters it isn\'t declared with - counted as XSpec merges the calls of nested scenarios', async () => {
		const arity = (count: number, inherited = '') => `XSpec: f:double is called with ${count} parameters${inherited}, but the stylesheet declares it with 1 parameter - XSpec fails to compile the tests (XPST0017)`;
		assert.deepEqual(await problems(xspec(`<x:scenario label="s"><x:call function="f:double"><x:param select="1"/><x:param select="2"/></x:call><x:expect label="e" select="2"/></x:scenario>`)), [arity(2)]);
		// an inner x:call's parameter replaces the outer one at its position - or adds one at another position
		assert.deepEqual(await problems(xspec(`<x:scenario label="o"><x:call function="f:double"><x:param select="1"/></x:call>
  <x:scenario label="i"><x:call><x:param select="5"/></x:call><x:expect label="e" select="10"/></x:scenario></x:scenario>`)), []);
		assert.deepEqual(await problems(xspec(`<x:scenario label="o"><x:call function="f:double"><x:param select="1"/></x:call>
  <x:scenario label="i"><x:call><x:param position="2" select="5"/></x:call><x:expect label="e" select="10"/></x:scenario></x:scenario>`)), [arity(2)]);
		// the call inherited as it is: reported on the x:call of the scenario it's from
		assert.deepEqual(await problems(xspec(`<x:scenario label="o"><x:call function="f:double"><x:param select="1"/><x:param select="2"/></x:call>
  <x:scenario label="i"><x:expect label="e" select="10"/></x:scenario></x:scenario>`)), [arity(2, ` - the x:call of the scenario 'o'`)]);
		// not compiled: without an expectation, or pending
		assert.deepEqual(await problems(xspec(`<x:scenario label="s"><x:call function="f:double"><x:param select="1"/><x:param select="2"/></x:call></x:scenario>
<x:scenario label="p" pending="later"><x:call function="f:double"/><x:expect label="e" select="2"/></x:scenario>`)), []);
	});

	test('x:expect: a warning for $x:result in select - a test written in select - with a quick fix making it the test', async () => {
		const warning = 'XSpec: select is the expected result, compared with the result - this uses $x:result, so it compares the result with its own value or a boolean. To test the result, use test, e.g. test="$x:result eq 2"';
		assert.deepEqual(await problems(xspec(`<x:scenario label="s"><x:call function="f:double"><x:param select="1"/></x:call><x:expect label="e" select="$x:result eq 2"/></x:scenario>`)), [warning]);
		// with test, select is compared with its value; and in a string literal, it's text
		assert.deepEqual(await problems(xspec(`<x:scenario label="s"><x:call function="f:double"><x:param select="1"/></x:call><x:expect label="e" test="$x:result" select="$x:result"/><x:expect label="f" select="'$x:result'"/></x:scenario>`)), []);
		const content = xspec(`<x:scenario label="s"><x:call function="f:double"><x:param select="1"/></x:call><x:expect label="e" select="$x:result eq 2"/></x:scenario>`);
		const { document, actionsAt } = await openWithProblems(content, 'uses $x:result');
		const action = (await actionsAt(content.indexOf('$x:result eq'))).find((a) => a.title.startsWith('Make select the test'));
		assert.isDefined(action);
		await vscode.workspace.applyEdit(action!.edit!);
		assert.include(document.getText(), '<x:expect label="e" test="$x:result eq 2"/>');
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	});

	test('x:scenario: code actions for pending and focus, and information for focus - with quick fixes removing it, or all in the file', async () => {
		const warning = 'XSpec: focus - only the focused scenarios are run, and every other scenario in this file is pending';
		const content = xspec(`<x:scenario label="a" focus="me"><x:call function="f:double"><x:param select="1"/></x:call><x:expect label="e" select="2"/></x:scenario>
<x:scenario label="b" focus="me too"><x:call function="f:double"><x:param select="1"/></x:call><x:expect label="e" select="2"/></x:scenario>
<x:scenario label="c" pending="later"><x:call function="f:double"><x:param select="1"/></x:call><x:expect label="e" select="2"/></x:scenario>`);
		assert.deepEqual(await problems(content), [warning, warning]);
		const { document, actionsAt } = await openWithProblems(content, 'only the focused scenarios');
		const titles = async (marker: string) => (await actionsAt(content.indexOf(marker))).map((a) => a.title);
		assert.includeMembers(await titles('focus="me"'), ['Remove focus', 'Remove focus from all 2 scenarios in this file', 'Mark the scenario as pending']);
		assert.includeMembers(await titles('label="c"'), ['Remove pending - run the scenario', 'Focus on the scenario - the others are pending']);
		const removeAll = (await actionsAt(content.indexOf('focus="me"'))).find((a) => a.title.startsWith('Remove focus from all'))!;
		await vscode.workspace.applyEdit(removeAll.edit!);
		assert.notInclude(document.getText(), 'focus=');
		const pending = (await actionsAt(content.indexOf('label="a"'))).find((a) => a.title === 'Mark the scenario as pending')!;
		await vscode.workspace.applyEdit(pending.edit!);
		assert.include(document.getText(), '<x:scenario label="a" pending="to do">');
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	});

	test('completion in XPath: the stylesheet\'s global variables and functions when it\'s imported - not with run-as="external", where only x:call can call them', async () => {
		const body = `<x:scenario label="s"><x:call function="f:double"><x:param select="1"/></x:call><x:expect label="e" test="|"/></x:scenario>`;
		const imported = await completions(xspec(body));
		assert.include(imported, '$f:greeting');
		assert.include(imported, 'f:double');
		const external = await completions(xspec(body, ' stylesheet="sut.xsl" run-as="external"'));
		assert.notInclude(external, '$f:greeting');
		assert.notInclude(external, 'f:double');
		// x:call's function: those of the stylesheet, still
		assert.include(await completions(xspec(`<x:scenario label="s"><x:call function="|"/></x:scenario>`, ' stylesheet="sut.xsl" run-as="external"')), 'f:double');
	});

	test('XSpec variables: definition, references, rename and hover - as XSpec scopes them, through x:like too', async () => {
		// line:character of a location, in a file at<n>.xspec written for each request
		const where = (locations: unknown[]) => (locations as (vscode.Location | vscode.LocationLink)[]).map((l) => 'uri' in l ?
			`${path.basename(l.uri.fsPath).replace(/^at\d+/, 'at')}:${l.range.start.line}:${l.range.start.character}` : `${path.basename(l.targetUri.fsPath).replace(/^at\d+/, 'at')}:${l.targetRange.start.line}`).sort();
		// where the text after the marker is, in the content without the marker: the nth occurrence of the text
		const position = (content: string, text: string, n = 1) => {
			let offset = -1;
			for (let i = 0; i < n; i++) {
				offset = content.indexOf(text, offset + 1);
			}
			const lines = content.substring(0, offset).split('\n');
			return `at.xspec:${lines.length - 1}:${lines[lines.length - 1].length}`;
		};
		const body = `<x:variable name="glob" select="1"/>
<x:scenario label="s">
  <x:variable name="loc" select="2"/>
  <x:call function="f:double"><x:param select="$lo|c + $glob"/></x:call>
  <x:expect label="e" test="$x:result = $loc and (every $loc in (1, 2) satisfies $loc gt 0)"/>
</x:scenario>
<x:scenario label="other"><x:variable name="loc" select="3"/><x:call function="f:double"><x:param select="$loc"/></x:call><x:expect label="e" select="6"/></x:scenario>`;
		const content = xspec(body);
		const plain = content.replace('|', '');
		const declaration = position(plain, 'loc" select="2"');
		const uses = [position(plain, 'loc + $glob'), position(plain, 'loc and (every')];
		assert.deepEqual(where(await at(content, 'vscode.executeDefinitionProvider')), [declaration]);
		// its references: not those bound by every, or of the other scenario's $loc
		assert.deepEqual(where(await at(content, 'vscode.executeReferenceProvider')), [declaration, ...uses].sort());
		// from the declaration too
		assert.deepEqual(where(await at(plain.replace('name="loc" select="2"', 'name="l|oc" select="2"'), 'vscode.executeReferenceProvider')), [declaration, ...uses].sort());
		assert.include(hoverText(await at(content, 'vscode.executeHoverProvider')), '<x:variable name="loc" select="2"/>');
		// a global one, and the stylesheet's - left to the XSLT providers
		assert.deepEqual(where(await at(plain.replace('$glob"', '$gl|ob"'), 'vscode.executeDefinitionProvider')), [position(plain, 'glob" select')]);
		assert.deepEqual(where(await at(xspec(`<x:scenario label="s"><x:expect label="e" test="$f:gree|ting"/></x:scenario>`), 'vscode.executeDefinitionProvider')).map((l) => l.replace(/:\d+$/, '')), ['sut.xsl:1']);

		// rename: the declaration and its references
		const renameFile = file(`rename${count++}.xspec`, plain);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(renameFile));
		const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', document.uri, document.positionAt(plain.indexOf('$loc + ') + 2), 'size');
		assert.deepEqual(edit.get(document.uri).map((e) => `at.xspec:${e.range.start.line}:${e.range.start.character} ${e.newText}`).sort(), [declaration, ...uses].sort().map((p) => `${p} size`));

		// in a shared scenario: each declaration it may be - one for each x:like using it - and each one's references include it
		const shared = xspec(`<x:scenario label="sized" shared="yes"><x:call function="f:double"><x:param select="$wid|th"/></x:call><x:expect label="e" test="$x:result gt 0"/></x:scenario>
<x:scenario label="small"><x:variable name="width" select="1"/><x:like label="sized"/></x:scenario>
<x:scenario label="large"><x:variable name="width" select="1000"/><x:like label="sized"/></x:scenario>`);
		const sharedPlain = shared.replace('|', '');
		assert.deepEqual(where(await at(shared, 'vscode.executeDefinitionProvider')), [position(sharedPlain, 'width" select="1"'), position(sharedPlain, 'width" select="1000"')].sort());
		const fromSmall = sharedPlain.replace('name="width" select="1"', 'name="wi|dth" select="1"');
		assert.deepEqual(where(await at(fromSmall, 'vscode.executeReferenceProvider')), [position(sharedPlain, 'width" select="1"'), position(sharedPlain, 'width"/></x:call>')].sort());
	});

	test('hover on x:scenario - its name or label: a summary, with what it runs as XSpec merges the enclosing scenarios\' calls, then XSpec\'s description', async () => {
		const content = (marker: string) => xspec(`<x:scenario label="outer"><x:call template="f:named"><x:param name="size" select="1"/><x:param name="colour" select="'red'"/></x:call>
  <x:x${marker === 'inner' ? '' : ''}scenario label="${marker === 'label' ? 'in|ner' : 'inner'}" pending="later">
    <x:call><x:param name="size" select="2"/></x:call>
    <x:variable name="v" select="1"/>
    <x:expect label="a heading" test="exists($x:result)"/>
  </x:scenario>
</x:scenario>
<x:scenario label="row" shared="yes" focus="now"><x:context mode="m"><p/></x:context><x:expect label="e" select="1"/></x:scenario>
<x:scenario label="uses"><x:like label="row"/></x:scenario>`.replace('<x:xscenario label="inner"', marker === 'name' ? '<x:sce|nario label="inner"' : '<x:scenario label="inner"').replace('<x:xscenario', '<x:scenario'));
		for (const marker of ['name', 'label']) {
			const text = hoverText(await at(content(marker), 'vscode.executeHoverProvider'));
			assert.include(text, '**Scenario** inner — line 3 — _pending: later_', marker);
			// the template from the outer x:call, with size from the inner one
			assert.include(text, 'Calls: `f:named` with `$size`: `2`, `$colour`: `\'red\'` — from _outer_', marker);
			assert.include(text, 'Variables: `$v`', marker);
			assert.include(text, 'Expectations: _a heading_', marker);
			// XSpec's description: only on the name
			assert.strictEqual(text.includes('A scenario defines the environment'), marker === 'name', marker);
		}
		const shared = hoverText(await at(xspec(`<x:scenario label="row" shared="yes" focus="now"><x:context mode="m"><p/></x:context><x:expect label="e" select="1"/></x:scenario>
<x:scenario label="uses"><x:like label="row"/></x:scenario>`).replace('<x:scenario label="row"', '<x:scen|ario label="row"'), 'vscode.executeHoverProvider'));
		assert.include(shared, '**Shared scenario** row — line 2 — _focus: now_');
		assert.include(shared, 'Context: `x:context mode="m"` with content');
		assert.include(shared, 'Used by x:like at: line 3');
	});

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
		const params = labels.filter((label) => label.startsWith('x:param ') && !label.endsWith(')'));
		assert.deepEqual(params, ['x:param rate', 'x:param f:currency']);
		assert.deepEqual((await completions(xspec(`  <x:param name="rate" select="1.2"/>\n  <|`, attributes))).filter((label) => label.startsWith('x:param ') && !label.endsWith(')')), ['x:param f:currency']);
		// in a scenario's x:call, not the global parameters
		assert.notInclude(await completions(xspec(`<x:scenario label="s"><x:call template="t"><|</x:call></x:scenario>`, attributes)), 'x:param rate');

		const warning = 'XSpec: the stylesheet\'s required parameter $rate isn\'t set - add an x:param for it to x:description, or each test fails with XTDE0050';
		assert.include(await problems(xspec(`<x:scenario label="s"><x:context><p/></x:context><x:expect label="e" select="1"/></x:scenario>`, attributes)), warning);
		assert.notInclude(await problems(xspec(`<x:param name="rate" select="1.2"/>\n<x:scenario label="s"><x:context><p/></x:context><x:expect label="e" select="1"/></x:scenario>`, attributes)), warning);

		// with run-as="external": a scenario's x:param sets them too, for its tests
		const external = ' stylesheet="params.xsl" run-as="external"';
		assert.include((await completions(xspec(`<x:scenario label="s">\n  <|\n</x:scenario>`, external))).filter((label) => label.startsWith('x:param ') && !label.endsWith(')')), 'x:param f:currency');
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
		const params = (await completions(nested('<x:call><|</x:call>'))).filter((label) => label.startsWith('x:param ') && !label.endsWith(')'));
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

	test('rename a named template\'s parameter: its x:param in the XSpec files calling the template - in an inner scenario\'s x:call too, which calls the outer one\'s template - not another template\'s', async () => {
		file('params.xsl', `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" version="3.0">
  <xsl:template name="f:box"><xsl:param name="width"/><xsl:sequence select="$width"/></xsl:template>
  <xsl:template name="f:other"><xsl:param name="width"/></xsl:template>
</xsl:stylesheet>`);
		const tested = file(`paramRename${count++}.xspec`, `<x:description ${xspecNs} xmlns:g="urn:f" stylesheet="params.xsl">
  <x:scenario label="direct"><x:call template="g:box"><x:param name="width" select="1"/></x:call><x:expect label="e" select="1"/></x:scenario>
  <x:scenario label="outer">
    <x:call template="g:box"/>
    <x:scenario label="inner"><x:call><x:param name = 'width' select="2"/></x:call><x:expect label="e" select="2"/></x:scenario>
  </x:scenario>
  <x:scenario label="other"><x:call template="g:other"><x:param name="width" select="3"/></x:call><x:expect label="e" select="()"/></x:scenario>
</x:description>`);
		const xspecDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(tested));
		const sut = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(dir, 'params.xsl')));
		const offset = sut.getText().indexOf('name="width"') + 7;
		const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', sut.uri, sut.positionAt(offset), 'size');
		const edits = edit.get(xspecDocument.uri);
		assert.deepEqual(edits.map((e) => `${e.range.start.line + 1}:${xspecDocument.getText(e.range)}->${e.newText}`), ['2:width->size', '5:width->size']);
		// in the stylesheet: the parameter and its reference, not f:other's
		assert.deepEqual(edit.get(sut.uri).map((e) => e.range.start.line + 1), [2, 2]);
		// and from the XSpec file - the x:param of x:call, or of the inner scenario's x:call - the same edits
		for (const [text, n] of [['width" select="1"', 0], ['width\' select="2"', 0]] as [string, number][]) {
			const at = xspecDocument.positionAt(xspecDocument.getText().indexOf(text, n) + 2);
			const fromXSpec = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', xspecDocument.uri, at, 'size');
			assert.deepEqual(fromXSpec.get(xspecDocument.uri).map((e) => e.range.start.line + 1), [2, 5], text);
			assert.deepEqual(fromXSpec.get(sut.uri).map((e) => e.range.start.line + 1), [2, 2], text);
		}
		// the other template's x:param: its own parameter, not f:box's
		const references = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', xspecDocument.uri, xspecDocument.positionAt(xspecDocument.getText().indexOf('width" select="3"') + 2));
		assert.deepEqual(references.map((l) => `${path.basename(l.uri.fsPath)}:${l.range.start.line + 1}`).sort(), [`${path.basename(tested)}:7`, 'params.xsl:3']);
	});

	test('find all references to a mode of the stylesheet: x:context\'s mode in the XSpec files testing it - and from the XSpec file, the stylesheet\'s references', async () => {
		const tested = file(`modeRefs${count++}.xspec`, `<x:description ${xspecNs} xmlns:g="urn:f" stylesheet="sut.xsl">
  <x:scenario label="s"><x:context mode="g:para"><p/></x:context><x:expect label="e" select="()"/></x:scenario>
  <x:scenario label="t"><x:context mode="#default"><p/></x:context><x:expect label="e" select="()"/></x:scenario>
  <x:scenario label="u"><x:call function="g:double"><x:param select="1"/></x:call><x:expect label="e" select="2"/></x:scenario>
</x:description>`);
		const xspecDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(tested));
		const sut = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(dir, 'sut.xsl')));
		const describe = (locations: vscode.Location[]) => locations.map((l) => `${path.basename(l.uri.fsPath)}:${l.range.start.line + 1}`).sort();
		const offset = sut.getText().indexOf('mode="f:para"') + 7;
		const fromMode = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', sut.uri, sut.positionAt(offset));
		assert.includeMembers(describe(fromMode), ['sut.xsl:5', `${path.basename(tested)}:2`]);
		assert.notInclude(describe(fromMode), `${path.basename(tested)}:3`);
		// from the XSpec file: the same, for x:context's mode and x:call's function
		const xspecAt = (text: string) => xspecDocument.positionAt(xspecDocument.getText().indexOf(text) + 2);
		const fromContext = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', xspecDocument.uri, xspecAt('g:para'));
		assert.deepEqual(describe(fromContext), describe(fromMode));
		const fromCall = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', xspecDocument.uri, xspecAt('g:double'));
		assert.includeMembers(describe(fromCall), ['sut.xsl:3', `${path.basename(tested)}:4`]);
		// renamed in the XSpec file too
		const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', sut.uri, sut.positionAt(offset), 'f:para2');
		assert.deepEqual(edit.get(vscode.Uri.file(tested)).map((e) => e.newText), ['g:para2']);
		// and from the XSpec file, with its prefix: the stylesheet keeps its own
		const fromXSpec = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', xspecDocument.uri, xspecAt('g:double'), 'g:triple');
		assert.deepEqual(fromXSpec.get(vscode.Uri.file(tested)).map((e) => e.newText), ['g:triple']);
		assert.include(fromXSpec.get(sut.uri).map((e) => e.newText), 'f:triple');
		assert.notInclude(fromXSpec.get(sut.uri).map((e) => e.newText), 'g:triple');
	});

	test('duplicate labels: a warning for sibling scenarios, or a scenario\'s expectations, with the same label', async () => {
		const ctx = '<x:context><p/></x:context>';
		// siblings at the top level, with an x:label, and in x:pending
		assert.deepEqual(await problems(xspec(`<x:scenario label="a">${ctx}<x:expect label="e" select="()"/></x:scenario>
<x:scenario><x:label> a </x:label>${ctx}<x:expect label="e" select="()"/></x:scenario>
<x:pending><x:scenario label="a">${ctx}<x:expect label="e" select="()"/></x:scenario></x:pending>`)), [
			'XSpec: another scenario at the top level of this file has the label \'a\' - the report and the Test Explorer show the same name for both',
			'XSpec: another scenario at the top level of this file has the label \'a\' - the report and the Test Explorer show the same name for both']);
		// expectations of one scenario, and nested scenarios
		assert.deepEqual(await problems(xspec(`<x:scenario label="a">${ctx}<x:expect label="e" select="()"/><x:expect label="e" test="true()"/>
<x:scenario label="n"><x:expect label="f" select="()"/></x:scenario><x:scenario label="n"><x:expect label="f" select="()"/></x:scenario></x:scenario>`)), [
			'XSpec: another expectation in this scenario has the label \'e\' - the report and the Test Explorer show the same name for both',
			'XSpec: another scenario in this scenario has the label \'n\' - the report and the Test Explorer show the same name for both']);
		// not: the same label in different scenarios, or a shared scenario's
		assert.deepEqual(await problems(xspec(`<x:scenario label="a">${ctx}<x:expect label="e" select="()"/></x:scenario>
<x:scenario label="b">${ctx}<x:expect label="e" select="()"/><x:scenario label="a"><x:expect label="e" select="()"/></x:scenario></x:scenario>
<x:scenario label="s" shared="yes"><x:expect label="e" select="()"/></x:scenario><x:scenario label="c">${ctx}<x:like label="s"/></x:scenario>`)), []);
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

	test('x:like: a problem for a label no scenario has, or more than one, or the scenario it\'s in - as XSpec stops the run', async () => {
		const shared = `<x:scenario label="row" shared="yes"><x:expect label="a row" test="exists($x:result)"/></x:scenario>`;
		assert.deepEqual(await problems(xspec(`${shared}
<x:scenario label="s"><x:context><p/></x:context><x:like label="row"/></x:scenario>
<x:scenario label="t"><x:context><p/></x:context><x:like><x:label>row</x:label></x:like></x:scenario>`)), []);
		assert.deepEqual(await problems(xspec(`${shared}<x:scenario label="s"><x:context><p/></x:context><x:like label="rows"/></x:scenario>`)),
			['XSpec: no scenario has the label \'rows\', for x:like - in this file, the XSpec files it imports or those importing it']);
		const twice = await problems(xspec(`${shared}${shared}<x:scenario label="s"><x:context><p/></x:context><x:like label="row"/></x:scenario>`));
		assert.lengthOf(twice, 1, twice.join('\n'));
		assert.match(twice[0], /^XSpec: 2 scenarios have the label 'row'/);
		assert.deepEqual(await problems(xspec(`<x:scenario label="s"><x:context><p/></x:context><x:like label="s"/><x:expect label="e" select="()"/></x:scenario>`)),
			['XSpec: x:like uses the scenario \'s\' that it\'s in - a loop']);
	});

	test('x:like: a scenario in an XSpec file imported, or importing it - and the variables of the scenario using a shared one are in scope', async () => {
		const library = file(`like-lib${count++}.xspec`, `<x:description ${xspecNs} stylesheet="sut.xsl">
  <x:scenario label="lib row" shared="yes">
    <x:variable name="lib-var" select="1"/>
    <x:expect label="uses the using scenario's variable" test="$using-var = 2"/>
  </x:scenario>
  <x:scenario label="uses the importer's"><x:context><p/></x:context><x:like label="importer row"/></x:scenario>
</x:description>`);
		const importer = xspec(`<x:import href="${path.basename(library)}"/>
<x:scenario label="importer row" shared="yes"><x:expect label="e" select="()"/></x:scenario>
<x:scenario label="s"><x:context><p/></x:context><x:variable name="using-var" select="2"/><x:like label="lib row"/><x:expect label="uses the shared scenario's variable" test="$lib-var = 1"/></x:scenario>`);
		assert.deepEqual(await problems(importer), []);
		// the imported file, linted on its own while the file importing it is open
		const libraryDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(library));
		const libraryProblems = await moduleDiagnostics.call(XsltSymbolProvider, libraryDocument, false, XSpecConfiguration.configuration);
		assert.deepEqual(libraryProblems.filter((d) => d.severity !== vscode.DiagnosticSeverity.Hint).map((d) => d.message), []);
	});

	test('x:like: completion of the scenarios\' labels - shared first, not the scenario it\'s in - going to the scenario, and finding the x:like elements using it', async () => {
		const body = `<x:scenario label="row" shared="yes"><x:expect label="e" select="()"/></x:scenario>
<x:scenario label="plain"><x:context><p/></x:context><x:expect label="e" select="()"/></x:scenario>
<x:scenario label="s"><x:context><p/></x:context><x:like label="|"/></x:scenario>`;
		const labels = await completions(xspec(body));
		assert.deepEqual(labels.filter((l) => ['row', 'plain', 's'].includes(l)).sort(), ['plain', 'row']);
		const where = async (content: string, command: string) => {
			const locations = await at(xspec(content), command) as (vscode.Location | vscode.LocationLink)[];
			return locations.map((l) => 'uri' in l ? l.range : l.targetRange).map((r) => `${r.start.line + 1}:${r.start.character}-${r.end.character}`).join(',');
		};
		const using = `<x:scenario label="row" shared="yes"><x:expect label="e" select="()"/></x:scenario>
<x:scenario label="s"><x:context><p/></x:context><x:like label="r|ow"/></x:scenario>
<x:scenario label="t"><x:context><p/></x:context><x:like label="row"/></x:scenario>`;
		assert.strictEqual(await where(using, 'vscode.executeDefinitionProvider'), '2:19-22');
		assert.strictEqual(await where(using.replace('r|ow', 'row').replace('label="row" shared', 'label="r|ow" shared'), 'vscode.executeReferenceProvider'), '2:19-22,3:64-67,4:64-67');
	});

	test('variables: in scope as XSpec scopes them - after the declaration, in its scenario and those within it, and through x:like', async () => {
		const unresolved = (name: string) => `XPath: The variable/parameter $${name} cannot be resolved`;
		// before its declaration, or in another scenario
		assert.deepEqual(await problems(xspec(`<x:scenario label="a"><x:context><p/></x:context><x:expect label="e" test="$v = 1"/><x:variable name="v" select="1"/></x:scenario>
<x:scenario label="b"><x:context><p/></x:context><x:expect label="e" test="$v = 1"/></x:scenario>`)), [unresolved('v'), unresolved('v')]);
		// in a scenario within its scenario, and a global one anywhere
		assert.deepEqual(await problems(xspec(`<x:scenario label="a"><x:variable name="v" select="$g"/>
  <x:scenario label="inner"><x:context><p/></x:context><x:expect label="e" test="$v = 1"/></x:scenario>
</x:scenario>
<x:variable name="g" select="1"/>`)), []);
		// after x:like, the shared scenario's - and in the shared scenario, the using scenario's before the x:like
		const shared = `<x:scenario label="row" shared="yes"><x:variable name="from-shared" select="$from-user"/><x:expect label="e" test="$from-shared"/></x:scenario>`;
		assert.deepEqual(await problems(xspec(`${shared}
<x:scenario label="s"><x:context><p/></x:context><x:variable name="from-user" select="1"/><x:like label="row"/><x:expect label="e" test="$from-shared = 1"/></x:scenario>`)), []);
		assert.deepEqual(await problems(xspec(`${shared}
<x:scenario label="s"><x:context><p/></x:context><x:like label="row"/><x:variable name="from-user" select="1"/></x:scenario>`)), [unresolved('from-user')]);
		// a shared scenario no x:like uses here may be used elsewhere, so any is in scope
		assert.deepEqual(await problems(xspec(shared)), []);
		// one in scope where some of the scenarios using it declare it, not all: a warning, naming those that don't
		const template = `<x:scenario label="sized" shared="yes"><x:context><p/></x:context><x:expect label="e" test="$width gt 0"/></x:scenario>`;
		const notInEvery = (labels: string) => `XSpec: $width isn't in scope where the scenario ${labels} uses this with x:like - XSpec fails to compile it (XPST0008)`;
		assert.deepEqual(await problems(xspec(`${template}
<x:scenario label="small"><x:variable name="width" select="1"/><x:like label="sized"/></x:scenario>
<x:scenario label="large"><x:like label="sized"/></x:scenario>`)), [notInEvery("'large'")]);
		assert.deepEqual(await problems(xspec(`${template}
<x:scenario label="small"><x:variable name="width" select="1"/><x:like label="sized"/></x:scenario>
<x:scenario label="large"><x:variable name="width" select="1000"/><x:like label="sized"/></x:scenario>`)), []);
		// with an x:import that isn't found, e.g. a URI an XML catalog maps: a variable not declared here is a warning, as
		// the import may declare it - not XSpec's own variable, with another prefix (as in XSpec's
		// test/catalog/catalog-01_xspec-uri.xspec), or one declared here
		assert.deepEqual((await problems(xspec(`<x:import href="catalog-01:/imported.xspec"/><x:variable name="here" select="1"/>
<x:scenario label="outer"><x:call function="true"/><x:scenario label="in global variable"><x:expect label="e" test="$im:v eq $x:xspec-uri and $here"/></x:scenario></x:scenario>`, ' stylesheet="sut.xsl" xmlns:im="urn:im"'))).filter((p) => !p.includes('catalog')),
			['XSpec: The variable $im:v isn\'t declared here - it may be declared in an XSpec file imported with x:import that isn\'t found']);
		// names compared by namespace: a prefix, another prefix for it, or an EQName
		assert.deepEqual(await problems(xspec(`<x:scenario label="s" xmlns:g="urn:f"><x:variable name="Q{urn:f}v" select="1"/><x:variable name="g:w" select="$f:v"/><x:context><p/></x:context><x:expect label="e" test="$f:w"/></x:scenario>`)), []);
	});

	test('x:like: hover - the scenario it uses, where it is and what it brings in', async () => {
		const text = hoverText(await at(xspec(`<x:scenario label="row" shared="yes"><x:variable name="v" select="1"/><x:expect label="has a cell" test="$v"/></x:scenario>
<x:scenario label="s"><x:context><p/></x:context><x:like label="r|ow"/></x:scenario>`), 'vscode.executeHoverProvider'));
		assert.include(text, '**Shared scenario** row — line 2');
		assert.include(text, 'Variables: `$v`');
		assert.include(text, 'Expectations: _has a cell_');
	});

	test('x:like: renaming a scenario\'s label renames the x:like elements using it - escaped for each - unless a scenario has the new label', async () => {
		const content = xspec(`<x:scenario label="row" shared="yes"><x:expect label="e" select="()"/></x:scenario>
<x:scenario label="taken"><x:context><p/></x:context><x:like label="r|ow"/></x:scenario>
<x:scenario label="t"><x:context><p/></x:context><x:like><x:label>row</x:label></x:like></x:scenario>`);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file(`rename${count++}.xspec`, content.replace('|', ''))));
		const position = document.positionAt(content.indexOf('|'));
		const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', document.uri, position, 'a "row" & more');
		assert.deepEqual(edit.get(document.uri).map((e) => `${e.range.start.line + 1}:${e.newText}`), ['2:a &quot;row&quot; &amp; more', '3:a &quot;row&quot; &amp; more', '4:a "row" &amp; more']);
		let refused = '';
		try {
			await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', document.uri, position, 'taken');
		} catch (e) {
			refused = String(e);
		}
		assert.include(refused, 'has the label \'taken\' already');
	});

	test('XPath 4.0: with x:description\'s xslt-version 4.0, as XSpec compiles the test runner - not the stylesheet\'s version', async () => {
		const body = `<x:scenario label="s"><x:call function="f:double"><x:param select="1"/></x:call><x:expect label="e" select="'A'" as="enum('A', 'B')"/></x:scenario>`;
		assert.deepEqual(await problems(xspec(body, ' stylesheet="sut.xsl" xslt-version="4.0"')), []);
		assert.deepEqual(await problems(xspec(body)), ['XPath: The \'enum(...)\' item type requires XPath 4.0']);
	});

	test('processing-instruction(name): the name is a processing instruction\'s target, not a type - in XSpec and XSLT', async () => {
		assert.deepEqual(await problems(xspec(`<x:scenario label="s"><x:call function="f:double"><x:param as="processing-instruction(pi)"><?pi data?></x:param></x:call><x:expect label="e" select="()"/></x:scenario>`)), []);
		const xslt = await vscode.workspace.openTextDocument({ language: 'xslt', content: `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
<xsl:template match="/"><xsl:variable name="v" as="processing-instruction(pi)?" select="()"/><xsl:sequence select="$v"/></xsl:template></xsl:stylesheet>` });
		assert.deepEqual((await moduleDiagnostics.call(XsltSymbolProvider, xslt, false, XSLTConfiguration.configuration)).map((d) => d.message), []);
	});

	test('XSpec\'s runtime utilities, in every XSLT test runner: e.g. x:UQName() and $x:apos', async () => {
		assert.deepEqual(await problems(xspec(`<x:scenario label="s"><x:call function="f:double"><x:param select="1"/></x:call><x:expect label="e" test="x:UQName('urn:a', 'b') ne $x:apos"/></x:scenario>`)), []);
	});

	test('user content: an element with the XSpec prefix, or named x:..., in another namespace isn\'t XSpec\'s', async () => {
		// x bound to another namespace in user content, e.g. SpreadsheetML's
		assert.deepEqual(await problems(xspec(`<x:scenario label="s"><x:context><doc xmlns:x="urn:schemas-microsoft-com:office:excel"><x:document/></doc></x:context><x:expect label="e" select="()"/></x:scenario>`)), []);
		// with t:description, x is another namespace's prefix
		assert.deepEqual(await problems(xspec(`<t:scenario label="s"><t:context><x:doc/></t:context><t:expect label="e" select="()"/></t:scenario>`, ' stylesheet="sut.xsl" xmlns:x="urn:other"', 't')), []);
		// still reported: an XSpec element in user content
		assert.deepEqual(await problems(xspec(`<x:scenario label="s"><x:context><doc><x:expect label="e" select="()"/></doc></x:context><x:expect label="e" select="()"/></x:scenario>`)), ['XSpec: element x:expect is not allowed here']);
	});

	suite('x:helper package-name: a package in the workspace', () => {
		const pkg = path.join(dir, 'helper-pkg.xsl');
		suiteSetup(async () => {
			fs.writeFileSync(pkg, `<xsl:package xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:h="urn:helper" name="urn:helper-pkg" package-version="2.0" version="3.0">
  <xsl:function name="h:triple" visibility="public"><xsl:param name="n"/><xsl:sequence select="$n * 3"/></xsl:function>
  <xsl:function name="h:hidden" visibility="private"><xsl:sequence select="1"/></xsl:function>
</xsl:package>`);
			await ImportIndex.instance.buildFrom([pkg, path.join(dir, 'sut.xsl')]);
		});
		const helper = (version = '') => xspec(`<x:helper package-name="urn:helper-pkg"${version}/>
<x:scenario label="s"><x:call function="f:double"><x:param select="h:triple(1)"/></x:call><x:expect label="e" select="6"/></x:scenario>`, ' stylesheet="sut.xsl" xmlns:h="urn:helper"');

		test('its public functions can be used, not its private ones', async () => {
			assert.deepEqual(await problems(helper()), []);
			assert.deepEqual(await problems(helper().replace('h:triple(1)', 'h:hidden()')), ['XPath: Function: \'h:hidden\' with 0 arguments not found']);
		});

		test('completion of the package names and versions, its hover, and Go to Definition', async () => {
			assert.include(await completions(xspec('<x:helper package-name="|"/>')), 'urn:helper-pkg');
			assert.includeMembers(await completions(xspec('<x:helper package-name="urn:helper-pkg" package-version="|"/>')), ['*', '2.0']);
			const content = helper().replace('package-name="urn:helper-pkg"', 'package-name="urn:hel|per-pkg"');
			assert.include(hoverText(await at(content, 'vscode.executeHoverProvider')), 'Package `urn:helper-pkg` version 2.0');
			const locations = await at(content, 'vscode.executeDefinitionProvider') as (vscode.Location | vscode.LocationLink)[];
			assert.deepEqual(locations.map((l) => path.basename('uri' in l ? l.uri.fsPath : l.targetUri.fsPath)), ['helper-pkg.xsl']);
		});

		test('a package that isn\'t found, or not in the version: a problem in the Problems view', async () => {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file(`helper${count++}.xspec`, helper(' package-version="9.9"'))));
			await vscode.window.showTextDocument(document);
			let messages: string[] = [];
			for (let i = 0; i < 50 && !messages.some((m) => m.includes('helper package')); i++) {
				await new Promise((resolve) => setTimeout(resolve, 100));
				messages = vscode.languages.getDiagnostics(document.uri).map((d) => d.message);
			}
			assert.include(messages, 'XSpec: the helper package \'urn:helper-pkg\' with package-version \'9.9\' not found - in the workspace, or the XSLT.resources.xsltPackages setting');
		});

		test('find all references to a package\'s function: its uses in the XSpec files with the package as a helper', async () => {
			const tests = file(`helper-refs${count++}.xspec`, helper());
			await vscode.workspace.openTextDocument(vscode.Uri.file(tests));
			const packageDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(pkg));
			const offset = packageDocument.getText().indexOf('name="h:triple"') + 8;
			const locations = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', packageDocument.uri, packageDocument.positionAt(offset));
			assert.deepEqual(locations.filter((l) => l.uri.fsPath === tests).map((l) => l.range.start.line + 1), [3]);
		});
	});
});
