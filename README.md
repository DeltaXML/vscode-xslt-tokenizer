# XPath 3.1 Semantic tokens sample

This project builds on the Semantic tokens VSCode Extensions sample to work with an XPath 3.1 lexer. This semantic tokens provider always returns all the tokens in a file.

The XPath demo file loaded in VSCode with the extension running:

![Screenshot](xpath-demo.png)

## To install dependencies
From terminal, run:

 ``npm install``

## Settings

Settings.json (in application directory)

{
	"[typescript]": {},
	"git.enableSmartCommit": true,
	"git.autofetch": true,
	"[XPath]": {
		"editor.matchBrackets": "always",
		"editor.semanticHighlighting.enabled":true
	},
	"window.zoomLevel": 0,
	"editor.matchBrackets": "always",
	"[xsl]": {
		"editor.semanticHighlighting.enabled":true
	}
}

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

## XPath 3.1 lexer summary

- Hand-crafted lexer
- No regular expressions
- Iterates character by character
- Single pass with character lookahead
- Disambiguates token based on previous/next token
- Manages evaluation context scope
- Intended for highlighting unused variables etc.
