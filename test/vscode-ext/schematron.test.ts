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
import { SchXslt2Checks } from '../../src/schXslt2Checks';
import { SchReferences } from '../../src/schReferences';
import { SchRequired } from '../../src/schRequired';
import { SchSnippets } from '../../src/schSnippets';
import { XSpecRunner } from '../../src/xspecRunner';

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

	// the text of the file, formatted - not applied to the document, which, left with unsaved changes, would be checked again
	// as other tests run
	const formatted = async (file: string) => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', document.uri, { tabSize: 2, insertSpaces: true });
		return (edits ?? []).map((edit) => [document.offsetAt(edit.range.start), document.offsetAt(edit.range.end), edit.newText] as const)
			.sort((a, b) => b[0] - a[0]).reduce((text, [start, end, newText]) => text.substring(0, start) + newText + text.substring(end), document.getText());
	};

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
		assert.deepEqual((await formatted(file)).split('\n').slice(1, 6), ['  <pattern>', '    <rule context="a">', '      <assert test="1"/>', '    </rule>', '  </pattern>']);
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
			["1: XPath: The prefix 'xs' isn't declared with sch:ns - SchXslt2 declares only the sch:ns prefixes in its validation stylesheet, not those declared with xmlns", "1: XPath: The prefix 'f' isn't declared with sch:ns - SchXslt2 declares only the sch:ns prefixes in its validation stylesheet, not those declared with xmlns"]);
	});

	test('prefixes: one declared with xmlns, not sch:ns, is undeclared in the schema\'s XPath - but declared within an XSLT element', async () => {
		const xmlns = 'xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"';
		assert.deepEqual(await problems(`<schema xmlns="http://purl.oclc.org/dsdl/schematron" ${xmlns} queryBinding="xslt3">
<pattern><rule context="a"><assert test="@n castable as xs:integer">x</assert></rule></pattern></schema>`), ["1: XPath: The prefix 'xs' isn't declared with sch:ns - SchXslt2 declares only the sch:ns prefixes in its validation stylesheet, not those declared with xmlns"]);
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
		assert.deepEqual((await problems(unprefixed(`<xsl:param ${xsl} name="OTP" select="false()"/>
<pattern><rule context="a"><assert test="$OTP">x</assert></rule></pattern>`))).sort(), ['1: SchXslt2: xsl:param is ignored - only xsl:accumulator, xsl:function, xsl:include, xsl:import, xsl:import-schema, xsl:key, xsl:use-package are copied into its validation stylesheet - use sch:param', '2: XPath: The variable/parameter $OTP cannot be resolved']);
	});

	test('formatting: an XSLT element\'s end tag is outdented', async () => {
		const file = path.join(dir, `format${count++}.sch`);
		fs.writeFileSync(file, unprefixed(`<xsl:function ${xsl} name="f:x">\n<xsl:sequence select="1"/>\n</xsl:function>\n<pattern/>`));
		assert.deepEqual((await formatted(file)).split('\n').slice(2, 5), ['    <xsl:sequence select="1"/>', '  </xsl:function>', '  <pattern/>']);
	});

	// the problems with the document - and after applying the quick fix for the problem with the message, the text
	const fixed = async (content: string, message: RegExp) => {
		const file = path.join(dir, `fix${count++}.sch`);
		fs.writeFileSync(file, content);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const diagnostics = await moduleDiagnostics.call(XsltSymbolProvider, document, false, SchConfiguration.configuration);
		const diagnostic = diagnostics.find((d) => message.test(d.message));
		assert.isDefined(diagnostic, diagnostics.map((d) => d.message).join('\n'));
		const actions = SchXslt2Checks.codeActions(document, [diagnostic!]);
		assert.lengthOf(actions, 1, diagnostic!.message);
		// applied to the text, not the document - which, left with unsaved changes, would be checked again as other tests run
		const edits = actions[0].edit!.get(document.uri).map((edit) => [document.offsetAt(edit.range.start), document.offsetAt(edit.range.end), edit.newText] as const);
		return edits.sort((a, b) => b[0] - a[0]).reduce((text, [start, end, newText]) => text.substring(0, start) + newText + text.substring(end), document.getText());
	};

	test('SchXslt2: XSLT it ignores - a top-level declaration it doesn\'t copy, or in a rule - or doesn\'t run, in a message', async () => {
		const messages = (await problems(unprefixed(`<ns prefix="f" uri="urn:f"/>
<xsl:param ${xsl} name="p" select="1"/>
<xsl:template ${xsl} match="a"/>
<xsl:function ${xsl} name="f:x"><xsl:sequence select="1"/></xsl:function>
<let name="v"><xsl:sequence ${xsl} select="1"/></let>
<pattern><rule context="a"><xsl:variable ${xsl} name="v2" select="1"/>
<assert test="true()">at <xsl:value-of ${xsl} select="path()"/></assert></rule></pattern>
<properties><property id="p1"><xsl:copy-of ${xsl} select="."/></property></properties>`))).map((m) => m.replace(/ - only .* are copied into its validation stylesheet/, ' - only ...'));
		assert.deepEqual(messages, [
			'2: SchXslt2: xsl:param is ignored - only ... - use sch:param',
			'3: SchXslt2: xsl:template is ignored - only ...',
			'5: SchXslt2: xsl:sequence isn\'t run in the content of sch:let - it\'s copied into the value as it is: use the value attribute for an expression',
			'6: SchXslt2: xsl:variable is ignored in sch:rule - use sch:let',
			'7: SchXslt2: xsl:value-of isn\'t run in a message - it\'s copied into the report as it is - use sch:value-of'
		]);
	});

	test('SchXslt2: quick fixes - xsl:variable to sch:let, a top-level xsl:param to sch:param, xsl:value-of to sch:value-of', async () => {
		const rule = (content: string) => unprefixed(`<pattern><rule context="a">${content}<assert test="true()">x</assert></rule></pattern>`);
		assert.include(await fixed(rule(`<xsl:variable ${xsl} name="v" as="xs:integer" select="count(*) &lt; 2"/>`), /xsl:variable is ignored/),
			'<let name="v" value="count(*) &lt; 2" as="xs:integer"/>');
		assert.include(await fixed(prefixed(`<xsl:param ${xsl} name="OTP" select="false()"/>`), /xsl:param is ignored/), '<sch:param name="OTP" value="false()"/>');
		assert.include(await fixed(unprefixed(`<pattern><rule context="a"><assert test="true()">at <xsl:value-of ${xsl} select="path()"/></assert></rule></pattern>`), /xsl:value-of isn't run/),
			'at <value-of select="path()"/></assert>');
	});

	test('SchXslt2: a prefix not declared with sch:ns - one problem, with a quick fix adding the sch:ns', async () => {
		const content = `<schema xmlns="http://purl.oclc.org/dsdl/schematron" xmlns:f="urn:f" queryBinding="xslt3">
  <ns prefix="g" uri="urn:g"/>
  <pattern><rule context="a"><assert test="xs:integer(@n) gt 0 and f:x()">x</assert></rule></pattern>
</schema>`;
		assert.deepEqual(await problems(content), [
			"2: XPath: The prefix 'xs' isn't declared with sch:ns - SchXslt2 declares only the sch:ns prefixes in its validation stylesheet, not those declared with xmlns",
			"2: XPath: The prefix 'f' isn't declared with sch:ns - SchXslt2 declares only the sch:ns prefixes in its validation stylesheet, not those declared with xmlns"
		]);
		// a known namespace, e.g. xs - or the namespace an xmlns declares for the prefix
		assert.include(await fixed(content, /prefix 'xs'/), '<ns prefix="g" uri="urn:g"/>\n  <ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/>');
		assert.include(await fixed(content, /prefix 'f'/), '<ns prefix="f" uri="urn:f"/>');
	});

	test('SchXslt2: an included module that declares the unnamed mode with use-accumulators, or accumulators', async () => {
		fs.writeFileSync(path.join(dir, 'modes.xsl'), `<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:mode use-accumulators="#all"/><xsl:accumulator name="acc" initial-value="0"><xsl:accumulator-rule match="a" select="$value + 1"/></xsl:accumulator></xsl:stylesheet>`);
		const file = path.join(dir, `include${count++}.sch`);
		fs.writeFileSync(file, unprefixed(`<xsl:include ${xsl} href="modes.xsl"/>`));
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const diagnostics = SchXslt2Checks.problems(document);
		assert.deepEqual(diagnostics.map((d) => [vscode.DiagnosticSeverity[d.severity], /XTSE0545/.test(d.message) || /accumulator acc/.test(d.message)]),
			[['Error', true], ['Warning', true]]);
	});

	test('not reported: foreign elements, e.g. Schematron QuickFix\'s, with their attributes - and Schematron elements within them', async () => {
		assert.deepEqual(await problems(`<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron" xmlns:sqf="http://www.schematron-quickfix.com/validator/process" queryBinding="xslt3">
<sch:pattern><sch:rule context="a"><sch:assert test="@id" sqf:fix="add-id">x</sch:assert>
<sqf:fix id="add-id"><sqf:description><sqf:title>Add <sch:value-of select="name()"/></sqf:title></sqf:description><sqf:add node-type="attribute" target="id" select="'1'"/></sqf:fix>
</sch:rule></sch:pattern>
<sch:properties><sch:property id="p"><user-data><elem1 id="i">x</elem1></user-data></sch:property></sch:properties>
<sch:pattern><sch:rule context="b"><sch:let name="v"><function xmlns="http://www.w3.org/2012/xquery">x</function></sch:let><sch:assert test="$v">x</sch:assert></sch:rule></sch:pattern></sch:schema>`), []);
	});

	test('not reported: a file sch:include includes, whose outermost element is, e.g., sch:pattern', async () => {
		assert.deepEqual(await problems(`<sch:pattern xmlns:sch="http://purl.oclc.org/dsdl/schematron"><sch:rule context="a"><sch:report test="b">x</sch:report></sch:rule></sch:pattern>`), []);
	});

	test('not reported: SchXslt2\'s $schxslt:phase, severity as a variable or another value, and other query bindings', async () => {
		assert.deepEqual(await problems(`<schema xmlns="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt4"><ns prefix="schxslt" uri="http://dmaus.name/ns/2023/schxslt"/>
<let name="sev" value="'info'"/>
<pattern><rule context="a"><report test="$schxslt:phase eq 'A' and identity(1)" severity="$sev">x</report><assert test="1" severity="custom">x</assert></rule></pattern></schema>`), []);
		// XQuery's functions, e.g. local:add, declared in XQuery
		assert.deepEqual(await problems(`<schema xmlns="http://purl.oclc.org/dsdl/schematron" queryBinding="xquery31"><pattern><rule context="a"><report test="local:add(0, 1)">x</report></rule></pattern></schema>`), []);
	});

	test('Schematron 1.5: not ISO Schematron, which SchXslt2 validates with - and its pattern names aren\'t QNames', async () => {
		assert.deepEqual(await problems(`<s:schema xmlns:s="http://www.ascc.net/xml/schematron"><s:pattern name="A 'quoted' constraint"><s:rule context="a"><s:assert test="b">x</s:assert></s:rule></s:pattern></s:schema>`),
			["0: SchXslt2: this isn't ISO Schematron, whose namespace is http://purl.oclc.org/dsdl/schematron - SchXslt2 doesn't validate with it"]);
	});

	test('the problems are in the Problems view for a Schematron file open in an editor', async () => {
		const file = path.join(dir, `published${count++}.sch`);
		fs.writeFileSync(file, unprefixed('<pattern><rule context="a"><assert test="$undeclared">x</assert></rule></pattern>'));
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		await vscode.window.showTextDocument(document);
		let messages: string[] = [];
		for (let i = 0; i < 50 && messages.length === 0; i++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			messages = vscode.languages.getDiagnostics(document.uri).map((d) => d.message);
		}
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		assert.deepEqual(messages, ['XPath: The variable/parameter $undeclared cannot be resolved']);
	});

	test('variables: an abstract rule and the rules extending it share their sch:let - as SchXslt2 copies its content into them', async () => {
		assert.deepEqual(await problems(unprefixed(`<pattern>
<rule abstract="true" id="base"><let name="fromBase" value="1"/></rule>
<rule abstract="true" id="ar"><extends rule="base"/><let name="fromAbstract" value="1"/><assert test="$fromExtender + $fromBase gt 0">x</assert></rule>
<rule context="a"><let name="fromExtender" value="1"/><extends rule="ar"/><assert test="$fromAbstract + $fromBase + $undeclared gt 0">x</assert></rule>
<rule context="b"><assert test="$fromAbstract">x</assert></rule></pattern>`)),
		['4: XPath: The variable/parameter $undeclared cannot be resolved', '5: XPath: The variable/parameter $fromAbstract cannot be resolved']);
	});

	test('references: errors where SchXslt2 stops, and warnings where it ignores the reference - with the ids of included files', async () => {
		fs.writeFileSync(path.join(dir, 'included-pattern.sch'), `<pattern xmlns="http://purl.oclc.org/dsdl/schematron" abstract="true" id="inc"><rule context="$c"><assert test="1">x</assert></rule></pattern>`);
		const messages = await problems(unprefixed(`<phase id="ph"><active pattern="p"/><active pattern="nope"/><active pattern="ap"/></phase>
<pattern abstract="true" id="ap"><param name="needed"/><param name="optional" value="1"/><rule context="$needed"><assert test="$optional">x</assert></rule></pattern>
<include href="included-pattern.sch"/>
<pattern id="p" is-a="ap"><param name="needed" value="a"/><param name="old-style" value="1"/></pattern>
<pattern id="p2" is-a="ap"/>
<pattern id="p3" is-a="inc"><param name="c" value="b"/></pattern>
<pattern id="p4" is-a="p"/>
<group id="g" is-a="ap"/>
<pattern id="p5" is-a="missing"/>
<pattern id="p6"><rule abstract="true" id="ar"><assert test="1" diagnostics="d1 dx" properties="px">x</assert></rule>
<rule context="a" id="r"><extends rule="ar"/><extends rule="r"/><extends rule="gone"/><assert test="1" id="p6">x</assert></rule></pattern>
<diagnostics><diagnostic id="d1">d</diagnostic></diagnostics>`));
		assert.deepEqual(messages.filter((m) => m.includes('SchXslt2:')).sort(), [
			'1: SchXslt2: no pattern or group has the id nope - the phase has no pattern with it',
			'1: SchXslt2: the pattern ap is abstract - only the patterns with is-a for it are run',
			'5: SchXslt2: the abstract pattern ap declares the parameter needed, with no value - supply it with sch:param',
			'7: SchXslt2: the pattern p isn\'t an abstract pattern - is-a must be the id of one',
			'8: SchXslt2: the pattern ap isn\'t an abstract group - is-a must be the id of one',
			'9: SchXslt2: no abstract pattern has the id missing',
			'10: SchXslt2: the id p6 isn\'t unique in the schema',
			'10: SchXslt2: no diagnostic has the id dx - it\'s left out of the report',
			'10: SchXslt2: no property has the id px - it\'s left out of the report',
			'11: SchXslt2: the rule r isn\'t abstract - extends must be the id of an abstract rule',
			'11: SchXslt2: no abstract rule has the id gone',
			'11: SchXslt2: the id p6 isn\'t unique in the schema'
		].sort());
	});

	test('references: Go to Definition from is-a, extends\' rule, active\'s pattern and diagnostics - also into an included file', async () => {
		fs.writeFileSync(path.join(dir, 'included-pattern2.sch'), `<pattern xmlns="http://purl.oclc.org/dsdl/schematron" abstract="true" id="inc2"/>`);
		const content = unprefixed(`<phase id="ph"><active pattern="p"/></phase>
<include href="included-pattern2.sch"/>
<pattern id="p" is-a="inc2"/>
<pattern id="q"><rule abstract="true" id="ar"/><rule context="a"><extends rule="ar"/><assert test="1" diagnostics="d1">x</assert></rule></pattern>
<diagnostics><diagnostic id="d1">d</diagnostic></diagnostics>`);
		const file = path.join(dir, `definition${count++}.sch`);
		fs.writeFileSync(file, content);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const at = (text: string) => document.positionAt(content.indexOf(text) + text.length - 1);
		const target = (text: string) => SchReferences.definition(document, at(text))?.map((l) => `${path.basename(l.uri.fsPath)}:${l.range.start.line}:${l.range.start.character}`);
		assert.deepEqual(target('pattern="p'), [`${path.basename(file)}:3:0`]);
		assert.deepEqual(target('is-a="inc2'), ['included-pattern2.sch:0:0']);
		assert.deepEqual(target('rule="ar'), [`${path.basename(file)}:4:16`]);
		assert.deepEqual(target('diagnostics="d1'), [`${path.basename(file)}:5:13`]);
	});

	test('links: the files of sch:include, sch:extends href and xsl:include - and one that isn\'t found is reported', async () => {
		fs.writeFileSync(path.join(dir, 'linked-pattern.sch'), `<pattern xmlns="http://purl.oclc.org/dsdl/schematron" id="lp"/>`);
		fs.writeFileSync(path.join(dir, 'linked-library.sch'), `<library xmlns="http://purl.oclc.org/dsdl/schematron"><rules><rule abstract="true" id="lr"/></rules></library>`);
		fs.writeFileSync(path.join(dir, 'linked.xsl'), `<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"/>`);
		const content = unprefixed(`<include href="linked-pattern.sch"/>
<extends href="linked-library.sch#lr"/>
<xsl:include ${xsl} href="linked.xsl"/>
<include href="missing.sch"/>`);
		const file = path.join(dir, `links${count++}.sch`);
		fs.writeFileSync(file, content);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', document.uri);
		// not VS Code's own links for URIs, e.g. the namespaces' - and an xsl:include's link includes the quotes
		assert.deepEqual(links.filter((l) => l.target?.scheme === 'file').map((l) => `${document.getText(l.range).replace(/"/g, '')} ${path.basename(l.target!.fsPath)}`).sort(),
			['linked-library.sch linked-library.sch', 'linked-pattern.sch linked-pattern.sch', 'linked.xsl linked.xsl', 'missing.sch missing.sch']);
		assert.include(await problems(content), "4: SchXslt2: the file missing.sch isn't found");
	});

	test('required attributes: an error where SchXslt2 fails without it, else a warning - not within a foreign element', async () => {
		const messages = await problems(unprefixed(`<ns prefix="f"/>
<param name="p"/>
<phase><active/></phase>
<pattern abstract="true"><param name="c"/><rule context="$c"><assert test="1">x</assert></rule></pattern>
<pattern is-a="x" id="i"><param name="c"/></pattern>
<pattern id="p1"><rule><let value="1"/><assert>x <value-of/><span>s</span></assert><report test="1">y</report></rule>
<rule abstract="true"><extends/></rule></pattern>
<include/>
<diagnostics><diagnostic>d</diagnostic></diagnostics>
<properties><property>p<user-data xmlns="urn:data"><span/></user-data></property></properties>`));
		const required = messages.filter((m) => m.includes('must have'));
		assert.deepEqual(required, [
			"1: Schematron: ns must have a 'uri' attribute - SchXslt2 fails without it",
			"2: Schematron: param must have a 'value' attribute - ISO Schematron requires it",
			"3: Schematron: phase must have a 'id' attribute - ISO Schematron requires it",
			"3: Schematron: active must have a 'pattern' attribute - ISO Schematron requires it",
			"4: Schematron: pattern must have a 'id' attribute - ISO Schematron requires it",
			"5: Schematron: param must have a 'value' attribute - SchXslt2 fails without it",
			"6: Schematron: rule must have a 'context' attribute - SchXslt2 fails without it",
			"6: Schematron: let must have a 'name' attribute - SchXslt2 fails without it",
			"6: Schematron: assert must have a 'test' attribute - SchXslt2 fails without it",
			"6: Schematron: value-of must have a 'select' attribute - SchXslt2 fails without it",
			"6: Schematron: span must have a 'class' attribute - ISO Schematron requires it",
			"7: Schematron: rule must have a 'id' attribute - ISO Schematron requires it",
			"7: Schematron: extends must have one of the attributes 'rule', 'href' - ISO Schematron requires it",
			"8: Schematron: include must have a 'href' attribute - SchXslt2 fails without it",
			"9: Schematron: diagnostic must have a 'id' attribute - ISO Schematron requires it",
			"10: Schematron: property must have a 'id' attribute - ISO Schematron requires it"
		]);
		// the quick fix adds the attribute
		const file = path.join(dir, `required${count++}.sch`);
		fs.writeFileSync(file, unprefixed('<pattern><rule><assert test="1">x</assert></rule></pattern>'));
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const diagnostic = SchRequired.problems(document)[0];
		const action = SchRequired.codeActions(document, [diagnostic])[0];
		assert.strictEqual(action.title, "Add a 'context' attribute");
	});

	test('element completion: each form of an element has the attributes it requires', async () => {
		const placed: [string, string][] = [['ns', 'schema'], ['param', 'schema'], ['param', 'pattern'], ['let', 'schema'], ['let', 'rule'], ['phase', 'schema'],
			['active', 'phase'], ['pattern', 'schema'], ['group', 'schema'], ['rule', 'pattern'], ['assert', 'rule'], ['report', 'rule'], ['extends', 'rule'],
			['extends', 'schema'], ['include', 'schema'], ['value-of', 'assert'], ['name', 'assert'], ['span', 'assert'], ['diagnostic', 'diagnostics'],
			['property', 'properties'], ['dir', 'p'], ['title', 'schema']];
		for (const [element, parent] of placed) {
			const snippets = SchSnippets.forElement(`sch:${element}`, parent);
			assert.isNotEmpty(snippets, element);
			for (const snippet of snippets!) {
				const attribute = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(snippet.body)?.[1];
				// a parameter in a pattern: one with is-a, which requires a value
				const requirements = SchRequired.ruleFor(element, parent, attribute, (name) => name === 'is-a' ? 'p' : undefined);
				for (const requirement of requirements) {
					assert.isTrue(requirement.oneOf.some((name) => attribute(name) !== undefined), `${snippet.label}: ${snippet.body}`);
				}
			}
		}
	});

	test('element completion: the forms of an element, with the file\'s prefix for Schematron - or none', async () => {
		const forms = async (content: string) => {
			const offset = content.indexOf('|');
			const file = path.join(dir, `forms${count++}.sch`);
			fs.writeFileSync(file, content.replace('|', ''));
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
			const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(offset));
			return new Map(list.items.map((item) => [typeof item.label === 'string' ? item.label : item.label.label, (item.insertText as vscode.SnippetString | undefined)?.value]));
		};
		const unprefixedForms = await forms(unprefixed('<pattern>\n<|\n</pattern>'));
		assert.strictEqual(unprefixedForms.get('rule'), 'rule context="$1">\n\t$0\n</rule>');
		assert.strictEqual(unprefixedForms.get('rule (abstract)'), 'rule abstract="true" id="$1">\n\t$0\n</rule>');
		const prefixedForms = await forms(prefixed('<sch:pattern><sch:rule context="a">\n<|\n</sch:rule></sch:pattern>'));
		assert.strictEqual(prefixedForms.get('sch:assert'), 'sch:assert test="$1">$2</sch:assert>$0');
		assert.strictEqual(prefixedForms.get('sch:let'), 'sch:let name="$1" value="$2"/>$0');
	});

	test('hover: references, rules, assertions, variables and elements - and a function\'s signature, as in a stylesheet', async () => {
		const content = unprefixed(`<let name="max" value="10"/>
<phase id="ph"><active pattern="p1"/></phase>
<pattern abstract="true" id="ap"><title>Tables</title><param name="table"/><param name="limit" value="5"/>
<rule context="$table"><assert test="count(row) le $limit">x</assert></rule></pattern>
<pattern id="pi" is-a="ap"><param name="table" value="tbl"/></pattern>
<pattern id="p1"><title>Rows</title>
<rule abstract="true" id="ar"><let name="n" value="count(*)"/><assert test="$n gt 0">empty</assert></rule>
<rule context="row[@a]"><assert test="1">x</assert></rule>
<rule context="row"><extends rule="ar"/><let name="v" value="@v"/><assert test="$v le $max and $n gt 0" diagnostics="d1" severity="warning">Row <value-of select="@id"/> too big</assert></rule>
</pattern>
<diagnostics><diagnostic id="d1">See <name/> for details</diagnostic></diagnostics>`);
		const file = path.join(dir, `hover${count++}.sch`);
		fs.writeFileSync(file, content);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		// the hover's text at the end of the text found - after the text before it, when given
		const hover = async (text: string, after = '') => {
			const offset = content.indexOf(text, content.indexOf(after)) + text.length - 1;
			const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, document.positionAt(offset));
			// as shown: without the escapes of Markdown characters in text
			return hovers.flatMap((h) => h.contents.map((c) => typeof c === 'string' ? c : c.value)).join('\n').replace(/\\([\\`*_{}[\]()#+\-.!<>|~])/g, '$1');
		};
		const isA = await hover('is-a="ap');
		assert.include(isA, 'abstract pattern ap');
		assert.include(isA, '`$table`: `tbl`');
		assert.include(isA, '`$limit`: `5` - the default');
		assert.include(isA, 'rule `tbl`');
		assert.include(isA, 'assert `count(row) le 5`');
		const extendsHover = await hover('rule="ar');
		assert.include(extendsHover, 'let `$n` := `count(*)`');
		assert.include(extendsHover, 'assert `$n gt 0`');
		assert.include(await hover('pattern="p1'), 'Rows');
		assert.include(await hover('diagnostics="d1'), 'See {name()} for details');
		const rule = await hover('<rule', '<rule context="row">');
		assert.include(rule, 'a node is handled by this rule only if it doesn\'t match an earlier rule');
		assert.include(rule, '`row[@a]`');
		// not the abstract rule, which has no context
		assert.notInclude(rule, '- ``');
		assert.include(rule, 'extends `ar`');
		const assertion = await hover('<assert', '<rule context="row">');
		assert.include(assertion, 'Reported when the test is **false**');
		assert.include(assertion, 'severity: `warning`');
		assert.include(assertion, 'Row {@id} too big');
		assert.include(assertion, 'Diagnostic `d1`: See {name()} for details');
		assert.include(await hover('$max'), 'let $max := 10');
		assert.include(await hover('$max'), 'the schema - global');
		assert.include(await hover('$n', 'test="$v'), 'let $n := count(*)');
		assert.include(await hover('$limit', 'le '), 'Parameter of the abstract pattern `ap`');
		assert.include(await hover('$limit', 'le '), '`pi`: not supplied');
		assert.include(await hover('<phase'), 'A phase');
		// a built-in function, as in a stylesheet
		assert.include(await hover('count', 'count(row)'), 'count(');
	});

	test('hover: an abstract pattern in an included file with another prefix, and a function of an included XSLT module', async () => {
		fs.writeFileSync(path.join(dir, 'hover-included.sch'), `<sch:pattern xmlns:sch="http://purl.oclc.org/dsdl/schematron" abstract="true" id="inc">
<sch:param name="c"/><sch:rule context="$c"><sch:report test="@x">x</sch:report></sch:rule></sch:pattern>`);
		fs.writeFileSync(path.join(dir, 'hover-functions.xsl'), `<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f">
<xsl:function name="f:double"><xsl:param name="n"/><xsl:sequence select="$n * 2"/></xsl:function></xsl:stylesheet>`);
		const content = unprefixed(`<ns prefix="f" uri="urn:f"/><xsl:include ${xsl} href="hover-functions.xsl"/><include href="hover-included.sch"/>
<pattern id="i" is-a="inc"><param name="c" value="item"/></pattern>
<pattern><rule context="a"><assert test="f:double(1) eq 2">x</assert></rule></pattern>`);
		const file = path.join(dir, `hover${count++}.sch`);
		fs.writeFileSync(file, content);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const hover = async (text: string) => {
			const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, document.positionAt(content.indexOf(text) + text.length - 1));
			return hovers.flatMap((h) => h.contents.map((c) => typeof c === 'string' ? c : c.value)).join('\n');
		};
		const isA = await hover('is-a="inc');
		assert.include(isA, 'rule `item`');
		assert.include(isA, 'report `@x`');
		assert.include(await hover('f:double'), 'f:double($n)');
	});

	// with the Saxon jar setting, and XSpec's setting for syntax extensions, as given - restored afterwards
	const withSaxon = async <T>(saxonJar: string, allowSyntaxExtensions: string | undefined, run: () => Promise<T>) => {
		const tasks = vscode.workspace.getConfiguration('XSLT.tasks');
		const xspec = vscode.workspace.getConfiguration('XSLT.xspec');
		const savedJar = tasks.inspect<string>('saxonJar')?.globalValue;
		const savedSetting = xspec.inspect<string>('allowSyntaxExtensions')?.globalValue;
		await tasks.update('saxonJar', saxonJar, vscode.ConfigurationTarget.Global);
		await xspec.update('allowSyntaxExtensions', allowSyntaxExtensions, vscode.ConfigurationTarget.Global);
		try {
			return await run();
		} finally {
			await tasks.update('saxonJar', savedJar, vscode.ConfigurationTarget.Global);
			await xspec.update('allowSyntaxExtensions', savedSetting, vscode.ConfigurationTarget.Global);
		}
	};
	const noteSchema = (noteAttributes = '', functionAttributes = '') => unprefixed(`<ns prefix="f" uri="urn:f"/>
<xsl:function ${xsl} name="f:double"${functionAttributes}><xsl:note${noteAttributes}>Doubles a number</xsl:note><xsl:param name="n"/><xsl:sequence select="$n * 2"/></xsl:function>
<pattern><rule context="a"><assert test="f:double(1) eq 2">x</assert></rule></pattern>`);

	test('xsl:note: in a declaration SchXslt2 copies, it needs Saxon\'s syntax extensions - not with use-when="false()"', async () => {
		const count = (content: string) => SchXslt2Checks.notesNeedingExtensions(content).length;
		assert.strictEqual(count(noteSchema()), 1);
		assert.strictEqual(count(noteSchema(' use-when="false()"')), 0);
		assert.strictEqual(count(noteSchema(' use-when=" false( ) "')), 0);
		assert.strictEqual(count(noteSchema('', ' use-when="false()"')), 0);
		// a top-level note isn't copied - it's reported as ignored
		assert.strictEqual(count(unprefixed(`<xsl:note ${xsl}>x</xsl:note>`)), 0);
	});

	test('xsl:note: reported for Saxon-HE, a Saxon before 13 or XSpec\'s setting off - not for Saxon-PE 13, or with use-when="false()"', async () => {
		const file = path.join(dir, `note${count++}.sch`);
		fs.writeFileSync(file, noteSchema());
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const noteProblems = () => SchXslt2Checks.problems(document).filter((d) => d.code === SchXslt2Checks.noteCode).map((d) => d.message.replace(/ - Saxon reports.*/, ''));
		const needs = 'SchXslt2: xsl:note in its stylesheet needs Saxon\'s syntax extensions, which ';
		assert.deepEqual(await withSaxon('/opt/SaxonHE13-0J/saxon-he-13.0.jar', undefined, async () => noteProblems()), [needs + 'Saxon-HE doesn\'t have']);
		assert.deepEqual(await withSaxon('/opt/SaxonPE12-8J/saxon-pe-12.8.jar', undefined, async () => noteProblems()), [needs + 'Saxon 12 doesn\'t have for it - Saxon 13 or later is needed']);
		assert.deepEqual(await withSaxon('/opt/SaxonPE13-1J/saxon-pe-13.1.jar', 'off', async () => noteProblems()), [needs + 'the XSLT.xspec.allowSyntaxExtensions setting turns off']);
		assert.deepEqual(await withSaxon('/opt/SaxonPE13-1J/saxon-pe-13.1.jar', undefined, async () => noteProblems()), []);
		// the quick fix adds use-when="false()"
		await withSaxon('/opt/SaxonHE13-0J/saxon-he-13.0.jar', undefined, async () => {
			const diagnostic = SchXslt2Checks.problems(document).find((d) => d.code === SchXslt2Checks.noteCode)!;
			const action = SchXslt2Checks.codeActions(document, [diagnostic])[0];
			const edit = action.edit!.get(document.uri)[0];
			assert.strictEqual(edit.newText, ' use-when="false()"');
			assert.strictEqual(document.getText(new vscode.Range(edit.range.start.translate(0, -8), edit.range.start)), 'xsl:note');
		});
	});

	test('xsl:note: XSpec turns Saxon\'s syntax extensions on for a Schematron with one, by "auto" - as for queryBinding="xslt4"', async () => {
		const xspecFor = (schema: string) => {
			const sch = path.join(dir, `tested${count++}.sch`);
			fs.writeFileSync(sch, schema);
			const xspecPath = path.join(dir, `tests${count++}.xspec`);
			fs.writeFileSync(xspecPath, `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" schematron="${path.basename(sch)}"/>`);
			return vscode.Uri.file(xspecPath);
		};
		await withSaxon('/opt/SaxonPE13-1J/saxon-pe-13.1.jar', undefined, async () => {
			assert.strictEqual(XSpecRunner.syntaxExtensionsValue(xspecFor(noteSchema())), 'on');
			assert.strictEqual(XSpecRunner.syntaxExtensionsValue(xspecFor(noteSchema(' use-when="false()"'))), 'off');
			assert.strictEqual(XSpecRunner.syntaxExtensionsValue(xspecFor('<schema xmlns="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt4"/>')), 'on');
		});
	});
});
