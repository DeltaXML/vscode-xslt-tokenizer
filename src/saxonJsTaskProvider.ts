/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - saxonTaskProvider
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SaxonTaskProvider } from './saxonTaskProvider';

function exists(file: string): Promise<boolean> {
    return new Promise<boolean>((resolve, _reject) => {
        fs.exists(file, (value) => {
            resolve(value);
        });
    });
}

interface XSLTJSTask {
    type: string,
    label: string,
    nodeModulesFolder: string,
    xsltFile: string,
    xmlSource: string,
    resultPath: string,
    parameters?: XSLTParameter[],
    initialTemplate?: string,
    initialMode?: string,
    useWorkspace?: boolean,
    export?: string,
    group?: TaskGroup
}

interface TaskGroup {
    kind: string
}

interface XSLTParameter {
    name: string,
    value: string
}

export class SaxonJsTaskProvider implements vscode.TaskProvider {
    static SaxonBuildScriptType: string = 'xslt-js';
    templateTaskLabel = 'Saxon-JS Transform (New)';
    templateTaskFound = false;


    constructor(private workspaceRoot: string) { }

    public async provideTasks(): Promise<vscode.Task[]> {
        let rootPath = vscode.workspace.rootPath ? vscode.workspace.rootPath : '/';
        let tasksPath = path.join(rootPath, '.vscode', 'tasks.json');
        let tasksObject = undefined;

        if (await exists(tasksPath)) {
            const tasksText = fs.readFileSync(tasksPath).toString('utf-8');
            const commaFixedTasksText1 = tasksText.replace(/,\s*}/, '}');
            const commaFixedTasksText2 = commaFixedTasksText1.replace(/,\s*\]/, ']');

            const taskLines = commaFixedTasksText2.split("\n");
            const jsonTaskLines: string[] = [];
            taskLines.forEach((taskLine) => {
                if (taskLine.trimLeft().startsWith('//')) {
                    // don't add comment
                } else {
                    jsonTaskLines.push(taskLine);
                }
            });
            const jsonString = jsonTaskLines.join('\n');
            console.log(jsonString);

            tasksObject = JSON.parse(jsonString);

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

    private getTasks(tasks: XSLTJSTask[]) {
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
		let nodeModulesDefault = '${workspaceFolder}/node_modules'
		let xmlSourceValue = '${file}';
		let xsltFilePath = '${file}';
        let resultPathValue = '${workspaceFolder}/xslt-out/result1.xml';

        let xsltTask: XSLTJSTask = {
            type: 'xslt-js',
            nodeModulesFolder: nodeModulesDefault,
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

        let source = 'xslt-js';

        if (genericTask.type === 'xslt-js') {
            let xsltTask: XSLTJSTask = <XSLTJSTask> genericTask;
            if (xsltTask.label === 'xslt-js: ' + this.templateTaskLabel) {
                this.templateTaskFound = true;
            }

            let commandLineArgs: string[] = [];

            let xsltParameters: XSLTParameter[] = xsltTask.parameters? xsltTask.parameters: [];
            let xsltParametersCommand: string[] = []
            for (const param of xsltParameters) {
                xsltParametersCommand.push(param.name + '=' + param.value);
            }
            
            for (const propName in xsltTask) {
                let propValue = this.getProp(xsltTask, propName);
                let propNameValue = '';
                switch (propName) {
                    case 'xsltFile': 
                        propNameValue = '-xsl:' + propValue;
                        break
                    case 'xmlSource':
                        propNameValue = '-s:' + propValue;
                        break;
                    case 'resultPath': 
                        propNameValue = '-o:' + propValue;
                        break
                    case 'initialTemplate':
                        propNameValue = '-it:' + propValue;
                        break;
                    case 'initialMode': 
                        propNameValue = '-im:' + propValue;
                        break;
                    case 'export':
                        propNameValue = '-export:' + propValue;
                        break;
                }
                if (propNameValue !== '') {
                    commandLineArgs.push(propNameValue);
                }
            }

            let nodeModulesPath = xsltTask.nodeModulesFolder + path.sep + '.bin' + path.sep;

            // this is overriden if problemMatcher is set in the tasks.json file      
            let problemMatcher = "$saxon-xslt-js";

            const processExecution = new vscode.ProcessExecution(nodeModulesPath + 'xslt3', commandLineArgs.concat(xsltParametersCommand));
            let newTask = new vscode.Task(xsltTask, xsltTask.label, source, processExecution, problemMatcher);

            //let newTask = new vscode.Task(xsltTask, xsltTask.label, source, new vscode.ShellExecution(commandline), problemMatcher);
            return newTask;
        } else {
            return undefined;
        }
        
    }
}