import * as vscode from 'vscode';

export class XPathDocumentChangeHandler {
	public async onDocumentChange(e: vscode.TextDocumentChangeEvent) {
		let activeChange = e.contentChanges[0];
		if (!activeChange) {
			return;
		}
		let triggerSuggest = false;
		let skipTrigger = false;
		if (activeChange.text === '/' && activeChange.rangeLength === 0) {
			let prevChar = e.document.getText().charAt(activeChange.rangeOffset - 1);
			if (activeChange.text.endsWith('/')) {
				skipTrigger = true;
			} else {
				triggerSuggest = true;
			}
		}
		if (!skipTrigger && activeChange.rangeOffset > 10) {
			let prevChar = e.document.getText().charAt(activeChange.rangeOffset - 1);
			if ((prevChar === '\n' || prevChar === ' ') && activeChange.text === 'x') {
				triggerSuggest = true;
			} else if ((prevChar === '"' || prevChar === '(') && activeChange.text.length === 1 && ['[', '(', '{', '?', '"', '\''].indexOf(activeChange.text) === -1) {
				triggerSuggest = true;
			}
		}
		if (triggerSuggest || activeChange.text === ' ' || activeChange.text === '(' || activeChange.text === '[' || activeChange.text === '!' || activeChange.text === '$' || activeChange.text === '<') {
			setTimeout(() => {
				vscode.commands.executeCommand('editor.action.triggerSuggest');
			}, 10);
			return;
		}
	}
}