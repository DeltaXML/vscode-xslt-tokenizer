/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - saxonCTaskProvider
 */
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { SaxonJsTaskProvider } from './saxonJsTaskProvider';
import { SaxonTaskProvider } from './saxonTaskProvider';

interface XSLTCTask extends vscode.TaskDefinition {
    label: string;
    saxonCPath?: string;
    saxonCLibraryPaths?: string[];
    licenseFileLocation?: string;
    unescapeMessages?: boolean;
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
    configFilename?: string;
    dtd?: string;
    enableAssertions?: string;
    expandValues?: string;
    explainFilename?: string;
    exportFilename?: string;
    traceOutFilename?: string;
    traceListener?: string;
    timing?: string;
    TPfilename?: string;
    TPxslFilename?: string;
    group?: TaskGroup;
}

interface TaskGroup {
    kind: string;
}

interface XSLTParameter {
    name: string;
    value: string;
}

function pathSeparator() {
    return os.platform() === 'win32' ? ';' : ':';
}

function saxonCExecutableName() {
    return os.platform() === 'win32' ? 'Transform.exe' : 'Transform';
}

// SaxonC's native libraries are frequently built/packaged without an embedded rpath (macOS: "no LC_RPATH's
// found" when loading e.g. libsaxonc-pe.dylib), so Transform can fail to launch even once its own path is
// correctly configured. This combines the sibling 'lib' folder next to the configured executable (the common
// case) with any additional folders the user has configured - some SaxonC distributions split dependencies
// (e.g. a separate core library) across folders that aren't a fixed, guessable path relative to the executable.
// The bundled script prepends it to PATH on Windows, or a dedicated env var on macOS/Linux
function buildLibraryPath(saxonCPath: string | undefined, extraLibraryPaths: string[] | undefined): string | undefined {
    const paths: string[] = [];
    if (saxonCPath) {
        paths.push(path.join(saxonCPath, '..', 'lib'));
    }
    if (extraLibraryPaths) {
        paths.push(...extraLibraryPaths);
    }
    return paths.length > 0 ? paths.join(pathSeparator()) : undefined;
}

// Transform is launched via this bundled script when its library path must be set or its xsl:message output
// unescaped. It's run by VS Code's own executable as Node.js, so needs nothing else installed. See the script
function saxonCScriptPath() {
    return vscode.Uri.joinPath(SaxonTaskProvider.extensionURI!, 'xslt-resources', 'saxonc-transform.js').fsPath;
}

// an argument the script ignores - VS Code echoes a task's command line as its arguments joined with spaces, so
// this breaks the 'Executing task' line after the long VS Code executable and script paths
function echoLineBreak() {
    return (os.platform() === 'win32' ? '^' : '\\') + '\r\n   ';
}

export class SaxonCTaskProvider implements vscode.TaskProvider {
    static SaxonBuildScriptType: string = 'xslt-c';
    templateTaskLabel = 'SaxonC Transform (New)';
    templateTaskFound = false;

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

    private getTasks(tasks: XSLTCTask[]) {
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
        let saxonCPathDefault = '${config:XSLT.tasks.saxonCPath}';
        let xmlSourceValue = '${command:xslt-xpath.pickXmlSourceFile}';
        let xsltFilePath = '${command:xslt-xpath.pickXsltFile}';
        let resultPathValue = '${workspaceFolder}/xsl-out/result1.xml';

        let xsltTask: XSLTCTask = {
            type: 'xslt-c',
            label: this.templateTaskLabel,
            saxonCPath: saxonCPathDefault,
            xsltFile: xsltFilePath,
            xmlSource: xmlSourceValue,
            resultPath: resultPathValue,
            allowSyntaxExtensions40: 'off',
            group: {
                kind: "build"
            }
        };

        return this.getTask(xsltTask);
    }

    public getTask(genericTask: vscode.TaskDefinition): vscode.Task | undefined {

        let source = 'xslt-c';
        const saxonCPathConfig: string | undefined = vscode.workspace.getConfiguration('XSLT.tasks').get('saxonCPath');
        const saxonCLibraryPathsConfig: string[] | undefined = vscode.workspace.getConfiguration('XSLT.tasks').get('saxonCLibraryPaths');
        const saxonCLicenseFileLocationConfig: string | undefined = vscode.workspace.getConfiguration('XSLT.tasks').get('saxonCLicenseFileLocation');

        if (genericTask.type === 'xslt-c') {
            let xsltTask: XSLTCTask = <XSLTCTask>genericTask;
            if (xsltTask.label === 'xslt-c: ' + this.templateTaskLabel) {
                this.templateTaskFound = true;
            }
            const taskSaxonCPath = xsltTask.saxonCPath === '${config:XSLT.tasks.saxonCPath}' ? saxonCPathConfig : xsltTask.saxonCPath;
            const taskLibraryPaths = xsltTask.saxonCLibraryPaths ?? saxonCLibraryPathsConfig;
            const taskLicenseFileLocation = xsltTask.licenseFileLocation ?? saxonCLicenseFileLocationConfig;
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

            for (const propName in xsltTask) {
                let propValue = this.getProp(xsltTask, propName);
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
                    case 'TPfilename':
                        commandLineArgs.push('-TP:' + propValue);
                        break;
                    case 'TPxslFilename':
                        commandLineArgs.push('-TPxsl:' + propValue);
                        break;
                    case 'allowSyntaxExtensions40':
                        commandLineArgs.push('--allowSyntaxExtensions:' + propValue);
                        break;
                }
            }

            if (nogo) {
                commandLineArgs.push('-nogo');
            }
            if (taskLicenseFileLocation) {
                commandLineArgs.push('--licenseFileLocation:' + taskLicenseFileLocation);
            }

            // SaxonC's CLI mirrors SaxonJ's command-line arguments closely, but is invoked as a single native
            // executable (no java/classpath) - just 'Transform' on Linux/macOS, 'Transform.exe' on Windows
            const executablePath = taskSaxonCPath ? path.join(taskSaxonCPath, saxonCExecutableName()) : saxonCExecutableName();
            const libraryPath = buildLibraryPath(taskSaxonCPath, taskLibraryPaths);
            const allArgs = commandLineArgs.concat(saxonFeaturesCommand).concat(xsltParametersCommand);
            // this is overriden if problemMatcher is set in the tasks.json file
            let problemMatcher = "$saxon-xslt";

            const unescapeMessages = xsltTask.unescapeMessages !== false;
            let execution: vscode.ProcessExecution;
            if (libraryPath || unescapeMessages) {
                // macOS strips DYLD_* environment variables that a process merely *inherits* (a SIP protection
                // against library injection) - and VS Code's task/terminal machinery goes through such a
                // restricted intermediate, so ProcessExecutionOptions.env's DYLD_LIBRARY_PATH never survives to
                // reach Transform. A process CAN still set these variables for its own children though, so the
                // script is passed the library path under a different name and sets it itself
                const env: { [key: string]: string } = { ELECTRON_RUN_AS_NODE: '1', SAXONC_UNESCAPE_MESSAGES: String(unescapeMessages) };
                if (libraryPath) {
                    env.SAXONC_LIBRARY_PATH = libraryPath;
                }
                execution = new vscode.ProcessExecution(process.execPath, [saxonCScriptPath(), echoLineBreak(), executablePath].concat(allArgs), { env });
            } else {
                execution = new vscode.ProcessExecution(executablePath, allArgs);
            }
            let newTask = new vscode.Task(xsltTask, vscode.TaskScope.Workspace, xsltTask.label, source, execution, problemMatcher);
            newTask.presentationOptions.clear = false;
            newTask.presentationOptions.showReuseMessage = false;
            newTask.presentationOptions.echo = true;
            return newTask;
        } else {
            return undefined;
        }
    }

}
