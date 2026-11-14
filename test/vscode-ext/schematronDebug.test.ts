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
import { XsltEmptySteps } from '../../src/xsltEmptySteps';

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

suite('Schematron: debugging - the paths checked for empty steps', () => {
	test('in the rule paused in: its lets, tests and messages up to the line - all its lets at the rule - not its context, nor an abstract pattern\'s parameters', () => {
		const text = [
			`<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt3">`,
			'  <sch:let name="g" value="/orders/order"/>',
			'  <sch:pattern id="p">',
			'    <sch:rule context="order/item">',
			'      <sch:let name="n" value="name/first"/>',
			'      <sch:assert test="price/amount">No <sch:value-of select="../code"/></sch:assert>',
			'      <sch:report test="$n/x and note">Noted</sch:report>',
			'    </sch:rule>',
			'  </sch:pattern>',
			'  <sch:pattern abstract="true" id="a">',
			'    <sch:rule context="$e"><sch:let name="v" value="$v2"/><sch:assert test="$attr/x, $v/y, q/r">x</sch:assert></sch:rule>',
			'  </sch:pattern>',
			'</sch:schema>'].join('\n');
		const chains = (line: number) => XsltEmptySteps.schematronChains(text, line).map((c) => c.points.map((p) => text.substring(p.markStart, p.markEnd)).join(' '));
		// at the rule: its lets
		assert.deepStrictEqual(chains(3), ['name first']);
		assert.deepStrictEqual(chains(5), ['name first', 'price amount', '.. code']);
		assert.deepStrictEqual(chains(6), ['name first', 'price amount', '.. code', '$n x', 'note']);
		// a global let: from the root or a variable only
		assert.deepStrictEqual(chains(1), ['orders order']);
		// $attr is the abstract pattern's parameter - $v is its let
		assert.deepStrictEqual(chains(10), []);
	});
});

suite('Schematron: debugging', () => {
	const saxonJar = process.env.XSLT_TEST_SAXON_JAR ?? process.env.XSPEC_SAXON_JAR;
	let folder = '';
	const file = (name: string) => path.join(folder, name);
	let stops: { session: vscode.DebugSession; reason: string; body?: any }[] = [];
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
						stops.push({ session, reason: message.body.reason, body: message.body });
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
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		fs.rmSync(folder, { recursive: true, force: true });
	});
	suiteTeardown(async () => {
		disposables.forEach((d) => d.dispose());
		await vscode.workspace.getConfiguration('XSLT.tasks').update('saxonJar', undefined, vscode.ConfigurationTarget.Global);
	});

	const nextStop = () => new Promise<{ session: vscode.DebugSession; reason: string; body?: any }>((resolve) => {
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

	test('fades a path step that\'s empty for the rule\'s node, with why in its hover', async () => {
		const schema = vscode.Uri.file(file('orders.sch'));
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(schema));
		vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(schema, new vscode.Position(lineOf('id="has-lines"'), 0)))]);
		const finished = ended();
		assert.isTrue(await SchematronDebug.debug(schema));
		// A1 has a line
		let stop = await nextStop();
		await new Promise((resolve) => setTimeout(resolve, 1000));
		assert.deepStrictEqual(XsltEmptySteps.lastFaded, []);
		await stop.session.customRequest('continue', { threadId: 1 });
		// B2 hasn't
		stop = await nextStop();
		for (let i = 0; i < 100 && XsltEmptySteps.lastFaded.length === 0; i++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		const faded = XsltEmptySteps.lastFaded;
		assert.deepStrictEqual(faded.map((f) => `${f.line}: ${f.text}`), [`${lineOf('id="has-lines"')}: line`]);
		assert.include(faded[0].hover, 'no `line` - 0 child elements');
		vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
		await stop.session.customRequest('continue', { threadId: 1 });
		await finished;
	});

	test('pausing at each failed assertion, or successful report - with its message - for the roles in its condition, if any', async () => {
		fs.writeFileSync(file('orders.sch'), `<schema ${iso} queryBinding="xslt3">
  <ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/>
  <pattern id="orders">
    <rule context="order">
      <let name="id" value="@id"/>
      <report test="@id = 'A1'" role="info" id="first">Order <value-of select="$id"/> is the first</report>
      <assert test="@date castable as xs:date" role="warning" id="valid-date">Order <value-of select="$id"/> has an invalid date</assert>
      <assert test="line">Order <value-of select="$id"/> has no lines</assert>
    </rule>
  </pattern>
</schema>`);
		const text = fs.readFileSync(file('orders.sch'), 'utf8');
		const line = (t: string) => text.split('\n').findIndex((l) => l.includes(t)) + 1;
		const schema = vscode.Uri.file(file('orders.sch'));
		// the outcomes paused at - with a breakpoint on the rule, and maybe on the last assertion too, resumed from with
		// 'continue' or 'next'
		const outcomesOf = async (onAssertion?: 'continue' | 'next') => {
			stops = [];
			vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
			vscode.debug.addBreakpoints([line('<rule'), ...(onAssertion ? [line('test="line"')] : [])].map((l) => new vscode.SourceBreakpoint(new vscode.Location(schema, new vscode.Position(l - 1, 0)))));
			const finished = ended();
			assert.isTrue(await SchematronDebug.debug(schema));
			let stop = await nextStop();
			// failed assertions: errors only - one with no role or severity is an error; successful reports: all
			await stop.session.customRequest('setExceptionBreakpoints', { filters: ['errors'], filterOptions: [{ filterId: 'schematronFailedAssert', condition: 'error' }, { filterId: 'schematronSuccessfulReport' }] });
			const outcomes: string[] = [];
			let resume = 'continue';
			for (let i = 0; i < 20; i++) {
				await stop.session.customRequest(resume, { threadId: 1 });
				const next = await Promise.race([nextStop(), finished.then(() => undefined)]);
				if (!next) {
					break;
				}
				stop = next;
				const frame = (await stop.session.customRequest('stackTrace', { threadId: 1 })).stackFrames[0];
				resume = stop.reason === 'breakpoint' && frame.line === line('test="line"') ? onAssertion! : 'continue';
				if (stop.reason === 'exception') {
					const info = await stop.session.customRequest('exceptionInfo', { threadId: 1 });
					outcomes.push(`${stop.reason} ${stop.body.description} @${frame.line}: ${info.exceptionId} - ${info.description} (${path.basename(frame.source.path)})`);
				}
			}
			await finished;
			return outcomes;
		};
		const report = `exception Successful report @${line('id="first"')}: Successful report: first - Order A1 is the first (orders.sch)`;
		const failed = `exception Failed assertion @${line('test="line"')}: Failed assertion - Order B2 has no lines (orders.sch)`;
		assert.deepEqual(await outcomesOf(), [report, failed]);
		// continuing from a breakpoint on the assertion: not paused again there, for its failure - stepping from it is
		assert.deepEqual(await outcomesOf('continue'), [report]);
		assert.deepEqual(await outcomesOf('next'), [report, failed]);
	});

	test('the phase: a breakpoint in a pattern that isn\'t active in it isn\'t verified, and says why', async () => {
		fs.writeFileSync(file('orders.sch'), schemaText.replace('queryBinding="xslt3">', 'queryBinding="xslt3" defaultPhase="lines">')
			.replace('  <pattern id="orders">', `  <phase id="lines"><active pattern="lines"/></phase>
  <pattern id="lines"><rule context="line"><assert test="true()" id="line-ok">x</assert></rule></pattern>
  <pattern id="orders">`));
		const text = fs.readFileSync(file('orders.sch'), 'utf8');
		const schema = vscode.Uri.file(file('orders.sch'));
		breakpointResponses.length = 0;
		const line = (t: string) => text.split('\n').findIndex((l) => l.includes(t));
		vscode.debug.addBreakpoints([line('id="valid-date"'), line('id="line-ok"')].map((l) => new vscode.SourceBreakpoint(new vscode.Location(schema, new vscode.Position(l, 0)))));
		const finished = ended();
		assert.isTrue(await SchematronDebug.debug(schema));
		const stop = await nextStop();
		assert.match(stop.session.name, /\(phase lines\)$/);
		const response = breakpointResponses.find((r) => r.session === stop.session && r.body.breakpoints?.length === 2)?.body;
		// by line, as VS Code sends them
		const at = (l: number) => response.breakpoints.find((b: any) => b.line === l + 1);
		assert.isTrue(at(line('id="line-ok"')).verified);
		assert.isFalse(at(line('id="valid-date"')).verified);
		assert.strictEqual(at(line('id="valid-date"')).message, 'Schematron: the pattern orders isn\'t active in the phase lines');
		vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
		await stop.session.customRequest('continue', { threadId: 1 });
		await finished;
	});

	test('is-a: a breakpoint on an instance pauses for its copy alone - named for it, with its parameters', async () => {
		fs.writeFileSync(file('orders.sch'), `<schema ${iso} queryBinding="xslt3">
  <pattern abstract="true" id="required">
    <param name="element"/>
    <param name="attribute"/>
    <rule context="$element"><assert test="$attribute" id="required-attribute">needs it</assert></rule>
  </pattern>
  <pattern id="order-ids" is-a="required"><param name="element" value="order"/><param name="attribute" value="@id"/></pattern>
  <pattern id="order-dates" is-a="required"><param name="element" value="order"/><param name="attribute" value="@date"/></pattern>
</schema>`);
		const text = fs.readFileSync(file('orders.sch'), 'utf8');
		const schema = vscode.Uri.file(file('orders.sch'));
		vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(schema, new vscode.Position(text.split('\n').findIndex((l) => l.includes('id="order-dates"')), 0)))]);
		const finished = ended();
		assert.isTrue(await SchematronDebug.debug(schema));
		const names: string[] = [];
		let parameters: string[] = [];
		for (let i = 0; i < 2; i++) {
			const stop = await nextStop();
			const frame = (await stop.session.customRequest('stackTrace', { threadId: 1 })).stackFrames[0];
			names.push(`${frame.name} @${frame.line}`);
			const { scopes } = await stop.session.customRequest('scopes', { frameId: frame.id });
			const scope = scopes.find((s: any) => s.name === 'Parameters');
			parameters = (await stop.session.customRequest('variables', { variablesReference: scope.variablesReference })).variables.map((v: any) => `${v.name}=${v.value}`);
			await stop.session.customRequest('continue', { threadId: 1 });
		}
		await finished;
		// the rule of the abstract pattern, for each order - order-dates' copy only
		const ruleLine = text.split('\n').findIndex((l) => l.includes('<rule context="$element">')) + 1;
		assert.deepEqual(names, [`rule order - order-dates (is-a required) @${ruleLine}`, `rule order - order-dates (is-a required) @${ruleLine}`]);
		assert.deepEqual(parameters, ['$element=order', '$attribute=@date']);
	});
});
