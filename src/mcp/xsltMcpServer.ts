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
import { McpServer, StreamableHTTPServerTransport, z } from './sdk';
import { declarationKindNames, XsltMcpTools, XsltModules } from './xsltMcpTools';

// The extension's MCP server, for AI assistants: tools that use its linter and its knowledge of XSLT modules (see
// XsltMcpTools). It runs in the extension host, so the tools use the same code as the editor - with the Streamable
// HTTP transport, on 127.0.0.1 at the port of XSLT.mcp.port, as VS Code (for GitHub Copilot) and command-line agents
// (e.g. Claude Code) can both connect to it. Each request needs the token, kept in the secret storage - the same for
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

	public constructor(private readonly secrets: vscode.SecretStorage, modules: XsltModules) {
		this.tools = new XsltMcpTools(modules);
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

	public static port() {
		return vscode.workspace.getConfiguration('XSLT.mcp').get<number>('port', 6745);
	}

	public static url(port = XsltMcpServer.port()) {
		return `http://127.0.0.1:${port}/mcp`;
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

	// listening - or not, e.g. when another window has the port: false
	public async start(port = XsltMcpServer.port()): Promise<boolean> {
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
				XsltMcpServer.log.warn(error.code === 'EADDRINUSE' ? `port ${port} is in use - e.g. by the MCP server of another VS Code window` : `not started: ${error.message}`);
				this.httpServer = undefined;
				resolve(false);
			});
			server.listen(port, '127.0.0.1', () => {
				XsltMcpServer.log.info(`listening at ${XsltMcpServer.url(port)}`);
				resolve(true);
			});
		});
	}

	public stop() {
		this.httpServer?.close();
		this.httpServer = undefined;
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
		const mcp = this.createServer();
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		response.on('close', () => {
			transport.close();
			mcp.close();
		});
		await mcp.connect(transport);
		await transport.handleRequest(request, response, message);
	}

	private createServer() {
		const version: string = vscode.extensions.getExtension('deltaxml.xslt-xpath')?.packageJSON.version ?? '0';
		const mcp = new McpServer({ name: 'xslt-xpath', version });
		const tools = this.tools;
		const filePath = z.string().describe('The file\'s path: absolute, or relative to the first workspace folder');
		const minSeverity = z.enum(['error', 'warning', 'info', 'hint']);
		const name = z.string().describe('The name as written in the module, e.g. f:area, or $config for a variable, or f:area#2 for a function of arity 2');
		const kind = z.enum(declarationKindNames).optional().describe('The kind of declaration - any kind, if not given');
		const readOnly = { readOnlyHint: true, openWorldHint: false };
		mcp.registerTool('lint_file', {
			title: 'Lint an XSLT or XSpec file',
			description: 'The problems in an XSLT module (.xsl, .xslt) or XSpec file (.xspec), as the XSLT/XPath extension reports them in the ' +
				'Problems panel - with its imports, includes and packages - whether or not the file is open in an editor. ' +
				'Each problem is given as line:column (1-based), severity and message.',
			inputSchema: { path: filePath, minSeverity: minSeverity.optional().describe('Only problems of this severity or worse - all, if not given') },
			annotations: readOnly
		}, async (args) => tools.lintFile(args.path, args.minSeverity));
		mcp.registerTool('lint_files', {
			title: 'Lint the XSLT and XSpec files in a folder',
			description: 'The problems in each XSLT module and XSpec file in a folder and its subfolders, as lint_file finds them - only the files ' +
				'with problems are listed, after a summary. XSpec\'s generated test runners (xspec/*-compiled.xsl) aren\'t checked.',
			inputSchema: {
				folder: z.string().optional().describe('The folder: absolute, or relative to the first workspace folder - the first workspace folder, if not given'),
				pattern: z.string().optional().describe('A glob pattern for the files, relative to the folder - default **/*.{xsl,xslt,xspec}'),
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
		mcp.registerTool('find_declaration', {
			title: 'Find the declaration of an XSLT component',
			description: 'Where a function, named template, global variable or parameter, mode, attribute set, key, accumulator, item type or ' +
				'character map is declared, as seen from an XSLT module - in the module, the modules it imports or includes, or the packages it uses - ' +
				'with its parameters and types. When more than one module declares it, the one used (with the highest import precedence) is first.',
			inputSchema: { path: filePath.describe('The XSLT module or XSpec file the name is used in'), name, kind },
			annotations: readOnly
		}, async (args) => tools.findDeclaration(args.path, args.name, args.kind));
		mcp.registerTool('find_references', {
			title: 'Find the references to an XSLT component',
			description: 'The references to a function, named template, global variable or parameter, mode, attribute set, key, accumulator or ' +
				'item type, as Find All References finds them in VS Code: in its module, the modules that import or use it, and the XSpec files ' +
				'that test it - with each reference\'s line.',
			inputSchema: { path: filePath.describe('The XSLT module or XSpec file the name is used in'), name, kind },
			annotations: readOnly
		}, async (args) => tools.findReferences(args.path, args.name, args.kind));
		mcp.registerTool('describe_type', {
			title: 'Describe an XSLT 4.0 item type',
			description: 'A named item type (xsl:item-type), as seen from an XSLT module: its declaration, and for a record type its fields - each with ' +
				'its type, and ? for an optional field - or for an enumeration type its values. A record(...) type written out can be given too.',
			inputSchema: { path: filePath.describe('The XSLT module or XSpec file the type is used in'), name: z.string().describe('The item type\'s name, e.g. cx:complex, or a record(...) type') },
			annotations: readOnly
		}, async (args) => tools.describeType(args.path, args.name));
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
		if (!XsltMcpServer.isEnabled()) {
			return [];
		}
		const token = await this.server.getToken();
		return [new vscode.McpHttpServerDefinition('XSLT/XPath', vscode.Uri.parse(XsltMcpServer.url()), { Authorization: `Bearer ${token}` })];
	}
}
