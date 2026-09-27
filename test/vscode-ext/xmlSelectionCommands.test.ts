/**
 * Test suite for the XML selection commands: the 'XML: Select Element...' quick pick command is registered, and the
 * package.json contributions - the keybindings for macOS and Windows/Linux, limited to XML-based editors, and the
 * XML Selection submenu of the editor context menu
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import * as path from 'path';
import * as fs from 'fs';

const selectionCommands = ['xslt-xpath.selectCurrentElement', 'xslt-xpath.selectParentElement', 'xslt-xpath.selectFirstChildElement',
	'xslt-xpath.selectPrecedingElement', 'xslt-xpath.selectFollowingElement'];
const contributes = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8')).contributes;

suite('XML selection commands', () => {
	test('the quick pick command is registered', async () => {
		const extension = vscode.extensions.getExtension('deltaxml.xslt-xpath');
		await extension?.activate();
		const commands = await vscode.commands.getCommands(true);
		assert.includeMembers(commands, selectionCommands.concat('xslt-xpath.xmlSelectionPick', 'xslt-xpath.gotoXPath'));
	});

	test('each keybinding has macOS and Windows/Linux keys, only in XML-based editors', () => {
		selectionCommands.concat('xslt-xpath.xmlSelectionPick').forEach((command) => {
			const keybinding = contributes.keybindings.find((k: { command: string }) => k.command === command);
			assert.isDefined(keybinding, command);
			assert.match(keybinding.mac, /^shift\+cmd\+\d$/, command);
			assert.match(keybinding.key, /^ctrl\+shift\+\d$/, command);
			assert.include(keybinding.when, 'editorTextFocus', command);
			assert.include(keybinding.when, 'xslt', command);
		});
	});

	test('the XML Selection submenu has each command', () => {
		assert.deepEqual(contributes.submenus, [{ id: 'xslt-xpath.xmlSelection', label: 'XML Selection' }]);
		assert.includeDeepMembers(contributes.menus['editor/context'].map((m: { submenu?: string }) => m.submenu), ['xslt-xpath.xmlSelection']);
		const items = contributes.menus['xslt-xpath.xmlSelection'].map((m: { command: string }) => m.command);
		assert.deepEqual(items, ['xslt-xpath.selectCurrentElement', 'xslt-xpath.selectParentElement', 'xslt-xpath.selectFirstChildElement',
			'xslt-xpath.selectPrecedingElement', 'xslt-xpath.selectFollowingElement', 'xslt-xpath.gotoXPath']);
	});
});
