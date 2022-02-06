# calculateDiagnostics references:

- XSLTTokenDiagnostics.calculateDiagnostics
	- XSLTSymbolProvider.getDocumentSymbols

# processTopLevelImports references

XsltDefinitionProvider implements vscode.DefinitionProvider, vscode.CompletionItemProvider

- XSLTSymbolProvider.processTopLevelImports
	- XSLTDefinitionProvider.getImportedGlobals
	- XSLTSymbolProvider.getDocumentSymbols


					let refDocTokens = XSLTReferenceProvider.calculateReferences(instruction, langConfig, langConfig.docType, hrefDoc, eid.allTokens, eid.globalInstructionData, eid.allImportedGlobals);
"file:///Users/philipf/Documents/github/vscode-xslt-tokenizer/sample/included6.xsl"