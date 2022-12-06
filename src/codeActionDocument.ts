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
    private static wsRegex = new RegExp(/\s/);
    docText: string;

    constructor(uri: vscode.Uri, text: string) {
        this.docText = text;
        this.uri = uri;
        this.fileName = uri.fsPath;
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
        return this.docText;
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
        const text = this.docText;
        const len = text.length;
        let charNum = 0;
        let lineNum = 0;
        let lineStartChar = -1;
        let lineEndChar = -1;
        let lineText = "";
        let nonSpaceNum = 0;
        while (charNum < len && lineEndChar < 0) {
            const char = text.charAt(charNum);
            if (lineStartChar < 0 && lineNum === findLine) {
                lineStartChar = charNum;
            } 
            if (char === '\n') {
                if (lineStartChar > -1) {
                    lineEndChar = charNum;
                }
                lineNum++;
            } else if (lineStartChar > -1) {
                if (CodeActionDocument.wsRegex.test(char)) {
                    nonSpaceNum++;
                }
                lineText += char;
            }
            charNum++;
        }
        return new CodeActionTextLine(lineText, nonSpaceNum);

    }

}