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

interface XSLTCTask extends vscode.TaskDefinition {
    label: string;
    saxonCPath?: string;
    saxonCLibraryPaths?: string[];
    licenseFileLocation?: string;
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
// correctly configured. On Windows, DLLs are found via PATH itself; POSIX platforms use a dedicated env var.
function libraryPathEnvVarName() {
    const platform = os.platform();
    if (platform === 'win32') {
        return 'PATH';
    }
    return platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
}

// combines the sibling 'lib' folder next to the configured executable (the common case) with any additional
// folders the user has configured - some SaxonC distributions split dependencies (e.g. a separate core library)
// across folders that aren't a fixed, guessable path relative to the executable
function buildLibraryPathEnv(saxonCPath: string | undefined, extraLibraryPaths: string[] | undefined): { [key: string]: string } | undefined {
    const paths: string[] = [];
    if (saxonCPath) {
        paths.push(path.join(saxonCPath, '..', 'lib'));
    }
    if (extraLibraryPaths) {
        paths.push(...extraLibraryPaths);
    }
    if (paths.length === 0) {
        return undefined;
    }
    const varName = libraryPathEnvVarName();
    const existingValue = process.env[varName];
    const combinedValue = existingValue ? paths.concat(existingValue).join(pathSeparator()) : paths.join(pathSeparator());
    return { [varName]: combinedValue };
}

function shellQuote(value: string): string {
    return "'" + value.replace(/'/g, "'\\''") + "'";
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
            const libraryPathEnv = buildLibraryPathEnv(taskSaxonCPath, taskLibraryPaths);
            const allArgs = commandLineArgs.concat(saxonFeaturesCommand).concat(xsltParametersCommand);
            // this is overriden if problemMatcher is set in the tasks.json file
            let problemMatcher = "$saxon-xslt";

            let execution: vscode.ProcessExecution | vscode.ShellExecution;
            if (libraryPathEnv && os.platform() !== 'win32') {
                // macOS strips DYLD_* environment variables that a process merely *inherits* (a SIP protection
                // against library injection) - and VS Code's task/terminal machinery goes through such a
                // restricted intermediate, so ProcessExecutionOptions.env's DYLD_LIBRARY_PATH never survives to
                // reach Transform. A process CAN still set these variables for its own children though, so setting
                // it inline in a shell command (forcing /bin/sh, regardless of the user's configured shell) works
                const envAssignments = Object.entries(libraryPathEnv).map(([key, value]) => `export ${key}=${shellQuote(value)};`).join(' ');
                const commandLine = `${envAssignments} exec ${shellQuote(executablePath)} ${allArgs.map(shellQuote).join(' ')}`;
                execution = new vscode.ShellExecution(commandLine, { executable: '/bin/sh', shellArgs: ['-c'] });
            } else {
                execution = new vscode.ProcessExecution(executablePath, allArgs, libraryPathEnv ? { env: libraryPathEnv } : undefined);
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
