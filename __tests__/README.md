# Test Process for the XPath Lexer and Linter

## Overview
This document explains how to create and run tests for the XPath lexer and, subsequently, for the XSLT linter - using the same XPath test data. These two components are the most important part of the extension as they drive amlost all language-specific features, from Syntax Highlighting to Symbol Referencing.

To test the XPath Lexer we need the following: 
1. name of the test
2. an XPath expression
3. a set of tokens that we expect the lexer to generate.

The Mocha test [xpathLexer_catalog.spec.ts](../test/unit/xpathLexer_catalog.spec.ts) loads XPath strings and their expected token information from the first 'group' in the [catalog.jsonc](data/xsl-test-files/catalog.jsonc) file.

Each file listed in the group contains a set of tests contained in a *.json* file, generated from a single *.xsl* source file. The *.xsl* test source file
(eg. [xpInAsAttribute.xsl](data/xsl-test-files/xpInAsAttribute.xsl)) comprises a set of `xsl:variable` instructions. A `attribute-name` processing instruction indicates whether the `as` or `select` attribute on the `xsl:variable` instruction is to be tested, for example: 

```xml
<!-- file: __tests__/data/xsl-test-files/xpTypes.xsl -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                expand-text="true" version="3.0">
  
  <?test-attribute select?>
  <xsl:variable name="test1" select="1 + 2"/>
  <xsl:variable name="test2" select="1 div 2"/>
  ...
</xsl:stylesheet>
```

## Generating Lexer test suite data from the XSLT source
*for example output see:  [xpInAsAttribute-test.json](data/xpInAsAttribute-test.json)*

1. open the new source XSLT test file (eg. *xsl-tests-files/xpInAsAttribute.xsl*) in the editor
2. invoke the VS Code command: *'Tasks: run tesk task'* from the command pallette<br>
   *(the task: *gen: expected test json from xsl - PICK input* is now triggered as it's the default)*
3. on the prompt *'Select source XSLT for test'*, pick the test file from the *recently used* list
4. once the generator completes, review the `tokens` property for each test in the generated JSON data file
5. if satisfied, add the test base name (eg. 'xpInAsAttribute') to the first group in [catalog.jsonc](data/xsl-test-files/catalog.jsonc)

## Executing the Lexer Test
Run the test from the terminal using the command `npm run unit-test`. Each named test, corresponding to an `xsl:variable` will invoke the lexer and verify the output tokens correspond to those generated in the test data.

All test suites will run, including the new test suite, which works as a regression test, ensuring future changes to 
the lexer do not affect existing functionality.

#### Aside
>#### The *'gen: expected test json from xsl - PICK input'* task comprises these stages:
>
>1. The first stage runs [xslXPathAttributesToJson.xsl](scripts/xslXPathAttributesToJson.xsl) to extract, from each 'xsl:variable' instruction, the name and XPath expression from the 'as' or 'select' attribute to an interim JSON file (named *temp/json-from-xml-out.json*).
>
>2. The final stage uses [xpLexerTestGen.ts](utils/xpLexerTestGen.ts) to run the XPath Lexer for each XPath expression (in the interim JSON file) and output data for the tokens on each XPath expression and add this to the JSON object.
>3. The JSON test file created is placed in the *__tests/data* directory, with a *-test.json* suffix added to the source XSLT selected

#### 3. Once the task has created the JSON test file, add the base name of the test to the [catalog.jsonc](data/xsl-test-files/catalog.jsonc) file.




## Notes
- Keep XPath expressions in the test *.xsl* files clear and focused
- Review generated expected token data for accuracy
- Use `<select>` elements for multi-line XPath expression testing (avoids XML attribute whitespace normalisation)
- Mark pending tests in the .xsl test file by suffixing the test label (the `name` attribute of `xsl:variable`) with '-PENDING' - these tests will be skipped

## Linter testing (extending Lexer tests):
  - Tests for the **Linter** with a *'.dg'* suffix can be generated from the Lexer tests using the shell command `npm test`
  - Linter tests use the 2nd group in the [catalog.jsonc](data/xsl-test-files/catalog.jsonc) file
  - The `tokens` property from the Lexer test is replaced with a `problems` token - for expected diagnostics values
  - The same `npm test` command is also used to run the **Linter** tests (when a `problems` property for expected diagnostics data exists for the test)
  - **Linter** tests rely on the VS Code API and are therefore run (using an older Mocha version) within the VS Code extension host
    - By default `isDirect` in [linter.test.ts](/test/vscode-ext/linter.test.ts) is set `false` so Linter tests bypass the VS Code editor (otherwise using the same API)<br>
  *this avoids a 500ms wait between each test - imposed by the editor for 'debouncing' purposes*

## Test Strategy
The XSLT/XPath extension has evolved organically without, until now, any automated tests except those used
at the time of project inception.

The manual test strategy involves manually opening `*.xsl` files in the `sample` directory, along with other
XSLT resources such as those found in the W3C XSLT tests. The following are the main features tested regularly.

- Running XSLT using `tasks.json` (Task Providers for SaxonJ and SaxonJS)
- Syntax-highlighting of XSLT and XPath (Lexers for XSLT and XPath)
- Problem reporting for XSLT and XPath syntax (Linter)
- Code formatting of XSLT and XPath (Formatting Provider)
- Auto completion
- Symbol referencing and outline views

Syntax-highlighting proves to be a highly effective way for manually testing the lexer behaviour. When tokens are highlighted
badly we know we have a problem that will affect other features like the linter or code-formatting provider.


The automated test setup described provides a useful supplement to this test strategy, but manual testing remains critical to this project.


## Conclusion
The tests, with their expected 'tokens' and 'problems' data, are 'regression tests' ensuring later releases do not
break features relying on the Lexer and Linter.