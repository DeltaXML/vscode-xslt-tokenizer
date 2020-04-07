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

interface XSLTTask {
    type: string,
    label: string,
    saxonJar: string,
    xsltFile: string,
    xmlSource: string,
    resultPath: string,
    parameters?: XSLTParameter[],
    initialTemplate?: string,
    initialMode?: string,
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

export class SaxonTaskProvider implements vscode.TaskProvider {
	static SaxonBuildScriptType: string = 'custombuildscript';
	private tasks: vscode.Task[] = [];

	constructor(private workspaceRoot: string) { }

	public async provideTasks(): Promise<vscode.Task[]> {
        let rootPath = vscode.workspace.rootPath? vscode.workspace.rootPath: '/';
        let tasksPath = path.join(rootPath, '.vscode', 'tasks.json');
        let tasksObject = undefined;
        if (await exists(tasksPath)) {
            delete require.cache[tasksPath];
            tasksObject = require(tasksPath);
        } else {
            tasksObject = {tasks: []};
        }

		return this.getTasks(tasksObject);
	}

	public resolveTask(_task: vscode.Task): vscode.Task | undefined {	
        return undefined;	
		//return this.getTask();
    }
    
    private getProp(obj: any, prop: string): string {
        return obj[prop];
    }

	private getTasks(tasksObject: TasksObject): vscode.Task[] {
        this.tasks = [];

		let newTaskLabel = 'Saxon Transform (New)';
		let saxonJarDefault = '${config:XSLT.tasks.saxonJar}'  //'/Users/philipf/Documents/github/SaxonHE10-0J/saxon-he-10.0.jar';
		let source = 'xslt';
		let xmlSourceValue = '${file}';
		let xsltFilePath = '${file}';
        let resultPathValue = '${workspaceFolder}/xslt-out/result1.xml';

        let tasks: GenericTask[] = tasksObject.tasks;
        let addNewTask = true;
        
        for (let i = 0; i < tasks.length + 1; i++) {
            let genericTask: GenericTask;
            if (i === tasks.length) {
                if (addNewTask) {
                    let xsltTask: XSLTTask = {
                        type: 'xslt',
                        saxonJar: saxonJarDefault,
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
            if (genericTask.type === 'xslt') {
                let xsltTask: XSLTTask = <XSLTTask> genericTask;
                if (xsltTask.label === 'xslt: ' + newTaskLabel || xsltTask.label === newTaskLabel) {
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
                    xsltParametersCommand.push(param.name + '=' + param.value);
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
                    }
                }

                if (xsltParametersCommand.length > 0) {
                    commandLineArgs.push(xsltParametersCommand.join(' '));
                }
                let resolvedCommandLine = commandLineArgs.join(' ');
                
                let problemMatcher = "$saxon-xslt";

                let commandline = `java -jar ${xsltTask.saxonJar} ${resolvedCommandLine}`;

                this.tasks.push(new vscode.Task(xsltTask, xsltTask.label, source, new vscode.ShellExecution(commandline), problemMatcher));
            }
        }

		return this.tasks;

	}
}