# XPath 3.1 Semantic tokens sample

This extends the Semantic tokens sample to work with an XPath lexer. This semantic tokens provider always returns all the tokens in a file.

![Screenshot](xpath-demo.png)

## To install dependencies
From terminal, run:

 ``npm install``

## How to run

Launch the extension and open the file `sample/basic.xpath`.

(Once the semantics tokens are complete) use the following settings:

```json
"editor.tokenColorCustomizationsExperimental": {
	"*.static": {
		"foreground": "#ff0000",
		"fontStyle": "bold"
	},
	"type": {
		"foreground": "#00aa00"
	}
}
```

## How to test XPath Lexer

From terminal, run:

``npm test``

## State of development

- This is currently a work in progress. Main XPath 3.1 tokenization is complete.

- Next step is to add semantic tokens for XPath. 

- The intention is to then add an XSLT lexer that delegates to the XPath lexer when required. Basic evaluation context will be passed from the XSLT lexer to the XPath lexer.
