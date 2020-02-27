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

let pos: LexPosition = {line: 0, startCharacter: 0, documentOffset: 0};

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
tokenType: TokenLevelState.number
},
{value: `+`,
tokenType: TokenLevelState.operator
},
{value: `2`,
tokenType: TokenLevelState.number
},]
  expect (r).toEqual(ts);
});

test(`stringLiteral escaping`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`'fir''st' || "seco""nd"`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `'fir''st'`,
tokenType: TokenLevelState.string
},
{value: `||`,
tokenType: TokenLevelState.operator
},
{value: `"seco""nd"`,
tokenType: TokenLevelState.string
},]
  expect (r).toEqual(ts);
});
       
test(`number token`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`255.7e-2+union`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `255.7e-2`,
tokenType: TokenLevelState.number
},
{value: `+`,
tokenType: TokenLevelState.operator
},
{value: `union`,
tokenType: TokenLevelState.nodeNameTest
},]
  expect (r).toEqual(ts);
});

test(`parenthesis sum`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`255+($union+28)`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `255`,
tokenType: TokenLevelState.number
},
{value: `+`,
tokenType: TokenLevelState.operator
},
{value: `(`,
tokenType: TokenLevelState.operator,
children:[
{value: `$union`,
tokenType: TokenLevelState.variable
},
{value: `+`,
tokenType: TokenLevelState.operator
},
{value: `28`,
tokenType: TokenLevelState.number
},]
},
{value: `)`,
tokenType: TokenLevelState.operator
},]
  expect (r).toEqual(ts);
});


        
test(`resolve ambiguous keywords`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`union and union and union div $var, div/and/union and .. and union`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `union`,
tokenType: TokenLevelState.nodeNameTest
},
{value: `and`,
tokenType: TokenLevelState.operator
},
{value: `union`,
tokenType: TokenLevelState.nodeNameTest
},
{value: `and`,
tokenType: TokenLevelState.operator
},
{value: `union`,
tokenType: TokenLevelState.nodeNameTest
},
{value: `div`,
tokenType: TokenLevelState.operator
},
{value: `$var`,
tokenType: TokenLevelState.variable
},
{value: `,`,
tokenType: TokenLevelState.operator
},
{value: `div`,
tokenType: TokenLevelState.nodeNameTest
},
{value: `/`,
tokenType: TokenLevelState.operator
},
{value: `and`,
tokenType: TokenLevelState.nodeNameTest
},
{value: `/`,
tokenType: TokenLevelState.operator
},
{value: `union`,
tokenType: TokenLevelState.nodeNameTest
},
{value: `and`,
tokenType: TokenLevelState.operator
},
{value: `..`,
tokenType: TokenLevelState.operator
},
{value: `and`,
tokenType: TokenLevelState.operator
},
{value: `union`,
tokenType: TokenLevelState.nodeNameTest
},]
  expect (r).toEqual(ts);
});


        
test(`literal uri`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`$a eq Q{http://example.com}div`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `$a`,
tokenType: TokenLevelState.variable
},
{value: `eq`,
tokenType: TokenLevelState.operator
},
{value: `Q{http://example.com}`,
tokenType: TokenLevelState.uriLiteral
},
{value: `div`,
tokenType: TokenLevelState.nodeNameTest
},]
  expect (r).toEqual(ts);
});
       
test(`attribute castable as simple type`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`@myatt castable as xs:integer and $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `@myatt`,
tokenType: TokenLevelState.attributeNameTest
},
{value: `castable`,
tokenType: TokenLevelState.operator
},
{value: `as`,
tokenType: TokenLevelState.operator
},
{value: `xs:integer`,
tokenType: TokenLevelState.simpleType
},
{value: `and`,
tokenType: TokenLevelState.operator
},
{value: `$b`,
tokenType: TokenLevelState.variable
},]
  expect (r).toEqual(ts);
});


        
test(`axis and nodetype`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`ancestor::node() union parent::table/@name`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `ancestor`,
tokenType: TokenLevelState.axisName
},
{value: `::`,
tokenType: TokenLevelState.operator
},
{value: `node`,
tokenType: TokenLevelState.nodeType
},
{value: `()`,
tokenType: TokenLevelState.operator
},
{value: `union`,
tokenType: TokenLevelState.operator
},
{value: `parent`,
tokenType: TokenLevelState.axisName
},
{value: `::`,
tokenType: TokenLevelState.operator
},
{value: `table`,
tokenType: TokenLevelState.nodeNameTest
},
{value: `/`,
tokenType: TokenLevelState.operator
},
{value: `@name`,
tokenType: TokenLevelState.attributeNameTest
},]
  expect (r).toEqual(ts);
});


        
test(`axis and attribute shorthand`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`ancestor::node() union parent::table/@name`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `ancestor`,
tokenType: TokenLevelState.axisName
},
{value: `::`,
tokenType: TokenLevelState.operator
},
{value: `node`,
tokenType: TokenLevelState.nodeType
},
{value: `()`,
tokenType: TokenLevelState.operator
},
{value: `union`,
tokenType: TokenLevelState.operator
},
{value: `parent`,
tokenType: TokenLevelState.axisName
},
{value: `::`,
tokenType: TokenLevelState.operator
},
{value: `table`,
tokenType: TokenLevelState.nodeNameTest
},
{value: `/`,
tokenType: TokenLevelState.operator
},
{value: `@name`,
tokenType: TokenLevelState.attributeNameTest
},]
  expect (r).toEqual(ts);
});
        
test(`function call`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`count($a)`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `count`,
tokenType: TokenLevelState.function
},
{value: `(`,
tokenType: TokenLevelState.operator,
children:[
{value: "$a",
tokenType: TokenLevelState.variable
},]
},
{value: `)`,
tokenType: TokenLevelState.operator
},]
  expect (r).toEqual(ts);
});

test(`* wildcard 1`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`* union $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `*`,
tokenType: TokenLevelState.nodeType
},
{value: `union`,
tokenType: TokenLevelState.operator
},
{value: `$b`,
tokenType: TokenLevelState.variable
},]
  expect (r).toEqual(ts);
});
        
test(`* wildcard 2`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`pre:* union $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `pre`,
tokenType: TokenLevelState.nodeNameTest
},
{value: `:*`,
tokenType: TokenLevelState.nodeType
},
{value: `union`,
tokenType: TokenLevelState.operator
},
{value: `$b`,
tokenType: TokenLevelState.variable
},]
  expect (r).toEqual(ts);
});
       
test(`* wildcard 3`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`/*:name div $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `/`,
tokenType: TokenLevelState.operator
},
{value: `*:`,
tokenType: TokenLevelState.operator
},
{value: `name`,
tokenType: TokenLevelState.nodeNameTest
},
{value: `div`,
tokenType: TokenLevelState.operator
},
{value: `$b`,
tokenType: TokenLevelState.variable
},]
  expect (r).toEqual(ts);
});
       
test(`* wildcard 4`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`Q{http://example.com}* eq $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `Q{http://example.com}`,
tokenType: TokenLevelState.uriLiteral
},
{value: `*`,
tokenType: TokenLevelState.nodeType
},
{value: `eq`,
tokenType: TokenLevelState.operator
},
{value: `$b`,
tokenType: TokenLevelState.variable
},]
  expect (r).toEqual(ts);
});

test(`* multiplication`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`$var * 8`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `$var`,
tokenType: TokenLevelState.variable
},
{value: `*`,
tokenType: TokenLevelState.operator
},
{value: `8`,
tokenType: TokenLevelState.number
},]
  expect (r).toEqual(ts);
});
       
test(`array curly brace`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`array {1}`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `array`,
tokenType: TokenLevelState.operator
},
{value: `{`,
tokenType: TokenLevelState.operator,
children:[
{value: "1",
tokenType: TokenLevelState.number
},]
},
{value: `}`,
tokenType: TokenLevelState.operator
},]
  expect (r).toEqual(ts);
});
       
test(`array square brace`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`array [1]`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `array`,
tokenType: TokenLevelState.operator
},
{value: `[`,
tokenType: TokenLevelState.operator,
children:[
{value: "1",
tokenType: TokenLevelState.number
},]
},
{value: `]`,
tokenType: TokenLevelState.operator
},]
  expect (r).toEqual(ts);
});
        
test(`declaration`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`map {25: first}`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `map`,
tokenType: TokenLevelState.operator
},
{value: `{`,
tokenType: TokenLevelState.operator,
children:[
{value: "25",
tokenType: TokenLevelState.number
},
{value: ":",
tokenType: TokenLevelState.operator
},
{value: "first",
tokenType: TokenLevelState.nodeNameTest
},]
},
{value: `}`,
tokenType: TokenLevelState.operator
},]
  expect (r).toEqual(ts);
});
        
test(`valid names`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`$pre:var22.5a || pre:name22.5b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `$pre:var22.5a`,
tokenType: TokenLevelState.variable
},
{value: `||`,
tokenType: TokenLevelState.operator
},
{value: `pre:name22.5b`,
tokenType: TokenLevelState.nodeNameTest
},]
  expect (r).toEqual(ts);
});
       
test(`valid names 2`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`$_pre:var22.5a || _pre:name22.5b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `$_pre:var22.5a`,
tokenType: TokenLevelState.variable
},
{value: `||`,
tokenType: TokenLevelState.operator
},
{value: `_pre:name22.5b`,
tokenType: TokenLevelState.nodeNameTest
},]
  expect (r).toEqual(ts);
});
               
test(`if then else`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`if ($a eq 5) then $a else union`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `if`,
tokenType: TokenLevelState.complexExpression
},
{value: `(`,
tokenType: TokenLevelState.operator,
children:[
{value: `$a`,
tokenType: TokenLevelState.variable
},
{value: `eq`,
tokenType: TokenLevelState.operator
},
{value: `5`,
tokenType: TokenLevelState.number
},]
},
{value: `)`,
tokenType: TokenLevelState.operator
},
{value: `then`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `$a`,
tokenType: TokenLevelState.variable
},
{value: `else`,
tokenType: TokenLevelState.complexExpression
},]
},
{value: `union`,
tokenType: TokenLevelState.nodeNameTest
},]
  expect (r).toEqual(ts);
});
       
test(`numeric literals with dot chars`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`.55 + 1.`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `.55`,
tokenType: TokenLevelState.number
},
{value: `+`,
tokenType: TokenLevelState.operator
},
{value: `1.`,
tokenType: TokenLevelState.number
},]
  expect (r).toEqual(ts);
});

test(`map type`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`$M instance of map(xs:integer, xs:string)`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `$M`,
tokenType: TokenLevelState.variable
},
{value: `instance`,
tokenType: TokenLevelState.operator
},
{value: `of`,
tokenType: TokenLevelState.operator
},
{value: `map`,
tokenType: TokenLevelState.simpleType
},
{value: `(`,
tokenType: TokenLevelState.operator,
children:[
{value: `xs:integer`,
tokenType: TokenLevelState.nodeNameTest
},
{value: `,`,
tokenType: TokenLevelState.operator
},
{value: `xs:string`,
tokenType: TokenLevelState.nodeNameTest
},]
},
{value: `)`,
tokenType: TokenLevelState.operator
},]
  expect (r).toEqual(ts);
});
       
test(`if else if else`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`if (level1) then 1 else if (level2) then 2 else 0`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `if`,
tokenType: TokenLevelState.complexExpression
},
{value: `(`,
tokenType: TokenLevelState.operator,
children:[
{value: `level1`,
tokenType: TokenLevelState.nodeNameTest
},]
},
{value: `)`,
tokenType: TokenLevelState.operator
},
{value: `then`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `1`,
tokenType: TokenLevelState.number
},
{value: `else`,
tokenType: TokenLevelState.complexExpression
},]
},
{value: `if`,
tokenType: TokenLevelState.complexExpression
},
{value: `(`,
tokenType: TokenLevelState.operator,
children:[
{value: `level2`,
tokenType: TokenLevelState.nodeNameTest
},]
},
{value: `)`,
tokenType: TokenLevelState.operator
},
{value: `then`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `2`,
tokenType: TokenLevelState.number
},
{value: `else`,
tokenType: TokenLevelState.complexExpression
},]
},
{value: `0`,
tokenType: TokenLevelState.number
},]
  expect (r).toEqual(ts);
});
        
test(`if if else else`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`if (level1) then if (level1.1) then 1.1 else 1.0 else 0`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `if`,
tokenType: TokenLevelState.complexExpression
},
{value: `(`,
tokenType: TokenLevelState.operator,
children:[
{value: `level1`,
tokenType: TokenLevelState.nodeNameTest
},]
},
{value: `)`,
tokenType: TokenLevelState.operator
},
{value: `then`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `if`,
tokenType: TokenLevelState.complexExpression
},
{value: `(`,
tokenType: TokenLevelState.operator,
children:[
{value: `level1.1`,
tokenType: TokenLevelState.nodeNameTest
},]
},
{value: `)`,
tokenType: TokenLevelState.operator
},
{value: `then`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `1.1`,
tokenType: TokenLevelState.number
},
{value: `else`,
tokenType: TokenLevelState.complexExpression
},]
},
{value: `1.0`,
tokenType: TokenLevelState.number
},
{value: `else`,
tokenType: TokenLevelState.complexExpression
},]
},
{value: `0`,
tokenType: TokenLevelState.number
},]
  expect (r).toEqual(ts);
});
        
test(`comma inside if expr - error`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`if ($a) then 1,2 else 1`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `if`,
tokenType: TokenLevelState.complexExpression
},
{value: `(`,
tokenType: TokenLevelState.operator,
children:[
{value: `$a`,
tokenType: TokenLevelState.variable
},]
},
{value: `)`,
tokenType: TokenLevelState.operator
},
{value: `then`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `1`,
tokenType: TokenLevelState.number
},
{value: `,`,
error: true,
tokenType: TokenLevelState.operator
},
{value: `2`,
tokenType: TokenLevelState.number
},
{value: `else`,
tokenType: TokenLevelState.complexExpression
},]
},
{value: `1`,
tokenType: TokenLevelState.number
},]
  expect (r).toEqual(ts);
});
       
        
test(`simple let expression`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`let $a := 2 return $a`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `let`,
tokenType: TokenLevelState.complexExpression
},
{value: `$a`,
tokenType: TokenLevelState.variable
},
{value: `:=`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `2`,
tokenType: TokenLevelState.number
},
{value: `return`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `$a`,
tokenType: TokenLevelState.variable
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
tokenType: TokenLevelState.complexExpression
},
{value: `$a`,
tokenType: TokenLevelState.variable
},
{value: `:=`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `2`,
tokenType: TokenLevelState.number
},
{value: `,`,
tokenType: TokenLevelState.operator
},
{value: `$b`,
tokenType: TokenLevelState.variable
},
{value: `:=`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `3`,
tokenType: TokenLevelState.number
},
{value: `return`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `(`,
tokenType: TokenLevelState.operator,
children:[
{value: `$a`,
tokenType: TokenLevelState.variable
},
{value: `,`,
tokenType: TokenLevelState.operator
},
{value: `$b`,
tokenType: TokenLevelState.variable
},]
},
{value: `)`,
tokenType: TokenLevelState.operator
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
tokenType: TokenLevelState.complexExpression
},
{value: `$a`,
tokenType: TokenLevelState.variable
},
{value: `in`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `1`,
tokenType: TokenLevelState.number
},
{value: `to`,
tokenType: TokenLevelState.operator
},
{value: `5`,
tokenType: TokenLevelState.number
},
{value: `,`,
tokenType: TokenLevelState.operator
},
{value: `$b`,
tokenType: TokenLevelState.variable
},
{value: `in`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `1`,
tokenType: TokenLevelState.number
},
{value: `to`,
tokenType: TokenLevelState.operator
},
{value: `5`,
tokenType: TokenLevelState.number
},
{value: `return`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `concat`,
tokenType: TokenLevelState.function
},
{value: `(`,
tokenType: TokenLevelState.operator,
children:[
{value: `$a`,
tokenType: TokenLevelState.variable
},
{value: `,`,
tokenType: TokenLevelState.operator
},
{value: `'.'`,
tokenType: TokenLevelState.string
},
{value: `,`,
tokenType: TokenLevelState.operator
},
{value: `$b`,
tokenType: TokenLevelState.variable
},]
},
{value: `)`,
tokenType: TokenLevelState.operator
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
tokenType: TokenLevelState.complexExpression
},
{value: `$a`,
tokenType: TokenLevelState.variable
},
{value: `:=`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `1`,
tokenType: TokenLevelState.number
},
{value: `,`,
tokenType: TokenLevelState.operator
},
{value: `$b`,
tokenType: TokenLevelState.variable
},
{value: `:=`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `2`,
tokenType: TokenLevelState.number
},
{value: `return`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `$a`,
tokenType: TokenLevelState.variable
},
{value: `+`,
tokenType: TokenLevelState.operator
},
{value: `2`,
tokenType: TokenLevelState.number
},
{value: `,`,
tokenType: TokenLevelState.operator
},]
},]
},]
},
{value: `union`,
tokenType: TokenLevelState.nodeNameTest
},]
  expect (r).toEqual(ts);
});
        
test(`everyExpr with sequence concatanation`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`every $a in * satisfies $a > 0, $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `every`,
tokenType: TokenLevelState.complexExpression
},
{value: `$a`,
tokenType: TokenLevelState.variable
},
{value: `in`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `*`,
tokenType: TokenLevelState.nodeType
},
{value: `satisfies`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `$a`,
tokenType: TokenLevelState.variable
},
{value: `>`,
tokenType: TokenLevelState.operator
},
{value: `0`,
tokenType: TokenLevelState.number
},
{value: `,`,
tokenType: TokenLevelState.operator
},]
},]
},
{value: `$b`,
tokenType: TokenLevelState.variable
},]
  expect (r).toEqual(ts);
});
       
test(`comment included in a sequence`, () => {
  let l: XPathLexer = new XPathLexer();
  let rx: Token[] = l.analyse(`$a, (:comment:), $b`,  ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens(rx);
  let ts: TokenLight[] = [
{value: `$a`,
tokenType: TokenLevelState.variable
},
{value: `,`,
tokenType: TokenLevelState.operator
},
{value: `(:comment:)`,
tokenType: TokenLevelState.comment
},
{value: `,`,
tokenType: TokenLevelState.operator
},
{value: `$b`,
tokenType: TokenLevelState.variable
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
tokenType: TokenLevelState.string
},
{value: `two`,
tokenType: TokenLevelState.string
},
{value: `three"`,
tokenType: TokenLevelState.string
},
{value: `||`,
tokenType: TokenLevelState.operator
},
{value: `"new"`,
tokenType: TokenLevelState.string
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
tokenType: TokenLevelState.complexExpression,
line: 0,
length: 2,
startCharacter: 0
},
{value: `(`,
tokenType: TokenLevelState.operator,
children:[
{value: `$a`,
tokenType: TokenLevelState.variable,
line: 0,
length: 2,
startCharacter: 4
},],
line: 0,
length: 1,
startCharacter: 3
},
{value: `)`,
tokenType: TokenLevelState.operator,
line: 0,
length: 1,
startCharacter: 6
},
{value: `then`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `$b`,
tokenType: TokenLevelState.variable,
line: 1,
length: 2,
startCharacter: 0
},
{value: `(:some`,
tokenType: TokenLevelState.comment,
line: 1,
length: 6,
startCharacter: 3
},
{value: `thing:)`,
tokenType: TokenLevelState.comment,
line: 2,
length: 7,
startCharacter: 0
},
{value: `else`,
tokenType: TokenLevelState.complexExpression,
line: 3,
length: 4,
startCharacter: 0
},],
line: 0,
length: 4,
startCharacter: 8
},
{value: `$c`,
tokenType: TokenLevelState.variable,
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
tokenType: TokenLevelState.comment,
line: 0,
length: 9,
startCharacter: 0
},
{value: `split:)`,
tokenType: TokenLevelState.comment,
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
tokenType: TokenLevelState.string,
line: 0,
length: 11,
startCharacter: 0
},
{value: `string'`,
tokenType: TokenLevelState.string,
line: 1,
length: 7,
startCharacter: 0
},
{value: `eq`,
tokenType: TokenLevelState.operator,
line: 1,
length: 2,
startCharacter: 8
},
{value: `$a`,
tokenType: TokenLevelState.variable,
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
tokenType: TokenLevelState.nodeNameTest,
line: 0,
length: 6,
startCharacter: 0
},
{value: `,`,
tokenType: TokenLevelState.operator,
line: 0,
length: 1,
startCharacter: 6
},
{value: `title`,
tokenType: TokenLevelState.nodeNameTest,
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
tokenType: TokenLevelState.operator,
line: 0,
length: 3,
startCharacter: 0
},
{value: `{`,
tokenType: TokenLevelState.operator,
children:[
{value: `abc:`,
tokenType: TokenLevelState.nodeNameTest,
line: 1,
length: 4,
startCharacter: 1
},
{value: `2`,
tokenType: TokenLevelState.number,
line: 1,
length: 1,
startCharacter: 6
},
{value: `def:`,
tokenType: TokenLevelState.nodeNameTest,
line: 2,
length: 4,
startCharacter: 1
},
{value: `23`,
tokenType: TokenLevelState.number,
line: 2,
length: 2,
startCharacter: 6
},
{value: `hij:`,
tokenType: TokenLevelState.nodeNameTest,
line: 3,
length: 4,
startCharacter: 1
},
{value: `24`,
tokenType: TokenLevelState.number,
line: 3,
length: 2,
startCharacter: 6
},],
line: 0,
length: 1,
startCharacter: 4
},
{value: `}`,
tokenType: TokenLevelState.operator,
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
tokenType: TokenLevelState.function,
line: 0,
length: 5,
startCharacter: 0
},
{value: `(`,
tokenType: TokenLevelState.operator,
line: 0,
length: 1,
startCharacter: 5
},
{value: `$a`,
tokenType: TokenLevelState.variable,
line: 0,
length: 2,
startCharacter: 6
},
{value: `)`,
tokenType: TokenLevelState.operator,
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
tokenType: TokenLevelState.complexExpression,
line: 0,
length: 3,
startCharacter: 0
},
{value: `$a`,
tokenType: TokenLevelState.variable,
line: 0,
length: 2,
startCharacter: 4
},
{value: `:=`,
tokenType: TokenLevelState.complexExpression,
line: 0,
length: 2,
startCharacter: 7
},
{value: `2`,
tokenType: TokenLevelState.number,
line: 0,
length: 1,
startCharacter: 10
},
{value: `return`,
tokenType: TokenLevelState.complexExpression,
line: 0,
length: 6,
startCharacter: 12
},
{value: `9`,
tokenType: TokenLevelState.number,
line: 0,
length: 1,
startCharacter: 19
},
{value: `+`,
tokenType: TokenLevelState.operator,
line: 0,
length: 1,
startCharacter: 21
},
{value: `$a`,
tokenType: TokenLevelState.variable,
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
tokenType: TokenLevelState.variable,
line: 0,
length: 5,
startCharacter: 0
},
{value: `&lt;`,
tokenType: TokenLevelState.operator,
line: 0,
length: 4,
startCharacter: 6
},
{value: `$that`,
tokenType: TokenLevelState.variable,
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
tokenType: TokenLevelState.number,
line: 0,
length: 2,
startCharacter: 0
},
{value: `&lt;`,
tokenType: TokenLevelState.operator,
line: 0,
length: 4,
startCharacter: 2
},
{value: `22`,
tokenType: TokenLevelState.number,
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
tokenType: TokenLevelState.variable,
line: 0,
length: 2,
startCharacter: 0
},
{value: `eq`,
tokenType: TokenLevelState.operator,
line: 0,
length: 2,
startCharacter: 3
},
{value: `&quot;n&quot;`,
tokenType: TokenLevelState.string,
line: 0,
length: 13,
startCharacter: 6
},
{value: `and`,
tokenType: TokenLevelState.operator,
line: 0,
length: 3,
startCharacter: 20
},
{value: `$b`,
tokenType: TokenLevelState.variable,
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
tokenType: TokenLevelState.variable,
line: 0,
length: 2,
startCharacter: 0
},
{value: `eq`,
tokenType: TokenLevelState.operator,
line: 0,
length: 2,
startCharacter: 3
},
{value: `&apos;n&apos;`,
tokenType: TokenLevelState.string,
line: 0,
length: 13,
startCharacter: 6
},
{value: `and`,
tokenType: TokenLevelState.operator,
line: 0,
length: 3,
startCharacter: 20
},
{value: `$b`,
tokenType: TokenLevelState.variable,
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
tokenType: TokenLevelState.variable,
line: 0,
length: 2,
startCharacter: 0
},
{value: `eq`,
tokenType: TokenLevelState.operator,
line: 0,
length: 2,
startCharacter: 3
},
{value: `&apos;`,
tokenType: TokenLevelState.string,
line: 0,
length: 6,
startCharacter: 6
},
{value: `the quick brown`,
tokenType: TokenLevelState.string,
line: 1,
length: 15,
startCharacter: 0
},
{value: `&apos;`,
tokenType: TokenLevelState.string,
line: 2,
length: 6,
startCharacter: 0
},
{value: `and`,
tokenType: TokenLevelState.operator,
line: 2,
length: 3,
startCharacter: 7
},
{value: `$b`,
tokenType: TokenLevelState.variable,
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
tokenType: TokenLevelState.variable,
line: 0,
length: 2,
startCharacter: 0
},
{value: `eq`,
tokenType: TokenLevelState.operator,
line: 0,
length: 2,
startCharacter: 3
},
{value: `&quot;`,
tokenType: TokenLevelState.string,
line: 0,
length: 6,
startCharacter: 6
},
{value: `the quick brown`,
tokenType: TokenLevelState.string,
line: 1,
length: 15,
startCharacter: 0
},
{value: `&quot;`,
tokenType: TokenLevelState.string,
line: 2,
length: 6,
startCharacter: 0
},
{value: `and`,
tokenType: TokenLevelState.operator,
line: 2,
length: 3,
startCharacter: 7
},
{value: `$b`,
tokenType: TokenLevelState.variable,
line: 2,
length: 2,
startCharacter: 11
},]
  expect (r).toEqual(ts);
});
        
test(`declaration`, () => {
  let l: XPathLexer = new XPathLexer();
  l.flatten = false;
  let rx: Token[] = l.analyse(`let $ac := function($a) as function(*) {function($b) {$b + 1}} return $a`, ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens2(rx);
  let ts: Token[] = [
{value: `let`,
tokenType: TokenLevelState.complexExpression,
line: 0,
length: 3,
startCharacter: 0
},
{value: `$ac`,
tokenType: TokenLevelState.variable,
line: 0,
length: 3,
startCharacter: 4
},
{value: `:=`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `function`,
tokenType: TokenLevelState.operator,
line: 0,
length: 8,
startCharacter: 11
},
{value: `(`,
tokenType: TokenLevelState.operator,
children:[
{value: `$a`,
tokenType: TokenLevelState.variable,
line: 0,
length: 2,
startCharacter: 20
},],
line: 0,
length: 1,
startCharacter: 19
},
{value: `)`,
tokenType: TokenLevelState.operator,
line: 0,
length: 1,
startCharacter: 22
},
{value: `as`,
tokenType: TokenLevelState.operator,
line: 0,
length: 2,
startCharacter: 24
},
{value: `function`,
tokenType: TokenLevelState.simpleType,
line: 0,
length: 8,
startCharacter: 27
},
{value: `(`,
tokenType: TokenLevelState.operator,
children:[
{value: `*`,
tokenType: TokenLevelState.nodeType,
line: 0,
length: 1,
startCharacter: 36
},],
line: 0,
length: 1,
startCharacter: 35
},
{value: `)`,
tokenType: TokenLevelState.operator,
line: 0,
length: 1,
startCharacter: 37
},
{value: `{`,
tokenType: TokenLevelState.operator,
children:[
{value: `function`,
tokenType: TokenLevelState.operator,
line: 0,
length: 8,
startCharacter: 40
},
{value: `(`,
tokenType: TokenLevelState.operator,
children:[
{value: `$b`,
tokenType: TokenLevelState.variable,
line: 0,
length: 2,
startCharacter: 49
},],
line: 0,
length: 1,
startCharacter: 48
},
{value: `)`,
tokenType: TokenLevelState.operator,
line: 0,
length: 1,
startCharacter: 51
},
{value: `{`,
tokenType: TokenLevelState.operator,
children:[
{value: `$b`,
tokenType: TokenLevelState.variable,
line: 0,
length: 2,
startCharacter: 54
},
{value: `+`,
tokenType: TokenLevelState.operator,
line: 0,
length: 1,
startCharacter: 57
},
{value: `1`,
tokenType: TokenLevelState.number,
line: 0,
length: 1,
startCharacter: 59
},],
line: 0,
length: 1,
startCharacter: 53
},
{value: `}`,
tokenType: TokenLevelState.operator,
line: 0,
length: 1,
startCharacter: 60
},],
line: 0,
length: 1,
startCharacter: 39
},
{value: `}`,
tokenType: TokenLevelState.operator,
line: 0,
length: 1,
startCharacter: 61
},
{value: `return`,
tokenType: TokenLevelState.complexExpression,
children:[
{value: `$a`,
tokenType: TokenLevelState.variable,
line: 0,
length: 2,
startCharacter: 70
},],
line: 0,
length: 6,
startCharacter: 63
},],
line: 0,
length: 2,
startCharacter: 8
},]
  expect (r).toEqual(ts);
});
        
test(`empty line in xpath`, () => {
  let l: XPathLexer = new XPathLexer();
  l.flatten = false;
  let rx: Token[] = l.analyse(`c,

d(b)`, ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens2(rx);
  let ts: Token[] = [
{value: `c`,
tokenType: TokenLevelState.nodeNameTest,
line: 0,
length: 1,
startCharacter: 0
},
{value: `,`,
tokenType: TokenLevelState.operator,
line: 0,
length: 1,
startCharacter: 1
},
{value: `d`,
tokenType: TokenLevelState.function,
line: 2,
length: 1,
startCharacter: 0
},
{value: `(`,
tokenType: TokenLevelState.operator,
children:[
{value: `b`,
tokenType: TokenLevelState.nodeNameTest,
line: 2,
length: 1,
startCharacter: 2
},],
line: 2,
length: 1,
startCharacter: 1
},
{value: `)`,
tokenType: TokenLevelState.operator,
line: 2,
length: 1,
startCharacter: 3
},]
  expect (r).toEqual(ts);
});


        
test(`blank line plus indent char`, () => {
  let l: XPathLexer = new XPathLexer();
  l.flatten = true;
  let rx: Token[] = l.analyse(`c,\n\n d(b)`, ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens2(rx);
  let ts: Token[] = [
{value: `c`,
tokenType: TokenLevelState.nodeNameTest,
line: 0,
length: 1,
startCharacter: 0
},
{value: `,`,
tokenType: TokenLevelState.operator,
line: 0,
length: 1,
startCharacter: 1
},
{value: `d`,
tokenType: TokenLevelState.function,
line: 2,
length: 1,
startCharacter: 1
},
{value: `(`,
tokenType: TokenLevelState.operator,
line: 2,
length: 1,
startCharacter: 2
},
{value: `b`,
tokenType: TokenLevelState.nodeNameTest,
line: 2,
length: 1,
startCharacter: 3
},
{value: `)`,
tokenType: TokenLevelState.operator,
line: 2,
length: 1,
startCharacter: 4
},]
  expect (r).toEqual(ts);
});

test(`wildcard following attribute axis shortcut: @`, () => {
  let l: XPathLexer = new XPathLexer();
  l.flatten = true;
  let rx: Token[] = l.analyse(`@* except @q,child::* except r`, ExitCondition.None, pos);
  let r: Token[] = Utilities.minimiseTokens2(rx);
  let ts: Token[] = [
{value: `@`,
tokenType: TokenLevelState.attributeNameTest,
line: 0,
length: 1,
startCharacter: 0
},
{value: `*`,
tokenType: TokenLevelState.nodeType,
line: 0,
length: 1,
startCharacter: 1
},
{value: `except`,
tokenType: TokenLevelState.operator,
line: 0,
length: 6,
startCharacter: 3
},
{value: `@q`,
tokenType: TokenLevelState.attributeNameTest,
line: 0,
length: 2,
startCharacter: 10
},
{value: `,`,
tokenType: TokenLevelState.operator,
line: 0,
length: 1,
startCharacter: 12
},
{value: `child`,
tokenType: TokenLevelState.axisName,
line: 0,
length: 5,
startCharacter: 13
},
{value: `::`,
tokenType: TokenLevelState.operator,
line: 0,
length: 2,
startCharacter: 18
},
{value: `*`,
tokenType: TokenLevelState.nodeType,
line: 0,
length: 1,
startCharacter: 20
},
{value: `except`,
tokenType: TokenLevelState.operator,
line: 0,
length: 6,
startCharacter: 22
},
{value: `r`,
tokenType: TokenLevelState.nodeNameTest,
line: 0,
length: 1,
startCharacter: 29
},]
  expect (r).toEqual(ts);
});
