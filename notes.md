# calculateDiagnostics references:

- XSLTTokenDiagnostics.calculateDiagnostics
	- XSLTSymbolProvider.getDocumentSymbols

# processTopLevelImports references

XsltDefinitionProvider implements vscode.DefinitionProvider, vscode.CompletionItemProvider

- XSLTSymbolProvider.processTopLevelImports
	- XSLTDefinitionProvider.getImportedGlobals
	- XSLTSymbolProvider.getDocumentSymbols