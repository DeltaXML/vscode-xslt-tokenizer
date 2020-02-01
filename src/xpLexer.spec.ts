// tslint:disable
import { XPathLexer, Token, TokenLevelState, Utilities, ExitCondition, LexPosition, CharLevelState } from './xpLexer';

interface TokenLight {
  line?: number;
  startCharacter?: number;
  length?: number;
  value: string;
  charType?: CharLevelState;
  tokenType: TokenLevelState;
  context?: TokenLight|null;
  children?: TokenLight[];
  error?: boolean;
}

let pos: LexPosition = {line: 0, startCharacter: 0};

test('items in returned legend must equal count of TokenLevelState enum', () => {
  let expectedTokenTypeCount = Object.keys(TokenLevelState).length / 2;
  let tokenLegend = XPathLexer.getTextmateTypeLegend();
  expect (tokenLegend.length).toEqual(expectedTokenTypeCount);
});

test(`numeric operator`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`1 + 2`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `1`,
tokenType: TokenLevelState.Number
},
{value: `+`,
tokenType: TokenLevelState.Operator
},
{value: `2`,
tokenType: TokenLevelState.Number
},]
  expect (r).toEqual(ts);
});

test(`stringLiteral escaping`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`'fir''st' || "seco""nd"`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `'fir''st'`,
tokenType: TokenLevelState.String
},
{value: `||`,
tokenType: TokenLevelState.Operator
},
{value: `"seco""nd"`,
tokenType: TokenLevelState.String
},]
  expect (r).toEqual(ts);
});
       
test(`number token`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`255.7e-2+union`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `255.7e-2`,
tokenType: TokenLevelState.Number
},
{value: `+`,
tokenType: TokenLevelState.Operator
},
{value: `union`,
tokenType: TokenLevelState.Name
},]
  expect (r).toEqual(ts);
});

test(`parenthesis sum`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`255+($union+28)`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `255`,
tokenType: TokenLevelState.Number
},
{value: `+`,
tokenType: TokenLevelState.Operator
},
{value: `(`,
tokenType: TokenLevelState.Operator,
children:[
{value: `$union`,
tokenType: TokenLevelState.Variable
},
{value: `+`,
tokenType: TokenLevelState.Operator
},
{value: `28`,
tokenType: TokenLevelState.Number
},]
},
{value: `)`,
tokenType: TokenLevelState.Operator
},]
  expect (r).toEqual(ts);
});


        
test(`resolve ambiguous keywords`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`union and union and union div $var, div/and/union and .. and union`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `union`,
tokenType: TokenLevelState.Name
},
{value: `and`,
tokenType: TokenLevelState.Operator
},
{value: `union`,
tokenType: TokenLevelState.Name
},
{value: `and`,
tokenType: TokenLevelState.Operator
},
{value: `union`,
tokenType: TokenLevelState.Name
},
{value: `div`,
tokenType: TokenLevelState.Operator
},
{value: `$var`,
tokenType: TokenLevelState.Variable
},
{value: `,`,
tokenType: TokenLevelState.Operator
},
{value: `div`,
tokenType: TokenLevelState.Name
},
{value: `/`,
tokenType: TokenLevelState.Operator
},
{value: `and`,
tokenType: TokenLevelState.Name
},
{value: `/`,
tokenType: TokenLevelState.Operator
},
{value: `union`,
tokenType: TokenLevelState.Name
},
{value: `and`,
tokenType: TokenLevelState.Operator
},
{value: `..`,
tokenType: TokenLevelState.Operator
},
{value: `and`,
tokenType: TokenLevelState.Operator
},
{value: `union`,
tokenType: TokenLevelState.Name
},]
  expect (r).toEqual(ts);
});


        
test(`literal uri`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`$a eq Q{http://example.com}div`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `$a`,
tokenType: TokenLevelState.Variable
},
{value: `eq`,
tokenType: TokenLevelState.Operator
},
{value: `Q{http://example.com}`,
tokenType: TokenLevelState.UriLiteral
},
{value: `div`,
tokenType: TokenLevelState.Name
},]
  expect (r).toEqual(ts);
});
       
test(`attribute castable as simple type`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`@myatt castable as xs:integer and $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `@myatt`,
tokenType: TokenLevelState.Attribute
},
{value: `castable`,
tokenType: TokenLevelState.Operator
},
{value: `as`,
tokenType: TokenLevelState.Operator
},
{value: `xs:integer`,
tokenType: TokenLevelState.SimpleType
},
{value: `and`,
tokenType: TokenLevelState.Operator
},
{value: `$b`,
tokenType: TokenLevelState.Variable
},]
  expect (r).toEqual(ts);
});


        
test(`axis and nodetype`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`ancestor::node() union parent::table/@name`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `ancestor`,
tokenType: TokenLevelState.Axis
},
{value: `::`,
tokenType: TokenLevelState.Operator
},
{value: `node`,
tokenType: TokenLevelState.NodeType
},
{value: `()`,
tokenType: TokenLevelState.Operator
},
{value: `union`,
tokenType: TokenLevelState.Operator
},
{value: `parent`,
tokenType: TokenLevelState.Axis
},
{value: `::`,
tokenType: TokenLevelState.Operator
},
{value: `table`,
tokenType: TokenLevelState.Name
},
{value: `/`,
tokenType: TokenLevelState.Operator
},
{value: `@name`,
tokenType: TokenLevelState.Attribute
},]
  expect (r).toEqual(ts);
});


        
test(`axis and attribute shorthand`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`ancestor::node() union parent::table/@name`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `ancestor`,
tokenType: TokenLevelState.Axis
},
{value: `::`,
tokenType: TokenLevelState.Operator
},
{value: `node`,
tokenType: TokenLevelState.NodeType
},
{value: `()`,
tokenType: TokenLevelState.Operator
},
{value: `union`,
tokenType: TokenLevelState.Operator
},
{value: `parent`,
tokenType: TokenLevelState.Axis
},
{value: `::`,
tokenType: TokenLevelState.Operator
},
{value: `table`,
tokenType: TokenLevelState.Name
},
{value: `/`,
tokenType: TokenLevelState.Operator
},
{value: `@name`,
tokenType: TokenLevelState.Attribute
},]
  expect (r).toEqual(ts);
});
        
test(`function call`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`count($a)`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `count`,
tokenType: TokenLevelState.Function
},
{value: `(`,
tokenType: TokenLevelState.Operator,
children:[
{value: "$a",
tokenType: TokenLevelState.Variable
},]
},
{value: `)`,
tokenType: TokenLevelState.Operator
},]
  expect (r).toEqual(ts);
});

test(`* wildcard 1`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`* union $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `*`,
tokenType: TokenLevelState.NodeType
},
{value: `union`,
tokenType: TokenLevelState.Operator
},
{value: `$b`,
tokenType: TokenLevelState.Variable
},]
  expect (r).toEqual(ts);
});
        
test(`* wildcard 2`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`pre:* union $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `pre`,
tokenType: TokenLevelState.Name
},
{value: `:*`,
tokenType: TokenLevelState.NodeType
},
{value: `union`,
tokenType: TokenLevelState.Operator
},
{value: `$b`,
tokenType: TokenLevelState.Variable
},]
  expect (r).toEqual(ts);
});
       
test(`* wildcard 3`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`/*:name div $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `/`,
tokenType: TokenLevelState.Operator
},
{value: `*:`,
tokenType: TokenLevelState.Operator
},
{value: `name`,
tokenType: TokenLevelState.Name
},
{value: `div`,
tokenType: TokenLevelState.Operator
},
{value: `$b`,
tokenType: TokenLevelState.Variable
},]
  expect (r).toEqual(ts);
});
       
test(`* wildcard 4`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`Q{http://example.com}* eq $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `Q{http://example.com}`,
tokenType: TokenLevelState.UriLiteral
},
{value: `*`,
tokenType: TokenLevelState.NodeType
},
{value: `eq`,
tokenType: TokenLevelState.Operator
},
{value: `$b`,
tokenType: TokenLevelState.Variable
},]
  expect (r).toEqual(ts);
});

test(`* multiplication`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`$var * 8`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `$var`,
tokenType: TokenLevelState.Variable
},
{value: `*`,
tokenType: TokenLevelState.Operator
},
{value: `8`,
tokenType: TokenLevelState.Number
},]
  expect (r).toEqual(ts);
});
       
test(`array curly brace`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`array {1}`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `array`,
tokenType: TokenLevelState.Operator
},
{value: `{`,
tokenType: TokenLevelState.Operator,
children:[
{value: "1",
tokenType: TokenLevelState.Number
},]
},
{value: `}`,
tokenType: TokenLevelState.Operator
},]
  expect (r).toEqual(ts);
});
       
test(`array square brace`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`array [1]`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `array`,
tokenType: TokenLevelState.Operator
},
{value: `[`,
tokenType: TokenLevelState.Operator,
children:[
{value: "1",
tokenType: TokenLevelState.Number
},]
},
{value: `]`,
tokenType: TokenLevelState.Operator
},]
  expect (r).toEqual(ts);
});
        
test(`declaration`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`map {25: first}`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `map`,
tokenType: TokenLevelState.Operator
},
{value: `{`,
tokenType: TokenLevelState.Operator,
children:[
{value: "25",
tokenType: TokenLevelState.Number
},
{value: ":",
tokenType: TokenLevelState.Operator
},
{value: "first",
tokenType: TokenLevelState.Name
},]
},
{value: `}`,
tokenType: TokenLevelState.Operator
},]
  expect (r).toEqual(ts);
});
        
test(`valid names`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`$pre:var22.5a || pre:name22.5b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `$pre:var22.5a`,
tokenType: TokenLevelState.Variable
},
{value: `||`,
tokenType: TokenLevelState.Operator
},
{value: `pre:name22.5b`,
tokenType: TokenLevelState.Name
},]
  expect (r).toEqual(ts);
});
       
test(`valid names 2`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`$_pre:var22.5a || _pre:name22.5b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `$_pre:var22.5a`,
tokenType: TokenLevelState.Variable
},
{value: `||`,
tokenType: TokenLevelState.Operator
},
{value: `_pre:name22.5b`,
tokenType: TokenLevelState.Name
},]
  expect (r).toEqual(ts);
});
               
test(`if then else`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`if ($a eq 5) then $a else union`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `if`,
tokenType: TokenLevelState.Operator
},
{value: `(`,
tokenType: TokenLevelState.Operator,
children:[
{value: `$a`,
tokenType: TokenLevelState.Variable
},
{value: `eq`,
tokenType: TokenLevelState.Operator
},
{value: `5`,
tokenType: TokenLevelState.Number
},]
},
{value: `)`,
tokenType: TokenLevelState.Operator
},
{value: `then`,
tokenType: TokenLevelState.Operator,
children:[
{value: `$a`,
tokenType: TokenLevelState.Variable
},
{value: `else`,
tokenType: TokenLevelState.Operator
},]
},
{value: `union`,
tokenType: TokenLevelState.Name
},]
  expect (r).toEqual(ts);
});
       
test(`numeric literals with dot chars`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`.55 + 1.`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `.55`,
tokenType: TokenLevelState.Number
},
{value: `+`,
tokenType: TokenLevelState.Operator
},
{value: `1.`,
tokenType: TokenLevelState.Number
},]
  expect (r).toEqual(ts);
});

test(`map type`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`$M instance of map(xs:integer, xs:string)`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `$M`,
tokenType: TokenLevelState.Variable
},
{value: `instance`,
tokenType: TokenLevelState.Operator
},
{value: `of`,
tokenType: TokenLevelState.Operator
},
{value: `map`,
tokenType: TokenLevelState.SimpleType
},
{value: `(`,
tokenType: TokenLevelState.Operator,
children:[
{value: `xs:integer`,
tokenType: TokenLevelState.Name
},
{value: `,`,
tokenType: TokenLevelState.Operator
},
{value: `xs:string`,
tokenType: TokenLevelState.Name
},]
},
{value: `)`,
tokenType: TokenLevelState.Operator
},]
  expect (r).toEqual(ts);
});
       
test(`if else if else`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`if (level1) then 1 else if (level2) then 2 else 0`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `if`,
tokenType: TokenLevelState.Operator
},
{value: `(`,
tokenType: TokenLevelState.Operator,
children:[
{value: `level1`,
tokenType: TokenLevelState.Name
},]
},
{value: `)`,
tokenType: TokenLevelState.Operator
},
{value: `then`,
tokenType: TokenLevelState.Operator,
children:[
{value: `1`,
tokenType: TokenLevelState.Number
},
{value: `else`,
tokenType: TokenLevelState.Operator
},]
},
{value: `if`,
tokenType: TokenLevelState.Operator
},
{value: `(`,
tokenType: TokenLevelState.Operator,
children:[
{value: `level2`,
tokenType: TokenLevelState.Name
},]
},
{value: `)`,
tokenType: TokenLevelState.Operator
},
{value: `then`,
tokenType: TokenLevelState.Operator,
children:[
{value: `2`,
tokenType: TokenLevelState.Number
},
{value: `else`,
tokenType: TokenLevelState.Operator
},]
},
{value: `0`,
tokenType: TokenLevelState.Number
},]
  expect (r).toEqual(ts);
});
        
test(`if if else else`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`if (level1) then if (level1.1) then 1.1 else 1.0 else 0`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `if`,
tokenType: TokenLevelState.Operator
},
{value: `(`,
tokenType: TokenLevelState.Operator,
children:[
{value: `level1`,
tokenType: TokenLevelState.Name
},]
},
{value: `)`,
tokenType: TokenLevelState.Operator
},
{value: `then`,
tokenType: TokenLevelState.Operator,
children:[
{value: `if`,
tokenType: TokenLevelState.Operator
},
{value: `(`,
tokenType: TokenLevelState.Operator,
children:[
{value: `level1.1`,
tokenType: TokenLevelState.Name
},]
},
{value: `)`,
tokenType: TokenLevelState.Operator
},
{value: `then`,
tokenType: TokenLevelState.Operator,
children:[
{value: `1.1`,
tokenType: TokenLevelState.Number
},
{value: `else`,
tokenType: TokenLevelState.Operator
},]
},
{value: `1.0`,
tokenType: TokenLevelState.Number
},
{value: `else`,
tokenType: TokenLevelState.Operator
},]
},
{value: `0`,
tokenType: TokenLevelState.Number
},]
  expect (r).toEqual(ts);
});
        
test(`comma inside if expr - error`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`if ($a) then 1,2 else 1`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `if`,
tokenType: TokenLevelState.Operator
},
{value: `(`,
tokenType: TokenLevelState.Operator,
children:[
{value: `$a`,
tokenType: TokenLevelState.Variable
},]
},
{value: `)`,
tokenType: TokenLevelState.Operator
},
{value: `then`,
tokenType: TokenLevelState.Operator,
children:[
{value: `1`,
tokenType: TokenLevelState.Number
},
{value: `,`,
error: true,
tokenType: TokenLevelState.Operator
},
{value: `2`,
tokenType: TokenLevelState.Number
},
{value: `else`,
tokenType: TokenLevelState.Operator
},]
},
{value: `1`,
tokenType: TokenLevelState.Number
},]
  expect (r).toEqual(ts);
});
       
        
test(`simple let expression`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`let $a := 2 return $a`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `let`,
tokenType: TokenLevelState.Declaration
},
{value: `$a`,
tokenType: TokenLevelState.Variable
},
{value: `:=`,
tokenType: TokenLevelState.Declaration,
children:[
{value: `2`,
tokenType: TokenLevelState.Number
},
{value: `return`,
tokenType: TokenLevelState.Declaration,
children:[
{value: `$a`,
tokenType: TokenLevelState.Variable
},]
},]
},]
  expect (r).toEqual(ts);
});
       
test(`nested let expression`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`let $a := 2, $b := 3 return ($a, $b)`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `let`,
tokenType: TokenLevelState.Declaration
},
{value: `$a`,
tokenType: TokenLevelState.Variable
},
{value: `:=`,
tokenType: TokenLevelState.Declaration,
children:[
{value: `2`,
tokenType: TokenLevelState.Number
},
{value: `,`,
tokenType: TokenLevelState.Operator
},
{value: `$b`,
tokenType: TokenLevelState.Variable
},
{value: `:=`,
tokenType: TokenLevelState.Declaration,
children:[
{value: `3`,
tokenType: TokenLevelState.Number
},
{value: `return`,
tokenType: TokenLevelState.Declaration,
children:[
{value: `(`,
tokenType: TokenLevelState.Operator,
children:[
{value: `$a`,
tokenType: TokenLevelState.Variable
},
{value: `,`,
tokenType: TokenLevelState.Operator
},
{value: `$b`,
tokenType: TokenLevelState.Variable
},]
},
{value: `)`,
tokenType: TokenLevelState.Operator
},]
},]
},]
},]
  expect (r).toEqual(ts);
});
              
test(`nested for loop`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`for $a in 1 to 5, $b in 1 to 5 return concat($a, '.', $b)`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `for`,
tokenType: TokenLevelState.Declaration
},
{value: `$a`,
tokenType: TokenLevelState.Variable
},
{value: `in`,
tokenType: TokenLevelState.Declaration,
children:[
{value: `1`,
tokenType: TokenLevelState.Number
},
{value: `to`,
tokenType: TokenLevelState.Operator
},
{value: `5`,
tokenType: TokenLevelState.Number
},
{value: `,`,
tokenType: TokenLevelState.Operator
},
{value: `$b`,
tokenType: TokenLevelState.Variable
},
{value: `in`,
tokenType: TokenLevelState.Declaration,
children:[
{value: `1`,
tokenType: TokenLevelState.Number
},
{value: `to`,
tokenType: TokenLevelState.Operator
},
{value: `5`,
tokenType: TokenLevelState.Number
},
{value: `return`,
tokenType: TokenLevelState.Declaration,
children:[
{value: `concat`,
tokenType: TokenLevelState.Function
},
{value: `(`,
tokenType: TokenLevelState.Operator,
children:[
{value: `$a`,
tokenType: TokenLevelState.Variable
},
{value: `,`,
tokenType: TokenLevelState.Operator
},
{value: `'.'`,
tokenType: TokenLevelState.String
},
{value: `,`,
tokenType: TokenLevelState.Operator
},
{value: `$b`,
tokenType: TokenLevelState.Variable
},]
},
{value: `)`,
tokenType: TokenLevelState.Operator
},]
},]
},]
},]
  expect (r).toEqual(ts);
});

       
test(`nested let expression with sequence concatanation`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`let $a := 1, $b := 2 return $a + 2, union`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `let`,
tokenType: TokenLevelState.Declaration
},
{value: `$a`,
tokenType: TokenLevelState.Variable
},
{value: `:=`,
tokenType: TokenLevelState.Declaration,
children:[
{value: `1`,
tokenType: TokenLevelState.Number
},
{value: `,`,
tokenType: TokenLevelState.Operator
},
{value: `$b`,
tokenType: TokenLevelState.Variable
},
{value: `:=`,
tokenType: TokenLevelState.Declaration,
children:[
{value: `2`,
tokenType: TokenLevelState.Number
},
{value: `return`,
tokenType: TokenLevelState.Declaration,
children:[
{value: `$a`,
tokenType: TokenLevelState.Variable
},
{value: `+`,
tokenType: TokenLevelState.Operator
},
{value: `2`,
tokenType: TokenLevelState.Number
},
{value: `,`,
tokenType: TokenLevelState.Operator
},]
},]
},]
},
{value: `union`,
tokenType: TokenLevelState.Name
},]
  expect (r).toEqual(ts);
});
        
test(`everyExpr with sequence concatanation`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`every $a in * satisfies $a > 0, $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `every`,
tokenType: TokenLevelState.Declaration
},
{value: `$a`,
tokenType: TokenLevelState.Variable
},
{value: `in`,
tokenType: TokenLevelState.Declaration,
children:[
{value: `*`,
tokenType: TokenLevelState.NodeType
},
{value: `satisfies`,
tokenType: TokenLevelState.Declaration,
children:[
{value: `$a`,
tokenType: TokenLevelState.Variable
},
{value: `>`,
tokenType: TokenLevelState.Operator
},
{value: `0`,
tokenType: TokenLevelState.Number
},
{value: `,`,
tokenType: TokenLevelState.Operator
},]
},]
},
{value: `$b`,
tokenType: TokenLevelState.Variable
},]
  expect (r).toEqual(ts);
});
       
test(`comment included in a sequence`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`$a, (:comment:), $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `$a`,
tokenType: TokenLevelState.Variable
},
{value: `,`,
tokenType: TokenLevelState.Operator
},
{value: `(:comment:)`,
tokenType: TokenLevelState.Comment
},
{value: `,`,
tokenType: TokenLevelState.Operator
},
{value: `$b`,
tokenType: TokenLevelState.Variable
},]
  expect (r).toEqual(ts);
});
        
test(`multiline string literal`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`"one

two
three" || "new"`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `"one`,
tokenType: TokenLevelState.String
},
{value: `two`,
tokenType: TokenLevelState.String
},
{value: `three"`,
tokenType: TokenLevelState.String
},
{value: `||`,
tokenType: TokenLevelState.Operator
},
{value: `"new"`,
tokenType: TokenLevelState.String
},]
  expect (r).toEqual(ts);
});

/// minimiseTokens2:
        
test(`multi-line if then else`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`if ($a) then
$b (:some
thing:) 
else $c`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens2(rx);
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
  let rx: Token[] = l.analyse(`(:comment
split:)`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens2(rx);
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
  let rx: Token[] = l.analyse(`'multi-line
string' eq 
$a`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens2(rx);
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
let rx: Token[] = l.analyse(`author,\n\ttitle`,  ExitCondition.None, pos);
let r: Token[] = Utilities.minimiseTokens2(rx);
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
  let rx: Token[] = l.analyse(`map {\n\tabc: 2\n\tdef: 23\n\thij: 24\n}`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens2(rx);
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
  let rx: Token[] = l.analyse(`count($a)`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens2(rx);
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
  let rx: Token[] = l.analyse(`let $a := 2 return 9 + $a`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens2(rx);
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
tokenType: TokenLevelState.Declaration,
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


        
test(`entity-ref-lt`, () => {
  let l: XPathLexer = new XPathLexer();
  l.flatten = true;
  l.entityRefOn = true;
  let rx: Token[] = l.analyse(`$this &lt; $that`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens2(rx);
  let ts: Token[] = [
{value: `$this`,
tokenType: TokenLevelState.Variable,
line: 0,
length: 5,
startCharacter: 0
},
{value: `&lt;`,
tokenType: TokenLevelState.Operator,
line: 0,
length: 4,
startCharacter: 6
},
{value: `$that`,
tokenType: TokenLevelState.Variable,
line: 0,
length: 5,
startCharacter: 11
},]
  expect (r).toEqual(ts);
});
               
test(`entity-ref-number-default`, () => {
  let l: XPathLexer = new XPathLexer();
  l.flatten = true;
  let rx: Token[] = l.analyse(`22&lt;22`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens2(rx);
  let ts: Token[] = [
{value: `22`,
tokenType: TokenLevelState.Number,
line: 0,
length: 2,
startCharacter: 0
},
{value: `&lt;`,
tokenType: TokenLevelState.Operator,
line: 0,
length: 4,
startCharacter: 2
},
{value: `22`,
tokenType: TokenLevelState.Number,
line: 0,
length: 2,
startCharacter: 6
},]
  expect (r).toEqual(ts);
});
        
test(`double quote char ref string`, () => {
  let l: XPathLexer = new XPathLexer();
  l.flatten = true;
  let rx: Token[] = l.analyse(`$a eq &quot;n&quot; and $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens2(rx);
  let ts: Token[] = [
{value: `$a`,
tokenType: TokenLevelState.Variable,
line: 0,
length: 2,
startCharacter: 0
},
{value: `eq`,
tokenType: TokenLevelState.Operator,
line: 0,
length: 2,
startCharacter: 3
},
{value: `&quot;n&quot;`,
tokenType: TokenLevelState.String,
line: 0,
length: 13,
startCharacter: 6
},
{value: `and`,
tokenType: TokenLevelState.Operator,
line: 0,
length: 3,
startCharacter: 20
},
{value: `$b`,
tokenType: TokenLevelState.Variable,
line: 0,
length: 2,
startCharacter: 24
},]
  expect (r).toEqual(ts);
});
        
test(`double quote char ref string`, () => {
  let l: XPathLexer = new XPathLexer();
  l.flatten = true;
  let rx: Token[] = l.analyse(`$a eq &apos;n&apos; and $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens2(rx);
  let ts: Token[] = [
{value: `$a`,
tokenType: TokenLevelState.Variable,
line: 0,
length: 2,
startCharacter: 0
},
{value: `eq`,
tokenType: TokenLevelState.Operator,
line: 0,
length: 2,
startCharacter: 3
},
{value: `&apos;n&apos;`,
tokenType: TokenLevelState.String,
line: 0,
length: 13,
startCharacter: 6
},
{value: `and`,
tokenType: TokenLevelState.Operator,
line: 0,
length: 3,
startCharacter: 20
},
{value: `$b`,
tokenType: TokenLevelState.Variable,
line: 0,
length: 2,
startCharacter: 24
},]
  expect (r).toEqual(ts);
});
        
test(`multiline char ref single quote test`, () => {
  let l: XPathLexer = new XPathLexer();
  l.flatten = true;
  let rx: Token[] = l.analyse(`$a eq &apos;
the quick brown
&apos; and $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens2(rx);
  let ts: Token[] = [
{value: `$a`,
tokenType: TokenLevelState.Variable,
line: 0,
length: 2,
startCharacter: 0
},
{value: `eq`,
tokenType: TokenLevelState.Operator,
line: 0,
length: 2,
startCharacter: 3
},
{value: `&apos;`,
tokenType: TokenLevelState.String,
line: 0,
length: 6,
startCharacter: 6
},
{value: `the quick brown`,
tokenType: TokenLevelState.String,
line: 1,
length: 15,
startCharacter: 0
},
{value: `&apos;`,
tokenType: TokenLevelState.String,
line: 2,
length: 6,
startCharacter: 0
},
{value: `and`,
tokenType: TokenLevelState.Operator,
line: 2,
length: 3,
startCharacter: 7
},
{value: `$b`,
tokenType: TokenLevelState.Variable,
line: 2,
length: 2,
startCharacter: 11
},]
  expect (r).toEqual(ts);
});
        
test(`multiline char ref double quote test`, () => {
  let l: XPathLexer = new XPathLexer();
  l.flatten = true;
  let rx: Token[] = l.analyse(`$a eq &quot;
the quick brown
&quot; and $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens2(rx);
  let ts: Token[] = [
{value: `$a`,
tokenType: TokenLevelState.Variable,
line: 0,
length: 2,
startCharacter: 0
},
{value: `eq`,
tokenType: TokenLevelState.Operator,
line: 0,
length: 2,
startCharacter: 3
},
{value: `&quot;`,
tokenType: TokenLevelState.String,
line: 0,
length: 6,
startCharacter: 6
},
{value: `the quick brown`,
tokenType: TokenLevelState.String,
line: 1,
length: 15,
startCharacter: 0
},
{value: `&quot;`,
tokenType: TokenLevelState.String,
line: 2,
length: 6,
startCharacter: 0
},
{value: `and`,
tokenType: TokenLevelState.Operator,
line: 2,
length: 3,
startCharacter: 7
},
{value: `$b`,
tokenType: TokenLevelState.Variable,
line: 2,
length: 2,
startCharacter: 11
},]
  expect (r).toEqual(ts);
});

