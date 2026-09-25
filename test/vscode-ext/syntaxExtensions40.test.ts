/**
 * Test suite for the 'allowSyntaxExtensions40' task setting, for Saxon (Java) and SaxonC tasks
 *
 * 'auto' (and no setting) passes '--allowSyntaxExtensions:on' unless the processor is Saxon-HE, which fails every
 * transform when XPath 4.0 syntax is enabled. 'on' and 'off' are passed as they are.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { assert } from 'chai';
import { SaxonTaskProvider } from '../../src/saxonTaskProvider';
import { SaxonCTaskProvider } from '../../src/saxonCTaskProvider';

const saxonHEJars = ['/opt/SaxonHE13-0J/saxon-he-13.0.jar', '/opt/saxon/saxon9he.jar', 'C:\\Saxon\\saxon-he-12.5.jar'];
const saxonPEJars = ['/opt/SaxonPE13-0J/saxon-pe-13.0.jar', '/opt/SaxonEE13-0J/saxon-ee-13.0.jar', '/opt/saxon/saxon9pe.jar', '/opt/lib/saxon.jar'];
const saxonCHEPaths = ['/opt/SaxonCHE-macos-arm64-13-0-0/bin'];
const saxonCPEPaths = ['/opt/SaxonCPE-macos-arm64-13-0-0/bin', '/opt/Saxon C/bin'];

function syntaxExtensionArgs(execution: vscode.ProcessExecution | vscode.ShellExecution | vscode.CustomExecution | undefined) {
	return (execution as vscode.ProcessExecution).args.filter((arg) => arg.startsWith('--allowSyntaxExtensions'));
}

function javaTask(saxonJar: string, allowSyntaxExtensions40?: string) {
	const definition: vscode.TaskDefinition = { type: 'xslt', label: 'syntax extensions test', saxonJar, xsltFile: 'a.xsl', xmlSource: 'a.xml', messageEscaping: 'on' };
	if (allowSyntaxExtensions40) {
		definition.allowSyntaxExtensions40 = allowSyntaxExtensions40;
	}
	return new SaxonTaskProvider('').getTask(definition);
}

function saxonCTask(saxonCPath: string, allowSyntaxExtensions40?: string) {
	const definition: vscode.TaskDefinition = { type: 'xslt-c', label: 'syntax extensions test', saxonCPath, xsltFile: 'a.xsl', xmlSource: 'a.xml', unescapeMessages: false };
	if (allowSyntaxExtensions40) {
		definition.allowSyntaxExtensions40 = allowSyntaxExtensions40;
	}
	return new SaxonCTaskProvider('').getTask(definition);
}

suite('allowSyntaxExtensions40 task setting', () => {
	suiteSetup(() => {
		// SaxonC tasks locate the bundled xslt-resources/saxonc-transform.js script
		SaxonTaskProvider.extensionURI ??= vscode.Uri.file(path.resolve(__dirname, '..', '..', '..'));
	});

	test('Saxon-HE is recognised from the jar or SaxonC path', () => {
		saxonHEJars.concat(saxonCHEPaths).forEach((p) => assert.isTrue(SaxonTaskProvider.isSaxonHE(p), p));
		saxonPEJars.concat(saxonCPEPaths).forEach((p) => assert.isFalse(SaxonTaskProvider.isSaxonHE(p), p));
		assert.isFalse(SaxonTaskProvider.isSaxonHE(undefined));
	});

	['auto', undefined].forEach((setting) => {
		test(`xslt: ${setting ?? 'no setting'} enables XPath 4.0 syntax, except for Saxon-HE`, () => {
			saxonPEJars.forEach((jar) => assert.deepEqual(syntaxExtensionArgs(javaTask(jar, setting)?.execution), ['--allowSyntaxExtensions:on'], jar));
			saxonHEJars.forEach((jar) => assert.deepEqual(syntaxExtensionArgs(javaTask(jar, setting)?.execution), setting ? ['--allowSyntaxExtensions:off'] : [], jar));
		});
		test(`xslt-c: ${setting ?? 'no setting'} enables XPath 4.0 syntax, except for SaxonC-HE`, () => {
			saxonCPEPaths.forEach((p) => assert.deepEqual(syntaxExtensionArgs(saxonCTask(p, setting)?.execution), ['--allowSyntaxExtensions:on'], p));
			saxonCHEPaths.forEach((p) => assert.deepEqual(syntaxExtensionArgs(saxonCTask(p, setting)?.execution), setting ? ['--allowSyntaxExtensions:off'] : [], p));
		});
	});

	['on', 'off'].forEach((setting) => {
		test(`'${setting}' is passed as it is`, () => {
			saxonPEJars.concat(saxonHEJars).forEach((jar) => assert.deepEqual(syntaxExtensionArgs(javaTask(jar, setting)?.execution), ['--allowSyntaxExtensions:' + setting], jar));
			saxonCPEPaths.concat(saxonCHEPaths).forEach((p) => assert.deepEqual(syntaxExtensionArgs(saxonCTask(p, setting)?.execution), ['--allowSyntaxExtensions:' + setting], p));
		});
	});

	test('new quick run task definitions use auto', () => {
		assert.equal(SaxonTaskProvider.createQuickRunTaskDefinition('xslt', 'q', 'a.xsl', 'a.xml').allowSyntaxExtensions40, 'auto');
		assert.equal(SaxonTaskProvider.createQuickRunTaskDefinition('xslt-c', 'q', 'a.xsl', 'a.xml').allowSyntaxExtensions40, 'auto');
	});
});
