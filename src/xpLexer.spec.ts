// tslint:disable
import { XPathLexer, Token, TokenLight, TokenLevelState, Utilities } from './xpLexer';

test('items in returned legend must equal count of TokenLevelState enum', () => {
  let expectedTokenTypeCount = Object.keys(TokenLevelState).length / 2;
  let tokenLegend = XPathLexer.getTextmateTypeLegend();
  expect (tokenLegend.length).toEqual(expectedTokenTypeCount);
});


/// minimiseTokens2:
        
test(`multi-line if then else`, () => {
  let l: XPathLexer = new XPathLexer();
let xpath = `if ($a) then
$b (:some
thing:) 
else $c`;
  let rx: Token[] = l.analyse(xpath); let r: Token[] = Utilities.minimiseTokens2(xpath, rx);
  let ts: TokenLight[] = [
{value: `if`,
tokenType: TokenLevelState.Operator,
line: 0,
length: 2,
startCharacter: 0
},
{value: `(`,
tokenType: TokenLevelState.Operator,
children:[
{value: `$a`,
tokenType: TokenLevelState.Variable,
line: 0,
length: 2,
startCharacter: 4
},],
line: 0,
length: 1,
startCharacter: 3
},
{value: `)`,
tokenType: TokenLevelState.Operator,
line: 0,
length: 1,
startCharacter: 6
},
{value: `then`,
tokenType: TokenLevelState.Operator,
children:[
{value: `$b`,
tokenType: TokenLevelState.Variable,
line: 1,
length: 2,
startCharacter: 0
},
{value: `(:some`,
tokenType: TokenLevelState.Comment,
line: 1,
length: 6,
startCharacter: 3
},
{value: `thing:)`,
tokenType: TokenLevelState.Comment,
line: 2,
length: 7,
startCharacter: 0
},
{value: `else`,
tokenType: TokenLevelState.Operator,
line: 3,
length: 4,
startCharacter: 0
},],
line: 0,
length: 4,
startCharacter: 8
},
{value: `$c`,
tokenType: TokenLevelState.Variable,
line: 3,
length: 2,
startCharacter: 5
},]
  expect (r).toEqual(ts);
});
       
test(`multi-line comment`, () => {
  let l: XPathLexer = new XPathLexer();
let xpath = `(:comment
split:)`;
  let rx: Token[] = l.analyse(xpath); let r: Token[] = Utilities.minimiseTokens2(xpath, rx);
  let ts: TokenLight[] = [
{value: `(:comment`,
tokenType: TokenLevelState.Comment,
line: 0,
length: 9,
startCharacter: 0
},
{value: `split:)`,
tokenType: TokenLevelState.Comment,
line: 1,
length: 7,
startCharacter: 0
},]
  expect (r).toEqual(ts);
});
        
test(`multi-line string`, () => {
  let l: XPathLexer = new XPathLexer();
let xpath = `'multi-line
string' eq 
$a`;
  let rx: Token[] = l.analyse(xpath); let r: Token[] = Utilities.minimiseTokens2(xpath, rx);
  let ts: TokenLight[] = [
{value: `'multi-line`,
tokenType: TokenLevelState.String,
line: 0,
length: 11,
startCharacter: 0
},
{value: `string'`,
tokenType: TokenLevelState.String,
line: 1,
length: 7,
startCharacter: 0
},
{value: `eq`,
tokenType: TokenLevelState.Operator,
line: 1,
length: 2,
startCharacter: 8
},
{value: `$a`,
tokenType: TokenLevelState.Variable,
line: 2,
length: 2,
startCharacter: 0
},]
  expect (r).toEqual(ts);
});
        
test(`newline whitespace after comma`, () => {
let l: XPathLexer = new XPathLexer();
let xpath = "author,\n\ttitle";
let rx: Token[] = l.analyse(xpath); let r: Token[] = Utilities.minimiseTokens2(xpath, rx);
let ts: TokenLight[] = [
{value: `author`,
tokenType: TokenLevelState.Name,
line: 0,
length: 6,
startCharacter: 0
},
{value: `,`,
tokenType: TokenLevelState.Operator,
line: 0,
length: 1,
startCharacter: 6
},
{value: `title`,
tokenType: TokenLevelState.Name,
line: 1,
length: 5,
startCharacter: 1
},]
  expect (r).toEqual(ts);
});
       
test(`multiline map`, () => {
  let l: XPathLexer = new XPathLexer();
let xpath = `map {\n\tabc: 2\n\tdef: 23\n\thij: 24\n}`;
  let rx: Token[] = l.analyse(xpath); let r: Token[] = Utilities.minimiseTokens2(xpath, rx);
  let ts: TokenLight[] = [
{value: `map`,
tokenType: TokenLevelState.Operator,
line: 0,
length: 3,
startCharacter: 0
},
{value: `{`,
tokenType: TokenLevelState.Operator,
children:[
{value: `abc:`,
tokenType: TokenLevelState.Name,
line: 1,
length: 4,
startCharacter: 1
},
{value: `2`,
tokenType: TokenLevelState.Number,
line: 1,
length: 1,
startCharacter: 6
},
{value: `def:`,
tokenType: TokenLevelState.Name,
line: 2,
length: 4,
startCharacter: 1
},
{value: `23`,
tokenType: TokenLevelState.Number,
line: 2,
length: 2,
startCharacter: 6
},
{value: `hij:`,
tokenType: TokenLevelState.Name,
line: 3,
length: 4,
startCharacter: 1
},
{value: `24`,
tokenType: TokenLevelState.Number,
line: 3,
length: 2,
startCharacter: 6
},],
line: 0,
length: 1,
startCharacter: 4
},
{value: `}`,
tokenType: TokenLevelState.Operator,
line: 4,
length: 1,
startCharacter: 0
},]
  expect (r).toEqual(ts);
});
        
test(`flatten token structure`, () => {
  let l: XPathLexer = new XPathLexer();
  l.flatten = true;
let xpath = `count($a)`;
  let rx: Token[] = l.analyse(xpath); let r: Token[] = Utilities.minimiseTokens2(xpath, rx);
  let ts: TokenLight[] = [
{value: `count`,
tokenType: TokenLevelState.Function,
line: 0,
length: 5,
startCharacter: 0
},
{value: `(`,
tokenType: TokenLevelState.Operator,
line: 0,
length: 1,
startCharacter: 5
},
{value: `$a`,
tokenType: TokenLevelState.Variable,
line: 0,
length: 2,
startCharacter: 6
},
{value: `)`,
tokenType: TokenLevelState.Operator,
line: 0,
length: 1,
startCharacter: 8
},]
  expect (r).toEqual(ts);
});
              
test(`return declaration preceding number`, () => {
  let l: XPathLexer = new XPathLexer();
  l.flatten = true;
let xpath = `let $a := 2 return 9 + $a`;
  let rx: Token[] = l.analyse(xpath); let r: Token[] = Utilities.minimiseTokens2(xpath, rx);
  let ts: Token[] = [
{value: `let`,
tokenType: TokenLevelState.Declaration,
line: 0,
length: 3,
startCharacter: 0
},
{value: `$a`,
tokenType: TokenLevelState.Variable,
line: 0,
length: 2,
startCharacter: 4
},
{value: `:=`,
tokenType: TokenLevelState.Operator,
line: 0,
length: 2,
startCharacter: 7
},
{value: `2`,
tokenType: TokenLevelState.Number,
line: 0,
length: 1,
startCharacter: 10
},
{value: `return`,
tokenType: TokenLevelState.Declaration,
line: 0,
length: 6,
startCharacter: 12
},
{value: `9`,
tokenType: TokenLevelState.Number,
line: 0,
length: 1,
startCharacter: 19
},
{value: `+`,
tokenType: TokenLevelState.Operator,
line: 0,
length: 1,
startCharacter: 21
},
{value: `$a`,
tokenType: TokenLevelState.Variable,
line: 0,
length: 2,
startCharacter: 23
},]
  expect (r).toEqual(ts);
});

