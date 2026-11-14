/**
 * Test suite for debugging a Schematron schema: compiled by SchXslt2 to a stylesheet that the XSLT debugger runs on the
 * schema's XML context file, with breakpoints set, and pauses shown, at the schema's lines - its rules, lets and
 * assertions - SchXslt2's own variables hidden, and the report shown as a validation's when the session ends.
 * Needs a Saxon jar, in XSLT_TEST_SAXON_JAR (or XSPEC_SAXON_JAR), and the debugger built.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { SchematronDebug } from '../../src/schematronDebug';
import { SchematronContext } from '../../src/schematronContext';
import { SchIncludes } from '../../src/schIncludes';

const iso = 'xmlns="http://purl.oclc.org/dsdl/schematron"';
const schemaText = `<schema ${iso} queryBinding="xslt3">
  <ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/>
  <title>Orders</title>
  <pattern id="orders">
    <rule context="order">
      <let name="id" value="@id"/>
      <assert test="@date castable as xs:date" id="valid-date">Order <value-of select="$id"/> has an invalid date</assert>
      <assert test="line" id="has-lines">Order <value-of select="$id"/> has no lines</assert>
    </rule>
  </pattern>
</schema>`;
const dataText = `<orders>
  <order id="A1" date="2026-11-02"><line/></order>
  <order id="B2" date="2026-11-31"/>
</orders>`;

suite('Schematron: debugging', () => {
	const saxonJar = process.env.XSLT_TEST_SAXON_JAR ?? process.env.XSPEC_SAXON_JAR;
	let folder = '';
	const file = (name: string) => path.join(folder, name);
	let stops: { session: vscode.DebugSession; reason: string }[] = [];
	let onStop: (() => void) | undefined;
	const disposables: vscode.Disposable[] = [];
	// the responses to setBreakpoints for the schema, as VS Code gets them
	const breakpointResponses: { session: vscode.DebugSession, body: any }[] = [];

	suiteSetup(async function () {
		if (!saxonJar) {
			this.skip();
		}
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		await vscode.workspace.getConfiguration('XSLT.tasks').update('saxonJar', saxonJar, vscode.ConfigurationTarget.Global);
		disposables.push(vscode.debug.registerDebugAdapterTrackerFactory(SchematronDebug.debugType, {
			createDebugAdapterTracker: (session) => ({
				onDidSendMessage: (message: any) => {
					if (message.type === 'event' && message.event === 'stopped') {
						stops.push({ session, reason: message.body.reason });
						onStop?.();
					} else if (message.type === 'response' && message.command === 'setBreakpoints') {
						breakpointResponses.push({ session, body: message.body });
					}
				}
			})
		}));
	});
	setup(async () => {
		folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sch-debug-')));
		fs.writeFileSync(file('orders.sch'), schemaText);
		fs.writeFileSync(file('orders.xml'), dataText);
		SchIncludes.instance.buildFrom([file('orders.sch')]);
		await SchematronContext.setContextFile(file('orders.sch'), file('orders.xml'));
		stops = [];
	});
	teardown(async () => {
		vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
		await SchematronContext.setContextFile(file('orders.sch'), undefined);
		fs.rmSync(folder, { recursive: true, force: true });
	});
	suiteTeardown(async () => {
		disposables.forEach((d) => d.dispose());
		await vscode.workspace.getConfiguration('XSLT.tasks').update('saxonJar', undefined, vscode.ConfigurationTarget.Global);
	});

	const nextStop = () => new Promise<{ session: vscode.DebugSession; reason: string }>((resolve) => {
		const check = () => {
			if (stops.length > 0) {
				onStop = undefined;
				resolve(stops.shift()!);
			}
		};
		onStop = check;
		check();
	});
	// the end of the next Schematron session
	const ended = () => new Promise<void>((resolve) => {
		const listener = vscode.debug.onDidTerminateDebugSession((session) => {
			if (session.name.startsWith('Debug orders.sch')) {
				listener.dispose();
				resolve();
			}
		});
	});
	const lineOf = (text: string) => schemaText.split('\n').findIndex((line) => line.includes(text));

	test('a breakpoint on an assertion: paused at the schema\'s line, with the node, the rule\'s let - not SchXslt2\'s variables - and its test evaluated', async () => {
		const schema = vscode.Uri.file(file('orders.sch'));
		vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(schema, new vscode.Position(lineOf('id="valid-date"'), 0)))]);
		const finished = ended();
		assert.isTrue(await SchematronDebug.debug(schema));
		const stop = await nextStop();
		assert.strictEqual(stop.reason, 'breakpoint');
		assert.match(stop.session.name, /^Debug orders\.sch/);
		const { stackFrames } = await stop.session.customRequest('stackTrace', { threadId: 1 });
		assert.strictEqual(stackFrames[0].source.path, file('orders.sch'));
		assert.strictEqual(stackFrames[0].line, lineOf('id="valid-date"') + 1);
		const { scopes } = await stop.session.customRequest('scopes', { frameId: stackFrames[0].id });
		const locals = (await stop.session.customRequest('variables', { variablesReference: scopes.find((s: any) => s.name === 'Locals').variablesReference })).variables.map((v: any) => v.name);
		assert.include(locals, '$id');
		assert.isFalse(locals.some((name: string) => /schxslt|severity|rule-context/.test(name)), locals.join(', '));
		const evaluated = await stop.session.customRequest('evaluate', { expression: '@date castable as xs:date', frameId: stackFrames[0].id, context: 'watch' });
		assert.strictEqual(evaluated.result, 'true');
		// stepping: to the next of the schema's steps - the next assertion - not SchXslt2's own
		await stop.session.customRequest('next', { threadId: 1 });
		await nextStop();
		const stepped = (await stop.session.customRequest('stackTrace', { threadId: 1 })).stackFrames[0];
		assert.strictEqual(stepped.source.path, file('orders.sch'));
		assert.strictEqual(stepped.line, lineOf('id="has-lines"') + 1);
		vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
		await stop.session.customRequest('continue', { threadId: 1 });
		await finished;
		// the report: as a validation's
		for (let i = 0; i < 50 && vscode.languages.getDiagnostics(vscode.Uri.file(file('orders.xml'))).length < 2; i++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		assert.deepEqual(vscode.languages.getDiagnostics(vscode.Uri.file(file('orders.xml'))).filter((d) => d.source?.startsWith('Schematron')).map((d) => d.message).sort(),
			['Order B2 has an invalid date', 'Order B2 has no lines']);
	});

	test('a breakpoint where SchXslt2 has no step, e.g. on a title, isn\'t verified - one on a rule pauses where it fires, for each node', async () => {
		const schema = vscode.Uri.file(file('orders.sch'));
		breakpointResponses.length = 0;
		vscode.debug.addBreakpoints([lineOf('<title>'), lineOf('<rule')].map((line) => new vscode.SourceBreakpoint(new vscode.Location(schema, new vscode.Position(line, 0)))));
		const finished = ended();
		assert.isTrue(await SchematronDebug.debug(schema));
		const first = await nextStop();
		const response = breakpointResponses.find((r) => r.session === first.session && r.body.breakpoints?.length === 2)?.body;
		assert.isDefined(response, JSON.stringify(breakpointResponses));
		assert.deepEqual(response.breakpoints.map((b: any) => b.verified), [false, true]);
		assert.include(response.breakpoints[0].message, 'Schematron: no step here');
		const frame = (await first.session.customRequest('stackTrace', { threadId: 1 })).stackFrames[0];
		assert.strictEqual(frame.line, lineOf('<rule') + 1);
		const context = await first.session.customRequest('evaluate', { expression: 'string(@id)', frameId: frame.id, context: 'watch' });
		assert.strictEqual(context.result, '"A1"');
		await first.session.customRequest('continue', { threadId: 1 });
		const second = await nextStop();
		const secondFrame = (await second.session.customRequest('stackTrace', { threadId: 1 })).stackFrames[0];
		assert.strictEqual((await second.session.customRequest('evaluate', { expression: 'string(@id)', frameId: secondFrame.id, context: 'watch' })).result, '"B2"');
		vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
		await second.session.customRequest('continue', { threadId: 1 });
		await finished;
	});
});
