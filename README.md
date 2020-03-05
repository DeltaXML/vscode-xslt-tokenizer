# XPath Rising

_This project uses the proposed API for Semantic Tokens VSCode Extensions._

*XPath Rising* is a VSCode extension for the syntax highlighting of XSLT and XPath.


The XSLT demo file loaded in VSCode with the extension running:

![Screenshot](xslt-demo2.png)

![Screenshot](xslt-demo3.png)

The XPath demo file loaded in VSCode with the extension running:

![Screenshot](xpath-demo.png)

## To install dependencies
From terminal, run:

 ``npm install``

## Settings

Settings.json (in application directory)

```json
{
	"[XPath]": {
		"editor.matchBrackets": "always",
		"editor.semanticHighlighting.enabled":true
	},
	"[xsl]": {
		"editor.semanticHighlighting.enabled":true
	}
}
```

## How to run

The VSCode Insiders release is required. Launch the extension and open the file `sample/basic.xpath`.

## How to run XPath Lexer tests

From terminal, run:

``npm test``

## State of development

- The XSLT and XPath lexers now conform to the XSLT 3.0 and XPath 3.1 specifications to create appropiate semtantic token types. The types used are mapped to TM Grammar Scopes in the configuration in *package.json*. 

The TM Scopes used by this project are sufficient for the popular general-purpose syntax highlighting themes to provide effective syntax highlighting. These scopes will be refined later to provide more granularity to allow color themes to provide language-specfic highlighting.


## XSLT 3.0 and XPath 3.1 lexer summary

### Main Features
- Hand-crafted lexer
- No regular expressions
- Iterates character by character
- Single pass with 1-character lookahead
- Disambiguates token based on previous/next token
- Uses stack to manages evaluation context scope
- No Abstract Syntax Tree.

### Diagnostics / Testing
- A set of high-level tests for XPath 3.1 expressions
- Generate tests from XPath expressions
- XPath Diagnosticts Tool
	- Lists all tokens for given XPath
	- Each token type and main properties
- XSLT Diagnostics Tool
	- Currently, only lists values for each XSLT token
	
## Implementation Details:

The [Semantic Tokens API](https://github.com/microsoft/vscode/wiki/Semantic-Highlighting-Overview) provides for tokens with two main attributes:
- Token Types - such as *keyword*, *variable*
- Token Modifiers - e.g. *documentation*, *static* 

## Sample Diagnostics:

### Character-level:
```
path: let $ac := function($a) as function(*) {function($b) {$b + 1}} return $a
===============================================================================================================
Cached Real Token                                 New Token       Value                         line:startChar
===============================================================================================================
                                                  lName           let_                              0:0
lName           let_                              lWs              _                                0:3
lName           let_                              lVar            $ac_                              0:4
lVar            $ac_                              lWs              _                                0:7
lVar            $ac_                              dSep            :=_                               0:8
dSep            :=_                               lWs              _                                0:10
dSep            :=_                               lName           function_                         0:11
```
### Token-level (Context enabled):

```
Value           Char-Type       Token-type
-------------------------------------------
let             lName           Declaration
$ac             lVar            Variable
:=              dSep            Declaration
--- children-start---
function        lName           Operator
(               lB              Operator
--- children-start---
$a              lVar            Variable
--- children-end ----
)               rB              Operator
as              lName           Operator
function        lName           SimpleType
(               lB              Operator
