/**
 * Test suite for XPath lexical analysis within attribute contexts
 * 
 * This test suite validates the XPath lexer's ability to correctly tokenize XPath expressions
 * when they appear within XML attributes. It uses test cases from a JSON file containing
 * expected token patterns.
 * 
 * Each test case verifies:
 * 1. The correct number of tokens are generated
 * 2. No error tokens are present in the output
 * 3. Each token's value matches the expected value
 * 4. Each token's type matches the expected token type
 * 
 * @file xpLexerAsAttribute.spec.ts
 * @requires XPathLexer - the target of the test
 * 
 * Origin of the data file: @file xpInAsAttribute-expected.json
 * 1. @file xpInAsAttribute.xsl - the original XSLT source
 * 2. @file as-attributes-to-json-out.json - extracted with @template xslAsAttributesToJson.xsl
 * 3. the data file with expected tokens added by @module xpLexerTestGen.ts
 * 
 */
import * as vscode from 'vscode';
import * as os from 'os';
import { XPathLexer, ExitCondition, LexPosition } from '../../src/xpLexer';
import { ExpectedProblemData } from '../../__tests__/types';
import { expect, assert } from 'chai';
import { getCatalogGroup, getProblemDataFromFile } from '../../__tests__/utils/getCatalogGroup';
import { XPathConfiguration, XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { TestPaths } from '../../__tests__/utils/testPaths';
import path = require('path');
import fs = require('fs');

const catalogGroup = getCatalogGroup(0);

catalogGroup.files.forEach(file => {
    const loadedFileData: ExpectedProblemData = getProblemDataFromFile(file);
    describeTest(loadedFileData);
});

function describeTest(testData: ExpectedProblemData) {
    suite(`${testData.description}`, () => {
        const lexer = new XslLexer(XSLTConfiguration.configuration);
        // position info for tokens is computed from this start:
        const position: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
        const isTestingAsAttribute = testData.attributeName === 'as';

        const entries: any[] = [];

        testData.tests.forEach((testData, idx) => {
            const { label, xpath, problems } = testData;
            test(`${label} : ${xpath}`, async () => {
                // the call to the xpLexer.analyse function - the subject of the tests:
                let xslt = '';
                if (isTestingAsAttribute) {
                    xslt = `
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:ct="com.example.test" version="3.0">
    <xsl:function name="ct:run" as="${xpath}">
        <xsl:sequence select="1"/>
    </xsl:function>
</xsl:stylesheet>error`;
                } else {
                    xslt = `
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:ct="com.example.test" version="3.0">
    <xsl:function name="ct:run">
        <xsl:sequence select="${xpath}"/>
    </xsl:function>
</xsl:stylesheet>error`;
                }
                // console.log('*****XSLT*****');
                // console.log(xslt);
                const tempDir = os.tmpdir();
                const tempFilePath = path.join(tempDir, `my-temp-file-${Date.now()}-${idx}.xsl`);
                fs.writeFileSync(tempFilePath, xslt);
                const document = await vscode.workspace.openTextDocument(tempFilePath);
                const editor = await vscode.window.showTextDocument(document); // (optional, but can help trigger diagnostics)
                await editor.edit(editBuilder => {
                    editBuilder.insert(new vscode.Position(0, 0), ' '); // Insert a space at the start
                });
                await editor.edit(editBuilder => {
                    editBuilder.delete(new vscode.Range(0, 0, 0, 1)); // Remove the space
                });
                const diagnostics = await waitForDiagnostics(document.uri);
                diagnostics.pop(); // Remove final error as this is added to ensure diagnostics change is fired
                const latestProblems = diagnostics.map(problem => [problem.message, document.getText(problem.range)]);
                if (problems) {
                    latestProblems.forEach((latestProblem, idx) => {
                        const [expectedMessage, expectedTokenValue] = problems[idx];
                        const [latestMessage, latestTokenValue] = latestProblem;

                        expect(latestMessage).to.equal(expectedMessage);
                        expect(latestTokenValue).to.equal(expectedTokenValue);
                    });
                } else {
                    latestProblems.forEach((latestProblem) => {
                        entries.push(latestProblem);
                        console.log('message: ', latestProblem[0], 'tokenString: ', latestProblem[1]);
                    });


                    // assert.fail('No expected "problems" found in test. "problems" now added to test.');
                }
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                // const outputPath = resolvePath();

                // fs.writeFileSync(out)

                // diagnostics.forEach((token, idx) => {

                // });
            });
        });

    });
}

function resolvePath(suite: string) {
    return path.join(__dirname, '../../../../', TestPaths.testDataDir, suite + '.dg-test.json');
}

async function waitForDiagnostics(uri: vscode.Uri, timeout = 2000): Promise<vscode.Diagnostic[]> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            subscription.dispose();
            reject(new Error('Timed out waiting for diagnostics'));
        }, timeout);

        const subscription = vscode.languages.onDidChangeDiagnostics(e => {
            if (e.uris.some(changedUri => changedUri.toString() === uri.toString())) {
                const diags = vscode.languages.getDiagnostics(uri);
                clearTimeout(timer);
                subscription.dispose();
                resolve(diags);
            }
        });
    });
}


