/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT profile view
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';

// a profiled template, function or global, as the Profile view shows it
export interface ProfileRow {
    // 'template', 'function', 'variable' or 'param'
    kind: string;
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
    source?: string;
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

    public static show(run: ProfileRun) {
        XsltProfileView.run = run;
        if (XsltProfileView.panel) {
            XsltProfileView.panel.title = XsltProfileView.title(run);
            XsltProfileView.panel.webview.html = XsltProfileView.html(XsltProfileView.panel.webview, run);
            XsltProfileView.panel.reveal(undefined, true);
            return;
        }
        const panel = vscode.window.createWebviewPanel(XsltProfileView.viewType, XsltProfileView.title(run),
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, localResourceRoots: [] });
        panel.iconPath = new vscode.ThemeIcon('pulse');
        panel.webview.html = XsltProfileView.html(panel.webview, run);
        panel.webview.onDidReceiveMessage((message) => XsltProfileView.received(message));
        panel.onDidDispose(() => {
            XsltProfileView.panel = undefined;
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
            title: run.title, processor: run.processor, source: run.source, time: run.time.toLocaleString(),
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
	document.getElementById('meta').textContent = 'Profiled with ' + data.processor + (data.source ? ' on ' + data.source : '') + ' \\u00b7 ' + data.time;
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
			const th = el('th', column.num ? 'num' : '');
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
			tr.title = 'Go to the declaration: ' + row.moduleTitle + ':' + row.line;
			const component = el('td');
			component.append(el('span', 'kind', row.kind), el('span', 'label', row.label));
			if (row.mode) { component.append(el('span', 'mode', 'mode=' + row.mode)); }
			const module = el('td');
			module.title = row.moduleTitle;
			module.append(row.module, el('span', 'line', ':' + row.line));
			const share = el('td', 'share');
			const cell = el('div', 'bar-cell');
			const track = el('div', 'track');
			const bar = el('div', 'bar');
			bar.style.width = (100 * row.share).toFixed(2) + '%';
			track.append(bar);
			cell.append(track, el('span', 'pct', (100 * row.share).toFixed(1) + '%'));
			share.append(cell);
			tr.append(component, module, el('td', 'num', String(row.count)), el('td', 'num', ms(row.net)), share, el('td', 'num', ms(row.gross)), el('td', 'num', ms(row.avgNet)));
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
