/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - saxonTaskProvider
 */
import * as vscode from 'vscode';
import { DocumentChangeHandler } from './documentChangeHandler';
import * as jsc from 'jsonc-parser';

interface XSLTJSTask {
    type: string;
    label: string;
    nodeModulesFolder?: string;
    xsltFile: string;
    xmlSource: string;
    useJsonSource?: boolean;
    resultPath: string;
    parameters?: XSLTParameter[];
    initialTemplate?: string;
    initialMode?: string;
    useWorkspace?: boolean;
    export?: string;
    group?: TaskGroup;
}

interface TaskGroup {
    kind: string;
}

interface XSLTParameter {
    name: string;
    value: string;
}

export class SaxonJsTaskProvider implements vscode.TaskProvider {
    static SaxonBuildScriptType: string = 'xslt-js';
    templateTaskLabel = 'Saxon-JS Transform (New)';
    templateTaskFound = false;


    constructor(private workspaceRoot: string) { }

    public async provideTasks(): Promise<vscode.Task[]> {
        const tasksObject = await SaxonJsTaskProvider.getTasksObject();
        return this.getTasks(tasksObject.tasks);
    }

    public resolveTask(_task: vscode.Task): vscode.Task | undefined {
        return this.getTask(_task.definition);
    }

    public static async getTasksObject() {
        let workspaceUri = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri : vscode.Uri.file('/');
        let workspaceTaskUri = workspaceUri.with({ path: workspaceUri.path + '/.vscode/tasks.json' }) ;
        let tasksObject = undefined;

        try {
            const doc = await vscode.workspace.openTextDocument(workspaceTaskUri);
            tasksObject = jsc.parse(doc.getText());
        } catch (e) {
            tasksObject = { tasks: [] };
        }
        return tasksObject;
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
		let xmlSourceValue = '${file}';
		let xsltFilePath = '${file}';
        let resultPathValue = '${workspaceFolder}/xslt-out/result1.xml';

        let xsltTask: XSLTJSTask = {
            type: 'xslt-js',
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

            let npxCommand = DocumentChangeHandler.isWindowsOS? 'npx.cmd' : 'npx';
            let commandLineArgs: string[] = ['xslt3'];

            let xsltParameters: XSLTParameter[] = xsltTask.parameters? xsltTask.parameters: [];
            let xsltParametersCommand: string[] = [];
            let useJSON = !!xsltTask.useJsonSource;
            for (const param of xsltParameters) {
                xsltParametersCommand.push(param.name + '=' + param.value);
            }
            
            for (const propName in xsltTask) {
                let propValue = this.getProp(xsltTask, propName);
                let propNameValue = '';
                switch (propName) {
                    case 'xsltFile': 
                        propNameValue = '-xsl:' + propValue;
                        break;
                    case 'xmlSource':
                        const prefix = useJSON? '-json:' : '-s:';
                        if (propValue !== "") {
                            propNameValue = prefix + propValue;
                        }
                        break;
                    case 'jsonSource':
                        propNameValue = '-json:' + propValue;
                        break;
                    case 'resultPath': 
                        propNameValue = '-o:' + propValue;
                        break;
                    case 'initialTemplate':
                        propNameValue = '-it:' + propValue;
                        break;
                    case 'initialMode': 
                        propNameValue = '-im:' + propValue;
                        break;
                    case 'export':
                        propNameValue = '-export:' + propValue;
                        // TODO: add '-nogo' to prevent attempted execution?
                        break;
                }
                if (propNameValue !== '') {
                    commandLineArgs.push(propNameValue);
                }
            }


            // this is overriden if problemMatcher is set in the tasks.json file      
            let problemMatcher = "$saxon-xslt-js";

            const processExecution = new vscode.ProcessExecution(npxCommand, commandLineArgs.concat(xsltParametersCommand));
            let newTask = new vscode.Task(xsltTask, xsltTask.label, source, processExecution, problemMatcher);

            //let newTask = new vscode.Task(xsltTask, xsltTask.label, source, new vscode.ShellExecution(commandline), problemMatcher);
            return newTask;
        } else {
            return undefined;
        }
        
    }
}