/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - saxonTaskProvider
 */
import * as vscode from 'vscode';
import * as  os from 'os';
import { SaxonJsTaskProvider } from './saxonJsTaskProvider';
import * as path from 'path';

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
    resultPath: string;
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
    private static saxonVersionRgx = new RegExp(/saxon.e(\d+)-(\d+)-(\d+)-(\d+)/i);

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

    public static async getResultSerializerPath(document: vscode.TextDocument) {
        let serializerFiles = await vscode.workspace.findFiles('**/xpath-result-serializer.xsl');
        const serializer = serializerFiles.length > 0 ? serializerFiles[0] : vscode.Uri.joinPath(SaxonTaskProvider.extensionURI!, 'xslt-resources', 'xpath-result-serializer/xpath-result-serializer.xsl');
        const docBaseURI = path.dirname(document.uri.fsPath);
        return path.relative(docBaseURI, serializer.fsPath);
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
        let xmlSourceValue = '${file}';
        let xsltFilePath = '${command:xslt-xpath.pickXsltFile}';
        let resultPathValue = '${command:xslt-xpath.pickResultFile}';

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

    private getTask(genericTask: vscode.TaskDefinition): vscode.Task | undefined {

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
            let classPaths: string[] = [xsltTask.saxonJar];
            if (xsltTask.classPathEntries) {
                classPaths = classPaths.concat(xsltTask.classPathEntries);
            }
            let isXSLT40 = false;
            let useSaxonTextEmitter = isPriorToSaxon9902;

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
                    const htmlparserPath = <string|undefined>vscode.workspace.getConfiguration('XSLT.tasks').get('htmlParserJar');
                    if (htmlparserPath) {
                        classPaths.push(htmlparserPath);
                    }
                }
            }


            let rawClassPathString = classPaths.join(pathSeparator());
            // this is overriden if problemMatcher is set in the tasks.json file      
            let problemMatcher = "$saxon-xslt";
            const javaArgs = ['-cp', rawClassPathString, 'net.sf.saxon.Transform'];
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
            if (matches && matches.length === 5) {
                matches.shift(); // remove entire match
                const v = matches.map(item => Number.parseInt(item));
                result = (v[0] === 9 && v[1] === 9 && v[2] === 0 && v[3] === 1) ||
                    (v[0] < 9) || (v[0] === 9 && v[1] < 9);
            }
        }
        return result;
    }
}