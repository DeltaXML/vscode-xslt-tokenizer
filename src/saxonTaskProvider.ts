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

function pathSeparator() {
    if (os.platform() === 'win32') {
        return ';';
    } else {
        return ':';
    }
}

interface XSLTTask extends vscode.TaskDefinition {
    label: string;
    saxonJar: string;
    xsltFile: string;
    xmlSource: string;
    resultPath?: string;
    execute?: boolean;
    allowSyntaxExtensions40?: string;
    parameters?: XSLTParameter[];
    features?: XSLTParameter[];
    initialTemplate?: string;
    initialMode?: string;
    classPathEntries?: string[];
    useWorkspace?: boolean;
    messageEscaping?: string;
    group?: TaskGroup;
}

interface TaskGroup {
    kind: string;
}

interface XSLTParameter {
    name: string;
    value: string;
}

export class SaxonTaskProvider implements vscode.TaskProvider {
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

    private getProp(obj: any, prop: string): string {
        return obj[prop];
    }

    public static async getXdmViewPath(document: vscode.TextDocument) {
        let xdmViewFiles = await vscode.workspace.findFiles('**/xdm-view.xsl');
        const xdmView = xdmViewFiles.length > 0 ? xdmViewFiles[0] : vscode.Uri.joinPath(SaxonTaskProvider.extensionURI!, 'xslt-resources', 'xdm-view/xdm-view.xsl');
        const docBaseURI = path.dirname(document.uri.fsPath);
        return path.relative(docBaseURI, xdmView.fsPath);
    }

    // finds (or persists, on first use) a 'xslt' task in .vscode/tasks.json for this xsltFile/xmlSource pair,
    // so the user can subsequently add xslt parameters etc. by hand - returns its label, or undefined if there
    // is no workspace folder to persist into (caller should fall back to an ad hoc, non-persisted task)
    public static async findOrCreateQuickRunTaskLabel(xsltDocument: vscode.TextDocument, xmlSourceFsPath: string, definitionProvider: XsltDefinitionProvider): Promise<string | undefined> {
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
        const resolveStoredPath = (value: string) => path.normalize(value.startsWith('${workspaceFolder}')
            ? path.join(workspaceFolder.uri.fsPath, value.substring('${workspaceFolder}'.length))
            : value);

        let text: string;
        try {
            const doc = await vscode.workspace.openTextDocument(workspaceTaskUri);
            text = doc.getText();
        } catch {
            text = JSON.stringify({ version: '2.0.0', tasks: [] }, null, '\t');
        }

        const parsed = jsc.parse(text) || {};
        const existingTasks: XSLTTask[] = parsed.tasks || [];
        const normalizedXslt = path.normalize(xsltFsPath);
        const normalizedSource = path.normalize(xmlSourceFsPath);
        const match = existingTasks.find((t) =>
            t.type === 'xslt' &&
            typeof t.xsltFile === 'string' && resolveStoredPath(t.xsltFile) === normalizedXslt &&
            typeof t.xmlSource === 'string' && resolveStoredPath(t.xmlSource) === normalizedSource
        );
        if (match) {
            return match.label;
        }

        const label = `${path.basename(xsltFsPath, path.extname(xsltFsPath))} with ${path.basename(xmlSourceFsPath)}`;
        const parameters = await SaxonTaskProvider.extractTopLevelParameters(xsltDocument, definitionProvider);
        const newTask: XSLTTask = {
            type: 'xslt',
            label: label,
            saxonJar: '${config:XSLT.tasks.saxonJar}',
            xsltFile: toStoredPath(xsltFsPath),
            xmlSource: toStoredPath(xmlSourceFsPath),
            resultPath: '${command:xslt-xpath.pickResultFile}',
            messageEscaping: 'adaptive',
            allowSyntaxExtensions40: 'off',
            group: { kind: 'build' },
        };
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
        const newText = jsc.applyEdits(text, edits);
        await vscode.workspace.fs.writeFile(workspaceTaskUri, Buffer.from(newText, 'utf8'));
        return label;
    }

    // top-level xsl:param declarations (in this stylesheet, or anything it imports/includes) with a 'select'
    // default become '?name=<the same xpath>' overrides - the leading '?' tells Saxon's CLI to evaluate the
    // value as XPath rather than treat it as a literal string, so reusing the declared select expression
    // verbatim reproduces the param's own default, not an empty override
    private static async extractTopLevelParameters(xsltDocument: vscode.TextDocument, definitionProvider: XsltDefinitionProvider): Promise<XSLTParameter[]> {
        const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
        const { globalInstructionData, allImportedGlobals } = await definitionProvider.getImportedGlobals(xsltDocument, lexPosition);

        const seenNames = new Set<string>();
        const parameters: XSLTParameter[] = [];
        globalInstructionData.concat(allImportedGlobals).forEach((g: GlobalInstructionData) => {
            if (g.type === GlobalInstructionType.Parameter && g.defaultSelect && !seenNames.has(g.name)) {
                seenNames.add(g.name);
                parameters.push({ name: '?' + g.name, value: g.defaultSelect });
            }
        });
        return parameters;
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
            allowSyntaxExtensions40: 'off',
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
        const saxonJarConfig: string | undefined = vscode.workspace.getConfiguration('XSLT.tasks').get('saxonJar');
        let isPriorToSaxon9902 = false;

        if (genericTask.type === 'xslt') {
            let xsltTask: XSLTTask = <XSLTTask>genericTask;
            if (xsltTask.label === 'xslt: ' + this.templateTaskLabel) {
                this.templateTaskFound = true;
            }
            const taskSaxonJarPath = xsltTask.saxonJar === '${config:XSLT.tasks.saxonJar}' ? saxonJarConfig : xsltTask.saxonJar;
            isPriorToSaxon9902 = this.testSaxon9902(taskSaxonJarPath);
            const altSaxonJarPath = xsltTask.messageEscaping === "on" ? undefined : this.getAltSaxonPath(taskSaxonJarPath);
            let nogo = xsltTask.execute !== undefined && xsltTask.execute === false;
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
            let classPaths: string[] = altSaxonJarPath ? [altSaxonJarPath, xsltTask.saxonJar] : [xsltTask.saxonJar];
            if (xsltTask.classPathEntries) {
                classPaths = classPaths.concat(xsltTask.classPathEntries);
            }
            let isXSLT40 = false;
            let useSaxonTextEmitter = isPriorToSaxon9902 && !altSaxonJarPath;

            for (const propName in xsltTask) {
                let propValue = this.getProp(xsltTask, propName);
                switch (propName) {
                    case 'xsltFile':
                        commandLineArgs.push('-xsl:' + propValue);
                        break;
                    case 'xmlSource':
                        if (propValue !== "") {
                            commandLineArgs.push('-s:' + propValue);
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
                        commandLineArgs.push('--allowSyntaxExtensions:' + propValue);
                        break;
                    case 'messageEscaping':
                        useSaxonTextEmitter = propValue === "off" || (propValue === "adaptive" && isPriorToSaxon9902);
                        break;
                }
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
                    const htmlparserPath = <string | undefined>vscode.workspace.getConfiguration('XSLT.tasks').get('htmlParserJar');
                    if (htmlparserPath) {
                        classPaths.push(htmlparserPath);
                    }
                }
            }

            const saxonClassName = altSaxonJarPath ? 'com.deltaxml.saxon.perf.AltTransform' : 'net.sf.saxon.Transform';


            let rawClassPathString = classPaths.join(pathSeparator());
            // this is overriden if problemMatcher is set in the tasks.json file      
            let problemMatcher = "$saxon-xslt";
            const javaArgs = ['-cp', rawClassPathString, saxonClassName];
            const processExecution = new vscode.ProcessExecution('java', javaArgs.concat(commandLineArgs).concat(saxonFeaturesCommand).concat(xsltParametersCommand));
            let newTask = new vscode.Task(xsltTask, vscode.TaskScope.Workspace, xsltTask.label, source, processExecution, problemMatcher);
            newTask.presentationOptions.clear = false;
            newTask.presentationOptions.showReuseMessage = false;
            newTask.presentationOptions.echo = true;
            return newTask;
        } else {
            return undefined;
        }
    }

    private testSaxon9902(saxonJarPath: string | undefined) {
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

    private getAltSaxonPath(saxonJarPath: string | undefined) {
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