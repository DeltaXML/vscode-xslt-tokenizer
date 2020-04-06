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
    xsltFile: string,
    xmlSource: string,
    resultPath: string
}

interface GenericTask {
    type: string
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

	private getTasks(tasksObject: TasksObject): vscode.Task[] {
        this.tasks = [];

		let taskLabel = 'Saxon Transform';
		let saxonJar = '/Users/philipf/Documents/github/SaxonHE10-0J/saxon-he-10.0.jar';
		let source = 'xslt';
		let xmlSourceValue = '${file}';
		let xsltFilePath = '${file}';
        let resultPathValue = 'saxon-result.xml';

        let tasks: GenericTask[] = tasksObject.tasks;
        
        if (tasks.length > 0) {
            tasks.forEach((value, index) => {
                if (value.type === 'xslt') {
                    let xsltTask: XSLTTask = <XSLTTask>value;
                    // skip 'xslt: ' prefix added internally
                    taskLabel = xsltTask.label;
                    //saxonJar = xsltTask.
                    xmlSourceValue = xsltTask.xmlSource;
                    xsltFilePath = xsltTask.xsltFile;
                    resultPathValue = xsltTask.resultPath;                    
                    
                    let kind: vscode.TaskDefinition = {
                        type: 'xslt',
                        label: taskLabel,
                        xsltFile: xsltFilePath,
                        xmlSource: xmlSourceValue,
                        resultPath: resultPathValue,
                        group: {
                            kind: 'build'
                        }
                    };
                    let problemMatcher = "$saxon-xslt";

                    let commandline = `java -jar ${saxonJar} -xsl:${xsltFilePath} -s:${xmlSourceValue} -o:${resultPathValue}`;

                    this.tasks.push(new vscode.Task(kind, taskLabel, source, new vscode.ShellExecution(commandline), problemMatcher));
                }
            });
        } else {
            let kind: vscode.TaskDefinition = {
                type: 'xslt',
                label: taskLabel,
                xsltFile: xsltFilePath,
                xmlSource: xmlSourceValue,
                resultPath: resultPathValue,
                group: {
                    kind: 'build'
                }
            };
            let problemMatcher = "$saxon-xslt";
    
            let commandline = `java -jar ${saxonJar} -xsl:${xsltFilePath} -s:${xmlSourceValue} -o:${resultPathValue}`;

            this.tasks.push(new vscode.Task(kind, taskLabel, source, new vscode.ShellExecution(commandline), problemMatcher));

        }

		return this.tasks;

	}

	/*
{
    // See https://go.microsoft.com/fwlink/?LinkId=733558
    // for the documentation about the tasks.json format
    "version": "2.0.0",
    "tasks": [
        {
            "label": "saxon-xslt",
            "type": "shell",
            "command": "java",
            "args": [
                "-jar",
                "/Users/philipf/Documents/github/SaxonHE10-0J/saxon-he-10.0.jar",
                "-xsl:${file}",
                "-s:${file}",
                "-o:${workspaceFolder}/saxon.xslt.result.xml"
            ],
            "problemMatcher": {
                "owner": "xslt",
                "fileLocation": ["relative", "${file}/.."],
                "pattern": [
                  {
                    "regexp": "^(Error|Warning|Info)\\s+(?:on|at|near\\s+.*.*)(?:\\s+)?([^\\s]*)(?:\\s+on)?\\s+line\\s+(\\d+)\\s+column\\s+(\\d+)\\s+of\\s+([^:]*)",
                    "line": 3,
                    "column": 4,
                    "severity": 1,
                    "file": 5
                  },
                  {
                      "regexp": "^\\s+(\\w{4}\\d{4})\\s+(.*)",
                      "code": 1,
                      "message": 2
                  }
                ]
            },
            "group": {
                "kind": "build",
                "isDefault": true
            },
            "presentation": {
                "echo": true,
                "reveal": "always",
                "focus": false,
                "panel": "dedicated",
                "showReuseMessage": true,
                "clear": true
            }
        }
    ]
}
	*/

}