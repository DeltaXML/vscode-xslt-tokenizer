/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as http from 'http';
import { McpServer, createMcpHandler, loadSkills, toNodeHandler, z } from './sdk';
import { McpRoot } from './mcpRoot';
import { declarationKindNames, XsltMcpTools, XsltModules } from './xsltMcpTools';
import { RunConfiguration } from './runConfiguration';
import { ProfileConfiguration, TestConfiguration, ValidationConfiguration } from './assistantRuns';
import { OutputOrigin } from './outputOrigin';
import { XPathEvaluate } from './xpathEvaluate';

// The extension's MCP server, for AI assistants: tools that use its linter and its knowledge of XSLT modules (see
// XsltMcpTools). It runs in the extension host, so the tools use the same code as the editor - with the Streamable
// HTTP transport, on 127.0.0.1, as VS Code (for GitHub Copilot) and command-line agents (e.g. Claude Code) can both
// connect to it. Each window has a server of its own, for its workspace, at a port that's the same each time the
// workspace is opened (see start) - so with several windows, an assistant in each project uses that project's window. Each request needs the token, kept in the secret storage - the same for
// each window and session, so an assistant's setup keeps working until the token is reset. The server is stateless: a
// new SDK server and transport for each request
export class XsltMcpServer {
	public static readonly providerId = 'xslt-xpath.mcp';
	private static readonly tokenKey = 'xslt-xpath.mcpToken';
	private static readonly maxBody = 1024 * 1024;
	public static readonly log = vscode.window.createOutputChannel('XSLT MCP Server', { log: true });

	private httpServer: http.Server | undefined;
	private token: string | undefined;
	private readonly tools: XsltMcpTools;

	private readonly xpath: XPathEvaluate | undefined;
	private readonly skillsFolder: string | undefined;
	// serves MCP requests, each with a server of its own (see createServer): the 2026-07-28 protocol, and the 2025-era protocols
	// that clients such as Claude Code still use, statelessly
	private readonly mcpHandler = toNodeHandler(createMcpHandler(async () => {
		const mcp = this.createServer();
		await this.attachSkills(mcp);
		return mcp;
	}));
	// the skills the server serves (xslt-resources/skills): loaded once, for every server
	private skills: ReturnType<typeof loadSkills> | undefined;

	// state: the workspace's state, where its port is kept
	// extensionUri: the extension's folder, where the program that evaluates XPath is - without it, no evaluate_xpath tool
	public constructor(private readonly secrets: vscode.SecretStorage, modules: XsltModules, private readonly state?: vscode.Memento, extensionUri?: vscode.Uri) {
		this.tools = new XsltMcpTools(modules);
		this.xpath = extensionUri ? new XPathEvaluate(extensionUri) : undefined;
		this.skillsFolder = extensionUri ? vscode.Uri.joinPath(extensionUri, 'xslt-resources', 'skills').fsPath : undefined;
		// reset in this window or another: the new token is used from the next request
		secrets.onDidChange((event) => {
			if (event.key === XsltMcpServer.tokenKey) {
				this.token = undefined;
			}
		});
	}

	public static isEnabled() {
		return vscode.workspace.getConfiguration('XSLT.mcp').get<boolean>('enabled', false);
	}

	// the setting: the port of a window with no folder open, and the start of the range of each workspace's port
	public static basePort() {
		return vscode.workspace.getConfiguration('XSLT.mcp').get<number>('port', 6745);
	}

	public static url(port: number) {
		return `http://127.0.0.1:${port}/mcp`;
	}

	// what identifies the window's workspace: its .code-workspace file, else its first folder - none with no folder open
	public static workspaceKey(): string | undefined {
		return vscode.workspace.workspaceFile?.scheme === 'file' ? vscode.workspace.workspaceFile.fsPath : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	}

	// a workspace's port, from its key: each of up to 999 ports after the base port, so that each window - with another
	// workspace - has a server of its own, at a port that's the same each time the workspace is opened
	public static portFor(key: string, base = XsltMcpServer.basePort()) {
		return base + 1 + crypto.createHash('sha256').update(key).digest().readUInt32BE(0) % 999;
	}

	// the port the server is listening on - the URL an assistant connects to - while it's running
	public port: number | undefined;

	public get url(): string | undefined {
		return this.port !== undefined ? XsltMcpServer.url(this.port) : undefined;
	}

	// the token: made once, then kept
	public async getToken() {
		if (!this.token) {
			this.token = await this.secrets.get(XsltMcpServer.tokenKey);
			if (!this.token) {
				this.token = crypto.randomBytes(24).toString('base64url');
				await this.secrets.store(XsltMcpServer.tokenKey, this.token);
			}
		}
		return this.token;
	}

	// a new token: the assistants set up with the old one need to be set up again
	public async resetToken() {
		this.token = crypto.randomBytes(24).toString('base64url');
		await this.secrets.store(XsltMcpServer.tokenKey, this.token);
		return this.token;
	}

	public get isRunning() {
		return !!this.httpServer?.listening;
	}

	private static readonly portKey = 'xslt-xpath.mcpPort';

	// the port of the last start in this workspace - before it, if it was another
	public previousPort: number | undefined;

	// listening - or not: false. At the port given - else for the window's workspace: the one it had before, else the one
	// for its key (see portFor), or the next free one, kept for the workspace; with no folder open, the setting's
	// key: what identifies the workspace - for testing, another than the window's
	public async start(port?: number, key = XsltMcpServer.workspaceKey()): Promise<boolean> {
		// a start under way, e.g. from the setting changed and a command at once: that one's result - not a second server
		// trying the next port
		if (!this.starting) {
			this.starting = this.startAt(port, key).finally(() => this.starting = undefined);
		}
		return this.starting;
	}

	private starting: Promise<boolean> | undefined;

	private async startAt(port: number | undefined, key: string | undefined): Promise<boolean> {
		if (this.isRunning) {
			return true;
		}
		if (port !== undefined) {
			return this.listen(port, true);
		}
		if (!key) {
			return this.listen(XsltMcpServer.basePort(), true);
		}
		this.previousPort = this.state?.get<number>(XsltMcpServer.portKey);
		const first = this.previousPort ?? XsltMcpServer.portFor(key);
		for (let candidate = first; candidate < first + 20; candidate++) {
			if (await this.listen(candidate, candidate === first + 19)) {
				await this.state?.update(XsltMcpServer.portKey, candidate);
				return true;
			}
		}
		return false;
	}

	// logged: whether a port in use is reported - e.g. not each one tried before a free one
	private async listen(port: number, logInUse: boolean): Promise<boolean> {
		if (this.httpServer) {
			return this.isRunning;
		}
		await this.getToken();
		const server = http.createServer((request, response) => {
			this.handle(request, response, port).catch((error) => {
				XsltMcpServer.log.error(`request failed: ${error instanceof Error ? error.message : String(error)}`);
				if (!response.headersSent) {
					response.writeHead(500).end();
				}
			});
		});
		this.httpServer = server;
		return new Promise((resolve) => {
			server.once('error', (error: NodeJS.ErrnoException) => {
				if (error.code !== 'EADDRINUSE' || logInUse) {
					XsltMcpServer.log.warn(error.code === 'EADDRINUSE' ? `port ${port} is in use - e.g. by the MCP server of another VS Code window` : `not started: ${error.message}`);
				}
				this.httpServer = undefined;
				resolve(false);
			});
			server.listen(port, '127.0.0.1', () => {
				this.port = port;
				const key = XsltMcpServer.workspaceKey();
				XsltMcpServer.log.info(`listening at ${XsltMcpServer.url(port)}${key ? ` for ${key}` : ''}`);
				resolve(true);
			});
		});
	}

	public stop() {
		this.httpServer?.close();
		// and the connections it has open: a client keeps a stream open on the 2026-07-28 protocol (subscriptions/listen), which
		// would go on being served after the server is turned off
		this.httpServer?.closeAllConnections();
		this.httpServer = undefined;
		this.port = undefined;
		this.xpath?.dispose();
	}

	private async handle(request: http.IncomingMessage, response: http.ServerResponse, port: number) {
		// only for this server, by name - not e.g. a web page's request to another host name that resolves to 127.0.0.1
		const host = request.headers.host ?? '';
		if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
			response.writeHead(403).end();
			return;
		}
		if (request.url?.split('?')[0] !== '/mcp') {
			response.writeHead(404).end();
			return;
		}
		const authorization = request.headers.authorization ?? '';
		const expected = `Bearer ${await this.getToken()}`;
		if (authorization.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(authorization), Buffer.from(expected))) {
			response.writeHead(401).end();
			return;
		}
		let body = '';
		for await (const chunk of request) {
			body += chunk;
			if (body.length > XsltMcpServer.maxBody) {
				response.writeHead(413).end();
				return;
			}
		}
		let message: unknown;
		try {
			message = body ? JSON.parse(body) : undefined;
		} catch {
			response.writeHead(400).end();
			return;
		}
		// for a project's folder in a multi-root workspace, if the URL has it as its root
		const root = McpRoot.fromUrl(request.url);
		await McpRoot.run(root, () => this.mcpHandler(request, response, message));
	}

	// the skills, loaded on first use - none when the extension's folder isn't known (e.g. in tests), or they can't be read
	private async attachSkills(mcp: McpServer) {
		if (!this.skillsFolder) {
			return;
		}
		this.skills ??= loadSkills(this.skillsFolder);
		try {
			(await this.skills).attach(mcp);
		} catch (e: any) {
			// a skill that can't be served isn't a reason for the tools not to be
			XsltMcpServer.log.warn(`skills not served: ${e?.message ?? e}`);
			this.skills = undefined;
		}
	}

	private createServer() {
		const version: string = vscode.extensions.getExtension('deltaxml.xslt-xpath')?.packageJSON.version ?? '0';
		const mcp = new McpServer({ name: 'xslt-xpath', version }, { instructions: McpRoot.instructions() });
		const tools = this.tools;
		const filePath = z.string().describe('The file\'s path: absolute, or relative to the project\'s folder (the first workspace folder, unless set up for another)');
		const minSeverity = z.enum(['error', 'warning', 'info', 'hint']);
		const name = z.string().describe('The name as written in the module, e.g. f:area, or $config for a variable, or f:area#2 for a function of arity 2');
		const kind = z.enum(declarationKindNames).optional().describe('The kind of declaration - any kind, if not given');
		const readOnly = { readOnlyHint: true, openWorldHint: false };
		const topLevelStylesheet = (use: string) => z.string().optional().describe(`For an XSLT module: the top-level stylesheet to ${use} - one ` +
			'that imports or includes it, directly or indirectly - instead of the one found for it, e.g. one outside the workspace, or ' +
			'another of the stylesheets that include it. Absolute, or relative to the project\'s folder (the first workspace folder, unless set up for another)');
		mcp.registerTool('lint_file', {
			title: 'Lint an XSLT, XSpec or Schematron file',
			description: 'The problems in an XSLT module (.xsl, .xslt), XSpec file (.xspec) or Schematron schema (.sch), as the XSLT/XPath extension reports them in the ' +
				'Problems panel - with its imports, includes and packages - whether or not the file is open in an editor. A module ' +
				'that a top-level stylesheet imports or includes is checked with that stylesheet\'s declarations too: the one found ' +
				'for it in the workspace, or topLevelStylesheet. Each problem is given as line:column (1-based), severity and message.',
			inputSchema: {
				path: filePath,
				minSeverity: minSeverity.optional().describe('Only problems of this severity or worse - all, if not given'),
				topLevelStylesheet: topLevelStylesheet('check it with')
			},
			annotations: readOnly
		}, async (args) => tools.lintFile(args.path, args.minSeverity, args.topLevelStylesheet));
		mcp.registerTool('lint_files', {
			title: 'Lint the XSLT, XSpec and Schematron files in a folder',
			description: 'The problems in each XSLT module, XSpec file and Schematron schema in a folder and its subfolders, as lint_file finds them - only the files ' +
				'with problems are listed, after a summary. XSpec\'s generated test runners (xspec/*-compiled.xsl), node_modules, hidden ' +
				'folders such as .git (unless the pattern names one) and the files.exclude setting\'s files aren\'t checked. In a window with several ' +
				'workspace folders, the folder not given is the project\'s folder alone: to check the others too, call it for each folder.',
			inputSchema: {
				folder: z.string().optional().describe('The folder: absolute, or relative to the project\'s folder - the project\'s folder, if not given'),
				pattern: z.string().optional().describe('A glob pattern for the files, relative to the folder - default **/*.{xsl,xslt,xspec,sch}'),
				minSeverity: minSeverity.optional().describe('Only problems of this severity or worse - default warning, so hints such as unused variables are left out')
			},
			annotations: readOnly
		}, async (args) => tools.lintFiles(args.folder, args.pattern, args.minSeverity));
		mcp.registerTool('module_imports', {
			title: 'Show the imports of an XSLT module',
			description: 'The tree of imports, includes and used packages for an XSLT module: from the top-level stylesheet that imports or ' +
				'includes it, directly or indirectly (found from the workspace\'s XSLT modules), down - with the module marked. ' +
				'Earlier imports have lower import precedence than later ones.',
			inputSchema: { path: filePath },
			annotations: readOnly
		}, async (args) => tools.moduleImports(args.path));
		mcp.registerTool('list_declarations', {
			title: 'List the components an XSLT module can use',
			description: 'Every function, named template, global variable and parameter, mode, attribute set, key, accumulator, item type and ' +
				'character map usable from an XSLT module: its own declarations, then those of the modules it imports or includes and the ' +
				'packages it uses - each with its parameters and types, its location, and the first line of its documentation. Call it ' +
				'before writing or changing a stylesheet, to reuse what exists rather than write it again. A declaration overridden by one ' +
				'with a higher import precedence is marked. For a declaration\'s full documentation use find_declaration. A module that a ' +
				'top-level stylesheet imports or includes sees that stylesheet\'s declarations too: the one found for it in the workspace, or topLevelStylesheet.',
			inputSchema: {
				path: filePath.describe('The XSLT module or XSpec file to list the components usable from'), kind,
				topLevelStylesheet: topLevelStylesheet('list the declarations with')
			},
			annotations: readOnly
		}, async (args) => tools.listDeclarations(args.path, args.kind, args.topLevelStylesheet));
		if (this.xpath) {
			const xpath = this.xpath;
			mcp.registerTool('evaluate_xpath', {
				title: 'Evaluate an XPath expression on an XML file',
				description: 'Evaluates an XPath expression with Saxon (the user\'s jar, as for Find Nodes with XPath) on an XML file, and gives the ' +
					'result: the number of items, and the first 100 as the debugger shows values - a node as its path, a map, array or atomic ' +
					'value in full. Use it on the stylesheet\'s source XML (see run_configuration for its XML context file) to check input ' +
					'structure, a match pattern or a select/test expression, or the count of nodes, before writing or changing templates. ' +
					'It is evaluated as in a stylesheet: unprefixed element names are in no namespace unless xpathDefaultNamespace is given (as ' +
					'xpath-default-namespace), whatever the document\'s default namespace. Prefixes the document declares are bound. To use ' +
					'a prefix it doesn\'t declare, put one declare namespace line for each at the very start, each ending in a semicolon, ' +
					'e.g. declare namespace o = \'urn:orders\'; declare namespace x = \'urn:x\'; //o:order/x:ref - these lines are the only ' +
					'thing allowed before the XPath: it is XPath, not XQuery, so there is no declare variable, declare function or default ' +
					'element namespace (use xpathDefaultNamespace for unprefixed element names). The xs, fn, map, array, math and err ' +
					'prefixes are predeclared, but a stylesheet must declare map, array and math itself. There is no stylesheet around the ' +
					'expression: no variables, keys or functions of a stylesheet. For safety it has no extension functions (Java, EXPath, ' +
					'such as file:), no collection(), and doc() and unparsed-text() read only files in the workspace folders. An error is given ' +
					'with Saxon\'s code and position. Each node found is listed with its line and column in the XML file, so saxon:line-number() ' +
					'isn\'t needed. The saxon: extension functions (e.g. saxon:parse) need Saxon-PE or Saxon-EE - not Saxon-HE, the free ' +
					'edition: run_configuration says which edition the user has.',
				inputSchema: {
					xpath: z.string().describe('The XPath expression, e.g. //order[@total > 100]/@id or count(//item)'),
					path: filePath.describe('The XML file to evaluate it on, as the context item'),
					xpathDefaultNamespace: z.string().optional().describe('The namespace URI of unprefixed element names, as the stylesheet\'s xpath-default-namespace - none, if not given'),
					xpathVersion: z.enum(['3.1', '4.0']).optional().describe('4.0 by default - 3.1 with Saxon-HE, which can\'t evaluate XPath 4.0. Use 3.1 for an XSLT 3.0 stylesheet')
				},
				annotations: readOnly
			}, async (args) => xpath.evaluate(args.xpath, args.path, args.xpathVersion, args.xpathDefaultNamespace));
		}
		mcp.registerTool('find_declaration', {
			title: 'Find the declaration of an XSLT component',
			description: 'Where a function, named template, global variable or parameter, mode, attribute set, key, accumulator, item type or ' +
				'character map is declared, as seen from an XSLT module - in the module, the modules it imports or includes, or the packages it uses - ' +
				'with its parameters and types, and its documentation: its xsl:note, or a comment just before it. When more than one module ' +
				'declares it, the one used (with the highest import precedence) is first. Use it for a function declared in a stylesheet; ' +
				'for a built-in function, use xpath_function. A module that a top-level stylesheet imports or includes sees that ' +
				'stylesheet\'s declarations too: the one found for it in the workspace, or topLevelStylesheet.',
			inputSchema: {
				path: filePath.describe('The XSLT module or XSpec file the name is used in'), name, kind,
				topLevelStylesheet: topLevelStylesheet('find the declarations with')
			},
			annotations: readOnly
		}, async (args) => tools.findDeclaration(args.path, args.name, args.kind, args.topLevelStylesheet));
		mcp.registerTool('find_references', {
			title: 'Find the references to an XSLT component',
			description: 'The references to a function, named template, global variable or parameter, mode, attribute set, key, accumulator or ' +
				'item type, as Find All References finds them in VS Code: in its module, the modules that import or use it, and the XSpec files ' +
				'that test it - with each reference\'s line. The XSpec uses (x:call, or a call in a test) come last, under \'Tested in XSpec\', ' +
				'each with its scenario: use it to find the tests of a function or named template.',
			inputSchema: { path: filePath.describe('The XSLT module or XSpec file the name is used in'), name, kind },
			annotations: readOnly
		}, async (args) => tools.findReferences(args.path, args.name, args.kind));
		mcp.registerTool('describe_type', {
			title: 'Describe an XSLT 4.0 item type',
			description: 'A named item type (xsl:item-type), as seen from an XSLT module: its declaration, and for a record type its fields - each with ' +
				'its type, ? for an optional field and its @field documentation - or for an enumeration type its values. A record(...) type ' +
				'written out can be given too. A module that a top-level stylesheet imports or includes sees that stylesheet\'s types too: ' +
				'the one found for it in the workspace, or topLevelStylesheet.',
			inputSchema: {
				path: filePath.describe('The XSLT module or XSpec file the type is used in'),
				name: z.string().describe('The item type\'s name, e.g. cx:complex, or a record(...) type'),
				topLevelStylesheet: topLevelStylesheet('find the types with')
			},
			annotations: readOnly
		}, async (args) => tools.describeType(args.path, args.name, args.topLevelStylesheet));
		mcp.registerTool('xpath_function', {
			title: 'Describe a built-in XPath or XSLT function',
			description: 'The signature and description of a built-in function - from XPath and XSLT, including the map:, array: and math: functions - ' +
				'for XPath 3.1 and XSLT 3.0, or XPath 4.0 and XSLT 4.0. For a function declared in a stylesheet, use find_declaration.',
			inputSchema: {
				name: z.string().describe('The function\'s name, e.g. replace, fn:replace or map:get'),
				xpathVersion: z.enum(['3.1', '4.0']).optional().describe('3.1 (for XSLT 3.0) by default, or 4.0 (for XSLT 4.0)')
			},
			annotations: readOnly
		}, async (args) => tools.xpathFunction(args.name, args.xpathVersion));
		mcp.registerTool('run_configuration', {
			title: 'How the user runs stylesheets',
			description: 'The configuration the user runs stylesheets and XSpec tests with in VS Code: the Saxon jar (with its edition, version and ' +
				'licence), the XML catalog, the XSpec installation and the XSLT packages. With a stylesheet, also its Quick Run: the XML source ' +
				'(its XML context file), its parameters, the classpath and the exact java command line - with the options the extension adds, ' +
				'e.g. --allowSyntaxExtensions:on, -catalog and -lib. Call it before running Saxon yourself, and use that command, so that the ' +
				'result is the same as the user\'s.',
			inputSchema: { path: filePath.optional().describe('A stylesheet (.xsl, .xslt) to describe the Quick Run of: absolute, or relative to the project\'s folder (the first workspace folder, unless set up for another)') },
			annotations: readOnly
		}, async (args) => ({ content: [{ type: 'text' as const, text: await RunConfiguration.describe(args.path) }] }));
		const configuration = async (run: Promise<{ text: string, isError: boolean }>) => {
			const { text, isError } = await run;
			return { content: [{ type: 'text' as const, text }], isError };
		};
		mcp.registerTool('test_configuration', {
			title: 'How to run an XSpec file\'s tests',
			description: 'The commands that run the tests of an XSpec file (.xspec) - for a stylesheet, or a Schematron schema - as the Test Explorer runs ' +
				'them: with the user\'s Saxon jar, and the options the extension works out - Saxon\'s syntax extensions, the XML catalog, the ' +
				'packages and the Saxon settings of the stylesheet\'s task. It runs nothing: run the commands yourself, in order, with the ' +
				'user\'s permission. XSpec has no single command here - the tests are compiled to a test runner, then it is run, with more ' +
				'steps for a Schematron - so don\'t write your own. The files they write go to a folder in the temporary files, not the ' +
				'project. The run exits with 0 even when tests fail: it also gives the command that summarises the result as text - the ' +
				'numbers passed, failed and pending, and each failure with what was expected and what the test gave - and lists the ' +
				'file\'s scenarios. Use it after changing a stylesheet or its XSpec file.',
			inputSchema: { path: filePath.describe('The XSpec file (.xspec): absolute, or relative to the project\'s folder (the first workspace folder, unless set up for another)') },
			annotations: readOnly
		}, async (args) => configuration(TestConfiguration.describe(args.path)));
		mcp.registerTool('validation_configuration', {
			title: 'How to validate an XML file with a Schematron schema',
			description: 'The command that validates an XML file with a Schematron schema (.sch), as Schematron: Validate does: one run of Saxon, with ' +
				'the schema compiled by SchXslt2 - with the user\'s Saxon jar, the phase, Saxon\'s syntax extensions and the XML catalog the ' +
				'extension works out. It runs nothing: run the command yourself, with the user\'s permission. It writes the SVRL report to the ' +
				'temporary files, and the result also gives the command that summarises the report as text - the number of failed assertions ' +
				'and successful reports, and each with its role, location and message - as the run exits with 0 even when assertions fail. ' +
				'A location is an XPath for the XML file: give it to evaluate_xpath for its line and column. Give a schema or an XML file; ' +
				'the other is its XML context file, or the schema its xml-model names - or give it as pairedWith.',
			inputSchema: {
				path: filePath.describe('A Schematron schema (.sch) or the XML file to validate'),
				pairedWith: z.string().optional().describe('The other file, if it isn\'t the one the extension knows: for a schema, the XML file to validate; for an XML file, the schema'),
				phase: z.string().optional().describe('The id of the schema\'s phase to validate with - the one chosen for the pair, or the default, if not given')
			},
			annotations: readOnly
		}, async (args) => configuration(ValidationConfiguration.describe(args.path, args.pairedWith, args.phase)));
		mcp.registerTool('output_origin', {
			title: 'Where a part of a stylesheet\'s output came from',
			description: 'For a line of a stylesheet\'s output, or some text in it: the instruction that wrote each part of it (its file, line and start ' +
				'tag), the template or function it is in (with its match, name and mode), and the input node it was written for - as an XPath for ' +
				'the input file, with its line. Use it to find the code behind wrong output, instead of searching the stylesheet for the output\'s ' +
				'text, which fails for computed output. It reads the output of the last debug session in the user\'s VS Code window - Run and ' +
				'Debug, or Run Without Debugging, with SaxonJ - so the user must have run the stylesheet there first; without a line or text, it ' +
				'lists the outputs. Only XML output (method xml) is mapped. It runs nothing.',
			inputSchema: {
				output: z.string().optional().describe('The output: its name as listed, or the file it was written to - not needed if there\'s only one, or with text'),
				line: z.number().int().min(1).optional().describe('A line of the output, from 1'),
				text: z.string().optional().describe('Text to find in the output, instead of a line - e.g. a wrong value'),
				occurrence: z.number().int().min(1).optional().describe('Which occurrence of the text - 1 by default')
			},
			annotations: readOnly
		}, async (args) => configuration(OutputOrigin.describe(args.output, args.line, args.text, args.occurrence)));
		mcp.registerTool('profile_configuration', {
			title: 'How to profile a stylesheet',
			description: 'The commands that profile a stylesheet - to find why a transformation is slow - as the Profile Stylesheet command does: its ' +
				'Quick Run (the XML source and parameters the user runs it with), with Saxon\'s timing profile, run several times so the first ' +
				'run, the Java VM\'s warm-up, can be left out. It needs Saxon-PE or EE, not Saxon-HE. It runs nothing: run the command yourself, ' +
				'with the user\'s permission. It writes the profile and the result to the temporary files, not the project. The result also ' +
				'gives the command that summarises the profile as text - the templates, functions and global variables ranked by net time (the time in ' +
				'the construct itself, not in what it calls), each with its share, calls, gross time and where it is declared - so that you don\'t read ' +
				'Saxon\'s own HTML or XML report. Use it only when asked about speed, and again after a change to compare.',
			inputSchema: {
				path: filePath.describe('The stylesheet (.xsl, .xslt) to profile: its top-level stylesheet - absolute, or relative to the project\'s folder (the first workspace folder, unless set up for another)'),
				source: z.string().optional().describe('The XML file to profile it on, if not the stylesheet\'s XML context file - e.g. a larger input, since a small one is mostly start-up. Absolute, or relative to the project\'s folder'),
				top: z.number().int().min(0).optional().describe('How many of the slowest constructs the summary shows - 15 by default; 0 for all')
			},
			annotations: readOnly
		}, async (args) => configuration(ProfileConfiguration.describe(args.path, args.top, args.source)));
		return mcp;
	}
}

// For VS Code's own MCP support (e.g. GitHub Copilot's agent mode): the server's URL and token, while it's enabled
export class XsltMcpDefinitionProvider implements vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition> {
	private readonly changed = new vscode.EventEmitter<void>();
	public readonly onDidChangeMcpServerDefinitions = this.changed.event;

	public constructor(private readonly server: XsltMcpServer) {
	}

	public refresh() {
		this.changed.fire();
	}

	public async provideMcpServerDefinitions(): Promise<vscode.McpHttpServerDefinition[]> {
		// this window's server - at its own port, for its workspace
		const url = this.server.url;
		if (!XsltMcpServer.isEnabled() || !url) {
			return [];
		}
		const token = await this.server.getToken();
		// the extension's version: when it changes, VS Code refreshes the tools it has cached, so a release's new tools are seen
		const version: string = vscode.extensions.getExtension('deltaxml.xslt-xpath')?.packageJSON.version ?? '0';
		return [new vscode.McpHttpServerDefinition('XSLT/XPath', vscode.Uri.parse(url), { Authorization: `Bearer ${token}` }, version)];
	}
}
