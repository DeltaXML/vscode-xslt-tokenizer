/**
 * Test suite for editing Schematron (.sch) files: auto-completion from the ISO Schematron 2025 schema, as SchXslt2 - the
 * Schematron processor bundled with XSpec - implements it (see src/schSchema.ts)
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { SchConfiguration } from '../../src/languageConfigurations';
import { LanguageConfiguration } from '../../src/xslLexer';

suite('Schematron', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sch-'));
	let count = 0;

	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
	});

	const completions = async (content: string, marker = '|') => {
		const offset = content.indexOf(marker);
		const file = path.join(dir, `complete${count++}.sch`);
		fs.writeFileSync(file, content.replace(marker, ''));
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		assert.strictEqual(document.languageId, 'sch');
		const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(offset));
		return list.items.map((item) => typeof item.label === 'string' ? item.label : item.label.label);
	};
	const prefixed = (body: string) => `<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt3">\n${body}\n</sch:schema>`;
	const unprefixed = (body: string) => `<schema xmlns="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt3">\n${body}\n</schema>`;

	const ruleChildren = ['assert', 'report', 'let', 'extends', 'p', 'include'];

	test('elements: with the Schematron namespace as the default - no prefix, as most Schematron files are written', async () => {
		const names = await completions(unprefixed('<pattern><rule context="a">\n<|\n</rule></pattern>'));
		assert.includeMembers(names, ruleChildren, names.join(', '));
		assert.isFalse(names.some((name) => name.startsWith('sch:')), names.join(', '));
	});

	test('elements: with the prefix of sch:schema, e.g. sch or iso', async () => {
		const names = await completions(prefixed('<sch:pattern><sch:rule context="a">\n<|\n</sch:rule></sch:pattern>'));
		assert.includeMembers(names, ruleChildren.map((name) => 'sch:' + name), names.join(', '));
		const iso = await completions(`<iso:schema xmlns:iso="http://purl.oclc.org/dsdl/schematron"><iso:pattern><iso:rule context="a">\n<|\n</iso:rule></iso:pattern></iso:schema>`);
		assert.includeMembers(iso, ruleChildren.map((name) => 'iso:' + name), iso.join(', '));
	});

	test('ISO Schematron 2025, as SchXslt2 implements it: groups, parameters and the XSLT declarations it copies', async () => {
		const schemaChildren = await completions(unprefixed('<|'));
		assert.includeMembers(schemaChildren, ['ns', 'let', 'param', 'phase', 'pattern', 'group', 'include', 'diagnostics', 'properties',
			'xsl:function', 'xsl:key', 'xsl:accumulator', 'xsl:include', 'xsl:import', 'xsl:use-package'], schemaChildren.join(', '));
		// not Schematron 1.5's key, nor XSLT declarations SchXslt2 ignores
		for (const name of ['key', 'xsl:param', 'xsl:variable', 'xsl:template']) {
			assert.notInclude(schemaChildren, name, schemaChildren.join(', '));
		}
		const assertAttributes = await completions(unprefixed('<pattern><rule context="a"><assert | test="1"/></rule></pattern>'));
		assert.includeMembers(assertAttributes, ['severity', 'properties', 'flag', 'diagnostics', 'role', 'subject', 'id'], assertAttributes.join(', '));
		const severities = await completions(unprefixed('<pattern><rule context="a"><assert severity="|" test="1"/></rule></pattern>'));
		assert.includeMembers(severities, ['info', 'warning', 'error', 'fatal'], severities.join(', '));
		const phaseAttributes = await completions(unprefixed('<phase | id="p"/>'));
		assert.includeMembers(phaseAttributes, ['from', 'when'], phaseAttributes.join(', '));
		const ruleAttributes = await completions(unprefixed('<pattern><rule | context="a"/></pattern>'));
		assert.includeMembers(ruleAttributes, ['visit-each', 'abstract', 'flag'], ruleAttributes.join(', '));
		const patternAttributes = await completions(unprefixed('<pattern |/>'));
		assert.includeMembers(patternAttributes, ['abstract', 'is-a', 'documents'], patternAttributes.join(', '));
	});

	test('formatting: end tags with no prefix are outdented', async () => {
		const file = path.join(dir, `format${count++}.sch`);
		fs.writeFileSync(file, unprefixed('<pattern>\n<rule context="a">\n<assert test="1"/>\n</rule>\n</pattern>'));
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', document.uri, { tabSize: 2, insertSpaces: true });
		const edit = new vscode.WorkspaceEdit();
		edit.set(document.uri, edits ?? []);
		await vscode.workspace.applyEdit(edit);
		assert.deepEqual(document.getText().split('\n').slice(1, 6), ['  <pattern>', '    <rule context="a">', '      <assert test="1"/>', '    </rule>', '  </pattern>']);
	});

	test('the outline and breadcrumbs: the elements as they\'re written - with no prefix, or the file\'s', async () => {
		const outline = async (content: string) => {
			const file = path.join(dir, `outline${count++}.sch`);
			fs.writeFileSync(file, content);
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
			const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri);
			const names = (list: vscode.DocumentSymbol[]): string[] => list.filter((s) => s.name !== 'attributes').flatMap((s) => [s.name, ...names(s.children)]);
			return names(symbols ?? []);
		};
		assert.deepEqual(await outline(unprefixed('<pattern id="p"><rule context="a"><assert test="1"/></rule></pattern>')), ['schema', 'pattern', 'rule', 'assert']);
		assert.deepEqual(await outline(prefixed('<sch:pattern id="p"><sch:rule context="a"><sch:assert test="1"/></sch:rule></sch:pattern>')), ['sch:schema', 'sch:pattern', 'sch:rule', 'sch:assert']);
	});

	const moduleDiagnostics = (XsltSymbolProvider as unknown as { moduleDiagnostics(d: vscode.TextDocument, parent: boolean, config: LanguageConfiguration): Promise<vscode.Diagnostic[]> }).moduleDiagnostics;
	const problems = async (content: string) => {
		const file = path.join(dir, `problems${count++}.sch`);
		fs.writeFileSync(file, content);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const diagnostics = await moduleDiagnostics.call(XsltSymbolProvider, document, false, SchConfiguration.configuration);
		return diagnostics.filter((d) => d.severity !== vscode.DiagnosticSeverity.Hint).map((d) => `${d.range.start.line}: ${d.message}`);
	};

	test('variables: sch:let and sch:param, in scope as SchXslt2 declares them - the schema\'s and a phase\'s are global', async () => {
		assert.deepEqual(await problems(unprefixed(`
<let name="g" value="1"/>
<param name="gp" value="2"/>
<phase id="ph"><let name="phv" value="3"/><active pattern="p"/></phase>
<pattern id="p">
<let name="pv" value="4"/>
<rule context="a">
<let name="rv" value="5"/>
<assert test="$g + $gp + $phv + $pv + $rv + $undeclared">x</assert>
</rule>
</pattern>`)), ['9: XPath: The variable/parameter $undeclared cannot be resolved']);
	});

	test('variables: a rule\'s sch:let is in scope in the rule, and a pattern\'s in the pattern - not in others', async () => {
		assert.deepEqual(await problems(unprefixed(`
<pattern id="p1"><let name="pv" value="1"/>
<rule context="a"><let name="rv" value="2"/><assert test="$pv + $rv">x</assert></rule>
<rule context="b"><assert test="$rv">x</assert></rule>
</pattern>
<pattern id="p2"><rule context="c"><assert test="$pv">x</assert></rule></pattern>`)),
		['4: XPath: The variable/parameter $rv cannot be resolved', '6: XPath: The variable/parameter $pv cannot be resolved']);
	});

	test('variables: an abstract pattern\'s parameters are replaced as text, so they aren\'t variable references - also with a prefix', async () => {
		assert.deepEqual(await problems(unprefixed(`
<pattern abstract="true" id="ap"><rule context="$ctx"><assert test="$param1">y</assert></rule></pattern>
<pattern is-a="ap" id="p"><param name="ctx" value="a"/><param name="param1" value="true()"/></pattern>`)), []);
		assert.deepEqual(await problems(prefixed(`
<sch:group abstract="true" id="ag"><sch:rule context="$ctx"><sch:assert test="$p">y</sch:assert></sch:rule></sch:group>`)), []);
	});

	test('a new file: auto-completion of the outermost element offers a Schematron schema', async () => {
		const names = await completions('<|');
		assert.include(names, 'Schematron schema', names.join(', '));
	});

	test('prefixes: those of sch:ns, wherever it is - the only ones SchXslt2 declares in its validation stylesheet', async () => {
		assert.deepEqual(await problems(unprefixed(`<pattern><rule context="f:a"><assert test="@n castable as xs:integer">x</assert></rule></pattern>
<ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/><ns prefix="f" uri="urn:f"/>`)), []);
		assert.deepEqual(await problems(unprefixed('<pattern><rule context="a"><assert test="@n castable as xs:integer and f:x(.)">x</assert></rule></pattern>')),
			["1: XPath: Invalid type: 'xs:integer'", "1: XPath: Undeclared prefix in function: 'f:x'"]);
	});

	test('prefixes: one declared with xmlns, not sch:ns, is undeclared in the schema\'s XPath - but declared within an XSLT element', async () => {
		const xmlns = 'xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"';
		assert.deepEqual(await problems(`<schema xmlns="http://purl.oclc.org/dsdl/schematron" ${xmlns} queryBinding="xslt3">
<pattern><rule context="a"><assert test="@n castable as xs:integer">x</assert></rule></pattern></schema>`), ["1: XPath: Invalid type: 'xs:integer'"]);
		assert.deepEqual(await problems(`<schema xmlns="http://purl.oclc.org/dsdl/schematron" ${xmlns} queryBinding="xslt3">
<xsl:key name="k" match="a" use="xs:integer(@n)"/></schema>`), []);
	});

	const xsl = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"';

	test('XSLT: a function declared with xsl:function - its parameters, variables and namespaces checked as in a stylesheet', async () => {
		assert.deepEqual(await problems(unprefixed(`<ns prefix="f" uri="urn:f"/>
<xsl:function ${xsl} name="f:x" as="xs:integer"><xsl:param name="a" as="xs:integer"/><xsl:variable name="v" select="$a + 1"/><xsl:sequence select="$v cast as xs:integer"/></xsl:function>
<pattern><rule context="a"><assert test="f:x(1) eq 2 and f:x() and f:nope(1)">x</assert></rule></pattern>`)),
		["3: XPath: Function: 'f:x' with 0 arguments not found", "3: XPath: Function: 'f:nope' with 1 arguments not found"]);
	});

	test('XSLT: the XPath of an XSLT element is checked, e.g. xsl:key\'s use', async () => {
		assert.deepEqual(await problems(unprefixed(`<xsl:key ${xsl} name="k" match="a" use="xs:integer(@n) + $undeclared"/>
<pattern><rule context="a"><assert test="key('k', 1)">x</assert></rule></pattern>`)), ['1: XPath: The variable/parameter $undeclared cannot be resolved']);
	});

	test('XSLT: the functions of a module included with xsl:include', async () => {
		fs.writeFileSync(path.join(dir, 'lib.xsl'), `<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:g="urn:f">
<xsl:function name="g:lib"><xsl:param name="p"/><xsl:sequence select="$p"/></xsl:function></xsl:stylesheet>`);
		assert.deepEqual(await problems(unprefixed(`<ns prefix="f" uri="urn:f"/><xsl:include ${xsl} href="lib.xsl"/>
<pattern><rule context="a"><assert test="f:lib(1) and f:lib()">x</assert></rule></pattern>`)), ["2: XPath: Function: 'f:lib' with 0 arguments not found"]);
	});

	test('XSLT: a top-level XSLT declaration that SchXslt2 ignores, e.g. xsl:param, declares nothing', async () => {
		assert.deepEqual(await problems(unprefixed(`<xsl:param ${xsl} name="OTP" select="false()"/>
<pattern><rule context="a"><assert test="$OTP">x</assert></rule></pattern>`)), ['2: XPath: The variable/parameter $OTP cannot be resolved']);
	});

	test('formatting: an XSLT element\'s end tag is outdented', async () => {
		const file = path.join(dir, `format${count++}.sch`);
		fs.writeFileSync(file, unprefixed(`<xsl:function ${xsl} name="f:x">\n<xsl:sequence select="1"/>\n</xsl:function>\n<pattern/>`));
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', document.uri, { tabSize: 2, insertSpaces: true });
		const edit = new vscode.WorkspaceEdit();
		edit.set(document.uri, edits ?? []);
		await vscode.workspace.applyEdit(edit);
		assert.deepEqual(document.getText().split('\n').slice(2, 5), ['    <xsl:sequence select="1"/>', '  </xsl:function>', '  <pattern/>']);
	});
});
