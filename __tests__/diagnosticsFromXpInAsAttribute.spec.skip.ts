import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { XsltTokenDiagnostics } from '../src/xsltTokenDiagnostics';
import { DocumentTypes, XslLexer } from '../src/xslLexer';
import { XSLTConfiguration } from '../src/languageConfigurations';
import { TestPaths } from './utils/testPaths';

describe('XsltTokenDiagnostics on xpInAsAttribute.xsl', () => {
  let document: vscode.TextDocument;
  let diagnostics: vscode.Diagnostic[];

  beforeAll(async () => {
    const testDataFilePath = path.join(TestPaths.testXslDataDir, 'xpInAsAttribute.xsl');
    const xslText = fs.readFileSync(testDataFilePath).toString();
    document = await vscode.workspace.openTextDocument({ content: xslText, language: 'xml' });
    const xsltConfig = XSLTConfiguration.configuration;
    const xslLexer = new XslLexer(xsltConfig);
    const allTokens = xslLexer.analyse(document.getText());

    // Prepare dummy globalInstructionData and importedInstructionData as needed
    const globalInstructionData: any[] = [];
    const importedInstructionData: any[] = [];
    const symbols: vscode.DocumentSymbol[] = [];

    diagnostics = XsltTokenDiagnostics.calculateDiagnostics(
      xsltConfig,
      DocumentTypes.XSLT,
      document,
      allTokens,
      globalInstructionData,
      importedInstructionData,
      symbols
    );
  });

  it('should return diagnostics for known errors in xpInAsAttribute.xsl', () => {
    // Check that at least some diagnostics are returned
    expect(diagnostics.length).toBeGreaterThan(0);

    // Optionally, check for specific error messages or codes
    const errorMessages = diagnostics.map(d => d.message);
    expect(errorMessages.some(msg => msg.includes('invalid'))).toBe(true);
    expect(errorMessages.some(msg => msg.includes('expected'))).toBe(true);
  });

  it('should include diagnostics for invalid types', () => {
    const invalidTypeDiagnostic = diagnostics.find(d => d.message.includes('xs:intege'));
    expect(invalidTypeDiagnostic).toBeDefined();
  });

  // Add more specific tests as needed for your error types and cases
});