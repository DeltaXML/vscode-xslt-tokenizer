/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - saxonTaskProvider
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

function exists(file: string): Promise<boolean> {
	return new Promise<boolean>((resolve, _reject) => {
		fs.exists(file, (value) => {
			resolve(value);
		});
	});
}

interface TasksObject {
    tasks: GenericTask[]
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

interface GenericTask {
    type: string,
    group?: object
}

export class SaxonJsTaskProvider implements vscode.TaskProvider {
	static SaxonBuildScriptType: string = 'xslt-js';
	private tasks: vscode.Task[] = [];

	public async provideTasks(): Promise<vscode.Task[]> {
        let rootPath = vscode.workspace.rootPath? vscode.workspace.rootPath: '/';
        let tasksPath = path.join(rootPath, '.vscode', 'tasks.json');
        let tasksObject = undefined;

        if (await exists(tasksPath)) {
            const tasksText = fs.readFileSync(tasksPath).toString('utf-8');
            const taskLines = tasksText.split("\n");
            const jsonTaskLines: string[] = [];
            taskLines.forEach((taskLine) =>  {
                if (taskLine.trimLeft().startsWith('//')) {
                    // don't add comment
                } else {
                    jsonTaskLines.push(taskLine);
                }
            });
            const jsonString = jsonTaskLines.join('\n');
            tasksObject = JSON.parse(jsonString);

        } else {
            tasksObject = {tasks: []};
        }

		return this.getTasks(tasksObject);
	}

	public resolveTask(_task: vscode.Task): vscode.Task | undefined {	
        return undefined;	
    }
    
    private getProp(obj: any, prop: string): string {
        return obj[prop];
    }

	private getTasks(tasksObject: TasksObject): vscode.Task[] {
        this.tasks = [];

		let newTaskLabel = 'Saxon-JS Transform (New)';
		let nodeModulesDefault = '${workspaceFolder}/node_modules'
		let source = 'xslt-js';
		let xmlSourceValue = '${file}';
		let xsltFilePath = '${file}';
        let resultPathValue = '${workspaceFolder}/xslt-out/result1.xml';

        let tasks: GenericTask[] = tasksObject.tasks;
        let addNewTask = true;
        
        for (let i = 0; i < tasks.length + 1; i++) {
            let genericTask: GenericTask;
            if (i === tasks.length) {
                if (addNewTask) {
                    let xsltTask: XSLTJSTask = {
                        type: 'xslt-js',
                        nodeModulesFolder: nodeModulesDefault,
                        label: newTaskLabel,
                        xsltFile: xsltFilePath,
                        xmlSource: xmlSourceValue,
                        resultPath: resultPathValue
                    };
                    genericTask = xsltTask;
                } else {
                    genericTask = {type: 'ignore'};
                }
            } else {
                genericTask = tasks[i];
            }
            if (genericTask.type === 'xslt-js') {
                let xsltTask: XSLTJSTask = <XSLTJSTask> genericTask;
                if (xsltTask.label === 'xslt-js: ' + newTaskLabel || xsltTask.label === newTaskLabel) {
                    // do not add a new task if there's already a task with the 'new' task label
                    addNewTask = false;
                }
                xsltTask.group = {
                    kind: 'build'
                }

                let commandLineArgs: string[] = [];

                let xsltParameters: XSLTParameter[] = xsltTask.parameters? xsltTask.parameters: [];
                let xsltParametersCommand: string[] = []
                for (const param of xsltParameters) {
                    xsltParametersCommand.push('"' + param.name + '=' + param.value + '"');
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
                        case 'export':
                            commandLineArgs.push('-export:' + propValue);
                            break;
                    }
                }

                let nodeModulesPath = xsltTask.nodeModulesFolder + path.sep + '.bin' + path.sep;

                if (xsltParametersCommand.length > 0) {
                    commandLineArgs.push(xsltParametersCommand.join(' '));
                }

                let resolvedCommandLine = commandLineArgs.join(' ');         
                // this is overriden if problemMatcher is set in the tasks.json file      
                let problemMatcher = "$saxon-xslt-js";
                let commandline = `${nodeModulesPath}xslt3 ${resolvedCommandLine}`;
                let newTask = new vscode.Task(xsltTask, xsltTask.label, source, new vscode.ShellExecution(commandline), problemMatcher);
                this.tasks.push(newTask);
            }
        }

		return this.tasks;

	}
}