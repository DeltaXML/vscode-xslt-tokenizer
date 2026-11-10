/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT profile view
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { XsltProfile, ProfileDeclaration } from './xsltProfile';

// a profiled template, function or global, as the Profile view shows it
export interface ProfileRow {
    // 'template', 'function', 'variable' or 'param'
    kind: string;
    // Saxon's, e.g. 'xsl:template', and what identifies the declaration as its module is edited (see
    // XsltProfile.declarationKey) - undefined if the declaration wasn't found
    construct: string;
    key?: string;
    // a match template's pattern as written, else the name - '$name' for a variable or parameter
    label: string;
    mode?: string;
    // the module's file: URI, and how it's shown: relative to the workspace folder, with its full path as the tooltip
    file: string;
    module: string;
    moduleTitle: string;
    // 1-based, of the declaration's start tag
    line: number;
    // 0-based: what's selected on going to the declaration, if it was found
    selection?: { line: number; character: number; endLine: number; endCharacter: number };
    count: number;
    net: number;
    avgNet: number;
    gross: number;
    avgGross: number;
}

export interface ProfileRun {
    stylesheet: vscode.Uri;
    // e.g. 'order-report.xsl'
    title: string;
    // e.g. 'SaxonJ'
    processor: string;
    // what the times depend on, from the task: the XML source (or initial template), initial mode and parameters, e.g.
    // { label: 'Source', value: 'data/orders.xml', note: '2.1 KB' } - in that order
    settings: { label: string; value: string; note?: string }[];
    // e.g. 'orders.xml (2.1 KB)', or 'no source' - for the settings' one-line summary
    sourceSummary: string;
    // the runs asked for (XSLT.tasks.profileRuns), and those the profile has - fewer if a run failed
    requestedRuns: number;
    runs: number;
    time: Date;
    total: number;
    netTotal: number;
    rows: ProfileRow[];
}

// the Profile view: a webview with the rows of the last profile run, sorted by net time - each row going to its declaration
export class XsltProfileView {
    public static readonly viewType = 'xslt-xpath.profile';
    private static panel: vscode.WebviewPanel | undefined;
    private static run: ProfileRun | undefined;
    private static readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
    // a profile is shown, or the view's closed, which clears the profile
    public static readonly onDidChange = XsltProfileView.onDidChangeEmitter.event;

    // the profile shown, if the view is open
    public static current(): ProfileRun | undefined {
        return XsltProfileView.run;
    }

    // the view, brought to the front with the row selected - from its CodeLens on the declaration
    public static showRow(index: number) {
        if (XsltProfileView.panel) {
            XsltProfileView.panel.reveal(undefined, false);
            XsltProfileView.panel.webview.postMessage({ command: 'select', index });
        }
    }

    public static show(run: ProfileRun) {
        XsltProfileView.run = run;
        XsltProfileView.onDidChangeEmitter.fire();
        if (XsltProfileView.panel) {
            XsltProfileView.panel.title = XsltProfileView.title(run);
            XsltProfileView.panel.webview.html = XsltProfileView.html(XsltProfileView.panel.webview, run);
            XsltProfileView.panel.reveal(undefined, true);
            return;
        }
        const panel = vscode.window.createWebviewPanel(XsltProfileView.viewType, XsltProfileView.title(run),
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, // kept when hidden, so a row selected from a CodeLens isn't lost while the page reloads - the page is small
            { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true });
        panel.iconPath = new vscode.ThemeIcon('pulse');
        panel.webview.html = XsltProfileView.html(panel.webview, run);
        panel.webview.onDidReceiveMessage((message) => XsltProfileView.received(message));
        panel.onDidDispose(() => {
            XsltProfileView.panel = undefined;
            XsltProfileView.run = undefined;
            XsltProfileView.onDidChangeEmitter.fire();
        });
        XsltProfileView.panel = panel;
    }

    private static title(run: ProfileRun) {
        return `Profile: ${run.title}`;
    }

    private static async received(message: { command: string; index?: number }) {
        const run = XsltProfileView.run;
        if (!run) {
            return;
        }
        if (message.command === 'rerun') {
            vscode.commands.executeCommand('xslt-xpath.profileXslt', run.stylesheet);
            return;
        }
        if (message.command === 'reveal' && message.index !== undefined) {
            const row = run.rows[message.index];
            if (row) {
                await XsltProfileView.reveal(row);
            }
        }
    }

    // the declaration, in an editor beside the view: one already showing the module, else the first that isn't the view's
    private static async reveal(row: ProfileRow) {
        const uri = vscode.Uri.parse(row.file);
        const panelColumn = XsltProfileView.panel?.viewColumn;
        const visible = vscode.window.visibleTextEditors.filter((e) => e.viewColumn !== undefined && e.viewColumn !== panelColumn);
        const column = visible.find((e) => e.document.uri.toString() === uri.toString())?.viewColumn ??
            visible[0]?.viewColumn ?? (panelColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One);
        const s = row.selection;
        const selection = s ? new vscode.Range(s.line, s.character, s.endLine, s.endCharacter) : new vscode.Range(row.line - 1, 0, row.line - 1, 0);
        try {
            const editor = await vscode.window.showTextDocument(uri, { viewColumn: column, selection });
            editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        } catch (e) {
            vscode.window.showErrorMessage(`Profile: couldn't open ${row.moduleTitle} - ${e instanceof Error ? e.message : e}`);
        }
    }

    private static html(webview: vscode.Webview, run: ProfileRun): string {
        const nonce = crypto.randomBytes(16).toString('base64');
        // the data for the script - '<' escaped so nothing in it can end the script element
        const data = JSON.stringify({
            title: run.title, processor: run.processor, settings: run.settings, sourceSummary: run.sourceSummary,
            requestedRuns: run.requestedRuns, runs: run.runs, runsText: XsltProfile.runsText(run.runs, run.requestedRuns), time: run.time.toLocaleString(),
            total: run.total, netTotal: run.netTotal, rows: run.rows.map(({ selection: _s, file: _f, ...shown }) => shown)
        }).replace(/</g, '\\u003c');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
	body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 0 16px 16px; }
	header { position: sticky; top: 0; background: var(--vscode-editor-background); padding: 12px 0 8px; z-index: 2; }
	h1 { font-size: 1.15em; font-weight: 600; margin: 0 0 4px; }
	.meta, .note { color: var(--vscode-descriptionForeground); }
	.summary { margin: 8px 0 0; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
	.summary b { font-variant-numeric: tabular-nums; }
	button { font-family: inherit; font-size: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: none; padding: 3px 10px; border-radius: 2px; cursor: pointer; margin-left: auto; }
	button:hover { background: var(--vscode-button-hoverBackground); }
	button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
	table { border-collapse: collapse; width: 100%; table-layout: auto; }
	thead th { position: sticky; top: var(--header-height, 0); background: var(--vscode-editor-background); z-index: 1;
		text-align: left; font-weight: 600; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent)); white-space: nowrap; cursor: pointer; user-select: none; }
	thead th.num { text-align: right; }
	thead th:hover { color: var(--vscode-textLink-foreground); }
	thead th .arrow { display: inline-block; width: 1em; color: var(--vscode-descriptionForeground); }
	td { padding: 3px 8px; white-space: nowrap; vertical-align: middle; }
	td.num { text-align: right; font-variant-numeric: tabular-nums; }
	tbody tr { cursor: pointer; }
	tbody tr:hover { background: var(--vscode-list-hoverBackground); }
	tbody tr:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
	tbody tr:focus .kind, tbody tr:focus .mode, tbody tr:focus .line { color: inherit; }
	.kind { color: var(--vscode-descriptionForeground); display: inline-block; min-width: 5.5em; }
	.label { font-family: var(--vscode-editor-font-family); }
	.mode { color: var(--vscode-descriptionForeground); margin-left: 8px; font-family: var(--vscode-editor-font-family); }
	.line { color: var(--vscode-descriptionForeground); }
	td.share { min-width: 150px; width: 25%; }
	.bar-cell { display: flex; align-items: center; gap: 8px; }
	.track { flex: 1; height: 10px; position: relative; }
	.bar { position: absolute; left: 0; top: 0; bottom: 0; background: var(--vscode-charts-blue, var(--vscode-progressBar-background)); border-radius: 1px; min-width: 1px; }
	.pct { min-width: 3.5em; text-align: right; font-variant-numeric: tabular-nums; }
	/* slim: too narrow for every column without scrolling sideways - just the declaration and its net %, the label cut
	   short if need be. The other values are in the row's tooltip */
	@media (max-width: 600px) {
		.col-module, .col-count, .col-net, .col-gross, .col-avgNet { display: none; }
		td.col-label { max-width: 0; width: 100%; overflow: hidden; text-overflow: ellipsis; }
	}
	details.settings { margin: 0 0 12px; }
	details.settings summary { cursor: pointer; color: var(--vscode-descriptionForeground); }
	details.settings summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
	dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 16px; margin: 6px 0 0 16px; }
	dt { color: var(--vscode-descriptionForeground); }
	dd { margin: 0; overflow-wrap: anywhere; }
	dd .value { font-family: var(--vscode-editor-font-family); }
	dd .setting-note { color: var(--vscode-descriptionForeground); margin-left: 8px; }
	.runs-warning { color: var(--vscode-editorWarning-foreground); }
	.note { margin-top: 12px; font-size: 0.92em; }
	.empty { margin-top: 24px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<header id="header">
	<h1 id="title"></h1>
	<div class="meta" id="meta"></div>
	<div class="summary"><span id="summary"></span><button id="rerun" title="Run the profile again">Run Again</button></div>
</header>
<details class="settings" id="settings" open>
	<summary id="settings-summary"></summary>
	<dl id="settings-list"></dl>
</details>
<table id="table" aria-label="Profiled templates, functions and globals">
	<thead><tr id="head"></tr></thead>
	<tbody id="body"></tbody>
</table>
<div class="empty" id="empty" hidden>No templates, functions or global variables were timed in this run.</div>
<div class="note">Times are from a run with tracing on, which turns off some of Saxon's optimisations, so compare them with each other rather than as absolute timings. Net time leaves out the templates and functions called; gross time includes them. Net % is each row's share of the time spent in templates, functions and globals.</div>
<script nonce="${nonce}">
(function () {
	const vscode = acquireVsCodeApi();
	const data = ${data};
	const columns = [
		{ key: 'label', title: 'Template / function', num: false },
		{ key: 'module', title: 'Module', num: false },
		{ key: 'count', title: 'Calls', num: true },
		{ key: 'net', title: 'Net (ms)', num: true },
		{ key: 'share', title: 'Net %', num: false },
		{ key: 'gross', title: 'Gross (ms)', num: true },
		{ key: 'avgNet', title: 'Avg net (ms)', num: true },
	];
	const state = Object.assign({ sortKey: 'net', descending: true }, vscode.getState() || {});
	const rows = data.rows.map((row, index) => Object.assign({ index: index, share: data.netTotal > 0 ? row.net / data.netTotal : 0 }, row));

	const ms = (n) => !isFinite(n) ? '' : n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
	const el = (tag, className, text) => { const e = document.createElement(tag); if (className) { e.className = className; } if (text !== undefined) { e.textContent = text; } return e; };

	document.getElementById('title').textContent = data.title;
	document.getElementById('meta').textContent = 'Profiled with ' + data.processor + ' \\u00b7 ' + data.time;

	// what the times depend on: the source, parameters and runs
	const parameterCount = data.settings.filter((s) => s.label.startsWith('$')).length;
	document.getElementById('settings-summary').textContent = 'Run settings: ' + [data.sourceSummary,
		parameterCount === 0 ? 'no parameters' : parameterCount === 1 ? '1 parameter' : parameterCount + ' parameters', data.runsText].join(' \\u00b7 ');
	const settingsList = document.getElementById('settings-list');
	const runsNote = data.runs < data.requestedRuns ? 'only ' + data.runs + ' of ' + data.requestedRuns + ' ran - the run failed' :
		data.runs > 2 ? 'the times are the average of every run but the first, a warm-up run' :
		data.runs === 2 ? 'the times are the second run\\u2019s - the first was a warm-up run' :
		'the first run\\u2019s times include the Java VM\\u2019s warm-up - see the XSLT.tasks.profileRuns setting';
	for (const setting of data.settings.concat([{ label: 'Runs', value: String(data.requestedRuns), note: runsNote }])) {
		const dd = el('dd');
		dd.append(el('span', 'value', setting.value));
		if (setting.note) {
			dd.append(el('span', 'setting-note' + (setting.label === 'Runs' && data.runs < data.requestedRuns ? ' runs-warning' : ''), setting.note));
		}
		settingsList.append(el('dt', '', setting.label), dd);
	}
	const settingsDetails = document.getElementById('settings');
	if (state.settingsOpen === false) { settingsDetails.open = false; }
	settingsDetails.addEventListener('toggle', () => { state.settingsOpen = settingsDetails.open; vscode.setState(state); });
	const summary = document.getElementById('summary');
	summary.append('Total ', el('b', '', ms(data.total) + ' ms'), ' \\u00b7 in templates, functions and globals ', el('b', '', ms(data.netTotal) + ' ms'),
		data.total > 0 ? ' (' + Math.round(100 * data.netTotal / data.total) + '%)' : '');
	document.getElementById('rerun').addEventListener('click', () => vscode.postMessage({ command: 'rerun' }));

	const head = document.getElementById('head');
	const body = document.getElementById('body');
	const sortValue = (row, key) => key === 'share' ? row.net : key === 'module' ? row.module + ':' + String(row.line).padStart(8, '0') : row[key];

	function renderHead() {
		head.textContent = '';
		for (const column of columns) {
			const th = el('th', (column.num ? 'num ' : '') + 'col-' + column.key);
			th.tabIndex = 0;
			const sorted = state.sortKey === column.key;
			th.setAttribute('aria-sort', sorted ? (state.descending ? 'descending' : 'ascending') : 'none');
			const arrow = el('span', 'arrow', sorted ? (state.descending ? '\\u25be' : '\\u25b4') : '');
			if (column.num) { th.append(arrow, column.title); } else { th.append(column.title, arrow); }
			const sort = () => {
				if (state.sortKey === column.key) {
					state.descending = !state.descending;
				} else {
					state.sortKey = column.key;
					// numbers largest first, text A-Z
					state.descending = column.num || column.key === 'share';
				}
				vscode.setState(state);
				renderHead();
				renderBody();
			};
			th.addEventListener('click', sort);
			th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } });
			head.append(th);
		}
	}

	function renderBody() {
		const key = state.sortKey;
		const sorted = rows.slice().sort((a, b) => {
			const va = sortValue(a, key), vb = sortValue(b, key);
			const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
			return (state.descending ? -c : c) || b.net - a.net;
		});
		const focusedIndex = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.index : undefined;
		body.textContent = '';
		for (const row of sorted) {
			const tr = el('tr');
			tr.tabIndex = 0;
			tr.dataset.index = String(row.index);
			// an average over runs - fractional only if a run made a different number of calls
			const calls = Number.isInteger(row.count) ? String(row.count) : row.count.toFixed(1);
			// with the times too, for slim mode, which hides their columns
			tr.title = 'Go to the declaration: ' + row.moduleTitle + ':' + row.line + '\\n' +
				calls + (row.count === 1 ? ' call' : ' calls') + ' \\u00b7 ' + ms(row.net) + ' ms net \\u00b7 ' + ms(row.gross) + ' ms gross \\u00b7 ' + ms(row.avgNet) + ' ms avg net';
			const component = el('td', 'col-label');
			component.append(el('span', 'kind', row.kind), el('span', 'label', row.label));
			if (row.mode) { component.append(el('span', 'mode', 'mode=' + row.mode)); }
			const module = el('td', 'col-module');
			module.title = row.moduleTitle;
			module.append(row.module, el('span', 'line', ':' + row.line));
			const share = el('td', 'share col-share');
			const cell = el('div', 'bar-cell');
			const track = el('div', 'track');
			const bar = el('div', 'bar');
			bar.style.width = (100 * row.share).toFixed(2) + '%';
			track.append(bar);
			cell.append(track, el('span', 'pct', (100 * row.share).toFixed(1) + '%'));
			share.append(cell);
			tr.append(component, module, el('td', 'num col-count', calls), el('td', 'num col-net', ms(row.net)), share,
				el('td', 'num col-gross', ms(row.gross)), el('td', 'num col-avgNet', ms(row.avgNet)));
			tr.addEventListener('click', () => vscode.postMessage({ command: 'reveal', index: row.index }));
			tr.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					vscode.postMessage({ command: 'reveal', index: row.index });
				} else if (e.key === 'ArrowDown' && tr.nextElementSibling) {
					e.preventDefault(); tr.nextElementSibling.focus();
				} else if (e.key === 'ArrowUp' && tr.previousElementSibling) {
					e.preventDefault(); tr.previousElementSibling.focus();
				}
			});
			body.append(tr);
			if (focusedIndex === tr.dataset.index) { tr.focus(); }
		}
		document.getElementById('empty').hidden = rows.length > 0;
		document.getElementById('table').hidden = rows.length === 0;
	}

	// from a CodeLens: the row, focused and scrolled into view
	window.addEventListener('message', (event) => {
		if (event.data && event.data.command === 'select') {
			const tr = body.querySelector('tr[data-index="' + Number(event.data.index) + '"]');
			if (tr) {
				tr.focus();
				tr.scrollIntoView({ block: 'nearest' });
			}
		}
	});

	// the table header sticks below the page header
	const header = document.getElementById('header');
	const setHeaderHeight = () => document.documentElement.style.setProperty('--header-height', header.offsetHeight + 'px');
	new ResizeObserver(setHeaderHeight).observe(header);
	setHeaderHeight();
	renderHead();
	renderBody();
}());
</script>
</body>
</html>`;
    }
}

// on each profiled template, function and global in a module, its times from the profile shown in the Profile view -
// until the view's closed. Found by key, so they follow their declarations as the module is edited
export class XsltProfileCodeLensProvider implements vscode.CodeLensProvider {
    public readonly onDidChangeCodeLenses = XsltProfileView.onDidChange;

    public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const run = XsltProfileView.current();
        if (!run) {
            return [];
        }
        const uri = document.uri.toString();
        const rows = run.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.key !== undefined && vscode.Uri.parse(row.file).toString() === uri);
        if (rows.length === 0) {
            return [];
        }
        const text = document.getText();
        // the module's declarations of each construct, found once
        const declarations = new Map<string, ProfileDeclaration[]>();
        const declarationsOf = (construct: string) => {
            if (!declarations.has(construct)) {
                declarations.set(construct, XsltProfile.declarationsOf(text, construct));
            }
            return declarations.get(construct)!;
        };
        const lenses: vscode.CodeLens[] = [];
        for (const { row, index } of rows) {
            const declaration = XsltProfile.nearest(declarationsOf(row.construct), row.construct, row.key!, row.line - 1);
            if (!declaration) {
                continue;
            }
            lenses.push(new vscode.CodeLens(new vscode.Range(declaration.line, 0, declaration.line, 0), {
                title: XsltProfileCodeLensProvider.title(row, run.netTotal),
                tooltip: `Profiled with ${run.processor}, ${run.time.toLocaleTimeString()} - show in the Profile view`,
                command: 'xslt-xpath.showProfileRow',
                arguments: [index]
            }));
        }
        return lenses;
    }

    // e.g. '3 calls · 1.20 ms net (13%) · 4.50 ms gross' - for a global, evaluated once, just its time
    public static title(row: ProfileRow, netTotal: number): string {
        const ms = (n: number) => n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
        const share = netTotal > 0 ? ` (${Math.round(100 * row.net / netTotal)}%)` : '';
        if ((row.kind === 'variable' || row.kind === 'param') && row.count === 1) {
            return `${ms(row.net)} ms${share}`;
        }
        const calls = `${Number.isInteger(row.count) ? row.count : row.count.toFixed(1)} ${row.count === 1 ? 'call' : 'calls'}`;
        return row.gross > row.net ? `${calls} · ${ms(row.net)} ms net${share} · ${ms(row.gross)} ms gross` : `${calls} · ${ms(row.net)} ms${share}`;
    }
}
