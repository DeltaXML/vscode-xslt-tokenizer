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
		this.state = { text: '', step: '', note: '' };
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
		this.state = { text, step, note: '' };
		this.post();
	}

	// a second line, under the caption - e.g. what to do in a prompt that's shown - '' to remove it
	note(note) {
		this.state = { ...this.state, note };
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
	#note { font-size: 17px; line-height: 1.35; margin-top: 14px; opacity: 0.8; font-style: italic; }
</style></head>
<body><div id="step"></div><div id="text"></div><div id="note"></div>
<script nonce="${nonce}">
	const step = document.getElementById('step');
	const text = document.getElementById('text');
	const note = document.getElementById('note');
	window.addEventListener('message', (event) => {
		const changed = text.textContent !== event.data.text;
		step.textContent = event.data.step;
		note.textContent = event.data.note || '';
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

// what the demo is doing, e.g. what it's waiting for: in the Demo output channel - and the Debug Console of the window
// the demo was launched from - to see where a take was held up
let output;
let lastStopped;

function log(message) {
	console.log(`[demo] ${message}`);
	output?.appendLine(`${new Date().toISOString().substring(11, 19)} ${message}`);
}

// the debugger pausing: the debug adapter's stopped event, or VS Code's active stack frame changing - the first
function debuggerPaused(ms) {
	return Promise.race([
		eventOrTimeout(stoppedEmitter.event, ms),
		eventOrTimeout(vscode.debug.onDidChangeActiveStackItem, ms, (item) => !!item && item instanceof vscode.DebugStackFrame)
	]);
}

// as the Continue button - and the debug adapter's continue request too, for the thread that stopped, in case the
// command isn't run, e.g. as the focus is elsewhere
async function continueDebugging() {
	log('continuing');
	await vscode.commands.executeCommand('workbench.action.debug.continue').then(undefined, (e) => log(`Continue command: ${e}`));
	const session = vscode.debug.activeDebugSession;
	if (session) {
		await session.customRequest('continue', { threadId: lastStopped?.body?.threadId ?? 1 }).then(undefined, (e) => log(`continue request: ${e}`));
	}
}

async function caption(text) {
	if (stopRequested) {
		throw new DemoStopped();
	}
	log(`caption: ${text}`);
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

// the line of the first occurrence of the text, from 0 - not in a comment, e.g. a sample's notes on where to put a
// breakpoint (the comment is blanked, keeping the offsets)
function lineOf(document, text) {
	const offset = document.getText().replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' ')).indexOf(text);
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
// - accepted until the run starts, as the list may take a moment to appear: Enter does nothing until it's there
async function acceptResultFile(started) {
	let isStarted = false;
	started.then(() => isStarted = true);
	// time to see the list
	await pause(PACE.medium);
	const end = Date.now() + 20000;
	while (!isStarted && Date.now() < end) {
		await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
		await pause(700);
	}
	log(isStarted ? 'started' : 'didn\'t start in time - going on');
}

async function quickRun() {
	const started = eventOrTimeout(vscode.tasks.onDidStartTaskProcess, 30000);
	const ended = eventOrTimeout(vscode.tasks.onDidEndTaskProcess, 30000);
	log('Quick Run: waiting for the result file list, then the run to start');
	vscode.commands.executeCommand('xslt-xpath.quickRunXsltSaxonJ');
	await acceptResultFile(started);
	log(await ended ? 'Quick Run ended' : 'Quick Run didn\'t end in time - going on');
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
	if (path.basename(folder()) !== 'xslt-demo' && path.resolve(folder()) !== path.resolve(__dirname, 'workspace')) {
		throw new Error('The demo runs in /Users/Shared/xslt-demo - use the "Demo: Record Videos" launch configuration');
	}
	await vscode.commands.executeCommand('workbench.action.debug.stop').then(undefined, () => undefined);
	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	await clearCaptions();
	fs.rmSync(path.join(folder(), '.vscode'), { recursive: true, force: true });
	VIDEO1_FILES.forEach((file) => fs.copyFileSync(file, path.join(folder(), path.basename(file))));
	VIDEO1_FILES.forEach((file) => removeBreakpoints(path.join(folder(), path.basename(file))));
	await vscode.commands.executeCommand('workbench.view.explorer');
	captionCount = 0;
	// step mode's steps too: Start ... in Step Mode loads them again
	stepMode = { steps: [], next: 0, busy: false };
	updateStepStatus();
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

	await caption('Open a stylesheet, and click ▶ Quick Run');
	let stylesheet = await open('debug-xpath.xsl');
	await pause(PACE.short);
	await quickRun();
	await pause(PACE.long);

	await caption('Set a breakpoint, then click the Debug button');
	stylesheet = await open('debug-xpath.xsl');
	const totalLine = lineOf(stylesheet.document, '<xsl:variable name="total"');
	reveal(stylesheet, totalLine);
	await pause(PACE.short);
	vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(stylesheet.document.uri, new vscode.Position(totalLine, 0)))]);
	await pause(PACE.short);
	const paused = debuggerPaused(30000);
	const ended = eventOrTimeout(vscode.debug.onDidTerminateDebugSession, 60000);
	const debugStarted = eventOrTimeout(vscode.debug.onDidStartDebugSession, 30000);
	log('Debug: waiting for the result file list, then the session to start');
	vscode.commands.executeCommand('xslt-xpath.debugXslt');
	await acceptResultFile(debugStarted);
	log('waiting for the debugger to pause');
	log(await paused ? 'the debugger paused' : 'the debugger didn\'t pause in time - going on');
	await pause(PACE.short);

	await caption('Paused at the breakpoint: the context item, variables and parameters');
	await vscode.commands.executeCommand('workbench.debug.action.focusVariablesView').then(undefined, () => undefined);
	await pause(PACE.long);
	// the template runs for each order: without the breakpoint, the run goes on to the end
	removeBreakpoints(stylesheet.document.uri.fsPath);
	await pause(PACE.short);
	await continueDebugging();
	log('waiting for the debug session to end');
	log(await ended ? 'the debug session ended' : 'the debug session didn\'t end in time - going on');
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

// Step mode: each press of the Next Step key (ctrl+alt+N) shows the next step's caption and does its action - so the
// pace is the presenter's, with nothing to time, and no step can be missed. The result file list is left to the
// presenter. A step's caption and action, for video 1:
function video1Steps() {
	let stylesheet;
	return [
		{
			caption: 'Open an XML file: it becomes the XML context file',
			action: async () => { await open('orders.xml'); }
		},
		{
			caption: 'Open a stylesheet',
			action: async () => { stylesheet = await open('debug-xpath.xsl'); }
		},
		{
			caption: 'Click ▶ Quick Run: no tasks.json, no setup',
			action: async () => { quickRunWithNote(); }
		},
		{
			caption: 'Set a breakpoint, then click Debug - the button beside ▶ Quick Run - with any SaxonJ edition, including Saxon-HE',
			action: async () => {
				stylesheet = await open('debug-xpath.xsl');
				const totalLine = lineOf(stylesheet.document, '<xsl:variable name="total"');
				reveal(stylesheet, totalLine);
				vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(stylesheet.document.uri, new vscode.Position(totalLine, 0)))]);
				await sleep(800);
				debugWithNote();
			}
		},
		{
			caption: 'Paused at the breakpoint: the context item, variables and parameters',
			action: async () => { await vscode.commands.executeCommand('workbench.debug.action.focusVariablesView').then(undefined, () => undefined); }
		},
		{
			caption: 'Continue to the end',
			action: async () => {
				// the template runs for each order: without the breakpoint, the run goes on to the end
				removeBreakpoints(stylesheet.document.uri.fsPath);
				await continueDebugging();
			}
		},
		{
			caption: 'Need parameters or options? Edit the Quick Run task - Quick Run and the debugger both use it',
			action: async () => {
				await vscode.commands.executeCommand('workbench.view.explorer');
				await open('debug-xpath.xsl');
				const tasksOpened = eventOrTimeout(vscode.window.onDidChangeActiveTextEditor, 15000, (editor) => !!editor && editor.document.fileName.endsWith('tasks.json'));
				await vscode.commands.executeCommand('xslt-xpath.editQuickRunTaskSaxonJ');
				await tasksOpened;
				await typeTaskParameter();
			}
		},
		{
			caption: 'Run again: the task is used - here, with a higher discount threshold',
			action: async () => {
				await open('debug-xpath.xsl');
				quickRunWithNote();
			}
		},
		{
			caption: 'Run and debug any stylesheet - no setup needed',
			action: async () => { }
		}
	];
}

// while the result file list is shown, a note on what to do with it - until the run starts
const RESULT_FILE_NOTE = 'Pick a result file location, or press Enter to use the previous result file';

function noteUntil(started) {
	captions.note(RESULT_FILE_NOTE);
	started.then(() => captions.note(''));
}

function quickRunWithNote() {
	noteUntil(eventOrTimeout(vscode.tasks.onDidStartTaskProcess, 120000));
	vscode.commands.executeCommand('xslt-xpath.quickRunXsltSaxonJ');
}

function debugWithNote() {
	noteUntil(eventOrTimeout(vscode.debug.onDidStartDebugSession, 120000));
	vscode.commands.executeCommand('xslt-xpath.debugXslt');
}

// the parameter typed into the Quick Run task in tasks.json, in the active editor: after the task's label
async function typeTaskParameter() {
	const tasksEditor = vscode.window.activeTextEditor;
	if (!tasksEditor || !tasksEditor.document.fileName.endsWith('tasks.json')) {
		log('tasks.json isn\'t the active editor - no parameter typed');
		return;
	}
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

let stepMode = { steps: [], next: 0, busy: false };
let stepStatus;

function updateStepStatus() {
	if (!stepStatus) {
		return;
	}
	const { steps, next } = stepMode;
	if (steps.length === 0) {
		stepStatus.hide();
		return;
	}
	stepStatus.text = next < steps.length ? `$(debug-step-over) Demo ${next}/${steps.length}` : `$(check) Demo ${steps.length}/${steps.length}`;
	stepStatus.tooltip = next < steps.length ? `Next (ctrl+alt+N): ${steps[next].caption}` : 'All steps done - start again for a retake';
	stepStatus.show();
}

async function startStepMode(steps) {
	stopRequested = false;
	await reset(true);
	stepMode = { steps, next: 0, busy: false };
	await showCaptionView();
	captions.show('');
	updateStepStatus();
	log(`step mode: ${steps.length} steps - press ctrl+alt+N for each`);
}

async function nextStep() {
	const { steps } = stepMode;
	if (stepMode.busy || stepMode.next >= steps.length) {
		log(stepMode.busy ? 'still doing the last step - press again when it\'s done' : 'no more steps');
		return;
	}
	const step = steps[stepMode.next++];
	stepMode.busy = true;
	try {
		log(`step ${stepMode.next}: ${step.caption}`);
		captions.show(step.caption, `Step ${stepMode.next}`);
		if (step.note) {
			captions.note(step.note);
		}
		if (step.action) {
			await step.action();
		}
	} catch (e) {
		log(`step ${stepMode.next} failed: ${e instanceof Error ? e.message : e}`);
		vscode.window.showErrorMessage(`Demo step ${stepMode.next}: ${e instanceof Error ? e.message : e}`);
	} finally {
		stepMode.busy = false;
		updateStepStatus();
	}
}

// back one step: for captions only - a step with an action isn't done again
async function previousStep() {
	if (stepMode.busy || stepMode.steps.some((step) => step.action)) {
		log('back isn\'t available for steps with actions');
		return;
	}
	if (stepMode.next <= 1) {
		stepMode.next = 0;
		captions.show('');
		updateStepStatus();
		return;
	}
	stepMode.next -= 2;
	await nextStep();
}

// Captions only: the captions of a JSON file in scripts/demo/captions, a step at a time - nothing else is done, so the
// presenter does each step, as the caption says. The file is read each time, so a change to it is used straight away.
// A file: { "title": "...", "steps": [ { "caption": "...", "note": "..." }, "a caption alone", ... ] }
const CAPTIONS_FOLDER = path.join(__dirname, 'captions');

async function startCaptions() {
	const files = fs.existsSync(CAPTIONS_FOLDER) ? fs.readdirSync(CAPTIONS_FOLDER).filter((name) => name.endsWith('.json')).sort() : [];
	if (files.length === 0) {
		vscode.window.showErrorMessage(`Demo: no captions files (.json) in ${CAPTIONS_FOLDER}`);
		return;
	}
	const items = files.map((name) => {
		let title = name;
		try {
			title = JSON.parse(fs.readFileSync(path.join(CAPTIONS_FOLDER, name), 'utf8')).title ?? name;
		} catch {
			title = `${name} - not valid JSON`;
		}
		return { label: title, description: name, name };
	});
	const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Captions to show, a step at a time' });
	if (!picked) {
		return;
	}
	let steps;
	try {
		const data = JSON.parse(fs.readFileSync(path.join(CAPTIONS_FOLDER, picked.name), 'utf8'));
		steps = (data.steps ?? []).map((step) => typeof step === 'string' ? { caption: step } : { caption: step.caption ?? '', note: step.note });
	} catch (e) {
		vscode.window.showErrorMessage(`Demo: ${picked.name} - ${e instanceof Error ? e.message : e}`);
		return;
	}
	stopRequested = false;
	stepMode = { steps, next: 0, busy: false };
	await showCaptionView();
	captions.show('');
	updateStepStatus();
	log(`captions: ${picked.name}, ${steps.length} steps - ctrl+alt+N for the next, ctrl+alt+B to go back`);
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
	output = vscode.window.createOutputChannel('Demo');
	context.subscriptions.push(output);
	// the debugger pausing, e.g. at a breakpoint
	context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('xslt-saxon', {
		createDebugAdapterTracker: () => ({
			onDidSendMessage: (message) => {
				if (message.type === 'event' && message.event === 'stopped') {
					lastStopped = message;
					log(`debugger stopped: ${message.body?.reason ?? ''}`);
					stoppedEmitter.fire(message);
				}
			}
		})
	}));
	context.subscriptions.push(vscode.window.registerWebviewViewProvider('xsltDemo.captions', captions, { webviewOptions: { retainContextWhenHidden: true } }));
	context.subscriptions.push(vscode.commands.registerCommand('xsltDemo.playVideo1', () => play(video1)));
	stepStatus = vscode.window.createStatusBarItem('xsltDemo.step', vscode.StatusBarAlignment.Left, -1000);
	stepStatus.command = 'xsltDemo.nextStep';
	context.subscriptions.push(stepStatus);
	context.subscriptions.push(vscode.commands.registerCommand('xsltDemo.stepVideo1', () => startStepMode(video1Steps())));
	context.subscriptions.push(vscode.commands.registerCommand('xsltDemo.nextStep', () => nextStep()));
	context.subscriptions.push(vscode.commands.registerCommand('xsltDemo.previousStep', () => previousStep()));
	context.subscriptions.push(vscode.commands.registerCommand('xsltDemo.startCaptions', () => startCaptions()));
	context.subscriptions.push(vscode.commands.registerCommand('xsltDemo.stop', () => { stopRequested = true; }));
	context.subscriptions.push(vscode.commands.registerCommand('xsltDemo.reset', () => reset()));
}

function deactivate() { }

module.exports = { activate, deactivate, video1, reset, play };
