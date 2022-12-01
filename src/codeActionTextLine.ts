import * as vscode from 'vscode';

export class CodeActionTextLine implements vscode.TextLine {
    lineNumber: number = 1;
    text: string;
    range: vscode.Range;
    rangeIncludingLineBreak: vscode.Range;
    firstNonWhitespaceCharacterIndex: number = 1;
    isEmptyOrWhitespace: boolean = false;

    constructor(text: string, leadingSpaces: number) {
        this.text = text;
        let startPos = new vscode.Position(0,0);
		let endPos = new vscode.Position(0,0);
        let lineRange = new vscode.Range(startPos, endPos);
        this.range = lineRange;
        this.rangeIncludingLineBreak = lineRange;
        this.firstNonWhitespaceCharacterIndex = leadingSpaces;
    }

}