/**
 * Test suite for entity references, e.g. '&company;', checked against the entities a DOCTYPE's internal subset declares
 * - in text, attribute values and XPath expressions. With no DOCTYPE, only the predefined entities are declared. With
 * declarations that can't be seen - an external DTD, or a parameter entity reference that brings one in - any
 * well-formed name is allowed
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function problems(doctype: string, body: string) {
	const xslt = `${doctype}<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
	<xsl:template name="t">${body}</xsl:template>
</xsl:stylesheet>`;
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.map((d) => [d.message, document.getText(d.range)]);
}

const notDeclared = (name: string) => [`XML: Entity '${name}' is not declared in the DOCTYPE`, `&${name};`];
const notDeclaredNoDoctype = (name: string) => [`XML: Entity '${name}' is not declared - only lt, gt, amp, quot and apos are predefined: declare others in a DOCTYPE, or use a character reference, e.g. &#160;`, `&${name};`];

const subset = `<!DOCTYPE xsl:stylesheet [
<!-- the company's name -->
<!ENTITY company "DeltaXignia Ltd">
<!ENTITY dash "--">
<!ENTITY % param "p">
]>
`;
// in text, an attribute value, and an XPath string
const uses = (name: string) => `<out a="&${name};">&${name};</out><xsl:sequence select="'&${name};'"/>`;

const cases: [string, string, string, string[][]][] = [
	['no DOCTYPE: predefined entities and character references', '', `<out a="&lt;&#160;">&amp;&#xA0;&quot;&apos;&gt;</out>`, []],
	['no DOCTYPE: another entity', '', `<out>&nbsp;</out>`, [notDeclaredNoDoctype('nbsp')]],
	['declared in the internal subset', subset, uses('company') + uses('dash'), []],
	['not declared in the internal subset: in text, an attribute value and XPath', subset, uses('compnay'),
		[notDeclared('compnay'), notDeclared('compnay'), notDeclared('compnay')]],
	['a parameter entity is not referenced as &name;', subset, `<out>&param;</out>`, [notDeclared('param')]],
	['predefined entities with a DOCTYPE', subset, `<out>&lt;&amp;&#160;</out>`, []],
	['a DOCTYPE with no declarations', '<!DOCTYPE xsl:stylesheet>\n', `<out>&company;</out>`, [notDeclared('company')]],
	['an external DTD: any name', '<!DOCTYPE xsl:stylesheet SYSTEM "entities.dtd">\n', `<out>&company;&anything;</out>`, []],
	['an external DTD and an internal subset: any name', '<!DOCTYPE xsl:stylesheet PUBLIC "-//X//DTD Y//EN" "y.dtd" [\n<!ENTITY a "a">\n]>\n',
		`<out>&a;&anything;</out>`, []],
	['a parameter entity reference in the subset: any name', '<!DOCTYPE xsl:stylesheet [\n<!ENTITY % chars SYSTEM "chars.ent">\n%chars;\n]>\n',
		`<out>&nbsp;&anything;</out>`, []],
];

suite('Entity references and the DOCTYPE', () => {
	cases.forEach(([label, doctype, body, expected]) => {
		test(label, async () => {
			assert.deepEqual(await problems(doctype, body), expected);
		});
	});
});
