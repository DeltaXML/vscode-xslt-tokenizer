# XML Testing Process

## Overview
This process involves testing XML/XSLT functionality through a series of automated steps.
The example set out here is for one of just two automated test suites defined in `.spec.ts` files.

This example checks `as` attributes found in XSLT instructions to ensure the generated tokens
are correct. In this case, that they have properties matching the expected tokens.


## Steps

### 1. Create XSLT Test File
- Create a new XSLT file (like `__tests__/data/xsl-test-files/xpInAsAttribute.xsl`)
- Include XPath expressions you want to test
- Save file in appropriate test directory

### 2. XSLT to JSON Conversion
- Convert the XSLT file into a JSON format using the `xslt: as-attributes-to-json` task
- This creates a JSON test specification file
- JSON structure includes a set of tests
- Each test is represented by an array with `name` and `xpath` array items

### 3. Generate Expected Tokens 
- Run the launch task "`Add expected tokens to XP Lexer Test`" to process the JSON file
- System analyzes XPath expressions
- Automatically adds expected token results to JSON file

### 4. Execute Test
- Run the test using `npm test`
- The `__tests__/xpLexerAsAttribute.spec.ts` file loads the JSON created in *Step 3*
- The Jest test framework compares actual vs expected tokens
- Provides confidence that features relying on XSLT/XPath tokens will work as expected

## Notes
- Keep XPath expressions clear and focused
- Review generated expected token data in _Step 3_ for accuracy

## Test Strategy
The XSLT/XPath extension has evolved organically without any automated tests except those used
at the time of project inception.

The manual test strategy involves manually opening `*.xsl` files in the `sample` directory, along with other
XSLT resources such as those found in the W3C XSLT tests. The following are the main features tested regularly.

- Running XSLT using `tasks.json` (Task Providers for SaxonJ and SaxonJS)
- Syntax-highlighting of XSLT and XPath (Lexers for XSLT and XPath)
- Problem reporting for XSLT and XPath syntax (Linter)
- Code formatting of XSLT and XPath (Formatting Provider)

The tokens created by this extension's lexers are used in all XSLT/XPath language features with just one exception:
when running XSLT tasks. If there's a problem with XPath generated tokens, all these language features are compromised.

Syntax-highlighting proves to be a very effective way for manually testing the lexer behaviour. If tokens are highlighted
badly then we know we have a problem that will affect other features like the linter or code-formatting provider.


## Conclusion
The tests, with their expected token data, ensure later releases do not
change the token structure inadvertently.