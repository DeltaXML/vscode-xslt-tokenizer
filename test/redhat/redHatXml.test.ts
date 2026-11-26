/**
 * Not part of the test suite: lint_file for an XML file with Red Hat's XML extension installed - run with
 * npm run test-redhat (see .vscode-test.redhat.js). Its problems - validation against an XML Schema, and well-formedness -
 * are given with the extension's own, each problem once; a file with no schema, a valid one, one changed on disk in the
 * workspace, one changed outside it - which VS Code doesn't reload - and with Red Hat's validation turned off.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
// the extension's module first, as when the extension is loaded - its modules, loaded in another order, have a cycle
import '../../src/extension';
import { XsltMcpTools } from '../../src/mcp/xsltMcpTools';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { XMLConfiguration } from '../../src/languageConfigurations';
import { redHatXmlId } from '../../src/redHatXml';
import { revertAndCloseEditorsIn } from '../vscode-ext/testEditors';

const workspace = vscode.workspace.workspaceFolders![0].uri.fsPath;
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'redhat-xml-'));

const xsd = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="order">
    <xs:complexType>
      <xs:sequence><xs:element name="item" type="xs:integer" maxOccurs="unbounded"/></xs:sequence>
      <xs:attribute name="id" type="xs:string" use="required"/>
    </xs:complexType>
  </xs:element>
</xs:schema>`;
const valid = `<order xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="order.xsd" id="a1">\n  <item>1</item>\n</order>\n`;
const invalid = `<order xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="order.xsd">\n  <item>one</item>\n</order>\n`;

suite('lint_file with Red Hat\'s XML extension', () => {

	const xmlProvider = new XsltSymbolProvider(XMLConfiguration.configuration, null);
	const tools = new XsltMcpTools({ problems: (document) => xmlProvider.diagnosticsFor(document), declarations: async () => ({ own: [], imported: [] }) });
	const lint = async (file: string) => (await tools.lintFile(file)).content[0].text;
	const write = (folder: string, name: string, text: string) => {
		const file = path.join(folder, name);
		fs.writeFileSync(file, text);
		return file;
	};

	suiteSetup(() => {
		assert.ok(vscode.extensions.getExtension(redHatXmlId), 'Red Hat\'s XML extension is installed for these tests');
		write(workspace, 'order.xsd', xsd);
		write(outside, 'order.xsd', xsd);
	});

	suiteTeardown(async () => {
		await revertAndCloseEditorsIn(workspace);
		await revertAndCloseEditorsIn(outside);
	});

	test('invalid against its XML Schema: Red Hat\'s problems - the first, as its server starts', async () => {
		const result = await lint(write(workspace, 'invalid.xml', invalid));
		assert.match(result, /^\d+ problems? in .*invalid\.xml:\n/, result);
		assert.match(result, /1:2 error Attribute 'id' is missing from element 'order'\. \(Red Hat XML\)/, result);
		assert.match(result, /2:9 error .*integer.* \(Red Hat XML\)/, result);
		assert.match(result, /\n\nChecked by the XSLT\/XPath extension and Red Hat's XML extension, which validates it against the schema or DTD associated with it$/, result);
	});

	test('not well-formed: each problem once - Red Hat\'s, where both report one on a line', async () => {
		const result = await lint(write(workspace, 'malformed.xml', '<order>\n  <item>1</items>\n</order>\n'));
		const problemLines = result.split('\n\n')[0].split('\n').slice(1);
		assert.isNotEmpty(problemLines, result);
		assert.isTrue(problemLines.every((line) => line.endsWith('(Red Hat XML)')), result);
		assert.lengthOf(problemLines.filter((line) => line.startsWith('2:')), 1, result);
	});

	test('no schema: well-formedness only, said once - not as a problem', async () => {
		const result = await lint(write(workspace, 'plain.xml', '<order>\n  <item>1</item>\n</order>\n'));
		assert.strictEqual(result.replace(/: .*plain\.xml/, ': plain.xml'),
			'No problems: plain.xml\n\nChecked by the XSLT/XPath extension and Red Hat\'s XML extension: no schema or DTD is associated with the file, so for well-formedness only');
	});

	test('valid against its XML Schema', async () => {
		const result = await lint(write(workspace, 'valid.xml', valid));
		assert.match(result, /^No problems: .*valid\.xml\n\nChecked by the XSLT\/XPath extension and Red Hat's XML extension, which reported no problems/, result);
	});

	test('changed on disk, in a workspace folder: validated as it is now', async () => {
		const file = write(workspace, 'changed.xml', invalid);
		assert.match(await lint(file), /\(Red Hat XML\)/);
		fs.writeFileSync(file, valid);
		assert.match(await lint(file), /^No problems: /);
	});

	test('changed on disk, outside the workspace folders: VS Code has the old version, so only the extension\'s check, of the file on disk', async () => {
		const file = write(outside, 'changed.xml', invalid);
		assert.match(await lint(file), /\(Red Hat XML\)/);
		fs.writeFileSync(file, '<order>\n  <item>1</items>\n</order>\n');
		const result = await lint(file);
		assert.match(result, /^2 problems in .*changed\.xml:\n2:4 error XML: .*\n2:12 error XML: Unexpected close tag 'items'\n\nChecked for well-formedness only, as the file is on disk: VS Code has an older version of it open/, result);
		assert.notMatch(result, /Red Hat XML\)/, result);
	});

	test('with Red Hat\'s validation turned off: well-formedness only', async () => {
		const configuration = vscode.workspace.getConfiguration('xml.validation');
		await configuration.update('enabled', false, vscode.ConfigurationTarget.Global);
		try {
			const result = await lint(write(workspace, 'off.xml', invalid));
			assert.match(result, /^No problems: .*off\.xml\n\nChecked for well-formedness only: Red Hat's XML extension is installed, but its validation is off/, result);
		} finally {
			await configuration.update('enabled', undefined, vscode.ConfigurationTarget.Global);
		}
	});
});
