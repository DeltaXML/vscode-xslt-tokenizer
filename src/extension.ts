/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XPath/XSLT Lexer/Syntax Highlighter
 */
import * as vscode from 'vscode';
import { XPathLexer, ExitCondition, LexPosition, Token, BaseToken } from './xpLexer';
import { XMLDocumentFormattingProvider } from './xmlDocumentFormattingProvider';
import { SaxonTaskProvider, QuickRunTaskType } from './saxonTaskProvider';
import { SaxonJsTaskProvider } from './saxonJsTaskProvider';
import { SaxonCTaskProvider } from './saxonCTaskProvider';
import { XSLTConfiguration, XPathConfiguration, XMLConfiguration, XSLTLightConfiguration, DCPConfiguration, SchConfiguration } from './languageConfigurations';
import { SelectionType, XsltSymbolProvider } from './xsltSymbolProvider';
import { XslLexer, LanguageConfiguration, DocumentTypes, GlobalInstructionData, GlobalInstructionType } from './xslLexer';
import { DocumentChangeHandler } from './documentChangeHandler';
import { on } from 'process';
import { XsltDefinitionProvider } from './xsltDefinitionProvider';
import { DocumentLinkProvider } from './documentLinkProvider';
import { FullDocumentLinkProvider } from './fullDocumentLinkProvider';

import { DCPSymbolProvider } from './dcpSymbolProvider';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';
import { window } from 'vscode';
import { XSLTHoverProvider } from './xsltHoverProvider';
import { XSLTSignatureHelpProvider } from './xsltSignatureHelpProvider';
import * as os from 'os';
import { XsltTokenCompletions } from './xsltTokenCompletions';
import { XSLTReferenceProvider } from './xsltReferenceProvider';
import { XSLTCodeActions } from './xsltCodeActions';
import { FileSelection } from './fileSelection';



const tokenModifiers = new Map<string, number>();

const legend = (function () {
	const tokenTypesLegend = XslLexer.getTextmateTypeLegend();

	const tokenModifiersLegend = [
		'declaration', 'documentation', 'member', 'static', 'abstract', 'deprecated',
		'modification', 'async'
	];
	tokenModifiersLegend.forEach((tokenModifier, index) => tokenModifiers.set(tokenModifier, index));

	return new vscode.SemanticTokensLegend(tokenTypesLegend, tokenModifiersLegend);
})();

export function activate(context: vscode.ExtensionContext) {
	const fileSelector = new FileSelection(context);
	DocumentChangeHandler.isWindowsOS = os.platform() === 'win32';

	// restore the deliberately-chosen XML context file on startup, rather than waiting for the user to open/pick
	// one again - only if it still exists. Deliberately not derived from the recently-used file list, since that
	// list also gets entries from any XML file the user happens to view (e.g. inspecting a transform's output)
	(async () => {
		const persistedContextFsPath = fileSelector.getContextFileUri();
		if (persistedContextFsPath) {
			try {
				const uri = vscode.Uri.file(persistedContextFsPath);
				await vscode.workspace.fs.stat(uri);
				DocumentChangeHandler.lastActiveXMLNonXSLUri = uri;
				// registerXMLEditor() below already ran by the time this resolves and may have rendered the
				// status bar with the placeholder text (lastActiveXMLNonXSLUri was still unset then) - refresh
				// it now, using the same visibility rule registerXMLDocument uses for the current active editor
				const activeLangId = vscode.window.activeTextEditor?.document.languageId;
				DocumentChangeHandler.updateStatusBarItem(activeLangId === 'xslt' || activeLangId === 'xpath' || activeLangId === 'dcp');
			} catch {
				// file no longer exists - leave this to be set the usual way, by opening/picking an XML file
			}
		}
	})();
	const xsltDiagnosticsCollection = vscode.languages.createDiagnosticCollection('xslt');
	const xsltSymbolProvider = new XsltSymbolProvider(XSLTConfiguration.configuration, xsltDiagnosticsCollection);

	const dcpDiagnosticsCollection = vscode.languages.createDiagnosticCollection('dcp');
	const dcpSymbolProvider = new DCPSymbolProvider(DCPConfiguration.configuration, dcpDiagnosticsCollection);
	const dcpDefintiionProvider = new XsltDefinitionProvider(DCPConfiguration.configuration);
	const dcpLinkProvider = new FullDocumentLinkProvider(DCPConfiguration.configuration);

	const schDiagnosticsCollection = vscode.languages.createDiagnosticCollection('sch');
	const schSymbolProvider = new XsltSymbolProvider(SchConfiguration.configuration, schDiagnosticsCollection);
	const schDefintiionProvider = new XsltDefinitionProvider(SchConfiguration.configuration);
	const schLinkProvider = new FullDocumentLinkProvider(SchConfiguration.configuration);

	const xmlDefinitionProvider = new XsltDefinitionProvider(XMLConfiguration.configuration);
	const xpathDefinitionProvider = new XsltDefinitionProvider(XPathConfiguration.configuration);


	const xsltDefintiionProvider = new XsltDefinitionProvider(XSLTConfiguration.configuration);
	const xsltLinkProvider = new DocumentLinkProvider(XSLTLightConfiguration.configuration);

	const xmlDiagnosticsCollection = vscode.languages.createDiagnosticCollection('xml');
	const bpmnDiagnosticsCollection = vscode.languages.createDiagnosticCollection('bpmn');

	const xmlSymbolProvider = new XsltSymbolProvider(XMLConfiguration.configuration, xmlDiagnosticsCollection);
	const bpmnSymbolProvider = new XsltSymbolProvider(XMLConfiguration.configuration, bpmnDiagnosticsCollection);

	const docChangeHandler = new DocumentChangeHandler();
	let activeEditor = vscode.window.activeTextEditor;
	if (activeEditor) {
		docChangeHandler.registerXMLEditor(activeEditor);
	}

	async function formatUnchecked() {
		if (vscode.window.activeTextEditor) {
			const formatter = new XMLDocumentFormattingProvider(XMLConfiguration.configuration);
			formatter.indentMixedContent = true;
			const opts = vscode.window.activeTextEditor.options;
			const tabSize = opts.tabSize? opts.tabSize : 2;
			const cTabSize = typeof tabSize === 'number'? tabSize : Number(tabSize); 
			const insertSpaces = opts.insertSpaces !== undefined? opts.insertSpaces : true;
			const cInsertSpaces = typeof insertSpaces === 'boolean'? insertSpaces : Boolean(insertSpaces); 
			const formattingOpts: vscode.FormattingOptions = { tabSize: cTabSize, insertSpaces: cInsertSpaces};
			const tokenSource = new vscode.CancellationTokenSource();
			const edits = formatter.provideDocumentFormattingEdits(vscode.window.activeTextEditor.document, formattingOpts, tokenSource.token);
			const docUri = vscode.window.activeTextEditor.document.uri;
			for (let index = edits.length - 1; index > -1; index--) {
				const e = edits[index];
				const wse = new vscode.WorkspaceEdit();
				wse.replace(docUri, e.range, e.newText);
				let result = false;
				await vscode.workspace.applyEdit(wse).then(success => result = success);
				if (!result) {
					break;
				}
			}			
		}
	}

	async function showGotoXPathInputBox() {
		let symbol: vscode.DocumentSymbol|undefined;
		const xpath = XsltSymbolProvider.getXPathFromSelection();
		const inboxValue = xpath? xpath : '';
		const result = await window.showInputBox({
			value: inboxValue,
			valueSelection: [0, inboxValue.length],
			placeHolder: '/element/element[2]/element[3]',
			validateInput: text => {
				if (!text.startsWith('/')) {
					return 'XPath should start with "/"';
				} else {
					symbol = XsltSymbolProvider.getSymbolFromXPathLocator(text, XsltSymbolProvider.getSymbolsForActiveDocument());
					return symbol? null : 'No matching elements';
				}
				
			}
		});
		if (result) {
			XsltSymbolProvider.selectTextWithSymbol(symbol);
			const foundSymbol = symbol !== undefined;
			const msg = foundSymbol? `Matching element found: ${symbol?.name}` : 'No matching elements';
			window.showInformationMessage(msg);
		}
	}

	let cachedSymbols: vscode.DocumentSymbol[] = [];
	let cachedSymbolsDocUri = vscode.Uri.parse('file:/empty');

	async function getSymbolFromXPath(args: any[], textDocument?: vscode.TextDocument) {
		const { xpath, uri } = args[0];
		const docUri = vscode.Uri.parse(uri);
		const useCachedSymbols = cachedSymbolsDocUri === docUri;
		const docs = vscode.workspace.textDocuments;
		const foundDoc = textDocument? textDocument : docs.find(doc => doc.uri.toString() === uri);
		if (!useCachedSymbols && foundDoc) {
			const sp = new XsltSymbolProvider(XMLConfiguration.configuration, null);
			const newSymbols = await sp.getDocumentSymbols(foundDoc, false);
			if (newSymbols) {
				cachedSymbols = newSymbols;
				cachedSymbolsDocUri = foundDoc.uri;
			}
		}
		const symbol = XsltSymbolProvider.getSymbolFromXPathLocator(xpath, cachedSymbols);
		if (symbol) {
			return symbol;
		}
	}

	async function selectXPathInDocument(args: any[]) {
		const { xpath, uri } = args[0];
		const docUri = vscode.Uri.parse(uri);
		let doc = await vscode.workspace.openTextDocument(docUri);
    const viewColumn = vscode.ViewColumn.Beside;
		const keepFocus = true;
    const editor = await vscode.window.showTextDocument(doc, viewColumn, keepFocus);
		const symbol = await getSymbolFromXPath(args, doc);
		if (symbol) {
			editor.selection = new vscode.Selection(symbol.range.start, symbol.range.end);
			editor.revealRange(symbol.range);
		}
	}

	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
		docChangeHandler.registerXMLEditor(editor);
	}));

	context.subscriptions.push(vscode.tasks.onDidEndTask((event) => {
		const t = event.execution.task;
		if (fileSelector.completedPick === true && (t.definition.type === 'xslt' || t.definition.type === 'xslt-js' || t.definition.type === 'xslt-c')) {
			vscode.window.showInformationMessage(`Completed task: '${t.definition.label}'`);
			fileSelector.pickedValues.clear();
		}
		fileSelector.completedPick = true; // as fileselector may not be used for next task
	}));

	context.subscriptions.push(DocumentChangeHandler.contextStatusBarItem);
	context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider({ language: 'xslt' }, xsltSymbolProvider));
	context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider({ language: 'dcp' }, dcpSymbolProvider));
	context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider({ language: 'sch' }, schSymbolProvider));
	context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider({ language: 'xml' }, xmlSymbolProvider));
	context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider({ language: 'bpmn' }, bpmnSymbolProvider));
	context.subscriptions.push(vscode.languages.registerDefinitionProvider({ language: 'xslt' }, xsltDefintiionProvider));
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'xslt' }, xsltDefintiionProvider));
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'dcp' }, dcpDefintiionProvider));
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'sch' }, schDefintiionProvider));
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'xml' }, xmlDefinitionProvider));
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'xpath' }, xpathDefinitionProvider));
	context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({ language: 'xslt' }, xsltLinkProvider));
	context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({ language: 'dcp' }, dcpLinkProvider));
	context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({ language: 'sch' }, schLinkProvider));
	context.subscriptions.push(vscode.languages.registerHoverProvider({ language: 'xslt' }, new XSLTHoverProvider(xsltDefintiionProvider)));
	context.subscriptions.push(vscode.languages.registerHoverProvider({ language: 'xpath' }, new XSLTHoverProvider(xpathDefinitionProvider)));
	context.subscriptions.push(vscode.languages.registerSignatureHelpProvider({ language: 'xslt' }, new XSLTSignatureHelpProvider(), '(', ','));
	context.subscriptions.push(vscode.languages.registerSignatureHelpProvider({ language: 'xpath' }, new XSLTSignatureHelpProvider(), '(', ','));
	context.subscriptions.push(vscode.languages.registerReferenceProvider({language: 'xslt'}, new XSLTReferenceProvider()));
	context.subscriptions.push(vscode.languages.registerRenameProvider({language: 'xslt'}, new XSLTReferenceProvider()));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.addTaskInputs', () => SaxonJsTaskProvider.addInputsToTasks()));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.pickFile', async (...args) => await fileSelector.pickFile(args[0])));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.pickXsltFile', async () => await fileSelector.pickXsltFile()));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.pickXsltContextFile', async () => await fileSelector.pickXsltContextFile()));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.pickXmlSourceFile', async () => await fileSelector.pickXmlSourceFile()));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.pickXPathContextFile', async () => await fileSelector.pickXPathContextFile()));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.pickStage2XmlSourceFile', async () => await fileSelector.pickStage2XmlSourceFile()));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.pickResultFile', async () => await fileSelector.pickResultFile()));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.pickStage2ResultFile', async () => await fileSelector.pickStage2ResultFile()));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.setVariableNames', (...args) => XPathSemanticTokensProvider.setVariableNames(args[0])));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.formatUnchecked', () => formatUnchecked()));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.gotoXPath', () => showGotoXPathInputBox()));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.selectCurrentElement', () => XsltSymbolProvider.selectXMLElement(SelectionType.Current)));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.selectPrecedingElement', () => XsltSymbolProvider.selectXMLElement(SelectionType.Previous)));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.selectFollowingElement', () => XsltSymbolProvider.selectXMLElement(SelectionType.Next)));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.selectParentElement', () => XsltSymbolProvider.selectXMLElement(SelectionType.Parent)));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.selectFirstChildElement', () => XsltSymbolProvider.selectXMLElement(SelectionType.FirstChild)));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.symbolFromXPath', (...args) => getSymbolFromXPath(args)));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.selectXPathInDocument', (...args) => selectXPathInDocument(args)));
	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.setExtensionXPathVariable', (...args) => XsltTokenCompletions.extXPathVariables.set(args[0], args[1])));
	const quickRunTaskProviders: { [type in QuickRunTaskType]: { getTask(definition: vscode.TaskDefinition): vscode.Task | undefined } } = {
		'xslt': new SaxonTaskProvider(''),
		'xslt-js': new SaxonJsTaskProvider(''),
		'xslt-c': new SaxonCTaskProvider(''),
	};
	const getQuickRunTaskType = (uri?: vscode.Uri) => vscode.workspace.getConfiguration('XSLT.tasks', uri).get<QuickRunTaskType>('quickRunProcessor', 'xslt');

	// the status bar item shows the active processor as text (editor title buttons can only show an icon); the
	// context key picks which processor-specific variant of the editor title play button - and so its tooltip - is shown
	const quickRunProcessorStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
	quickRunProcessorStatusBarItem.command = 'xslt-xpath.quickRunSwitchProcessor';
	context.subscriptions.push(quickRunProcessorStatusBarItem);
	const updateQuickRunProcessorIndicators = () => {
		const document = vscode.window.activeTextEditor?.document;
		const taskType = getQuickRunTaskType(document?.uri);
		vscode.commands.executeCommand('setContext', 'xslt-xpath.quickRunProcessor', taskType);
		if (document?.languageId === 'xslt') {
			const processorName = SaxonTaskProvider.quickRunProcessorNames[taskType] ?? taskType;
			quickRunProcessorStatusBarItem.text = `$(play) ${processorName}`;
			quickRunProcessorStatusBarItem.tooltip = `Quick Run processor: ${processorName} - click to switch`;
			quickRunProcessorStatusBarItem.show();
		} else {
			quickRunProcessorStatusBarItem.hide();
		}
	};
	updateQuickRunProcessorIndicators();
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => updateQuickRunProcessorIndicators()));
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('XSLT.tasks.quickRunProcessor')) {
			updateQuickRunProcessorIndicators();
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.quickRunSwitchProcessor', async () => {
		const uri = vscode.window.activeTextEditor?.document.uri;
		const current = getQuickRunTaskType(uri);
		const items = (Object.keys(SaxonTaskProvider.quickRunProcessorNames) as QuickRunTaskType[]).map((taskType) => ({
			label: SaxonTaskProvider.quickRunProcessorNames[taskType],
			description: taskType === current ? `'${taskType}' task (current)` : `'${taskType}' task`,
			taskType: taskType,
		}));
		const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select the XSLT processor used by Quick Run' });
		if (!picked || picked.taskType === current) {
			return;
		}
		// update the most specific level the setting is already defined at, so the change actually takes effect
		const config = vscode.workspace.getConfiguration('XSLT.tasks', uri);
		const inspected = config.inspect('quickRunProcessor');
		const target = inspected?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
			: inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace
				: vscode.ConfigurationTarget.Global;
		await config.update('quickRunProcessor', picked.taskType, target);
	}));

	const quickRunXslt = async () => {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor || activeEditor.document.languageId !== 'xslt') {
			vscode.window.showErrorMessage('Quick Run XSLT: open an XSLT stylesheet in the active editor first.');
			return;
		}
		const taskType = getQuickRunTaskType(activeEditor.document.uri);
		const processorName = SaxonTaskProvider.quickRunProcessorNames[taskType];
		if (!processorName) {
			vscode.window.showErrorMessage(`Quick Run XSLT: unrecognised "XSLT.tasks.quickRunProcessor" setting value '${taskType}' - use 'xslt', 'xslt-js' or 'xslt-c'.`);
			return;
		}
		const enabledSetting = { 'xslt': 'java', 'xslt-js': 'js', 'xslt-c': 'saxonc' }[taskType];
		if (!vscode.workspace.getConfiguration(`XSLT.tasks.${enabledSetting}`).get('enabled')) {
			vscode.window.showErrorMessage(`Quick Run XSLT: ${processorName} tasks are disabled - enable the "XSLT.tasks.${enabledSetting}.enabled" setting to use this.`);
			return;
		}
		const saxonJar: string | undefined = vscode.workspace.getConfiguration('XSLT.tasks').get('saxonJar');
		if (taskType === 'xslt' && !saxonJar) {
			vscode.window.showErrorMessage('Quick Run XSLT: set the "XSLT.tasks.saxonJar" setting to your Saxon jar path first.');
			return;
		}
		if (taskType === 'xslt-c' && !vscode.workspace.getConfiguration('XSLT.tasks').get('saxonCPath')) {
			vscode.window.showErrorMessage('Quick Run XSLT: set the "XSLT.tasks.saxonCPath" setting to the folder containing the SaxonC Transform executable first.');
			return;
		}
		const contextUri = DocumentChangeHandler.lastActiveXMLNonXSLUri;
		if (!contextUri) {
			vscode.window.showErrorMessage('Quick Run XSLT: no XML context file is set - open an XML source file (or run "Pick XPath Context File") first.');
			return;
		}
		// first use for this xslt+context pair persists a real task in .vscode/tasks.json (result path uses the
		// file-picker command, so it also lands in the recent-files list), letting the user add xslt parameters etc.
		// by hand afterwards; subsequent runs re-execute that same (possibly since-edited) persisted task
		try {
			const label = await SaxonTaskProvider.findOrCreateQuickRunTaskLabel(taskType, activeEditor.document, contextUri.fsPath, xsltDefintiionProvider);
			if (label) {
				const persistedTasks = await vscode.tasks.fetchTasks({ type: taskType });
				const persistedTask = persistedTasks.find((t) => t.name === label);
				if (persistedTask) {
					await vscode.tasks.executeTask(persistedTask);
					return;
				}
				console.warn(`Quick Run XSLT: expected a persisted task named "${label}" but vscode.tasks.fetchTasks returned: [${persistedTasks.map((t) => t.name).join(', ')}] - falling back to an ad hoc run.`);
			}
		} catch (e) {
			// no workspace, or tasks.json couldn't be read/written - fall back to an ad hoc, non-persisted run below
			console.warn('Quick Run XSLT: failed to find/create a persisted task, falling back to an ad hoc run.', e);
		}

		const definition = SaxonTaskProvider.createQuickRunTaskDefinition(taskType, `${processorName} Quick Run`, activeEditor.document.uri.fsPath, contextUri.fsPath);
		if (taskType === 'xslt') {
			definition.saxonJar = saxonJar;
		}
		const task = quickRunTaskProviders[taskType].getTask(definition);
		if (task) {
			await vscode.tasks.executeTask(task);
		}
	};
	// the processor-specific variants exist only so the editor title play button's tooltip names the processor
	for (const command of ['xslt-xpath.quickRunXslt', 'xslt-xpath.quickRunXsltSaxonJ', 'xslt-xpath.quickRunXsltSaxonJS', 'xslt-xpath.quickRunXsltSaxonC']) {
		context.subscriptions.push(vscode.commands.registerCommand(command, quickRunXslt));
	}
	context.subscriptions.push(vscode.languages.registerCodeActionsProvider('xslt', new XSLTCodeActions(), { providedCodeActionKinds: XSLTCodeActions.providedCodeActionKinds }));
	context.subscriptions.push(
		vscode.commands.registerCommand(XSLTCodeActions.COMMAND, () => vscode.env.openExternal(vscode.Uri.parse('https://unicode.org/emoji/charts-12.0/full-emoji-list.html')))
	);

	// syntax highlighters
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'xslt' }, new XsltSemanticTokensProvider(XSLTConfiguration.configuration), legend));
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'dcp' }, new XsltSemanticTokensProvider(DCPConfiguration.configuration), legend));
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'sch' }, new XsltSemanticTokensProvider(SchConfiguration.configuration), legend));
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'bpmn' }, new XsltSemanticTokensProvider(XMLConfiguration.configuration), legend));

	const xpathDiagnosticsCollection = vscode.languages.createDiagnosticCollection('xpath');
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'xpath' }, new XPathSemanticTokensProvider(xpathDiagnosticsCollection), legend));
	// formatter
	let xsltFormatter = new XMLDocumentFormattingProvider(XSLTConfiguration.configuration);
	let xpathFormatter = new XMLDocumentFormattingProvider(XPathConfiguration.configuration);
	let xmlFormatter = new XMLDocumentFormattingProvider(XMLConfiguration.configuration);
	let dcpFormatter = new XMLDocumentFormattingProvider(DCPConfiguration.configuration);
	let schFormatter = new XMLDocumentFormattingProvider(SchConfiguration.configuration);

	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('xslt',
		xsltFormatter));
	context.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider('xslt',
		xsltFormatter));
	context.subscriptions.push(vscode.languages.registerOnTypeFormattingEditProvider('xslt',
		xsltFormatter, '\n', '/'));

	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('xpath',
		xpathFormatter));
	context.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider('xpath',
		xpathFormatter));
	context.subscriptions.push(vscode.languages.registerOnTypeFormattingEditProvider('xpath',
		xpathFormatter, '\n', '/'));

	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(['xml', 'bpmn'],
		xmlFormatter));
	context.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider(['xml', 'bpmn'],
		xmlFormatter));
	context.subscriptions.push(vscode.languages.registerOnTypeFormattingEditProvider(['xml', 'bpmn'],
		xmlFormatter, '\n', '/'));

	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('dcp',
		dcpFormatter));
	context.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider('dcp',
		dcpFormatter));
	context.subscriptions.push(vscode.languages.registerOnTypeFormattingEditProvider('dcp',
		dcpFormatter, '\n', '/'));
		
	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('sch',
		schFormatter));
	context.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider('sch',
		schFormatter));
	context.subscriptions.push(vscode.languages.registerOnTypeFormattingEditProvider('sch',
		schFormatter, '\n', '/'));

	let workspaceRoot = vscode.workspace.rootPath;
	if (!workspaceRoot) {
		return;
	}

	let xsltTaskEnabled = vscode.workspace.getConfiguration('XSLT.tasks.java').get('enabled');
	if (xsltTaskEnabled) {
		SaxonTaskProvider.extensionURI = context.extensionUri;
		let xsltTaskProvider = vscode.tasks.registerTaskProvider(SaxonTaskProvider.SaxonBuildScriptType, new SaxonTaskProvider(workspaceRoot));
		context.subscriptions.push(xsltTaskProvider);
	}

	let xsltJsTaskEnabled = vscode.workspace.getConfiguration('XSLT.tasks.js').get('enabled');
	if (xsltJsTaskEnabled) {
		let xsltjsTaskProvider = vscode.tasks.registerTaskProvider(SaxonJsTaskProvider.SaxonBuildScriptType, new SaxonJsTaskProvider(workspaceRoot));
		context.subscriptions.push(xsltjsTaskProvider);
	}

	let xsltCTaskEnabled = vscode.workspace.getConfiguration('XSLT.tasks.saxonc').get('enabled');
	if (xsltCTaskEnabled) {
		let xsltCTaskProvider = vscode.tasks.registerTaskProvider(SaxonCTaskProvider.SaxonBuildScriptType, new SaxonCTaskProvider(workspaceRoot));
		context.subscriptions.push(xsltCTaskProvider);
	}
	//vscode.commands.executeCommand('xslt-xpath.setExtensionXPathVariable', 'new', '/countries/country');

}

export class XPathSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
	private xpLexer = new XPathLexer();
	private collection: vscode.DiagnosticCollection|undefined;
	public constructor(collection?: vscode.DiagnosticCollection) {
		this.collection = collection;
	}

	private static globalInstructionData: GlobalInstructionData[] = [];

	public static getGlobalInstructionData() {
		return XPathSemanticTokensProvider.globalInstructionData;
	}

	public static setVariableNames = (names: string[]) => {
		const data: GlobalInstructionData[] = [];

		names.forEach((name) => {
			const token: BaseToken = {
				line: 1,
				startCharacter: 0,
				length: 1,
				value: name,
				tokenType: 0
			};
			const variableInstruction: GlobalInstructionData = {
				type: GlobalInstructionType.Variable,
				name: name,
				token: token,
				idNumber: 0
			};
			data.push(variableInstruction);
		});
		XPathSemanticTokensProvider.globalInstructionData = data;
	};

	public provideXPathProblems(document: vscode.TextDocument) {
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
		this.xpLexer.documentTokens = [];
		const allTokens = this.xpLexer.analyse(document.getText(), ExitCondition.None, lexPosition);
		return XsltTokenDiagnostics.calculateDiagnostics(XPathConfiguration.configuration, DocumentTypes.XPath, document, allTokens, [], [], []);
	}

	async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
		this.xpLexer.documentTokens = [];
		const allTokens = this.xpLexer.analyse(document.getText(), ExitCondition.None, lexPosition);
		setTimeout(() => this.reportProblems(allTokens, document), 0);
		const builder = new vscode.SemanticTokensBuilder();
		allTokens.forEach((token) => {
			builder.push(token.line, token.startCharacter, token.length, token.tokenType, 0);
		});
		return builder.build();
	}

	private reportProblems(allTokens: Token[], document: vscode.TextDocument) {
		if (this.collection) {
			let diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XPathConfiguration.configuration, DocumentTypes.XPath, document, allTokens, DocumentChangeHandler.lastXMLDocumentGlobalData, XPathSemanticTokensProvider.globalInstructionData, []);
			if (diagnostics.length > 0) {
				this.collection.set(document.uri, diagnostics);
			} else {
				this.collection.clear();
			};
		}
	}
}

export class XsltSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {

	private xslLexer: XslLexer;

	public constructor(languageConfig: LanguageConfiguration) {
		this.xslLexer = new XslLexer(languageConfig);
		this.xslLexer.provideCharLevelState = true;
	}

	async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
		// console.log('provideDocumentSemanticTokens');
		const allTokens = this.xslLexer.analyse(document.getText());
		const builder = new vscode.SemanticTokensBuilder();
		allTokens.forEach((token) => {
			builder.push(token.line, token.startCharacter, token.length, token.tokenType, 0);
		});
		return builder.build();
	}
}
