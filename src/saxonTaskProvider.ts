/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - saxonTaskProvider
 */
import * as vscode from 'vscode';
import * as  os from 'os';
import { SaxonJsTaskProvider } from './saxonJsTaskProvider';
import * as path from 'path';
import * as jsc from 'jsonc-parser';
import { GlobalInstructionType, GlobalInstructionData } from './xslLexer';
import { XsltDefinitionProvider } from './xsltDefinitionProvider';
import { LexPosition } from './xpLexer';
import { CatalogSetting } from './catalogSetting';
import { unquotedPath } from './settingPaths';
import { RecordTypes } from './recordTypes';
import { XsltPackages } from './xsltPackages';

function pathSeparator() {
    if (os.platform() === 'win32') {
        return ';';
    } else {
        return ':';
    }
}

export interface XSLTTask extends vscode.TaskDefinition {
    label: string;
    saxonJar: string;
    xsltFile: string;
    xmlSource: string;
    useJsonSource?: boolean;
    resultPath?: string;
    execute?: boolean;
    allowSyntaxExtensions40?: string;
    parameters?: XSLTParameter[];
    features?: XSLTParameter[];
    initialTemplate?: string;
    initialMode?: string;
    catalogFilenames?: string;
    classPathEntries?: string[];
    useWorkspace?: boolean;
    messageEscaping?: string;
    group?: TaskGroup;
}

export type QuickRunTaskType = 'xslt' | 'xslt-js' | 'xslt-c';

interface TaskGroup {
    kind: string;
}

interface XSLTParameter {
    name: string;
    value: string;
}

// a tasks.json input that asks for a stylesheet parameter's value when the task runs
export interface ParameterInput {
    id: string;
    type: 'command';
    command: string;
    args: { name: string; type: string; xpath: boolean };
}

export class SaxonTaskProvider implements vscode.TaskProvider {
    // the command that opens a file in VS Code's integrated browser - the 'Open in Integrated Browser' menu item for an
    // HTML file. It isn't documented, so it's only used if VS Code has it
    public static readonly integratedBrowserOpenFile = 'workbench.action.browser.openFile';
    public static readonly openResultAction = 'Open';
    public static readonly openResultInBrowserAction = 'Open in Browser';

    // the actions for the notification when a task writes a result file: 'Open', and for an HTML result, 'Open in
    // Browser' - if the integrated browser's command is one of the available commands
    public static resultActions(resultFsPath: string, availableCommands: string[]): string[] {
        const isHtml = /\.(html?|xhtml)$/i.test(resultFsPath);
        return isHtml && availableCommands.includes(SaxonTaskProvider.integratedBrowserOpenFile) ?
            [SaxonTaskProvider.openResultAction, SaxonTaskProvider.openResultInBrowserAction] : [SaxonTaskProvider.openResultAction];
    }

    static SaxonBuildScriptType: string = 'xslt';
    templateTaskLabel = 'Saxon Transform (New)';
    templateTaskFound = false;
    public static extensionURI: vscode.Uri | undefined;
    private static saxonVersionRgx = new RegExp(/saxon.e(\d+)-(\d+)(?:-(\d+))?(?:-(\d+))?/i);

    constructor(private workspaceRoot: string) { }

    public async provideTasks(): Promise<vscode.Task[]> {
        const tasksObject = await SaxonJsTaskProvider.getTasksObject();
        return this.getTasks(tasksObject.tasks);
    }

    public resolveTask(_task: vscode.Task): vscode.Task | undefined {
        return this.getTask(_task.definition);
    }

    // 'auto' (the default): XPath 4.0 syntax is enabled unless the processor is Saxon-HE - with Saxon-HE 13, enabling it
    // makes every transform fail with a licence error, whereas with Saxon-PE/EE it's harmless for pre-4.0 stylesheets
    public static syntaxExtensions40Value(setting: string | undefined, saxonPath: string | undefined): string {
        if (setting === 'on' || setting === 'off') {
            return setting;
        }
        return SaxonTaskProvider.isSaxonHE(saxonPath) ? 'off' : 'on';
    }

    // e.g. .../SaxonHE13-0J/saxon-he-13.0.jar, saxon9he.jar or .../SaxonCHE-macos-arm64-13-0-0/bin
    public static isSaxonHE(saxonPath: string | undefined) {
        return !!saxonPath && /saxonc?[-\d]*he(?=[-\d._]|j|$)/i.test(saxonPath);
    }

    public static async getXdmViewPath(document: vscode.TextDocument) {
        let xdmViewFiles = await vscode.workspace.findFiles('**/xdm-view.xsl');
        const xdmView = xdmViewFiles.length > 0 ? xdmViewFiles[0] : vscode.Uri.joinPath(SaxonTaskProvider.extensionURI!, 'xslt-resources', 'xdm-view/xdm-view.xsl');
        const docBaseURI = path.dirname(document.uri.fsPath);
        return path.relative(docBaseURI, xdmView.fsPath);
    }

    // the label of the first workspace folder's quick-run task of this type for the stylesheet and source, if there is
    // one - e.g. a task that runs a stylesheet on itself, as its own source document
    public static async quickRunTaskLabel(taskType: QuickRunTaskType, xsltFsPath: string, xmlSourceFsPath: string | undefined): Promise<string | undefined> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return undefined;
        }
        // as saved, as the task runs - not an open document's text, which VS Code keeps after the file's deleted
        let text: string;
        try {
            text = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'tasks.json'))).toString('utf8');
        } catch {
            return undefined;
        }
        const tasks: vscode.TaskDefinition[] = jsc.parse(text)?.tasks || [];
        return tasks.find((t) => SaxonTaskProvider.isQuickRunTaskFor(t, taskType, xsltFsPath, xmlSourceFsPath, workspaceFolder.uri.fsPath))?.label;
    }

    // the source of the first workspace folder's quick-run task for the stylesheet: its fsPath, null for a task with no
    // source, or undefined with no task - see quickRunTaskSourceIn
    public static async quickRunTaskSource(taskType: QuickRunTaskType, xsltFsPath: string): Promise<string | null | undefined> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return undefined;
        }
        let text: string;
        try {
            text = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'tasks.json'))).toString('utf8');
        } catch {
            return undefined;
        }
        return SaxonTaskProvider.quickRunTaskSourceIn(jsc.parse(text)?.tasks || [], taskType, xsltFsPath, workspaceFolder.uri.fsPath);
    }

    // of the quick-run tasks for the stylesheet - of the selected type if there are any, else of any type - the last
    // one's source (the most recently added, unless edited since): its fsPath, or null for a task with no source,
    // starting from xsl:initial-template. Tasks whose source is a variable, e.g. '${file}', are left out
    public static quickRunTaskSourceIn(tasks: vscode.TaskDefinition[], taskType: QuickRunTaskType, xsltFsPath: string, workspaceFolderFsPath: string): string | null | undefined {
        const quickRunTypes = Object.keys(SaxonTaskProvider.quickRunProcessorNames);
        const forStylesheet = tasks.filter((t) => quickRunTypes.includes(t.type) && typeof t.xsltFile === 'string' &&
            SaxonTaskProvider.resolveStoredPath(t.xsltFile, workspaceFolderFsPath) === path.normalize(xsltFsPath) &&
            !(typeof t.xmlSource === 'string' && t.xmlSource.includes('${') && !t.xmlSource.startsWith('${workspaceFolder}')));
        const ofType = forStylesheet.filter((t) => t.type === taskType);
        const task = (ofType.length > 0 ? ofType : forStylesheet).pop();
        if (!task) {
            return undefined;
        }
        return typeof task.xmlSource === 'string' && task.xmlSource !== '' ? SaxonTaskProvider.resolveStoredPath(task.xmlSource, workspaceFolderFsPath) : null;
    }

    // finds (or persists, on first use) a task of the given quick-run type ('xslt', 'xslt-js' or 'xslt-c') in
    // .vscode/tasks.json for this xsltFile/xmlSource pair, so the user can subsequently add xslt parameters etc. by
    // hand - an undefined xmlSourceFsPath means no source document, starting from xsl:initial-template instead.
    // Returns the task's label and whether it was just created, or undefined if there is no workspace folder to
    // persist into (caller should fall back to an ad hoc, non-persisted task). If several tasks are for the pair (e.g.
    // copies with different parameters), the user picks one - 'cancelled' if they didn't
    public static async findOrCreateQuickRunTask(taskType: QuickRunTaskType, xsltDocument: vscode.TextDocument, xmlSourceFsPath: string | undefined, definitionProvider: XsltDefinitionProvider): Promise<{ label: string; created: boolean } | 'cancelled' | undefined> {
        const xsltFsPath = xsltDocument.uri.fsPath;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return undefined;
        }
        const workspaceTaskUri = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'tasks.json');

        const toStoredPath = (fsPath: string) => {
            const rel = path.relative(workspaceFolder.uri.fsPath, fsPath);
            return (!rel.startsWith('..') && !path.isAbsolute(rel))
                ? '${workspaceFolder}/' + rel.split(path.sep).join('/')
                : fsPath;
        };

        let text: string;
        try {
            const doc = await vscode.workspace.openTextDocument(workspaceTaskUri);
            text = doc.getText();
        } catch {
            text = JSON.stringify({ version: '2.0.0', tasks: [] }, null, '\t');
        }

        const parsed = jsc.parse(text) || {};
        const existingTasks: vscode.TaskDefinition[] = parsed.tasks || [];
        const matches = existingTasks.filter((t) => SaxonTaskProvider.isQuickRunTaskFor(t, taskType, xsltFsPath, xmlSourceFsPath, workspaceFolder.uri.fsPath));
        if (matches.length === 1) {
            return { label: matches[0].label, created: false };
        }
        if (matches.length > 1) {
            const key = [taskType, xsltFsPath, xmlSourceFsPath ?? ''].join('\n');
            const sourceName = xmlSourceFsPath ? path.basename(xmlSourceFsPath) : 'xsl:initial-template';
            const recentlyPicked = SaxonTaskProvider.pickedTasks.get(key) ?? [];
            const picked = await vscode.window.showQuickPick(SaxonTaskProvider.quickRunTaskChoices(matches, recentlyPicked),
                { placeHolder: `${matches.length} tasks run ${path.basename(xsltFsPath)} with ${sourceName} - pick one` });
            if (!picked) {
                return 'cancelled';
            }
            SaxonTaskProvider.pickedTasks.set(key, [picked, ...recentlyPicked.filter((label) => label !== picked)]);
            return { label: picked, created: false };
        }

        // the Saxon (Java) label is unsuffixed so tasks persisted before quick-run became switchable still match.
        // Labels are only for display (runs are matched on xsltFile/xmlSource), but stylesheets or sources with the
        // same file name in different folders would otherwise get identical labels in the 'Run Task' list
        const labelSuffix = taskType === 'xslt' ? '' : ` (${SaxonTaskProvider.quickRunProcessorNames[taskType]})`;
        const sourceName = xmlSourceFsPath ? path.basename(xmlSourceFsPath) : 'xsl:initial-template';
        const baseLabel = `${path.basename(xsltFsPath, path.extname(xsltFsPath))} with ${sourceName}${labelSuffix}`;
        const existingLabels = new Set(existingTasks.map((t) => t.label));
        let label = baseLabel;
        for (let n = 2; existingLabels.has(label); n++) {
            label = `${baseLabel} ${n}`;
        }
        const { parameters, inputs } = await SaxonTaskProvider.extractTopLevelParameters(xsltDocument, definitionProvider);
        const newTask = SaxonTaskProvider.createQuickRunTaskDefinition(taskType, label, toStoredPath(xsltFsPath), xmlSourceFsPath ? toStoredPath(xmlSourceFsPath) : undefined, '${command:xslt-xpath.pickResultFile}');
        newTask.group = { kind: 'build' };
        if (parameters.length > 0) {
            newTask.parameters = parameters;
        }

        const formattingOptions = { tabSize: 4, insertSpaces: false, eol: '\n' };
        // an existing-but-empty (or otherwise incomplete) tasks.json has no top-level "version" yet - jsonc-parser's
        // modify() only ever adds the property path it's told to, so inserting straight into "tasks" would silently
        // leave "version" out and produce a tasks.json VS Code considers invalid (breaking task discovery entirely)
        if (typeof parsed.version !== 'string') {
            const versionEdits = jsc.modify(text, ['version'], '2.0.0', { formattingOptions });
            text = jsc.applyEdits(text, versionEdits);
        }
        const taskInsertionIndex = (jsc.parse(text)?.tasks || []).length;
        const edits = jsc.modify(text, ['tasks', taskInsertionIndex], newTask, {
            formattingOptions,
            isArrayInsertion: true,
        });
        text = jsc.applyEdits(text, edits);
        // the inputs for required parameters' values - shared by tasks for the same parameter name
        const existingInputIds = new Set(((parsed.inputs || []) as { id?: string }[]).map((input) => input.id));
        for (const input of inputs.filter((input) => !existingInputIds.has(input.id))) {
            const inputInsertionIndex = (jsc.parse(text)?.inputs || []).length;
            text = jsc.applyEdits(text, jsc.modify(text, ['inputs', inputInsertionIndex], input, { formattingOptions, isArrayInsertion: true }));
        }
        await vscode.workspace.fs.writeFile(workspaceTaskUri, Buffer.from(text, 'utf8'));
        return { label, created: true };
    }

    // the offset and length in tasks.json's text of the first task (by its definition) that matches - e.g. to show a
    // Quick Run task for editing
    public static taskRange(text: string, matches: (definition: vscode.TaskDefinition) => boolean): { offset: number; length: number } | undefined {
        const root = jsc.parseTree(text);
        const tasksNode = root ? jsc.findNodeAtLocation(root, ['tasks']) : undefined;
        const taskNode = tasksNode?.type === 'array' ? tasksNode.children?.find((node) => node.type === 'object' && matches(jsc.getNodeValue(node))) : undefined;
        return taskNode ? { offset: taskNode.offset, length: taskNode.length } : undefined;
    }

    // the labels of the tasks picked for each quick-run type, stylesheet and source, when several tasks are for them -
    // most recently picked first
    private static pickedTasks = new Map<string, string[]>();

    // the labels to pick from when several tasks are for the same stylesheet and source: the most recently picked
    // first (so the last one is picked again with Enter), then those not picked yet, in tasks.json order
    public static quickRunTaskChoices(matches: vscode.TaskDefinition[], recentlyPicked: string[]): string[] {
        const rank = (label: string) => recentlyPicked.includes(label) ? recentlyPicked.indexOf(label) : recentlyPicked.length;
        return matches.map((t) => t.label).sort((a, b) => rank(a) - rank(b));
    }

    // quick-run tasks are identified by their xsltFile + xmlSource pair (not their label, which the user may
    // change or duplicate) - stored paths may be relative to the task's workspace folder via '${workspaceFolder}'.
    // An undefined xmlSourceFsPath matches only tasks with no source document (xmlSource empty or absent)
    public static isQuickRunTaskFor(definition: vscode.TaskDefinition, taskType: QuickRunTaskType, xsltFsPath: string, xmlSourceFsPath: string | undefined, workspaceFolderFsPath: string): boolean {
        if (definition.type !== taskType || typeof definition.xsltFile !== 'string' || SaxonTaskProvider.resolveStoredPath(definition.xsltFile, workspaceFolderFsPath) !== path.normalize(xsltFsPath)) {
            return false;
        }
        if (xmlSourceFsPath === undefined) {
            return typeof definition.xmlSource !== 'string' || definition.xmlSource === '';
        }
        return SaxonTaskProvider.hasXmlSource(definition, xmlSourceFsPath, workspaceFolderFsPath);
    }

    // true if the task's xmlSource is this file - a stored path may be relative to the task's workspace folder
    public static hasXmlSource(definition: vscode.TaskDefinition, xmlSourceFsPath: string, workspaceFolderFsPath: string): boolean {
        const storedSource = definition.xmlSource;
        return typeof storedSource === 'string' && storedSource !== '' &&
            SaxonTaskProvider.resolveStoredPath(storedSource, workspaceFolderFsPath) === path.normalize(xmlSourceFsPath);
    }

    // the scope of a task: the workspace folder of its stylesheet - so ${workspaceFolder}, e.g. in the problem matchers'
    // search for the files Saxon reports, is that folder, also in a multi-root workspace - or else the workspace. With
    // xsltFile '${file}', the stylesheet is the active editor's file - otherwise, a path with a variable, e.g.
    // ${workspaceFolder} or ${command:...}, or a relative path, isn't known until the task runs
    public static taskScope(xsltFile: unknown): vscode.WorkspaceFolder | vscode.TaskScope.Workspace {
        const fsPath = xsltFile === '${file}' ? vscode.window.activeTextEditor?.document.uri.fsPath :
            typeof xsltFile === 'string' && !xsltFile.includes('${') ? xsltFile : undefined;
        const folder = fsPath && path.isAbsolute(fsPath) ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(fsPath)) : undefined;
        return folder ?? vscode.TaskScope.Workspace;
    }

    // a relative path, e.g. 'xsl/main.xsl', is relative to the workspace folder - the task runs there; another
    // variable, e.g. ${file} or ${command:...}, is left as it is, so it matches no file
    private static resolveStoredPath(value: string, workspaceFolderFsPath: string) {
        if (value.startsWith('${workspaceFolder}')) {
            return path.normalize(path.join(workspaceFolderFsPath, value.substring('${workspaceFolder}'.length)));
        }
        return path.normalize(path.isAbsolute(value) || value.includes('${') ? value : path.join(workspaceFolderFsPath, value));
    }

    // true if this stylesheet, or any module it imports/includes, declares a template named xsl:initial-template -
    // the template Saxon's '-it' option (with no template name) starts from
    public static async declaresInitialTemplate(xsltDocument: vscode.TextDocument, definitionProvider: XsltDefinitionProvider): Promise<boolean> {
        const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
        const { globalInstructionData, allImportedGlobals } = await definitionProvider.getImportedGlobals(xsltDocument, lexPosition);
        return globalInstructionData.concat(allImportedGlobals).some((g: GlobalInstructionData) =>
            g.type === GlobalInstructionType.Template &&
            (g.name === 'xsl:initial-template' || g.name === 'Q{http://www.w3.org/1999/XSL/Transform}initial-template'));
    }

    public static readonly quickRunProcessorNames: { [type in QuickRunTaskType]: string } = {
        'xslt': 'SaxonJ',
        'xslt-js': 'SaxonJS',
        'xslt-c': 'SaxonC',
    };

    // the minimal task definition for each quick-run task type - processor paths reference the user's settings
    // (rather than their current values) so a persisted task keeps working if those settings later change. With no
    // xmlSource, the task starts from xsl:initial-template ('-it'); xmlSource is still written, as an empty string,
    // since the task schemas require it
    public static createQuickRunTaskDefinition(taskType: QuickRunTaskType, label: string, xsltFile: string, xmlSource: string | undefined, resultPath?: string): vscode.TaskDefinition {
        const definition: vscode.TaskDefinition = { type: taskType, label: label };
        switch (taskType) {
            case 'xslt':
                definition.saxonJar = '${config:XSLT.tasks.saxonJar}';
                break;
            case 'xslt-c':
                definition.saxonCPath = '${config:XSLT.tasks.saxonCPath}';
                break;
        }
        definition.xsltFile = xsltFile;
        definition.xmlSource = xmlSource ?? '';
        if (xmlSource === undefined) {
            definition.initialTemplate = '';
        }
        if (resultPath) {
            definition.resultPath = resultPath;
        }
        switch (taskType) {
            case 'xslt':
                definition.messageEscaping = 'adaptive';
                definition.allowSyntaxExtensions40 = 'auto';
                break;
            case 'xslt-c':
                definition.allowSyntaxExtensions40 = 'auto';
                break;
        }
        return definition;
    }

    // the stylesheet parameters (in this stylesheet, or anything it imports/includes) that a run needs a value for:
    // those that are required. Each value comes from a tasks.json input, which asks for it when the task runs (offering
    // the values used before) - parameters with defaults are left out, so the stylesheet's own defaults apply (a
    // stylesheet such as DocBook xsltng has over 100)
    private static async extractTopLevelParameters(xsltDocument: vscode.TextDocument, definitionProvider: XsltDefinitionProvider): Promise<{ parameters: XSLTParameter[]; inputs: ParameterInput[] }> {
        const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
        const { globalInstructionData, allImportedGlobals } = await definitionProvider.getImportedGlobals(xsltDocument, lexPosition);

        const moduleTexts = new Map<string, string | undefined>();
        const moduleText = async (href: string | undefined) => {
            if (!href || href === xsltDocument.uri.fsPath) {
                return xsltDocument.getText();
            }
            if (!moduleTexts.has(href)) {
                moduleTexts.set(href, await vscode.workspace.openTextDocument(vscode.Uri.file(href)).then((d) => d.getText(), () => undefined));
            }
            return moduleTexts.get(href);
        };
        // the declaration in the importing module has the higher import precedence
        const seenNames = new Set<string>();
        const parameters: XSLTParameter[] = [];
        const inputs: ParameterInput[] = [];
        for (const g of globalInstructionData.concat(allImportedGlobals)) {
            if (g.type !== GlobalInstructionType.Parameter || seenNames.has(g.name)) {
                continue;
            }
            seenNames.add(g.name);
            if (g.defaultSelect !== undefined) {
                continue;
            }
            const text = await moduleText(g.href);
            const declaration = text !== undefined ? SaxonTaskProvider.parameterDeclaration(text, g.token.line, g.token.startCharacter) : undefined;
            if (!declaration || !SaxonTaskProvider.isRequiredParameter(declaration.attributes, declaration.hasContent)) {
                continue;
            }
            const type = declaration.attributes.get('as');
            const asXPath = !SaxonTaskProvider.isPlainValueType(type);
            const input: ParameterInput = { id: SaxonTaskProvider.parameterInputPrefix + g.name, type: 'command', command: SaxonTaskProvider.parameterValueCommand, args: { name: g.name, type: type ?? '', xpath: asXPath } };
            inputs.push(input);
            parameters.push({ name: (asXPath ? '?' : '') + g.name, value: '${input:' + input.id + '}' });
        }
        return { parameters, inputs };
    }

    public static readonly parameterValueCommand = 'xslt-xpath.enterParameterValue';
    public static readonly parameterInputPrefix = 'xsltParam-';

    // the attributes of the xsl:param element whose start tag includes the given position (e.g. its name), and whether
    // it has content - a default value, as a select attribute is. Comments aren't content
    public static parameterDeclaration(text: string, line: number, character: number): { attributes: Map<string, string>; hasContent: boolean } | undefined {
        let offset = 0;
        for (let l = 0; l < line; l++) {
            offset = text.indexOf('\n', offset) + 1;
            if (offset === 0) {
                return undefined;
            }
        }
        offset += character;
        // attribute values can't contain '<', so the last one before the name starts the tag
        const tagStart = text.lastIndexOf('<', offset);
        if (tagStart < 0 || !text.startsWith(RecordTypes.xsltTag(text, 'param'), tagStart)) {
            return undefined;
        }
        let tagEnd = -1;
        let quote = '';
        for (let i = tagStart; i < text.length && tagEnd < 0; i++) {
            const c = text.charAt(i);
            if (quote) {
                quote = c === quote ? '' : quote;
            } else if (c === '"' || c === '\'') {
                quote = c;
            } else if (c === '>') {
                tagEnd = i;
            }
        }
        if (tagEnd < 0) {
            return undefined;
        }
        const startTag = text.substring(tagStart, tagEnd + 1);
        const attributes = new Map<string, string>();
        for (const m of startTag.matchAll(/([\p{L}_][\p{L}\p{N}_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)) {
            attributes.set(m[1], m[2] ?? m[3]);
        }
        let hasContent = false;
        if (!startTag.endsWith('/>')) {
            const endTag = text.indexOf('</xsl:param', tagEnd);
            const content = text.substring(tagEnd + 1, endTag < 0 ? text.length : endTag);
            hasContent = content.replace(/<!--[\s\S]*?-->/g, '').trim() !== '';
        }
        return { attributes, hasContent };
    }

    // whether a stylesheet parameter must be supplied: required="yes", or (XSLT 3.0) implicitly - with no default
    // ('select' or content), and an 'as' type that doesn't allow the empty sequence. Without 'as', the default is ''
    public static isRequiredParameter(attributes: Map<string, string>, hasContent: boolean): boolean {
        const required = attributes.get('required')?.trim();
        if (required !== undefined && ['yes', 'true', '1', 'no', 'false', '0'].includes(required)) {
            return ['yes', 'true', '1'].includes(required);
        }
        const type = attributes.get('as');
        if (attributes.has('select') || hasContent || type === undefined || type.trim() === 'empty-sequence()') {
            return false;
        }
        const occurrence = SaxonTaskProvider.occurrenceIndicator(type);
        return occurrence === '' || occurrence === '+';
    }

    // the occurrence indicator ('?', '*', '+' or '') of a sequence type as a whole - not a function type's return
    // type's, as in 'function(xs:string) as xs:integer?' (written '(function(xs:string) as xs:integer)?' for the whole)
    public static occurrenceIndicator(type: string): string {
        const t = type.trim();
        const last = t.charAt(t.length - 1);
        if (!'?*+'.includes(last)) {
            return '';
        }
        let depth = 0;
        let quote = '';
        for (let i = 0; i < t.length; i++) {
            const c = t.charAt(i);
            if (quote) {
                quote = c === quote ? '' : quote;
            } else if (c === '"' || c === '\'') {
                quote = c;
            } else if (c === '(' || c === '[') {
                depth++;
            } else if (c === ')' || c === ']') {
                depth--;
            } else if (depth === 0 && /^\sas\s/.test(t.substring(i, i + 4))) {
                return '';
            }
        }
        return last;
    }

    // whether a value for this type can be given on the command line as it's typed (name=value): Saxon passes it as
    // xs:untypedAtomic, which converts to most atomic types - for other types, it's an XPath expression (?name=value)
    public static isPlainValueType(type: string | undefined): boolean {
        if (type === undefined) {
            return true;
        }
        const itemType = type.trim().replace(/[?*+]$/, '').trim();
        return /^(xs:[\p{L}_][\p{L}\p{N}_.-]*|enum\s*\(.*\))$/u.test(itemType) && !['xs:QName', 'xs:NOTATION', 'xs:error'].includes(itemType);
    }


    private getTasks(tasks: XSLTTask[]) {
        let result: vscode.Task[] = [];
        this.templateTaskFound = false;
        tasks.forEach((task) => {
            let newTask = this.getTask(task);
            if (newTask) {
                result.push(newTask);
            }
        });
        if (!this.templateTaskFound) {
            let templateTask = this.addTemplateTask();
            if (templateTask) {
                result.push(templateTask);
            }
        }

        return result;
    }

    private addTemplateTask() {
        let saxonJarDefault = '${config:XSLT.tasks.saxonJar}';
        let xmlSourceValue = '${command:xslt-xpath.pickXmlSourceFile}';
        let xsltFilePath = '${command:xslt-xpath.pickXsltFile}';
        let resultPathValue = '${workspaceFolder}/xsl-out/result1.xml';

        let xsltTask: XSLTTask = {
            type: 'xslt',
            saxonJar: saxonJarDefault,
            label: this.templateTaskLabel,
            xsltFile: xsltFilePath,
            xmlSource: xmlSourceValue,
            resultPath: resultPathValue,
            messageEscaping: 'adaptive',
            allowSyntaxExtensions40: 'auto',
            group: {
                kind: "build"
            }
        };

        return this.getTask(xsltTask);
    }

    // private addXPathEvalTemplateTask() {
    //     let saxonJarDefault = '${config:XSLT.tasks.saxonJar}';
    //     let xmlSourceValue = '${command:xslt-xpath.pickXPathContextFile}';
    //     let xsltFilePath = SaxonTaskProvider.getEvalXSLTPath();
    //     let resultPathValue = '${command:xslt-xpath.pickResultFile}';

    //     let xsltTask: XSLTTask = {
    //         type: 'xslt',
    //         saxonJar: saxonJarDefault,
    //         label: 'XPath Evaluation',
    //         xsltFile: xsltFilePath,
    //         xmlSource: xmlSourceValue,
    //         resultPath: resultPathValue,
    //         allowSyntaxExtensions40: 'on',
    //         messageEscaping: 'on',
    //         group: {
    //             kind: "build"
    //         }
    //     };

    //     return this.getTask(xsltTask);
    // }

    public getTask(genericTask: vscode.TaskDefinition): vscode.Task | undefined {

        let source = 'xslt';

        if (genericTask.type === 'xslt') {
            let xsltTask: XSLTTask = <XSLTTask>genericTask;
            if (xsltTask.label === 'xslt: ' + this.templateTaskLabel) {
                this.templateTaskFound = true;
            }
            const { classPath, mainClass, args } = SaxonTaskProvider.commandLine(xsltTask, false);
            // this is overriden if problemMatcher is set in the tasks.json file
            let problemMatcher = "$saxon-xslt";
            const javaArgs = ['-cp', classPath.join(pathSeparator()), mainClass];
            const processExecution = new vscode.ProcessExecution('java', javaArgs.concat(args));
            let newTask = new vscode.Task(xsltTask, SaxonTaskProvider.taskScope(xsltTask.xsltFile), xsltTask.label, source, processExecution, problemMatcher);
            newTask.presentationOptions.clear = false;
            newTask.presentationOptions.showReuseMessage = false;
            newTask.presentationOptions.echo = true;
            return newTask;
        } else {
            return undefined;
        }
    }

    // the Java classpath, main class and Saxon command-line arguments for an 'xslt' task definition - also used for
    // 'xslt-saxon' debug configurations, which have the same properties: forDebug leaves out the options that the
    // debugger's own Transform run can't use (the message-escaping AltTransform, tracing, timing, -nogo)
    public static commandLine(xsltTask: XSLTTask, forDebug: boolean): { classPath: string[]; mainClass: string; args: string[] } {
        const saxonJarConfig: string | undefined = vscode.workspace.getConfiguration('XSLT.tasks').get('saxonJar');
        const taskSaxonJarPath = xsltTask.saxonJar === '${config:XSLT.tasks.saxonJar}' ? saxonJarConfig : xsltTask.saxonJar;
        const isPriorToSaxon9902 = SaxonTaskProvider.testSaxon9902(taskSaxonJarPath);
        const altSaxonJarPath = xsltTask.messageEscaping === "on" || forDebug ? undefined : SaxonTaskProvider.getAltSaxonPath(taskSaxonJarPath);
        let nogo = xsltTask.execute !== undefined && xsltTask.execute === false && !forDebug;
        let commandLineArgs: string[] = [];

        let xsltParameters: XSLTParameter[] = xsltTask.parameters ? xsltTask.parameters : [];
        let xsltParametersCommand: string[] = [];
        for (const param of xsltParameters) {
            xsltParametersCommand.push(param.name + '=' + param.value);
        }
        let saxonFeatures: XSLTParameter[] = xsltTask.features ? xsltTask.features : [];
        let saxonFeaturesCommand: string[] = [];
        for (const feature of saxonFeatures) {
            saxonFeaturesCommand.push('--' + feature.name + ':' + feature.value);
        }
        // the setting's variable is kept for VS Code to substitute, unless the setting has quotes around it
        const saxonJar = xsltTask.saxonJar === '${config:XSLT.tasks.saxonJar}' && saxonJarConfig !== unquotedPath(saxonJarConfig) ?
            unquotedPath(saxonJarConfig)! : unquotedPath(xsltTask.saxonJar);
        let classPaths: string[] = altSaxonJarPath ? [altSaxonJarPath, saxonJar] : [saxonJar];
        if (xsltTask.classPathEntries) {
            classPaths = classPaths.concat(xsltTask.classPathEntries);
        }
        let isXSLT40 = false;
        let useSaxonTextEmitter = isPriorToSaxon9902 && !altSaxonJarPath;
        // options that would conflict with the debugger's own tracing
        const debugExcluded = ['traceOutFilename', 'traceListener', 'timing', 'TPfilename', 'TPxslFilename'];

        for (const propName in xsltTask) {
            if (forDebug && debugExcluded.includes(propName)) {
                continue;
            }
            let propValue = (<any>xsltTask)[propName];
            switch (propName) {
                case 'xsltFile':
                    commandLineArgs.push('-xsl:' + propValue);
                    break;
                case 'xmlSource':
                    if (propValue !== "") {
                        commandLineArgs.push((SaxonJsTaskProvider.isJsonSource(xsltTask) ? '-json:' : '-s:') + propValue);
                    }
                    break;
                case 'resultPath':
                    commandLineArgs.push('-o:' + propValue);
                    break;
                case 'initialTemplate':
                    if (propValue !== "") {
                        commandLineArgs.push('-it:' + propValue);
                    } else {
                        commandLineArgs.push('-it');
                    }
                    break;
                case 'initialMode':
                    commandLineArgs.push('-im:' + propValue);
                    break;
                case 'catalogFilenames':
                    commandLineArgs.push('-catalog:' + propValue);
                    break;
                case 'configFilename':
                    commandLineArgs.push('-config:' + propValue);
                    break;
                case 'dtd':
                    commandLineArgs.push('-dtd:' + propValue);
                    break;
                case 'enableAssertions':
                    commandLineArgs.push('-ea:' + propValue);
                    break;
                case 'expandValues':
                    commandLineArgs.push('-expand:' + propValue);
                    break;
                case 'explainFilename':
                    commandLineArgs.push('-explain:' + propValue);
                    break;
                case 'exportFilename':
                    commandLineArgs.push('-export:' + propValue);
                    break;
                case 'traceOutFilename':
                    commandLineArgs.push('-traceOut:' + propValue);
                    break;
                case 'traceListener':
                    if (propValue.length > 0) {
                    commandLineArgs.push('-T:' + propValue);
                    } else {
                        commandLineArgs.push('-T');
                    }
                    break;
                case 'timing':
                    if (propValue !== "off") {
                        commandLineArgs.push('-t');
                    }
                    break;
                case 'timing':
                    if (propValue !== "off") {
                        commandLineArgs.push('-TP');
                    }
                    break;
                case 'TPfilename':
                    commandLineArgs.push('-TP:' + propValue);
                    break;
                case 'TPxslFilename':
                    commandLineArgs.push('-TPxsl:' + propValue);
                    break;
                case 'allowSyntaxExtensions40':
                    isXSLT40 = true;
                    commandLineArgs.push('--allowSyntaxExtensions:' + SaxonTaskProvider.syntaxExtensions40Value(propValue, taskSaxonJarPath));
                    break;
                case 'messageEscaping':
                    useSaxonTextEmitter = propValue === "off" || (propValue === "adaptive" && isPriorToSaxon9902);
                    break;
            }
        }

        if (xsltTask.allowSyntaxExtensions40 === undefined && SaxonTaskProvider.syntaxExtensions40Value(undefined, taskSaxonJarPath) === 'on') {
            // no setting: as for 'auto'
            isXSLT40 = true;
            commandLineArgs.push('--allowSyntaxExtensions:on');
        }
        const catalogOption = CatalogSetting.taskOption(xsltTask);
        if (catalogOption) {
            // the XSLT.resources.catalog setting, as used for the task's hrefs in the editor
            commandLineArgs.push(catalogOption);
        }
        const libOption = SaxonTaskProvider.libOption(xsltTask);
        if (libOption) {
            commandLineArgs.push(libOption);
        }
        if (nogo) {
            commandLineArgs.push('-nogo');
        }
        if (useSaxonTextEmitter) {
            commandLineArgs.push('-m:net.sf.saxon.serialize.TEXTEmitter');
        }

        if (isXSLT40) {
            const htmlParserJar = classPaths.find((item) => item.includes('nu.validator') || item.includes('htmlparser'));

            if (!htmlParserJar) {
                const htmlparserPath = unquotedPath(vscode.workspace.getConfiguration('XSLT.tasks').get<string>('htmlParserJar'));
                if (htmlparserPath) {
                    classPaths.push(htmlparserPath);
                }
            }
        }

        const saxonClassName = altSaxonJarPath ? 'com.deltaxml.saxon.perf.AltTransform' : 'net.sf.saxon.Transform';
        return { classPath: classPaths, mainClass: saxonClassName, args: commandLineArgs.concat(saxonFeaturesCommand).concat(xsltParametersCommand) };
    }

    // Saxon's -lib option, for the packages the stylesheet uses with xsl:use-package (see XsltPackages) - Saxon finds
    // each by the name and version in its xsl:package element. Not for a task with a Saxon configuration file, which
    // may declare the packages itself
    public static libOption(task: { xsltFile?: unknown; configFilename?: unknown }): string | undefined {
        if (task.configFilename || typeof task.xsltFile !== 'string') {
            return undefined;
        }
        const xsltFsPath = SaxonTaskProvider.taskFilePath(task.xsltFile);
        const libraryPaths = xsltFsPath ? XsltPackages.libraryPaths(xsltFsPath) : [];
        return libraryPaths.length > 0 ? '-lib:' + libraryPaths.join(path.delimiter) : undefined;
    }

    // a task's file path property: '${file}' is the active editor's file, and a path may be relative to the workspace
    // folder, or start with '${workspaceFolder}' - undefined for another variable, e.g. ${command:...}
    private static taskFilePath(value: string): string | undefined {
        if (value === '${file}') {
            return vscode.window.activeTextEditor?.document.uri.fsPath;
        }
        if (value.includes('${') && !value.startsWith('${workspaceFolder}')) {
            return undefined;
        }
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        return folder ? SaxonTaskProvider.resolveStoredPath(value, folder) : path.isAbsolute(value) ? value : undefined;
    }

    private static testSaxon9902(saxonJarPath: string | undefined) {
        let result = false;
        if (saxonJarPath) {
            const matches = saxonJarPath.match(SaxonTaskProvider.saxonVersionRgx);
            if (matches && matches.length > 2) {
                matches.shift(); // remove entire match
                const v = matches.map(item => Number.parseInt(item));
                result = (v[0] === 9 && v[1] === 9 && v[2] === 0 && v[3] === 1) ||
                    (v[0] < 9) || (v[0] === 9 && v[1] < 9);
            }
        }
        return result;
    }

    private static getAltSaxonPath(saxonJarPath: string | undefined) {
        let jarName: string | undefined = "deltaxml-saxon-perf-1.0-SAXON";
        if (saxonJarPath) {
            const matches = saxonJarPath.match(SaxonTaskProvider.saxonVersionRgx);
            if (matches && matches.length > 2) {
                matches.shift(); // remove entire match
                const v = matches.map(item => Number.parseInt(item));
                const [major, minor, patch1, patch2] = v;
                switch (major) {
                    case 9:
                        jarName = minor === 9 ? jarName + '99' : undefined;
                        break;
                    case 10:
                    case 11:
                    case 12:
                    case 13:
                        jarName = jarName + major;
                        break;
                    default:
                        jarName = undefined;
                }
                if (jarName) {
                    jarName += ".jar";
                    jarName = vscode.Uri.joinPath(SaxonTaskProvider.extensionURI!, 'xslt-resources', jarName).fsPath;
                }
            } else {
                jarName = undefined;
            }
        }
        return jarName;
    }

}