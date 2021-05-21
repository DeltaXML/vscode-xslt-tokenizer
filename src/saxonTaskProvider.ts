/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - saxonTaskProvider
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as  os from 'os';
import * as jsc from 'jsonc-parser'

function exists(file: string): Promise<boolean> {
    return new Promise<boolean>((resolve, _reject) => {
        fs.exists(file, (value) => {
            resolve(value);
        });
    });
}

function pathSeparator() {
    if (os.platform() === 'win32') {
        return ';';
    } else {
        return ':';
    }
}

interface XSLTTask extends vscode.TaskDefinition {
    label: string,
    saxonJar: string,
    xsltFile: string,
    xmlSource: string,
    resultPath: string,
    parameters?: XSLTParameter[],
    initialTemplate?: string,
    initialMode?: string,
    classPathEntries?: string[],
    useWorkspace?: boolean,
    group?: TaskGroup
}

interface TaskGroup {
    kind: string
}

interface XSLTParameter {
    name: string,
    value: string
}

export class SaxonTaskProvider implements vscode.TaskProvider {
    static SaxonBuildScriptType: string = 'xslt';
    templateTaskLabel = 'Saxon Transform (New)';
    templateTaskFound = false;


    constructor(private workspaceRoot: string) { }

    public async provideTasks(): Promise<vscode.Task[]> {
        let rootPath = vscode.workspace.rootPath ? vscode.workspace.rootPath : '/';
        let tasksPath = path.join(rootPath, '.vscode', 'tasks.json');
        let tasksObject = undefined;

        if (await exists(tasksPath)) {
            const tasksText = fs.readFileSync(tasksPath).toString('utf-8');
            tasksObject = jsc.parse(tasksText);
        } else {
            tasksObject = { tasks: [] };
        }

        return this.getTasks(tasksObject.tasks);
    }

    public resolveTask(_task: vscode.Task): vscode.Task | undefined {
        return this.getTask(_task.definition);
    }

    private getProp(obj: any, prop: string): string {
        return obj[prop];
    }

    private getTasks(tasks: XSLTTask[]) {
        let result: vscode.Task[] = [];
        this.templateTaskFound = false;
        tasks.forEach((task) => {
            let newTask = this.getTask(task);
            if (newTask) {
                result.push(newTask);
            }
        })
        if (!this.templateTaskFound) {
            let templateTask = this.addTemplateTask();
            if (templateTask) {
                result.push(templateTask);
            }
        }

        return result;
    }

    private addTemplateTask() {
        let saxonJarDefault = '${config:XSLT.tasks.saxonJar}'
        let xmlSourceValue = '${file}';
        let xsltFilePath = '${file}';
        let resultPathValue = '${workspaceFolder}/xslt-out/result1.xml';

        let xsltTask: XSLTTask = {
            type: 'xslt',
            saxonJar: saxonJarDefault,
            label: this.templateTaskLabel,
            xsltFile: xsltFilePath,
            xmlSource: xmlSourceValue,
            resultPath: resultPathValue,
            group: {
                kind: "build"
            }
        };

        return this.getTask(xsltTask);
    }

    private getTask(genericTask: vscode.TaskDefinition): vscode.Task|undefined {

        let source = 'xslt';

        if (genericTask.type === 'xslt') {
            let xsltTask: XSLTTask = <XSLTTask>genericTask;
            if (xsltTask.label === 'xslt: ' + this.templateTaskLabel) {
                this.templateTaskFound = true;
            }

            let commandLineArgs: string[] = [];

            let xsltParameters: XSLTParameter[] = xsltTask.parameters ? xsltTask.parameters : [];
            let xsltParametersCommand: string[] = []
            for (const param of xsltParameters) {
                xsltParametersCommand.push(param.name + '=' + param.value);
            }
            let classPaths: string[] = [xsltTask.saxonJar];
            if (xsltTask.classPathEntries) {
                classPaths = classPaths.concat(xsltTask.classPathEntries);
            }

            for (const propName in xsltTask) {
                let propValue = this.getProp(xsltTask, propName);
                switch (propName) {
                    case 'xsltFile':
                        commandLineArgs.push('-xsl:' + propValue);
                        break
                    case 'xmlSource':
                        commandLineArgs.push('-s:' + propValue);
                        break;
                    case 'resultPath':
                        commandLineArgs.push('-o:' + propValue);
                        break
                    case 'initialTemplate':
                        commandLineArgs.push('-it:' + propValue);
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
                        commandLineArgs.push('-ea' + propValue);
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
                        commandLineArgs.push('-t');
                        break;
                }
            }


            let rawClassPathString = classPaths.join(pathSeparator());
            // this is overriden if problemMatcher is set in the tasks.json file      
            let problemMatcher = "$saxon-xslt";
            const javaArgs = ['-cp', rawClassPathString, 'net.sf.saxon.Transform'];
            const processExecution = new vscode.ProcessExecution('java', javaArgs.concat(commandLineArgs).concat(xsltParametersCommand));
            let newTask = new vscode.Task(xsltTask, xsltTask.label, source, processExecution, problemMatcher);
            return newTask;
        } else {
            return undefined;
        }
    }
}