/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { XmlElement, parseXml, descendants } from './xspecXml';
import { XSpecRunner } from './xspecRunner';
import { CatalogSetting } from './catalogSetting';
import { HrefPaths } from './hrefPaths';
import { SchReferences } from './schReferences';
import { SchExpandText } from './schExpandText';

// a failed assertion or successful report, from the SVRL report
export interface SchematronResult {
	kind: 'assert' | 'report';
	text: string;
	location: string;
	id?: string;
	test?: string;
	role?: string;
	severity?: string;
	diagnostics: string[];
}

// how a schema's rules were used in a validation, from its SVRL report - by the rule's id, or the one validate.xsl gives
// it, e.g. vscode-rule-3: the nodes it fired for, and those it was suppressed for, as an earlier rule of its pattern
// matched them first, and its failed assertions and successful reports - and the patterns and groups that were active
export interface SchematronCoverage {
	xml: string;
	// the phase it was validated with: '#DEFAULT' for the schema's default phase
	phase: string;
	rules: Map<string, { fired: number, suppressed: number, failed: number, reported: number }>;
	activePatterns: Set<string>;
}

// Schematron: Validate: an XML file validated with a Schematron schema, as SchXslt2 - the Schematron processor bundled
// with XSpec - validates it, with the Saxon of the XSLT.tasks.saxonJar setting (see
// xslt-resources/schematron/validate.xsl). Each failed assertion and successful report is a problem in the XML file, at
// the node it's about, with a link to the assertion in the schema.
// The schema: the one an xml-model processing instruction associates with the file, else the one last used for it, else
// one chosen from the workspace's - 'Choose Schema' chooses again. From a schema, the XML file last validated with it.
// Once validated, the file is validated again when it, or the schema, is saved
export class SchematronValidation {
	public static readonly validateCommand = 'xslt-xpath.validateWithSchematron';
	public static readonly exportCommand = 'xslt-xpath.exportStandardSchematron';
	// for testing: where the standard schema is saved
	public static saveDialog = (options: vscode.SaveDialogOptions) => vscode.window.showSaveDialog(options);
	public static readonly chooseCommand = 'xslt-xpath.validateWithSchematronChoose';
	public static readonly showAssertionCommand = 'xslt-xpath.showSchematronAssertion';
	public static readonly choosePhaseCommand = 'xslt-xpath.validateWithSchematronPhase';
	// the phase chosen for an XML file and schema - '#DEFAULT' for the schema's default phase - by their paths
	private static readonly phaseStateKey = 'xslt-xpath.schematronPhase';
	private static readonly stateKey = 'xslt-xpath.schematronForXml';
	private static readonly schematronNamespace = 'http://purl.oclc.org/dsdl/schematron';
	private static collection: vscode.DiagnosticCollection;
	private static channel: vscode.OutputChannel | undefined;
	private static state: vscode.Memento;
	private static extensionPath: string;
	// the files validated in this session, by path: the schema each was validated with
	private static readonly validated = new Map<string, string>();
	// the last validation with each schema, by its path - for the counts above its rules and patterns (see codeLenses)
	private static readonly coverage = new Map<string, SchematronCoverage>();
	private static readonly coverageChanged = new vscode.EventEmitter<void>();
	// for testing: how the schema is chosen, where none is known
	public static chooseSchema = (xmlUri: vscode.Uri) => SchematronValidation.pickSchema(xmlUri);

	public static register(context: vscode.ExtensionContext) {
		SchematronValidation.collection = vscode.languages.createDiagnosticCollection('schematron');
		SchematronValidation.state = context.workspaceState;
		SchematronValidation.extensionPath = context.extensionUri.fsPath;
		context.subscriptions.push(SchematronValidation.collection, SchematronValidation.coverageChanged,
			// above each rule and pattern of a schema: how it was used in the last validation with it
			vscode.languages.registerCodeLensProvider({ language: 'sch' }, {
				onDidChangeCodeLenses: SchematronValidation.coverageChanged.event,
				provideCodeLenses: (document) => SchematronValidation.codeLenses(document)
			}),
			vscode.commands.registerCommand(SchematronValidation.validateCommand, (uri?: vscode.Uri) => SchematronValidation.run(uri, false)),
			// the same, in the editor title's More Actions menu - where the title has no category, so it's 'Validate with Schematron'
			vscode.commands.registerCommand(SchematronValidation.validateCommand + 'Menu', (uri?: vscode.Uri) => SchematronValidation.run(uri, false)),
			vscode.commands.registerCommand(SchematronValidation.chooseCommand, (uri?: vscode.Uri) => SchematronValidation.run(uri, true)),
			vscode.commands.registerCommand(SchematronValidation.choosePhaseCommand, (uri?: vscode.Uri) => SchematronValidation.run(uri, false, true)),
			vscode.commands.registerCommand(SchematronValidation.exportCommand, (uri?: vscode.Uri) => SchematronValidation.exportStandard(uri)),
			// a code action on a problem: the assertion that reported it, in the schema
			vscode.commands.registerCommand(SchematronValidation.showAssertionCommand, (location: vscode.Location) =>
				vscode.window.showTextDocument(location.uri, { selection: location.range })),
			vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, {
				provideCodeActions: (_document, _range, context) => context.diagnostics.filter((d) => d.source?.startsWith('Schematron: ') && d.relatedInformation?.length)
					.map((d) => {
						const location = d.relatedInformation![0].location;
						const action = new vscode.CodeAction(`Show the ${/^the report/.test(d.relatedInformation![0].message) ? 'report' : 'assertion'} in ${path.basename(location.uri.fsPath)}`, vscode.CodeActionKind.QuickFix);
						action.diagnostics = [d];
						action.command = { command: SchematronValidation.showAssertionCommand, title: action.title, arguments: [location] };
						return action;
					})
			}),
			// validated again when the file, or its schema, is saved
			vscode.workspace.onDidSaveTextDocument((document) => {
				if (document.uri.scheme !== 'file') {
					return;
				}
				SchematronValidation.validated.forEach((schema, xml) => {
					if (xml === document.fileName || schema === document.fileName) {
						SchematronValidation.validate(vscode.Uri.file(xml), schema, false);
					}
				});
			}),
			vscode.workspace.onDidCloseTextDocument((document) => {
				if (SchematronValidation.validated.has(document.fileName)) {
					SchematronValidation.validated.delete(document.fileName);
					SchematronValidation.collection.delete(document.uri);
				}
			}));
	}

	// the file to validate, and the schema - from the command's file, or the active editor's
	private static async run(uri: vscode.Uri | undefined, choose: boolean, choosePhase = false) {
		const target = uri ?? vscode.window.activeTextEditor?.document.uri;
		if (!target || target.scheme !== 'file') {
			vscode.window.showInformationMessage('Schematron: open an XML file, or a Schematron schema, first.');
			return;
		}
		const pairs = SchematronValidation.pairs();
		if (/\.sch$/i.test(target.fsPath)) {
			// a schema: the file last validated with it - else one to choose
			const xml = Object.keys(pairs).reverse().find((file) => pairs[file] === target.fsPath && fs.existsSync(file)) ?? await SchematronValidation.pickXml();
			if (xml && (!choosePhase || await SchematronValidation.setPhase(xml, target.fsPath))) {
				await SchematronValidation.validate(vscode.Uri.file(xml), target.fsPath, true);
			}
			return;
		}
		const text = (await vscode.workspace.openTextDocument(target)).getText();
		const schema = choose ? await SchematronValidation.chooseSchema(target) :
			SchematronValidation.xmlModel(text, target.fsPath) ?? (pairs[target.fsPath] && fs.existsSync(pairs[target.fsPath]) ? pairs[target.fsPath] : await SchematronValidation.chooseSchema(target));
		if (!schema) {
			return;
		}
		if (choose && schema !== pairs[target.fsPath]) {
			// another schema: its default phase, until one is chosen
			await SchematronValidation.storePhase(target.fsPath, schema, '#DEFAULT');
		}
		if (!choosePhase || await SchematronValidation.setPhase(target.fsPath, schema)) {
			await SchematronValidation.validate(target, schema, true);
		}
	}

	// the phases of a schema: the id of each, with its title or first paragraph - and its defaultPhase
	public static phasesOf(schemaText: string): { phases: { id: string, description: string }[], defaultPhase?: string } {
		const root = parseXml(schemaText);
		if (!root) {
			return { phases: [] };
		}
		const colon = root.name.indexOf(':');
		const prefix = colon > 0 ? root.name.substring(0, colon + 1) : '';
		const text = (e: XmlElement | undefined) => (e ? [e.text, ...descendants(e).map((d) => d.text)].join(' ') : '').replace(/\s+/g, ' ').trim();
		const phases = root.children.filter((c) => c.name === prefix + 'phase' && c.attributes.get('id')?.trim()).map((phase) => ({
			id: phase.attributes.get('id')!.trim(),
			description: text(phase.children.find((c) => c.name === prefix + 'title') ?? phase.children.find((c) => c.name === prefix + 'p'))
		}));
		return { phases, defaultPhase: root.attributes.get('defaultPhase')?.trim() || undefined };
	}

	// the phase for the file and schema: '#DEFAULT' unless one was chosen
	public static phaseFor(xml: string, schema: string): string {
		return SchematronValidation.state.get<{ [key: string]: string }>(SchematronValidation.phaseStateKey, {})[`${xml}\u0000${schema}`] ?? '#DEFAULT';
	}

	private static async storePhase(xml: string, schema: string, phase: string) {
		const phases = SchematronValidation.state.get<{ [key: string]: string }>(SchematronValidation.phaseStateKey, {});
		await SchematronValidation.state.update(SchematronValidation.phaseStateKey, { ...phases, [`${xml}\u0000${schema}`]: phase });
	}

	// for testing: how the phase is chosen
	public static choosePhase = async (items: { label: string, description?: string, phase: string }[], current: string, schemaName: string) =>
		(await vscode.window.showQuickPick(items.map((item) => ({ ...item, picked: item.phase === current })), { placeHolder: `The phase of ${schemaName} to validate with` }))?.phase;

	// a phase chosen for the file and schema - false if none is chosen, or the schema has no phases
	private static async setPhase(xml: string, schema: string): Promise<boolean> {
		const { phases, defaultPhase } = SchematronValidation.phasesOf(fs.existsSync(schema) ? fs.readFileSync(schema, 'utf8') : '');
		if (phases.length === 0) {
			vscode.window.showInformationMessage(`Schematron: ${path.basename(schema)} has no phases - all its patterns are used.`);
			return false;
		}
		const items = [
			{ label: 'Default phase', description: defaultPhase ? `${defaultPhase} - the schema's defaultPhase` : 'all patterns - the schema has no defaultPhase', phase: '#DEFAULT' },
			{ label: '#ALL', description: 'all patterns', phase: '#ALL' },
			...phases.map((p) => ({ label: p.id, description: p.description, phase: p.id }))
		];
		const phase = await SchematronValidation.choosePhase(items, SchematronValidation.phaseFor(xml, schema), path.basename(schema));
		if (phase === undefined) {
			return false;
		}
		await SchematronValidation.storePhase(xml, schema, phase);
		return true;
	}

	// a phase as shown: the one the schema's defaultPhase names, for '#DEFAULT'
	private static phaseName(phase: string, schemaText: string) {
		return phase === '#DEFAULT' ? SchematronValidation.phasesOf(schemaText).defaultPhase : phase;
	}

	// the XML file for a schema's element and attribute name completion: the one last validated with it - else one open
	// whose xml-model associates it with the schema - else undefined
	public static dataFileFor(schema: string): string | undefined {
		if (!SchematronValidation.state) {
			return undefined;
		}
		const pairs = SchematronValidation.pairs();
		const validated = Object.keys(pairs).reverse().find((xml) => pairs[xml] === schema && fs.existsSync(xml));
		return validated ?? vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.languageId !== 'sch' &&
			d.getText(new vscode.Range(0, 0, 20, 0)).includes('xml-model') && SchematronValidation.xmlModel(d.getText(), d.fileName) === schema)?.fileName;
	}

	// the schema an xml-model processing instruction associates with the file, if it's a Schematron schema
	public static xmlModel(text: string, xmlPath: string): string | undefined {
		for (const pi of text.matchAll(/<\?xml-model\s([\s\S]*?)\?>/g)) {
			const pseudo = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(["'])([^"']*)\\1`).exec(pi[1])?.[2];
			const href = pseudo('href');
			const isSchematron = pseudo('schematypens') === SchematronValidation.schematronNamespace || (!pseudo('schematypens') && !!href && /\.sch$/i.test(href));
			const schema = isSchematron && href ? HrefPaths.toPath(href, xmlPath) : undefined;
			if (schema) {
				return schema;
			}
		}
		return undefined;
	}

	private static pairs(): { [xml: string]: string } {
		return SchematronValidation.state.get<{ [xml: string]: string }>(SchematronValidation.stateKey, {});
	}

	private static async pickSchema(xmlUri: vscode.Uri): Promise<string | undefined> {
		const files = await vscode.workspace.findFiles('**/*.sch', '**/node_modules/**', 500);
		const last = SchematronValidation.pairs()[xmlUri.fsPath];
		const items = files.map((f) => f.fsPath).sort((a, b) => (a === last ? -1 : b === last ? 1 : a.localeCompare(b)))
			.map((file) => ({ label: path.basename(file), description: vscode.workspace.asRelativePath(path.dirname(file)), file }));
		const browse = { label: '$(folder-opened) Browse...', description: '', file: '' };
		const picked = await vscode.window.showQuickPick([...items, browse], { placeHolder: `The Schematron schema to validate ${path.basename(xmlUri.fsPath)} with` });
		if (picked === browse) {
			const chosen = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Schematron': ['sch'] }, defaultUri: vscode.Uri.file(path.dirname(xmlUri.fsPath)) });
			return chosen?.[0]?.fsPath;
		}
		return picked?.file;
	}

	private static async pickXml(): Promise<string | undefined> {
		const chosen = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'XML': ['xml'], 'All files': ['*'] }, openLabel: 'Validate' });
		return chosen?.[0]?.fsPath;
	}

	// the file validated with the schema - its problems, in the Problems view - after saving either if it has changes
	public static async validate(xmlUri: vscode.Uri, schema: string, interactive: boolean): Promise<SchematronResult[] | undefined> {
		const problem = SchematronValidation.problem(xmlUri, schema);
		if (problem) {
			if (interactive) {
				vscode.window.showErrorMessage(problem);
			}
			return undefined;
		}
		for (const document of vscode.workspace.textDocuments.filter((d) => d.isDirty && (d.fileName === xmlUri.fsPath || d.fileName === schema))) {
			await document.save();
		}
		// the file last, as the one most recently validated
		const others = Object.entries(SchematronValidation.pairs()).filter(([xml]) => xml !== xmlUri.fsPath);
		await SchematronValidation.state.update(SchematronValidation.stateKey, { ...Object.fromEntries(others), [xmlUri.fsPath]: schema });
		SchematronValidation.validated.set(xmlUri.fsPath, schema);
		const svrl = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'schematron-')), 'report.svrl');
		const schemaText = fs.readFileSync(schema, 'utf8');
		const chosen = SchematronValidation.phaseFor(xmlUri.fsPath, schema);
		const phase = chosen === '#DEFAULT' || chosen === '#ALL' || SchematronValidation.phasesOf(schemaText).phases.some((p) => p.id === chosen) ? chosen : '#DEFAULT';
		const extensions = XSpecRunner.schematronSyntaxExtensions(xmlUri, schema, schemaText);
		const catalog = CatalogSetting.taskOption({});
		const transpiler = path.join(XSpecRunner.home(xmlUri) ?? path.join(SchematronValidation.extensionPath, 'xslt-resources', 'xspec'), 'lib', 'schxslt2', 'transpile.xsl');
		const args = ['-cp', XSpecRunner.saxonJar(xmlUri)!, 'net.sf.saxon.Transform', ...(catalog ? [catalog] : []), ...(extensions ? ['--allowSyntaxExtensions:on'] : []),
			'-s:' + xmlUri.fsPath, '-xsl:' + path.join(SchematronValidation.extensionPath, 'xslt-resources', 'schematron', 'validate.xsl'), '-o:' + svrl,
			// as XPath string literals, not text - with which Saxon 13 fails (see validate.xsl)
			'?schema=' + XSpecRunner.xpathString(vscode.Uri.file(schema).toString()), '?transpiler=' + XSpecRunner.xpathString(vscode.Uri.file(transpiler).toString()),
			// a phase that was chosen: not the schema's default phase - if it still has the phase
			...(phase !== '#DEFAULT' ? ['?phase=' + XSpecRunner.xpathString(phase)] : []),
			// text value templates in messages, with xsl:expand-text: the XSLT.schematron.allowExpandText setting
			...(SchExpandText.allowed() ? ['?allow-expand-text=true()'] : [])];
		const channel = SchematronValidation.output();
		channel.appendLine(`Validating ${xmlUri.fsPath} with ${schema}:`);
		channel.appendLine('java ' + args.map((arg) => /[\s"]/.test(arg) ? `"${arg}"` : arg).join(' '));
		const outcome = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Schematron: validating ${path.basename(xmlUri.fsPath)}` },
			() => SchematronValidation.java(args, path.dirname(xmlUri.fsPath)));
		channel.append(outcome.output);
		if (!outcome.ok || !fs.existsSync(svrl)) {
			SchematronValidation.collection.delete(xmlUri);
			SchematronValidation.coverage.delete(schema);
			SchematronValidation.coverageChanged.fire();
			const action = await vscode.window.showErrorMessage(`Schematron: the validation of ${path.basename(xmlUri.fsPath)} with ${path.basename(schema)} failed - see the Schematron output`, 'Show Output');
			if (action) {
				channel.show(true);
			}
			return undefined;
		}
		const svrlText = fs.readFileSync(svrl, 'utf8');
		const results = SchematronValidation.results(svrlText);
		SchematronValidation.coverage.set(schema, { ...SchematronValidation.coverageOf(svrlText), xml: xmlUri.fsPath, phase });
		SchematronValidation.coverageChanged.fire();
		fs.rmSync(path.dirname(svrl), { recursive: true, force: true });
		const xmlText = (await vscode.workspace.openTextDocument(xmlUri)).getText();
		const schemaDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(schema));
		const assertions = SchematronValidation.assertions(schemaDocument);
		SchematronValidation.collection.set(xmlUri, results.map((result) => SchematronValidation.diagnostic(result, xmlText, xmlUri, schema, assertions)));
		const phaseName = SchematronValidation.phaseName(phase, schemaText);
		const withSchema = `${path.basename(schema)}${phaseName ? `, phase ${phaseName}` : ''}`;
		const summary = results.length === 0 ? `Schematron: ${path.basename(xmlUri.fsPath)} is valid with ${withSchema}` :
			`Schematron: ${results.length} problem${results.length === 1 ? '' : 's'} in ${path.basename(xmlUri.fsPath)} with ${withSchema}`;
		channel.appendLine(summary);
		vscode.window.setStatusBarMessage(`$(${results.length === 0 ? 'pass' : 'warning'}) ${summary}`, 6000);
		return results;
	}

	// Schematron: Export Standard Copy...: a copy of the schema - with the files sch:include brings in - with the text value
	// templates of xsl:expand-text, a non-standard extension, as sch:value-of: for any Schematron processor
	public static async exportStandard(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
		const schemaUri = uri ?? (vscode.window.activeTextEditor?.document.languageId === 'sch' ? vscode.window.activeTextEditor.document.uri : undefined);
		if (!schemaUri || schemaUri.scheme !== 'file') {
			vscode.window.showErrorMessage('Schematron: Export Standard Copy: open a Schematron schema first.');
			return undefined;
		}
		const saxonJar = XSpecRunner.saxonJar(schemaUri);
		if (!saxonJar || !fs.existsSync(saxonJar)) {
			vscode.window.showErrorMessage(saxonJar ? `Schematron: Export Standard Copy: the Saxon jar '${saxonJar}' doesn't exist - check the "XSLT.tasks.saxonJar" setting.` :
				'Schematron: Export Standard Copy: set the "XSLT.tasks.saxonJar" setting to your Saxon jar path first.');
			return undefined;
		}
		for (const document of vscode.workspace.textDocuments.filter((d) => d.isDirty && d.uri.fsPath === schemaUri.fsPath)) {
			await document.save();
		}
		const target = await SchematronValidation.saveDialog({
			title: 'Schematron: Export Standard Copy', saveLabel: 'Export', filters: { Schematron: ['sch'] },
			defaultUri: vscode.Uri.file(schemaUri.fsPath.replace(/(\.sch)?$/, '-standard.sch'))
		});
		if (!target) {
			return undefined;
		}
		if (target.fsPath === schemaUri.fsPath) {
			vscode.window.showErrorMessage('Schematron: Export Standard Copy: choose another file than the schema itself.');
			return undefined;
		}
		const catalog = CatalogSetting.taskOption({});
		const args = ['-cp', saxonJar, 'net.sf.saxon.Transform', ...(catalog ? [catalog] : []), '-s:' + schemaUri.fsPath,
			'-xsl:' + path.join(SchematronValidation.extensionPath, 'xslt-resources', 'schematron', 'expand-text.xsl'), '-o:' + target.fsPath];
		const channel = SchematronValidation.output();
		channel.appendLine(`Exporting ${schemaUri.fsPath} as standard Schematron, to ${target.fsPath}:`);
		channel.appendLine('java ' + args.map((arg) => /[\s"]/.test(arg) ? `"${arg}"` : arg).join(' '));
		const outcome = await SchematronValidation.java(args, path.dirname(schemaUri.fsPath));
		channel.append(outcome.output);
		if (!outcome.ok || !fs.existsSync(target.fsPath)) {
			const action = await vscode.window.showErrorMessage(`Schematron: Export Standard Copy: ${path.basename(schemaUri.fsPath)} couldn't be exported - see the Schematron output`, 'Show Output');
			if (action) {
				channel.show(true);
			}
			return undefined;
		}
		await vscode.window.showTextDocument(target, { preview: false });
		return target;
	}

	// why it can't be validated, if it can't
	private static problem(xmlUri: vscode.Uri, schema: string) {
		const saxonJar = XSpecRunner.saxonJar(xmlUri);
		if (!saxonJar) {
			return 'Schematron: set the "XSLT.tasks.saxonJar" setting to your Saxon jar path first.';
		} else if (!fs.existsSync(saxonJar)) {
			return `Schematron: the Saxon jar '${saxonJar}' doesn't exist - check the "XSLT.tasks.saxonJar" setting.`;
		} else if (!fs.existsSync(schema)) {
			return `Schematron: the schema '${schema}' doesn't exist.`;
		}
		return undefined;
	}

	private static java(args: string[], cwd: string): Promise<{ ok: boolean, output: string }> {
		return new Promise((resolve) => {
			let output = '';
			const child = spawn('java', args, { cwd });
			child.stdout.on('data', (data: Buffer) => output += data.toString());
			child.stderr.on('data', (data: Buffer) => output += data.toString());
			child.on('error', (error) => resolve({ ok: false, output: output + `Java couldn't be run: ${error.message}\n` }));
			child.on('close', (code) => resolve({ ok: code === 0, output }));
		});
	}

	private static output() {
		SchematronValidation.channel = SchematronValidation.channel ?? vscode.window.createOutputChannel('Schematron');
		return SchematronValidation.channel;
	}

	// the failed assertions and successful reports of an SVRL report
	public static results(svrl: string): SchematronResult[] {
		const root = parseXml(svrl);
		if (!root) {
			return [];
		}
		const local = (e: XmlElement) => e.name.replace(/^.*:/, '');
		const text = (e: XmlElement | undefined) => (e ? [e.text, ...descendants(e).map((d) => d.text)].join(' ') : '').replace(/\s+/g, ' ').trim();
		return descendants(root).filter((e) => local(e) === 'failed-assert' || local(e) === 'successful-report').map((e) => ({
			kind: local(e) === 'failed-assert' ? 'assert' : 'report',
			text: text(e.children.find((c) => local(c) === 'text')),
			location: e.attributes.get('location') ?? '',
			id: e.attributes.get('id'),
			test: e.attributes.get('test'),
			role: e.attributes.get('role'),
			severity: e.attributes.get('severity'),
			diagnostics: e.children.filter((c) => local(c) === 'diagnostic-reference').map((c) => text(c))
		}));
	}

	// the rules fired and suppressed, their failed assertions and successful reports, and the active patterns, of an SVRL report
	public static coverageOf(svrl: string): Omit<SchematronCoverage, 'xml' | 'phase'> {
		const rules = new Map<string, { fired: number, suppressed: number, failed: number, reported: number }>();
		const activePatterns = new Set<string>();
		const root = parseXml(svrl);
		const count = (id: string | undefined, key: 'fired' | 'suppressed' | 'failed' | 'reported') => {
			if (id) {
				const counts = rules.get(id) ?? { fired: 0, suppressed: 0, failed: 0, reported: 0 };
				counts[key]++;
				rules.set(id, counts);
			}
		};
		for (const element of root ? descendants(root) : []) {
			switch (element.name.replace(/^.*:/, '')) {
				case 'active-pattern':
				case 'active-group':
					activePatterns.add(element.attributes.get('id') ?? '');
					break;
				case 'fired-rule':
					count(element.attributes.get('id'), 'fired');
					break;
				case 'suppressed-rule':
					count(element.attributes.get('id'), 'suppressed');
					break;
				case 'failed-assert':
					count(element.attributes.get('ruleId'), 'failed');
					break;
				case 'successful-report':
					count(element.attributes.get('ruleId'), 'reported');
					break;
			}
		}
		return { rules, activePatterns };
	}

	// above each rule of the schema last validated with: the nodes it fired for, or was suppressed for, and its failures -
	// or that it never fired - and above each pattern or group, how many of its rules fired, or that it wasn't active. Not
	// while the schema has unsaved changes, as its rules may have moved - it's validated again when it's saved
	public static codeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		const coverage = SchematronValidation.coverage.get(document.fileName);
		const root = coverage && !document.isDirty ? parseXml(document.getText()) : undefined;
		if (!coverage || !root) {
			return [];
		}
		const colon = root.name.indexOf(':');
		const prefix = colon > 0 ? root.name.substring(0, colon + 1) : '';
		const all = [root, ...descendants(root)];
		// as validate.xsl gives them ids: by their name and number in the schema
		const idOf = (element: XmlElement, kind: string) => element.attributes.get('id') ?? `vscode-${kind}-${all.filter((e) => e.name === prefix + kind).indexOf(element) + 1}`;
		const isAbstract = (element: XmlElement) => element.attributes.get('abstract')?.trim() === 'true';
		const xmlName = path.basename(coverage.xml);
		const open: vscode.Command = { title: '', command: 'vscode.open', arguments: [vscode.Uri.file(coverage.xml)] };
		const lens = (element: XmlElement, title: string, tooltip: string) => {
			const start = document.positionAt(element.start);
			return new vscode.CodeLens(new vscode.Range(start, start), { ...open, title, tooltip });
		};
		const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
		const lenses: vscode.CodeLens[] = [];
		for (const pattern of all.filter((e) => (e.name === prefix + 'pattern' || e.name === prefix + 'group') && !isAbstract(e))) {
			const kind = pattern.name.substring(prefix.length);
			const rules = pattern.children.filter((c) => c.name === prefix + 'rule' && !isAbstract(c));
			if (!coverage.activePatterns.has(idOf(pattern, kind)) && !pattern.attributes.has('is-a')) {
				const phaseName = SchematronValidation.phaseName(coverage.phase, document.getText());
				lenses.push(lens(pattern, `not active when ${xmlName} was validated${phaseName ? ` - phase ${phaseName}` : ''}`, `The ${kind} wasn't in the phase used to validate ${coverage.xml}`));
			} else if (rules.length > 0) {
				const fired = rules.filter((r) => (coverage.rules.get(idOf(r, 'rule'))?.fired ?? 0) > 0).length;
				lenses.push(lens(pattern, `${fired} of ${plural(rules.length, 'rule')} fired with ${xmlName}`, `When ${coverage.xml} was validated`));
			}
		}
		for (const rule of all.filter((e) => e.name === prefix + 'rule' && !isAbstract(e))) {
			const counts = coverage.rules.get(idOf(rule, 'rule'));
			const parent = rule.parent;
			const inactive = parent && !isAbstract(parent) && !parent.attributes.has('is-a') && (parent.name === prefix + 'pattern' || parent.name === prefix + 'group') &&
				!coverage.activePatterns.has(idOf(parent, parent.name.substring(prefix.length)));
			if (inactive) {
				continue;
			}
			const results = counts ? [counts.failed > 0 ? plural(counts.failed, 'failed assertion') : '', counts.reported > 0 ? plural(counts.reported, 'report') : ''].filter((r) => r) : [];
			let title: string;
			if (!counts || (counts.fired === 0 && counts.suppressed === 0)) {
				title = `never fired with ${xmlName}`;
			} else if (counts.fired === 0) {
				title = `never fired with ${xmlName} - suppressed for ${plural(counts.suppressed, 'node')} that an earlier rule matched first`;
			} else {
				title = `fired for ${plural(counts.fired, 'node')}${results.length > 0 ? ` - ${results.join(', ')}` : ''}${counts.suppressed > 0 ? ` - suppressed for ${counts.suppressed} that an earlier rule matched first` : ''}`;
			}
			lenses.push(lens(rule, title, `When ${coverage.xml} was validated - in a pattern, a node is handled only by the first rule whose context matches it`));
		}
		return lenses;
	}

	private static diagnostic(result: SchematronResult, xmlText: string, xmlUri: vscode.Uri, schema: string, assertions: { element: XmlElement, location: vscode.Location }[]) {
		const lines = xmlText.split('\n');
		const position = (offset: number) => {
			const before = xmlText.substring(0, offset).split('\n');
			return new vscode.Position(before.length - 1, before[before.length - 1].length);
		};
		const span = SchematronValidation.locate(xmlText, result.location);
		const range = span ? new vscode.Range(position(span.start), position(span.end)) : new vscode.Range(0, 0, 0, lines[0]?.length ?? 0);
		const message = [result.text || `${result.kind === 'assert' ? 'Assertion failed' : 'Report'}: ${result.test ?? ''}`, ...result.diagnostics].join('\n');
		const diagnostic = new vscode.Diagnostic(range, message, SchematronValidation.severity(result));
		diagnostic.source = `Schematron: ${path.basename(schema)}`;
		if (result.id) {
			diagnostic.code = result.id;
		}
		// the assertion in the schema: by its id, else its test
		const normalized = (value: string | undefined) => value?.replace(/\s+/g, ' ').trim();
		const assertion = assertions.find((a) => result.id !== undefined && a.element.attributes.get('id')?.trim() === result.id) ??
			assertions.find((a) => normalized(a.element.attributes.get('test')) === normalized(result.test));
		if (assertion) {
			diagnostic.relatedInformation = [new vscode.DiagnosticRelatedInformation(assertion.location,
				`the ${result.kind === 'assert' ? 'assertion that failed' : 'report'}${result.test ? `: ${normalized(result.test)}` : ''}`)];
			// the code - its id, or else assert or report - is a link to it, in the problem's hover and the Problems view:
			// VS Code opens a file URI at the line and column of its fragment, e.g. #L12,5
			const start = assertion.location.range.start;
			diagnostic.code = { value: result.id ?? result.kind, target: assertion.location.uri.with({ fragment: `L${start.line + 1},${start.character + 1}` }) };
		}
		return diagnostic;
	}

	// from the assertion's severity - or its role - e.g. warning or info: an error by default
	private static severity(result: SchematronResult): vscode.DiagnosticSeverity {
		const value = (result.severity ?? result.role ?? '').trim().toLowerCase();
		return value === 'warning' || value === 'warn' ? vscode.DiagnosticSeverity.Warning :
			value === 'info' || value === 'information' || value === 'informational' ? vscode.DiagnosticSeverity.Information : vscode.DiagnosticSeverity.Error;
	}

	// the assertions and reports of the schema - and the files it includes - with their locations
	private static assertions(schemaDocument: vscode.TextDocument): { element: XmlElement, location: vscode.Location }[] {
		const schema = SchReferences.schema(schemaDocument);
		return (schema?.files ?? []).flatMap((file) => {
			const root = parseXml(file.text);
			return root ? [root, ...descendants(root)].filter((e) => e.name === file.prefix + 'assert' || e.name === file.prefix + 'report').map((element) => {
				const before = file.text.substring(0, element.start).split('\n');
				const start = new vscode.Position(before.length - 1, before[before.length - 1].length);
				return { element, location: new vscode.Location(vscode.Uri.file(file.file), new vscode.Range(start, start.translate(0, element.name.length + 1))) };
			}) : [];
		});
	}

	// the offsets of the node an SVRL location is for - its path, as fn:path() gives it, e.g. /Q{}doc[1]/Q{urn:a}item[2]/@n:
	// an element's name in its start tag, or an attribute - for a text node, comment or processing instruction, its parent
	public static locate(text: string, location: string): { start: number, end: number } | undefined {
		const root = parseXml(text);
		if (!root || !location.startsWith('/')) {
			return undefined;
		}
		const steps = [...location.matchAll(/\/(@?(?:Q\{[^}]*\})?[^/\[{]+(?:\[\d+\])?|(?:text|comment|processing-instruction)\([^)]*\)(?:\[\d+\])?)/g)].map((m) => m[1]);
		const nameRange = (element: XmlElement) => ({ start: element.start + 1, end: element.start + 1 + element.name.length });
		const bindings = (element: XmlElement, inherited: Map<string, string>) => {
			const scope = new Map(inherited);
			element.attributes.forEach((value, name) => {
				if (name === 'xmlns') {
					scope.set('', value);
				} else if (name.startsWith('xmlns:')) {
					scope.set(name.substring(6), value);
				}
			});
			return scope;
		};
		const expanded = (name: string, scope: Map<string, string>, isAttribute: boolean) => {
			const colon = name.indexOf(':');
			const uri = colon > 0 ? scope.get(name.substring(0, colon)) ?? '' : isAttribute ? '' : scope.get('') ?? '';
			return `Q{${uri}}${name.substring(colon + 1)}`;
		};
		// the document node's child: the outermost element
		let current: XmlElement | undefined;
		let scope = new Map<string, string>();
		for (const step of steps) {
			const match = /^(@)?(Q\{[^}]*\})?([^\[]+)(?:\[(\d+)\])?$/.exec(step);
			if (!match || /\(/.test(step)) {
				// a text node, comment or processing instruction: its parent
				break;
			}
			const [, attribute, namespace, localName, index] = match;
			const name = (namespace ?? 'Q{}') + localName;
			if (attribute) {
				const element = current;
				if (!element) {
					return undefined;
				}
				const writtenName = [...element.attributes.keys()].find((written) => !written.startsWith('xmlns') && expanded(written, scope, true) === name);
				const startTag = text.substring(element.start, element.contentStart);
				const found = writtenName ? new RegExp(`\\s(${writtenName.replace(/[.-]/g, '\\$&')}\\s*=\\s*(["'])[\\s\\S]*?\\2)`).exec(startTag) : undefined;
				return found ? { start: element.start + found.index + 1, end: element.start + found.index + 1 + found[1].length } : nameRange(element);
			}
			const candidates = current ? current.children : [root];
			const parentScope = scope;
			const matching = candidates.filter((child) => expanded(child.name, bindings(child, parentScope), false) === name);
			const next = matching[(index ? Number(index) : 1) - 1];
			if (!next) {
				break;
			}
			current = next;
			scope = bindings(next, parentScope);
		}
		return current ? nameRange(current) : nameRange(root);
	}
}
