import { TLSSocket } from 'tls';
import * as vscode from 'vscode';
import { CodeActionTextLine } from './codeActionTextLine';

export class CodeActionDocument implements vscode.TextDocument {
    uri: vscode.Uri;
    fileName: string;
    isUntitled: boolean = true;
    languageId: string = "xslt";
    version: number = 1;
    isDirty: boolean = false;
    isClosed: boolean = false;
    private static wsRegex = new RegExp(/(^\s+)/);
    docText: string;
    private textLines: string[];

    constructor(uri: vscode.Uri, text: string) {
        this.docText = text;
        this.uri = uri;
        this.fileName = uri.fsPath;
        this.textLines = text.split('\n');
    }

    save(): Thenable<boolean> {
        throw new Error('Method not implemented.');
    }
    eol: vscode.EndOfLine = vscode.EndOfLine.LF;
    lineCount: number = 1;
    lineAt(line: number): vscode.TextLine;
    lineAt(position: vscode.Position): vscode.TextLine;
    lineAt(line: any): vscode.TextLine {
        if (line.line) {
            throw new Error('Method not implemented.');
        } else {
            const lineNum = <number> line;
            return this.getLineData(lineNum);
        }
    }
    offsetAt(position: vscode.Position): number {
        throw new Error('Method not implemented.');
    }
    positionAt(offset: number): vscode.Position {
        throw new Error('Method not implemented.');
    }
    getText(range?: vscode.Range | undefined): string {
        if (range) {
            const lineText = this.textLines[range.start.line];
            return lineText.substring(range.start.character, range.end.character);
        } else {
            return this.docText;
        }
    }
    getWordRangeAtPosition(position: vscode.Position, regex?: RegExp | undefined): vscode.Range | undefined {
        throw new Error('Method not implemented.');
    }
    validateRange(range: vscode.Range): vscode.Range {
        throw new Error('Method not implemented.');
    }
    validatePosition(position: vscode.Position): vscode.Position {
        throw new Error('Method not implemented.');
    }

    private getLineData(findLine: number) {
        const lineText = this.textLines[findLine];
        const wsLeadMatches = lineText.match(CodeActionDocument.wsRegex);
        let nonSpaceNum = 0;
        if (wsLeadMatches) {
            nonSpaceNum = wsLeadMatches[0].length;
        }
        return new CodeActionTextLine(lineText, nonSpaceNum);
    }

}