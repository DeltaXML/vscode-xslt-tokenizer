/**
 * Test suite for DCP files (DeltaXML's comparator configuration): checked and auto-completed from DCPSchema - the schema
 * of document-comparator-1_1.xsd in DeltaNova 2026.1, e.g. imageConfiguration's elements for binary image comparison.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';

const content = `<documentComparator version="1.0" id="images">
  <standardConfig>
    <resultReadabilityOptions>
      <modifiedWhitespaceBehaviour literalValue="automatic"/>
    </resultReadabilityOptions>
    <imageConfiguration>
      <imageXpath literalValue="//img"/>
      <imageGranularity literalValue="detailed-adjacent"/>
      <imageInputAMarkupStyle literalValue="red"/>
      <imageInputBMarkupStyle literalValue="green"/>
      <outputRefForm literalValue="source"/>
      <outputImageRefFavourSourceDoc literalValue="B"/>

    </imageConfiguration>
  </standardConfig>
</documentComparator>`;

suite('DCP schema (DeltaNova 2026.1)', () => {
	const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dcp-')));
	const file = path.join(folder, 'images.dcp');
	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		fs.writeFileSync(file, content);
	});
	suiteTeardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		fs.rmSync(folder, { recursive: true, force: true });
	});

	test('the image comparison elements and their values, and modifiedWhitespaceBehaviour\'s automatic, aren\'t reported - and are auto-completed', async () => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		await vscode.window.showTextDocument(document);
		assert.strictEqual(document.languageId, 'dcp');
		let problems: vscode.Diagnostic[] = [];
		for (let i = 0; i < 40; i++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
			problems = vscode.languages.getDiagnostics(document.uri);
		}
		assert.deepEqual(problems.map((d) => d.message), []);
		// on the empty line in imageConfiguration
		const line = content.split('\n').findIndex((l, i) => i > 0 && l.trim() === '');
		const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, new vscode.Position(line, 6), '<');
		const labels = list.items.map((item) => typeof item.label === 'string' ? item.label : item.label.label);
		assert.includeMembers(labels, ['imageGranularity', 'outputRefForm', 'outputImageRefFavourSourceDoc'], labels.join(', '));
		// a value the schema doesn't have is reported
		const editor = vscode.window.activeTextEditor!;
		const offset = document.getText().indexOf('"source"');
		await editor.edit((edit) => edit.replace(new vscode.Range(document.positionAt(offset + 1), document.positionAt(offset + 7)), 'relative'));
		for (let i = 0; i < 40 && vscode.languages.getDiagnostics(document.uri).length === 0; i++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		assert.lengthOf(vscode.languages.getDiagnostics(document.uri), 1);
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	});

	test('exactly one of literalValue, parameterRef and xpath: none, or two, reported - not for feature, whose URI name is not reported either - with a quick fix adding literalValue', async () => {
		const file2 = path.join(folder, 'values.dcp');
		fs.writeFileSync(file2, `<documentComparator version="1.0" id="values">
  <pipelineParameters>
    <booleanParameter name="ws" defaultValue="true"/>
  </pipelineParameters>
  <standardConfig>
    <resultReadabilityOptions>
      <modifiedWhitespaceBehaviour/>
      <changeGatheringEnabled literalValue="true" parameterRef="ws"/>
      <elementSplittingEnabled xpath="true()"/>
    </resultReadabilityOptions>
  </standardConfig>
  <advancedConfig>
    <parserFeatures>
      <feature name="http://xml.org/sax/features/namespaces"/>
    </parserFeatures>
  </advancedConfig>
</documentComparator>`);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file2));
		await vscode.window.showTextDocument(document);
		const messages = () => vscode.languages.getDiagnostics(document.uri).map((d) => d.message);
		for (let i = 0; i < 40 && messages().length < 2; i++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		assert.deepEqual(messages(), [
			'DCP: modifiedWhitespaceBehaviour must have one of the attributes \'literalValue\', \'parameterRef\' or \'xpath\'',
			'DCP: changeGatheringEnabled must have only one of the attributes \'literalValue\', \'parameterRef\' and \'xpath\' - it has \'literalValue\' and \'parameterRef\'']);
		const missing = vscode.languages.getDiagnostics(document.uri)[0];
		const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', document.uri, missing.range, vscode.CodeActionKind.QuickFix.value);
		const fix = actions.find((a) => a.title === 'Add a \'literalValue\' attribute');
		assert.isDefined(fix, actions.map((a) => a.title).join(', '));
		await vscode.workspace.applyEdit(fix!.edit!);
		assert.include(document.getText(), '<modifiedWhitespaceBehaviour literalValue=""/>');
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	});

	test('parameters: Go to Definition, Find All References, Rename and hover - from parameterRef, if, unless and $name in XPath', async () => {
		const file4 = path.join(folder, 'parameters.dcp');
		const text = `<documentComparator version="1.0" id="parameters">
  <pipelineParameters>
    <booleanParameter name="ws" defaultValue="true">
      <description>Whitespace changes</description>
    </booleanParameter>
    <stringParameter name="other" defaultValue="x"/>
  </pipelineParameters>
  <extensionPoints>
    <inputPreFlatteningPoint>
      <filter if="ws" when="$ws and $other = 'x'">
        <resource name="xsl/clean-house.xsl"/>
      </filter>
      <filter unless="ws">
        <resource name="xsl/clean-house.xsl"/>
      </filter>
    </inputPreFlatteningPoint>
  </extensionPoints>
  <standardConfig>
    <resultReadabilityOptions>
      <changeGatheringEnabled parameterRef="ws"/>
    </resultReadabilityOptions>
  </standardConfig>
</documentComparator>`;
		fs.writeFileSync(file4, text);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file4));
		await vscode.window.showTextDocument(document);
		for (let i = 0; i < 20; i++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		assert.deepEqual(vscode.languages.getDiagnostics(document.uri).map((d) => d.message), []);
		const at = (snippet: string, offset: number) => document.positionAt(text.indexOf(snippet) + offset);
		const declaration = text.indexOf('name="ws"') + 6;
		const where = (locations: (vscode.Location | vscode.LocationLink)[] | undefined) =>
			(locations ?? []).map((l) => 'uri' in l ? document.offsetAt(l.range.start) : document.offsetAt(l.targetSelectionRange?.start ?? l.targetRange.start));
		// Go to Definition: from each kind of reference to the declaration's name
		const results: string[] = [];
		for (const [snippet, offset] of [['parameterRef="ws"', 14], ['if="ws"', 5], ['unless="ws"', 9], ['$ws and', 2]] as [string, number][]) {
			const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', document.uri, at(snippet, offset));
			results.push(`${snippet}: ${JSON.stringify(where(definitions))}`);
		}
		assert.isTrue(results.every((r) => r.includes(String(declaration)) || r.includes(String(declaration - 1)) || r.includes(String(declaration + 1))), results.join(' | '));
		// Find All References: from the declaration - and from a reference
		const references = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', document.uri, document.positionAt(declaration + 1));
		const lines = (locations: vscode.Location[]) => [...new Set(locations.map((l) => l.range.start.line + 1))].sort((a, b) => a - b);
		assert.deepEqual(lines(references), [3, 10, 13, 20], JSON.stringify(references.map((r) => [r.range.start.line + 1, r.range.start.character])));
		const fromReference = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', document.uri, at('parameterRef="ws"', 14));
		assert.deepEqual(lines(fromReference), [3, 10, 13, 20]);
		// Rename: the declaration and each reference
		const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', document.uri, at('parameterRef="ws"', 14), 'spaces');
		await vscode.workspace.applyEdit(edit);
		const renamed = document.getText();
		['name="spaces"', 'if="spaces"', 'unless="spaces"', '$spaces and', 'parameterRef="spaces"'].forEach((s) => assert.include(renamed, s));
		assert.notInclude(renamed, '"ws"');
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		// hover: the parameter's declaration
		const reopened = await vscode.workspace.openTextDocument(vscode.Uri.file(file4));
		await vscode.window.showTextDocument(reopened);
		for (const [snippet, offset] of [['$ws and', 2], ['parameterRef="ws"', 14]] as [string, number][]) {
			const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', reopened.uri, at(snippet, offset));
			const hoverText = hovers.flatMap((h) => h.contents.map((c) => typeof c === 'string' ? c : c.value)).join('\n');
			assert.include(hoverText, '<booleanParameter name="ws" defaultValue="true"/>', snippet);
			assert.include(hoverText, 'Whitespace changes', snippet);
		}
		// not on another attribute's value
		const none = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', reopened.uri, at('defaultValue="x"', 15));
		assert.isFalse(none.some((h) => h.contents.some((c) => (typeof c === 'string' ? c : c.value).includes('Parameter name='))));
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	});

	test('literalValue is checked as XPath where it sets the XPath to a referenced image or SVG - not elsewhere', async () => {
		const file3 = path.join(folder, 'xpaths.dcp');
		fs.writeFileSync(file3, `<documentComparator version="1.0" id="xpaths">
  <standardConfig>
    <svgConfiguration>
      <svgInputAMarkupStyle literalValue="//img["/>
      <xPathToReferencedSVG literalValue="//svg["/>
    </svgConfiguration>
    <imageConfiguration>
      <imageXpath literalValue="//img["/>
    </imageConfiguration>
  </standardConfig>
</documentComparator>`);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file3));
		await vscode.window.showTextDocument(document);
		const lines = () => vscode.languages.getDiagnostics(document.uri).map((d) => d.range.start.line).sort();
		for (let i = 0; i < 40 && lines().length < 2; i++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
		// xPathToReferencedSVG's and imageXpath's - not svgInputAMarkupStyle's, a colour
		assert.deepEqual([...new Set(lines())], [4, 7], vscode.languages.getDiagnostics(document.uri).map((d) => `${d.range.start.line}: ${d.message}`).join('\n'));
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	});
});
