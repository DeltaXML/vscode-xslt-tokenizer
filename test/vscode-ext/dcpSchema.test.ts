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
});
