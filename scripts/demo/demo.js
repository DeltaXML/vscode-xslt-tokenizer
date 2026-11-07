// Scripted demos of the XSLT/XPath extension, for recording videos: each step shows a caption, does what a user would
// do - opening files, typing, running commands - and waits for the result, e.g. the debugger pausing, so every take
// is the same. Run with the 'Demo: Record Videos' launch configuration, which opens scripts/demo/workspace - a folder of
// its own, not committed, refilled for each take with copies of the sample files - start recording, then run
// 'Demo: Play Video 1: Run and Debug a Stylesheet' from the Command Palette.
// Not part of the published extension (scripts/** is in .vscodeignore).
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// pacing, in milliseconds - change these to make a take faster or slower
const PACE = {
	afterCaption: 1200,   // reading time for a caption before its action
	short: 1500,
	medium: 2500,
	long: 4000,
	typingDelay: 45,      // between typed characters
	countdown: 3          // seconds, before the first step
};
const SHOW_CAPTIONS = true;
// for a quick check that every step works, e.g. in a test: XSLT_DEMO_FAST=1
if (process.env.XSLT_DEMO_FAST) {
	Object.keys(PACE).forEach((key) => PACE[key] = key === 'countdown' ? 0 : Math.ceil(PACE[key] / 20));
}

let stopRequested = false;
let stoppedEmitter = new vscode.EventEmitter();

class DemoStopped extends Error { }

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pause(ms) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (stopRequested) {
			throw new DemoStopped();
		}
		await sleep(Math.min(100, end - Date.now()));
	}
}

// The captions: a view of their own - Demo › Captions - with large text, which can be moved to the secondary side bar,
// on the right, where it stays while the Explorer and Run and Debug views change on the left. Not notifications, which
// would be mixed up with the extension's own
class CaptionView {
	constructor() {
		this.view = undefined;
		this.state = { text: '', step: '' };
	}

	resolveWebviewView(webviewView) {
		this.view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = CaptionView.html();
		webviewView.onDidDispose(() => this.view = undefined);
		// as it's shown again, e.g. after being moved
		webviewView.onDidChangeVisibility(() => this.post());
		this.post();
	}

	show(text, step = '') {
		this.state = { text, step };
		this.post();
	}

	post() {
		this.view?.webview.postMessage(this.state);
	}

	static html() {
		const nonce = Math.random().toString(36).slice(2);
		return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
	body { padding: 18px 14px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
	#step { font-size: 13px; opacity: 0.6; letter-spacing: 0.04em; text-transform: uppercase; min-height: 1.2em; }
	#text { font-size: 22px; line-height: 1.35; margin-top: 8px; font-weight: 500; transition: opacity 0.35s ease; }
	#text.fresh { opacity: 0; }
</style></head>
<body><div id="step"></div><div id="text"></div>
<script nonce="${nonce}">
	const step = document.getElementById('step');
	const text = document.getElementById('text');
	window.addEventListener('message', (event) => {
		const changed = text.textContent !== event.data.text;
		step.textContent = event.data.step;
		text.textContent = event.data.text;
		if (changed) {
			text.classList.add('fresh');
			requestAnimationFrame(() => requestAnimationFrame(() => text.classList.remove('fresh')));
		}
	});
</script></body></html>`;
	}
}

const captions = new CaptionView();
let captionCount = 0;

async function showCaptionView() {
	await vscode.commands.executeCommand('xsltDemo.captions.focus').then(undefined, () => undefined);
}

async function caption(text) {
	if (stopRequested) {
		throw new DemoStopped();
	}
	console.log(`[demo] ${text}`);
	if (SHOW_CAPTIONS) {
		captions.show(text, `Step ${++captionCount}`);
	}
	await pause(PACE.afterCaption);
}

async function clearCaptions() {
	captions.show('');
}

function folder() {
	const workspace = vscode.workspace.workspaceFolders?.[0];
	if (!workspace) {
		throw new Error('Open the demo folder first - use the "Demo: Record Videos" launch configuration');
	}
	return workspace.uri.fsPath;
}

async function open(fileName, column = vscode.ViewColumn.One) {
	const document = await vscode.workspace.openTextDocument(path.join(folder(), fileName));
	return vscode.window.showTextDocument(document, { viewColumn: column, preview: false });
}

// the line of the first occurrence of the text, from 0
function lineOf(document, text) {
	const offset = document.getText().indexOf(text);
	if (offset < 0) {
		throw new Error(`"${text}" isn't in ${path.basename(document.fileName)}`);
	}
	return document.positionAt(offset).line;
}

function reveal(editor, line) {
	const position = new vscode.Position(line, 0);
	editor.selection = new vscode.Selection(position, position);
	editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

// types the text at the cursor, a character at a time - as edits, so the editor's auto-closing doesn't add to it
async function type(editor, text) {
	for (const char of text) {
		if (stopRequested) {
			throw new DemoStopped();
		}
		const at = editor.selection.active;
		await editor.edit((edit) => edit.insert(at, char), { undoStopBefore: false, undoStopAfter: false });
		await sleep(PACE.typingDelay);
	}
}

// waits for the event, or the time limit - the demo goes on either way
function eventOrTimeout(event, ms, filter = () => true) {
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			listener.dispose();
			resolve(false);
		}, ms);
		const listener = event((value) => {
			if (filter(value)) {
				clearTimeout(timer);
				listener.dispose();
				resolve(true);
			}
		});
	});
}

// the result file: the extension offers those used before - the first, as chosen once by hand in the demo's folder (a
// first run, with none used before, opens the save dialog instead, which a script can't use)
async function acceptResultFile() {
	await pause(PACE.medium);
	await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
}

async function quickRun() {
	const ended = eventOrTimeout(vscode.tasks.onDidEndTaskProcess, 30000);
	vscode.commands.executeCommand('xslt-xpath.quickRunXsltSaxonJ');
	await acceptResultFile();
	await ended;
}

function removeBreakpoints(fsPath) {
	const inFile = vscode.debug.breakpoints.filter((bp) => bp instanceof vscode.SourceBreakpoint && bp.location.uri.fsPath === fsPath);
	vscode.debug.removeBreakpoints(inFile);
}

// the sample files each video uses, copied into the demo's folder for each take
const SAMPLES = path.join(__dirname, '..', '..', 'sample');
const VIDEO1_FILES = ['debug-xpath.xsl', 'orders.xml'].map((name) => path.join(SAMPLES, 'debugger-demo', name));

// the demo's starting point, for each take: no editors open, fresh copies of the sample files in the demo's own folder -
// never the committed samples - and no .vscode/tasks.json or breakpoints there
async function reset(quiet = false) {
	if (path.resolve(folder()) !== path.resolve(__dirname, 'workspace')) {
		throw new Error('The demo runs in scripts/demo/workspace - use the "Demo: Record Videos" launch configuration');
	}
	await vscode.commands.executeCommand('workbench.action.debug.stop').then(undefined, () => undefined);
	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	await clearCaptions();
	fs.rmSync(path.join(folder(), '.vscode'), { recursive: true, force: true });
	VIDEO1_FILES.forEach((file) => fs.copyFileSync(file, path.join(folder(), path.basename(file))));
	VIDEO1_FILES.forEach((file) => removeBreakpoints(path.join(folder(), path.basename(file))));
	await vscode.commands.executeCommand('workbench.view.explorer');
	captionCount = 0;
	if (!quiet) {
		await showCaptionView();
		captions.show('Ready for a take: start recording, then play the video');
	}
}

async function countdown() {
	await showCaptionView();
	for (let n = PACE.countdown; n > 0; n--) {
		captions.show(`Starting in ${n}…`);
		await pause(1000);
	}
	await clearCaptions();
}

// Video 1: run and debug a stylesheet with its XML context file - without any set-up, then with the Quick Run task
async function video1() {
	await reset(true);
	await countdown();

	await caption('Open an XML file: it becomes the XML context file');
	await open('orders.xml');
	await pause(PACE.medium);

	await caption('Open a stylesheet, and click ▶ Quick Run: no tasks.json, no setup');
	let stylesheet = await open('debug-xpath.xsl');
	await pause(PACE.short);
	await quickRun();
	await pause(PACE.long);

	await caption('Debug it the same way - with any SaxonJ edition, including Saxon-HE');
	stylesheet = await open('debug-xpath.xsl');
	const totalLine = lineOf(stylesheet.document, '<xsl:variable name="total"');
	reveal(stylesheet, totalLine);
	await pause(PACE.short);
	vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(stylesheet.document.uri, new vscode.Position(totalLine, 0)))]);
	await pause(PACE.short);
	const paused = eventOrTimeout(stoppedEmitter.event, 30000);
	const ended = eventOrTimeout(vscode.debug.onDidTerminateDebugSession, 60000);
	vscode.commands.executeCommand('xslt-xpath.debugXslt');
	await acceptResultFile();
	await paused;
	await pause(PACE.short);

	await caption('Paused at the breakpoint: the context item, variables and parameters');
	await vscode.commands.executeCommand('workbench.debug.action.focusVariablesView').then(undefined, () => undefined);
	await pause(PACE.long);
	await vscode.commands.executeCommand('workbench.action.debug.continue');
	await ended;
	removeBreakpoints(stylesheet.document.uri.fsPath);
	await vscode.commands.executeCommand('workbench.view.explorer');
	await pause(PACE.short);

	await caption('Need parameters or options? Edit the Quick Run task - Quick Run and the debugger both use it');
	await open('debug-xpath.xsl');
	await pause(PACE.short);
	const tasksOpened = eventOrTimeout(vscode.window.onDidChangeActiveTextEditor, 15000, (editor) => !!editor && editor.document.fileName.endsWith('tasks.json'));
	await vscode.commands.executeCommand('xslt-xpath.editQuickRunTaskSaxonJ');
	await tasksOpened;
	await pause(PACE.short);
	const tasksEditor = vscode.window.activeTextEditor;
	if (tasksEditor && tasksEditor.document.fileName.endsWith('tasks.json')) {
		// a parameter for the task: after its label
		const text = tasksEditor.document.getText();
		const xsltFileOffset = text.indexOf('debug-xpath.xsl');
		const taskStart = text.lastIndexOf('{', text.lastIndexOf('"label"', xsltFileOffset));
		const labelOffset = text.indexOf('"label"', taskStart);
		const labelLine = tasksEditor.document.positionAt(labelOffset).line;
		const indent = tasksEditor.document.lineAt(labelLine).text.match(/^\s*/)[0];
		const end = tasksEditor.document.lineAt(labelLine).range.end;
		tasksEditor.selection = new vscode.Selection(end, end);
		tasksEditor.revealRange(new vscode.Range(end, end), vscode.TextEditorRevealType.InCenter);
		await pause(PACE.short);
		// '?': the value is an XPath expression, so it's a number
		await type(tasksEditor, `\n${indent}"parameters": [\n${indent}\t{ "name": "?discount-threshold", "value": "50" }\n${indent}],`);
		await pause(PACE.short);
		await tasksEditor.document.save();
	}
	await pause(PACE.short);

	await caption('Run again: the task is used - here, with a higher discount threshold');
	await open('debug-xpath.xsl');
	await pause(PACE.short);
	await quickRun();
	await pause(PACE.long);

	await caption('Run and debug any stylesheet - no setup needed');
	await pause(PACE.long);
	await clearCaptions();
}

async function play(video, rethrow = false) {
	stopRequested = false;
	try {
		await video();
	} catch (e) {
		captions.show(e instanceof DemoStopped ? 'Stopped' : `Stopped: ${e instanceof Error ? e.message : e}`);
		if (!(e instanceof DemoStopped)) {
			vscode.window.showErrorMessage(`Demo: ${e instanceof Error ? e.message : e}`);
			if (rethrow) {
				throw e;
			}
		}
	}
}

function activate(context) {
	stoppedEmitter = new vscode.EventEmitter();
	context.subscriptions.push(stoppedEmitter);
	// the debugger pausing, e.g. at a breakpoint
	context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('xslt-saxon', {
		createDebugAdapterTracker: () => ({
			onDidSendMessage: (message) => {
				if (message.type === 'event' && message.event === 'stopped') {
					stoppedEmitter.fire(message);
				}
			}
		})
	}));
	context.subscriptions.push(vscode.window.registerWebviewViewProvider('xsltDemo.captions', captions, { webviewOptions: { retainContextWhenHidden: true } }));
	context.subscriptions.push(vscode.commands.registerCommand('xsltDemo.playVideo1', () => play(video1)));
	context.subscriptions.push(vscode.commands.registerCommand('xsltDemo.stop', () => { stopRequested = true; }));
	context.subscriptions.push(vscode.commands.registerCommand('xsltDemo.reset', () => reset()));
}

function deactivate() { }

module.exports = { activate, deactivate, video1, reset, play };
