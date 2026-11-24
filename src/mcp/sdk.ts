/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
// The parts of the MCP TypeScript SDK (v2: the 2026-07-28 protocol, with the 2025-era protocols served as before) the
// extension's MCP server uses. The SDK and zod are devDependencies: after tsc, `npm run bundle-mcp` replaces this module's
// output with a bundle of them (with esbuild), so the packaged extension doesn't need the SDK's own dependencies (hono,
// ajv...). The SDK's packages are ESM only, which tsc's CommonJS module resolution can't find - see tsconfig.json's paths,
// which esbuild must not use (see bundle-mcp)
export { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
export { loadSkills } from '@modelcontextprotocol/server/ext/skills/node';
export { toNodeHandler } from '@modelcontextprotocol/node';
export { z } from 'zod';
