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
----------- 
XsltDefinitionProvider
async provideDefinition
XsltTokenDefinitions.findDefinition
XsltTokenDefinitions.findMatchingDefintion
async seekDefinition - used by xsltReferenceProvider.ts
----------
# What works
Find all references from <xsl:mode name>
Rename Symbol from <xsl:mode name>
# What doesn't work
Goto Definition from anywhere
Rename Symbol for anywhere other than <xsl:mode name>