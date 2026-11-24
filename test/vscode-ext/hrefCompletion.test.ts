/**
 * Completion of the path in an href (see src/hrefCompletion.ts): xsl:import and xsl:include in an XSLT module, and the
 * files an XSpec file refers to - with, for XSpec's x:import, a problem for a file that isn't XSpec or a folder, Go to
 * Definition, and a hover with what the file has
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import * as vscode from 'vscode';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { XSpecConfiguration } from '../../src/languageConfigurations';
import { LanguageConfiguration } from '../../src/xslLexer';

suite('Href completion', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'href-'));
	let count = 0;
	const write = (name: string, content: string) => {
		const fsPath = path.join(dir, name);
		fs.mkdirSync(path.dirname(fsPath), { recursive: true });
		fs.writeFileSync(fsPath, content);
		return fsPath;
	};
	const xslt = (body: string) => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">\n${body}\n</xsl:stylesheet>`;
	const xspec = (body: string) => `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" stylesheet="lib.xsl">\n${body}\n</x:description>`;
	write('lib.xsl', xslt(''));
	write('other.xslt', xslt(''));
	write('data.xml', '<doc/>');
	write('shared.xspec', xspec('<x:scenario label="row" shared="yes"><x:expect label="e" select="()"/></x:scenario>\n<x:scenario label="plain"><x:context><p/></x:context><x:expect label="e" select="()"/></x:scenario>'));
	write('sub/inner.xsl', xslt(''));
	write('sub/my file.xsl', xslt(''));
	write('.hidden/h.xsl', xslt(''));

	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
	});

	const open = async (name: string, content: string, marker = '|') => {
		const offset = content.indexOf(marker);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(write(name, content.replace(marker, ''))));
		return { document, position: document.positionAt(offset) };
	};
	const completions = async (extension: string, content: string) => {
		const { document, position } = await open(`complete${count++}${extension}`, content);
		const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, position);
		// not the files of the tests
		return list.items.filter((item) => (item.kind === vscode.CompletionItemKind.File || item.kind === vscode.CompletionItemKind.Folder) && !/^(complete|problems|nav)\d/.test(typeof item.label === 'string' ? item.label : item.label.label))
			.map((item) => `${typeof item.label === 'string' ? item.label : item.label.label}${item.insertText && item.insertText !== item.label ? '=' + item.insertText : ''}`).sort();
	};

	test('XSLT: xsl:import and xsl:include - the folders, and the XSLT modules, not the module itself or hidden folders', async () => {
		assert.deepEqual(await completions('.xsl', xslt('<xsl:import href="|"/>')), ['../', 'lib.xsl', 'other.xslt', 'sub/']);
		assert.deepEqual(await completions('.xsl', xslt('<xsl:include href="sub/|"/>')), ['inner.xsl', 'my file.xsl=my%20file.xsl']);
		// not other attributes, or a URI with a scheme
		assert.deepEqual(await completions('.xsl', xslt('<xsl:template match="|"/>')), []);
		assert.deepEqual(await completions('.xsl', xslt('<xsl:import href="urn:|"/>')), []);
	});

	test('XSLT: with the module\'s prefix for XSLT, e.g. xslt:import', async () => {
		const content = `<xslt:stylesheet xmlns:xslt="http://www.w3.org/1999/XSL/Transform" version="3.0">\n<xslt:import href="|"/>\n</xslt:stylesheet>`;
		assert.include(await completions('.xsl', content), 'lib.xsl');
	});

	test('XSpec: the files of the kind for each attribute - XSpec files for x:import, stylesheets for stylesheet, any for x:context', async () => {
		assert.deepEqual(await completions('.xspec', xspec('<x:import href="|"/>')), ['../', 'shared.xspec', 'sub/']);
		const stylesheets = await completions('.xspec', `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" stylesheet="|"/>`);
		assert.deepEqual(stylesheets, ['../', 'lib.xsl', 'other.xslt', 'sub/']);
		assert.includeMembers(await completions('.xspec', xspec('<x:scenario label="s"><x:context href="|"/></x:scenario>')), ['data.xml', 'lib.xsl', 'shared.xspec']);
		// relative to the base URI that xml:base changes
		assert.deepEqual(await completions('.xspec', xspec('<x:scenario label="s" xml:base="sub/"><x:context href="|"/></x:scenario>')), ['../', 'inner.xsl', 'my file.xsl=my%20file.xsl']);
	});

	const moduleDiagnostics = (XsltSymbolProvider as unknown as { moduleDiagnostics(d: vscode.TextDocument, parent: boolean, config: LanguageConfiguration): Promise<vscode.Diagnostic[]> }).moduleDiagnostics;
	const problems = async (content: string) => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(write(`problems${count++}.xspec`, content)));
		const diagnostics = await moduleDiagnostics.call(XsltSymbolProvider, document, false, XSpecConfiguration.configuration);
		return diagnostics.filter((d) => d.severity !== vscode.DiagnosticSeverity.Hint).map((d) => d.message);
	};

	test('XSpec x:import: a problem for a file that isn\'t an XSpec file, or a folder', async () => {
		assert.deepEqual(await problems(xspec('<x:import href="shared.xspec"/>')), []);
		assert.deepEqual(await problems(xspec('<x:import href="lib.xsl"/>')), ['XSpec: \'lib.xsl\' isn\'t an XSpec file - the outermost element of a file x:import imports must be x:description']);
		const folder = await problems(xspec('<x:import href="sub"/>'));
		assert.lengthOf(folder, 1, folder.join('\n'));
		assert.match(folder[0], /^XSpec: 'sub' of the href attribute is a folder, not a file/);
	});

	test('XSpec x:import: Go to Definition goes to the file, and the hover says what it has', async () => {
		const { document, position } = await open(`nav${count++}.xspec`, xspec('<x:import href="sha|red.xspec"/>'));
		const locations = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', document.uri, position);
		assert.deepEqual(locations.map((l) => path.basename('uri' in l ? l.uri.fsPath : l.targetUri.fsPath)), ['shared.xspec']);
		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, position);
		const text = hovers.flatMap((h) => h.contents.map((c) => typeof c === 'string' ? c : c.value)).join('\n');
		assert.include(text, '**XSpec file** shared.xspec');
		assert.include(text, '1 scenario, run with this file\'s - and 1 shared scenario for x:like: _row_');
	});
});
