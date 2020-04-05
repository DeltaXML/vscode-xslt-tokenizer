/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';


interface CustomBuildTaskDefinition extends vscode.TaskDefinition {
	/**
	 * The build flavor. Should be either '32' or '64'.
	 */
	flavor: string;

	/**
	 * Additional build flags
	 */
	flags?: string[];
}

function exists(file: string): Promise<boolean> {
	return new Promise<boolean>((resolve, _reject) => {
		fs.exists(file, (value) => {
			resolve(value);
		});
	});
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
            tasksObject = require(tasksPath);
        }

		this.tasks = [];
		return this.getTasks();
	}

	public resolveTask(_task: vscode.Task): vscode.Task | undefined {		
		return this.getTask();
	}

	private getTasks(): vscode.Task[] {
		this.tasks.push(this.getTask());
		return this.tasks;
	}

	private getTask(): vscode.Task {

		let taskName = 'Saxon Transform';
		let saxonJar = '/Users/philipf/Documents/github/SaxonHE10-0J/saxon-he-10.0.jar';
		let source = 'xslt';
		let xmlSourceValue = '${file}';
		let xsltFilePath = '${file}';
		let resultPathValue = 'saxon-result.xml';

		let kind: vscode.TaskDefinition = {
			type: 'xslt',
			label: 'saxon',
			xsltFile: xsltFilePath,
			xmlSource: xmlSourceValue,
			resultPath: resultPathValue,
            task: taskName,
            group: {
                kind: 'build'
            }
		};
		let problemMatcher = "$saxon-xslt";

		let commandline = `java -jar ${saxonJar} -xsl:${xsltFilePath} -s:${xmlSourceValue} -o:${resultPathValue}`;

		return new vscode.Task(kind, taskName, source, new vscode.ShellExecution(commandline), problemMatcher);

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