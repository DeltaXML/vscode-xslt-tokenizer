/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
// The parts of the MCP TypeScript SDK the extension's MCP server uses. The SDK and zod are devDependencies: after tsc,
// `npm run bundle-mcp` replaces this module's output with a bundle of them (with esbuild), so the packaged extension
// doesn't need the SDK's own dependencies (express, hono, ajv...)
export { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
export { z } from 'zod';
