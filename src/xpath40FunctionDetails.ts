/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */

/*
 NOTE: this code was auto-generated using resources/xslt/saxon-functions-to-typescript.xsl
 to transform the Saxon function library documentation: https://www.saxonica.com/documentation13/doc/functions.xml
 Do not edit - regenerate with: npm run generate-xpath40-functions
*/

import type { FunctionCompletionData } from './xsltTokenCompletions';

// XPath 4.0 functions: 291 entries
export const xpath40Data: FunctionCompletionData[] = [
	{
		name: "abs",
		signature: "abs($value as xs:numeric?) as xs:numeric?",
		description: "Returns the absolute value of a given number. Returns the same type as the supplied argument."
	},
	{
		name: "adjust-date-to-timezone",
		signature: "adjust-date-to-timezone($value as xs:date?, $timezone as xs:dayTimeDuration? := fn:implicit-timezone()) as xs:date?",
		description: "Returns a date value equivalent to the original date, but adjusted to a different timezone, or with the timezone removed."
	},
	{
		name: "adjust-dateTime-to-timezone",
		signature: "adjust-dateTime-to-timezone($value as xs:dateTime?, $timezone as xs:dayTimeDuration? := fn:implicit-timezone()) as xs:dateTime?",
		description: "Returns a dateTime value equivalent to the original dateTime, but adjusted to a different timezone, or with the timezone removed."
	},
	{
		name: "adjust-time-to-timezone",
		signature: "adjust-time-to-timezone($value as xs:time?, $timezone as xs:dayTimeDuration? := fn:implicit-timezone()) as xs:time?",
		description: "Returns a time value equivalent to the original time, but adjusted to a different timezone, or with the timezone removed."
	},
	{
		name: "all-different",
		signature: "all-different($values as xs:anyAtomicType*, $collation as xs:string? := fn:default-collation()) as xs:boolean",
		description: "Returns true if no two items in the supplied sequence are equal."
	},
	{
		name: "all-equal",
		signature: "all-equal($values as xs:anyAtomicType*, $collation as xs:string? := fn:default-collation()) as xs:boolean",
		description: "Returns true if all items in the supplied sequence (after atomization) are equal."
	},
	{
		name: "analyze-string",
		signature: "analyze-string($value as xs:string?, $pattern as xs:string, $flags as xs:string? := \"\") as element(fn:analyze-string-result)",
		description: "Analyzes a string using a regular expression, returning an XML structure that identifies which parts of the input string matched or failed to match the regular expression, and in the case of matched substrings, which substrings matched each capturing group in the regular expression."
	},
	{
		name: "apply",
		signature: "apply($function as fn(*), $arguments as array(*)) as item()*",
		description: "Makes a dynamic call on a function with an argument list supplied in the form of an array."
	},
	{
		name: "atomic-equal",
		signature: "atomic-equal($value1 as xs:anyAtomicType, $value2 as xs:anyAtomicType) as xs:boolean",
		description: "Determines whether two atomic items are equal, under the rules used for comparing keys in a map."
	},
	{
		name: "atomic-type-annotation",
		signature: "atomic-type-annotation($value as xs:anyAtomicType) as fn:schema-type-record",
		description: "Returns a record containing information about the type annotation of an atomic item."
	},
	{
		name: "available-environment-variables",
		signature: "available-environment-variables() as xs:string*",
		description: "Returns a list of environment variable names that are suitable for passing to environment-variable(), as a (possibly empty) sequence of strings."
	},
	{
		name: "avg",
		signature: "avg($values as xs:anyAtomicType*) as xs:anyAtomicType?",
		description: "Returns the average of a set of numbers or durations."
	},
	{
		name: "base-uri",
		signature: "base-uri($node as node()? := .) as xs:anyURI?",
		description: "Returns the base URI of a node."
	},
	{
		name: "boolean",
		signature: "boolean($input as item()*) as xs:boolean",
		description: "Obtains the effective boolean value of the supplied argument. The result is true if the argument value is a sequence starting with a node, or the singleton boolean true(), a singleton non-zero number, or a singleton non-zero-length string (or untypedAtomic). The result is false if the argument is an empty sequence, the singleton boolean false(), a singleton number zero or NaN, or a singleton zero-length string (or untypedAtomic). In all other cases the result is an error."
	},
	{
		name: "build-uri",
		signature: "build-uri($parts as fn:uri-structure-record, $options as map(*)? := {}) as xs:string",
		description: "Constructs a URI from the parts provided."
	},
	{
		name: "ceiling",
		signature: "ceiling($value as xs:numeric?) as xs:numeric?",
		description: "Rounds a value towards positive infinity."
	},
	{
		name: "char",
		signature: "char($value as (xs:string | xs:positiveInteger)) as xs:string",
		description: "Returns a string containing a particular character or glyph."
	},
	{
		name: "characters",
		signature: "characters($value as xs:string?) as xs:string*",
		description: "Splits the supplied string into a sequence of single-character strings."
	},
	{
		name: "civil-timezone",
		signature: "civil-timezone($value as xs:dateTime, $place as xs:string? := ()) as xs:dayTimeDuration",
		description: "Returns the timezone offset from UTC that is in conventional use at a given place and time."
	},
	{
		name: "codepoint-equal",
		signature: "codepoint-equal($value1 as xs:string?, $value2 as xs:string?) as xs:boolean?",
		description: "Compares two strings using the Unicode codepoint collation."
	},
	{
		name: "codepoints-to-string",
		signature: "codepoints-to-string($values as xs:integer*) as xs:string",
		description: "Converts a sequence of integers representing Unicode characters to the corresponding string."
	},
	{
		name: "collation",
		signature: "collation($options as map(*)) as xs:string",
		description: "Constructs a collation URI with requested properties."
	},
	{
		name: "collation-available",
		signature: "collation-available($collation as xs:string) as xs:boolean",
		description: "Asks whether a collation URI is recognized by the implementation."
	},
	{
		name: "collation-key",
		signature: "collation-key($value as xs:string, $collation as xs:string? := fn:default-collation()) as xs:base64Binary",
		description: "Returns a value that can be used for matching strings under a given collation. If two strings are equal under a given collation, then collation-key() when applied to these two strings returns values that compare equal."
	},
	{
		name: "collection",
		signature: "collection($source as xs:string? := ()) as item()*",
		description: "Returns a sequence of items making up the collection whose URI is supplied; or the default collection if no URI is supplied."
	},
	{
		name: "compare",
		signature: "compare($value1 as xs:anyAtomicType?, $value2 as xs:anyAtomicType?, $collation as xs:string? := fn:default-collation()) as xs:integer?",
		description: "Compares two strings using the specified collation, or the default collation if none is supplied."
	},
	{
		name: "concat",
		signature: "concat($values as xs:anyAtomicType* ... := ()) as xs:string",
		description: "Concatenates the string-values of the arguments into a single string. There must be at least two arguments."
	},
	{
		name: "contains",
		signature: "contains($value as xs:string?, $substring as xs:string?, $collation as xs:string? := fn:default-collation()) as xs:boolean",
		description: "Returns true if the second string is a substring of the first."
	},
	{
		name: "contains-subsequence",
		signature: "contains-subsequence($input as item()*, $subsequence as item()*, $compare as (fn(item(), item()) as xs:boolean?)? := fn:deep-equal#2) as xs:boolean",
		description: "Determines whether one sequence contains another as a contiguous subsequence, using a supplied callback function to compare items."
	},
	{
		name: "contains-token",
		signature: "contains-token($value as xs:string*, $token as xs:string, $collation as xs:string? := fn:default-collation()) as xs:boolean",
		description: "Determines whether or not any of the supplied strings, when tokenized at whitespace boundaries, contains the supplied token, under the rules of the supplied collation."
	},
	{
		name: "count",
		signature: "count($input as item()*) as xs:integer",
		description: "Counts the number of items in a sequence."
	},
	{
		name: "csv-doc",
		signature: "csv-doc($source as xs:string?, $options as map(*)? := {}) as fn:parsed-csv-structure-record?",
		description: "Reads an external resource containing CSV, and returns the results as a record containing information about the names in the header, as well as the data itself."
	},
	{
		name: "csv-to-arrays",
		signature: "csv-to-arrays($value as xs:string?, $options as map(*)? := {}) as array(xs:string)*",
		description: "Parses CSV data supplied as a string, returning the results in the form of a sequence of arrays of strings."
	},
	{
		name: "csv-to-xml",
		signature: "csv-to-xml($value as xs:string?, $options as map(*)? := {}) as document-node(fn:csv)?",
		description: "Parses CSV data supplied as a string, returning the results as an XML document."
	},
	{
		name: "current-date",
		signature: "current-date() as xs:date",
		description: "Returns the current date."
	},
	{
		name: "current-dateTime",
		signature: "current-dateTime() as xs:dateTimeStamp",
		description: "Returns the current date and time. Note that this does not change during the execution of the query or transformation."
	},
	{
		name: "current-time",
		signature: "current-time() as xs:time",
		description: "Returns the current time. Note that this does not change during the execution of the query or transformation."
	},
	{
		name: "data",
		signature: "data($input as item()* := .) as xs:anyAtomicType*",
		description: "Returns the result of atomizing a sequence."
	},
	{
		name: "dateTime",
		signature: "dateTime($date as xs:date?, $time as xs:time?) as xs:dateTime?",
		description: "Combines the given date and time. The result has a timezone if either of the inputs has a timezone; if they both have a timezone, then the two timezones must be the same."
	},
	{
		name: "day-from-date",
		signature: "day-from-date($value as xs:date?) as xs:integer?",
		description: "Extracts the day component of a date value."
	},
	{
		name: "day-from-dateTime",
		signature: "day-from-dateTime($value as (xs:dateTime | xs:date | xs:time | xs:gYear | xs:gYearMonth | xs:gMonth | xs:gMonthDay | xs:gDay)?) as xs:integer?",
		description: "Extracts the day component of a dateTime value."
	},
	{
		name: "days-from-duration",
		signature: "days-from-duration($value as xs:duration?) as xs:integer?",
		description: "Extracts the days component of a dayTimeDuration value."
	},
	{
		name: "decode-from-uri",
		signature: "decode-from-uri($value as xs:string?) as xs:string",
		description: "Decodes URI-escaped characters in a string."
	},
	{
		name: "deep-equal",
		signature: "deep-equal($input1 as item()*, $input2 as item()*, $options as (xs:string | map(*))? := {}) as xs:boolean",
		description: "Compares two sequences for deep equality; string values are compared using the specified collation; nodes are compared for deep equality of names and content."
	},
	{
		name: "default-collation",
		signature: "default-collation() as xs:string",
		description: "Returns the name of the default collation. If no collation has been set explicitly this will be the URI of the Unicode codepoint collation."
	},
	{
		name: "default-language",
		signature: "default-language() as xs:language",
		description: "Returns the value of the default language property from the dynamic context."
	},
	{
		name: "distinct-ordered-nodes",
		signature: "distinct-ordered-nodes($nodes as gnode()*) as gnode()*",
		description: "Removes duplicate GNodes and sorts the input into document order."
	},
	{
		name: "distinct-values",
		signature: "distinct-values($values as xs:anyAtomicType*, $collation as xs:string? := fn:default-collation()) as xs:anyAtomicType*",
		description: "Returns the set of distinct values present in a given sequence."
	},
	{
		name: "divide-decimals",
		signature: "divide-decimals($value as xs:decimal, $divisor as xs:decimal, $precision as xs:integer? := 0) as record(quotient as xs:decimal, remainder as xs:decimal)",
		description: "Divides one xs:decimal by another to a defined precision, returning both the quotient and the remainder."
	},
	{
		name: "do-until",
		signature: "do-until($input as item()*, $action as fn(item()*, xs:integer) as item()*, $predicate as fn(item()*, xs:integer) as xs:boolean?) as item()*",
		description: "Processes a supplied value repeatedly, continuing when some condition is false, and returning the value that satisfies the condition."
	},
	{
		name: "doc",
		signature: "doc($source as xs:string?, $options as map(*)? := {}) as document-node()?",
		description: "Retrieves an XML document located at the specified URI, parses it, and returns its document node."
	},
	{
		name: "doc-available",
		signature: "doc-available($source as xs:string?, $options as map(*)? := {}) as xs:boolean",
		description: "Returns true if a document with the given URI can be successfully loaded, false otherwise."
	},
	{
		name: "document-uri",
		signature: "document-uri($node as node()? := .) as xs:anyURI?",
		description: "Returns the URI of a document."
	},
	{
		name: "duplicate-values",
		signature: "duplicate-values($values as xs:anyAtomicType*, $collation as xs:string? := fn:default-collation()) as xs:anyAtomicType*",
		description: "Returns the values that appear in a sequence more than once."
	},
	{
		name: "element-to-map",
		signature: "element-to-map($element as element()?, $options as map(*)? := {}) as map(xs:string, item()?)?",
		description: "Converts an element node into a map that is suitable for JSON serialization."
	},
	{
		name: "element-to-map-plan",
		signature: "element-to-map-plan($input as (document-node() | element())*) as map(xs:string, (fn:element-conversion-plan-record|fn:attribute-conversion-plan-record))",
		description: "Analyzes sample data to generate a conversion plan suitable for use by the element-to-map() function."
	},
	{
		name: "element-with-id",
		signature: "element-with-id($values as xs:string*, $node as node() := .) as element()*",
		description: "Returns the sequence of element nodes that have an ID value matching the value of one or more of the IDREF values supplied in $values."
	},
	{
		name: "empty",
		signature: "empty($input as item()*) as xs:boolean",
		description: "Returns true if the given sequence is empty."
	},
	{
		name: "encode-for-uri",
		signature: "encode-for-uri($value as xs:string?) as xs:string",
		description: "Applies the %HH escaping convention to a URI, escaping both disallowed characters and reserved characters such as \"/\" and \":\"."
	},
	{
		name: "ends-with",
		signature: "ends-with($value as xs:string?, $substring as xs:string?, $collation as xs:string? := fn:default-collation()) as xs:boolean",
		description: "Returns true if the first string ends with the second string."
	},
	{
		name: "ends-with-subsequence",
		signature: "ends-with-subsequence($input as item()*, $subsequence as item()*, $compare as (fn(item(), item()) as xs:boolean?)? := fn:deep-equal#2) as xs:boolean",
		description: "Determines whether one sequence ends with another, using a supplied callback function to compare items."
	},
	{
		name: "environment-variable",
		signature: "environment-variable($name as xs:string) as xs:string?",
		description: "Returns the value of a system environment variable, if it exists."
	},
	{
		name: "error",
		signature: "error($code as xs:QName? := (), $description as xs:string? := (), $value as item()* := .) as item()*",
		description: "Raises an error."
	},
	{
		name: "escape-html-uri",
		signature: "escape-html-uri($value as xs:string?) as xs:string",
		description: "Applies the %HH escaping convention to a URI, according to the rules of the HTML specification: that is, non-ASCII characters are escaped, but all ASCII characters, including spaces, are retained intact."
	},
	{
		name: "every",
		signature: "every($input as item()*, $predicate as (fn(item(), xs:integer) as xs:boolean?)? := fn:boolean#1) as xs:boolean",
		description: "Returns true if every item in the input sequence satisfies a supplied predicate."
	},
	{
		name: "exactly-one",
		signature: "exactly-one($input as item()*) as item()",
		description: "Checks whether $input contains exactly one item; fails if it is empty or contains multiple items."
	},
	{
		name: "exists",
		signature: "exists($input as item()*) as xs:boolean",
		description: "Returns true if the given sequence is not empty."
	},
	{
		name: "expanded-QName",
		signature: "expanded-QName($value as xs:QName?) as xs:string?",
		description: "Returns a string representation of an xs:QName in the format Q{uri}local."
	},
	{
		name: "false",
		signature: "false() as xs:boolean",
		description: "Returns the boolean value false."
	},
	{
		name: "filter",
		signature: "filter($input as item()*, $predicate as fn(item(), xs:integer) as xs:boolean?) as item()*",
		description: "Returns those items from the sequence $input for which the supplied function $predicate returns true."
	},
	{
		name: "floor",
		signature: "floor($value as xs:numeric?) as xs:numeric?",
		description: "Rounds a number towards minus infinity."
	},
	{
		name: "fold-left",
		signature: "fold-left($input as item()*, $init as item()*, $action as fn(item()*, item()) as item()*) as item()*",
		description: "Processes the supplied sequence from left to right, applying the supplied function repeatedly to each item in turn, together with an accumulated result value."
	},
	{
		name: "fold-right",
		signature: "fold-right($input as item()*, $init as item()*, $action as fn(item(), item()*) as item()*) as item()*",
		description: "Processes the supplied sequence from right to left, applying the supplied function repeatedly to each item in turn, together with an accumulated result value."
	},
	{
		name: "foot",
		signature: "foot($input as item()*) as item()?",
		description: "Returns the last item in a sequence."
	},
	{
		name: "for-each",
		signature: "for-each($input as item()*, $action as fn(item(), xs:integer) as item()*) as item()*",
		description: "Applies the function item $action to every item from the sequence $input in turn, returning the concatenation of the resulting sequences in order."
	},
	{
		name: "for-each-pair",
		signature: "for-each-pair($input1 as item()*, $input2 as item()*, $action as fn(item(), item(), xs:integer) as item()*) as item()*",
		description: "Applies the function item $action to successive pairs of items taken one from $input1 and one from $input2, returning the concatenation of the resulting sequences in order."
	},
	{
		name: "format-date",
		signature: "format-date($value as xs:date?, $picture as xs:string, $language as xs:string? := (), $calendar as xs:string? := (), $place as xs:string? := ()) as xs:string?",
		description: "Formats a date, using a format controlled by the picture string."
	},
	{
		name: "format-dateTime",
		signature: "format-dateTime($value as xs:dateTime?, $picture as xs:string, $language as xs:string? := (), $calendar as xs:string? := (), $place as xs:string? := ()) as xs:string?",
		description: "Formats a dateTime, using a format controlled by the picture string."
	},
	{
		name: "format-integer",
		signature: "format-integer($value as xs:integer?, $picture as xs:string, $language as xs:string? := ()) as xs:string",
		description: "Formats an integer according to a given picture string, using the conventions of a given natural language if specified."
	},
	{
		name: "format-number",
		signature: "format-number($value as xs:numeric?, $picture as xs:string, $options as (xs:string | map(*))? := {}) as xs:string",
		description: "Formats a number as specified by a picture string and decimal format."
	},
	{
		name: "format-time",
		signature: "format-time($value as xs:time?, $picture as xs:string, $language as xs:string? := (), $calendar as xs:string? := (), $place as xs:string? := ()) as xs:string?",
		description: "Formats a time value, using a format controlled by the picture string."
	},
	{
		name: "function-annotations",
		signature: "function-annotations($function as fn(*)) as map(xs:QName, xs:anyAtomicType*)*",
		description: "Returns the annotations of the function item."
	},
	{
		name: "function-arity",
		signature: "function-arity($function as fn(*)) as xs:integer",
		description: "Returns the arity of the function identified by a function item."
	},
	{
		name: "function-identity",
		signature: "function-identity($function as fn(*)) as xs:string",
		description: "Returns a string representing the identity of a function item."
	},
	{
		name: "function-lookup",
		signature: "function-lookup($name as xs:QName, $arity as xs:integer) as fn(*)?",
		description: "Determines whether a function with a given name and arity is available in the context, and if so, returns a function item that can be used to call the function. The function is useful to allow fallback action when a function is not available: for example, when calling an XPath 3.0 function, the code can be conditional on whether the function is or is not available."
	},
	{
		name: "function-name",
		signature: "function-name($function as fn(*)) as xs:QName?",
		description: "Returns the name of the function identified by a function item."
	},
	{
		name: "generate-id",
		signature: "generate-id($node as gnode()? := .) as xs:string",
		description: "Returns a generated unique ASCII identifier for a node."
	},
	{
		name: "graphemes",
		signature: "graphemes($value as xs:string?) as xs:string*",
		description: "Splits the supplied string into a sequence of single-grapheme strings."
	},
	{
		name: "has-children",
		signature: "has-children($node as gnode()? := .) as xs:boolean",
		description: "Asks whether the supplied node has one or more children."
	},
	{
		name: "hash",
		signature: "hash($value as (xs:string | xs:hexBinary | xs:base64Binary)?, $algorithm as xs:string? := \"MD5\", $options as map(*)? := {}) as xs:hexBinary?",
		description: "Returns the results of a specified hash, checksum, or cyclic redundancy check function applied to the input."
	},
	{
		name: "head",
		signature: "head($input as item()*) as item()?",
		description: "Returns the first item in a sequence."
	},
	{
		name: "highest",
		signature: "highest($input as item()*, $collation as xs:string? := fn:default-collation(), $key as (fn(item()) as xs:anyAtomicType*)? := fn:data#1) as item()*",
		description: "Returns those items from a supplied sequence that have the highest value of a sort key, where the sort key can be computed using a caller-supplied function."
	},
	{
		name: "hours-from-dateTime",
		signature: "hours-from-dateTime($value as (xs:dateTime | xs:date | xs:time | xs:gYear | xs:gYearMonth | xs:gMonth | xs:gMonthDay | xs:gDay)?) as xs:integer?",
		description: "Extracts the hour component of a dateTime value."
	},
	{
		name: "hours-from-duration",
		signature: "hours-from-duration($value as xs:duration?) as xs:integer?",
		description: "Extracts the hours component of a dayTimeDuration value."
	},
	{
		name: "hours-from-time",
		signature: "hours-from-time($value as xs:time?) as xs:integer?",
		description: "Extracts the hours component of a time value. Note that this is from the localized value, not the normalized value: for example if the supplied time value is 01:23:00+05:00 then the result is 1."
	},
	{
		name: "html-doc",
		signature: "html-doc($source as xs:string?, $options as map(*)? := {}) as document-node(*:html)?",
		description: "Reads an external resource containing HTML, and returns the result of parsing the resource as HTML."
	},
	{
		name: "id",
		signature: "id($values as xs:string*, $node as node() := .) as element()*",
		description: "Finds the elements with given ID attribute values."
	},
	{
		name: "identity",
		signature: "identity($input as item()*) as item()*",
		description: "Returns the value of the argument, unchanged. Useful in situations where a function must be supplied, but the desired action is to do nothing."
	},
	{
		name: "idref",
		signature: "idref($values as xs:string*, $node as node() := .) as node()*",
		description: "Finds the nodes that link to the element with a given ID value. These will be element or attribute nodes marked by virtue of schema or DTD validation as IDREF or IDREFS values."
	},
	{
		name: "implicit-timezone",
		signature: "implicit-timezone() as xs:dayTimeDuration",
		description: "Returns the implicit timezone."
	},
	{
		name: "in-scope-namespaces",
		signature: "in-scope-namespaces($element as element()) as map((xs:NCName | enum('')), xs:anyURI)",
		description: "Returns the in-scope namespaces of an element node, as a map."
	},
	{
		name: "in-scope-prefixes",
		signature: "in-scope-prefixes($element as element()) as xs:string*",
		description: "Returns the names of the namespaces that are in scope for an element. Except for the unnamed namespace, which is represented by the string \"\", the names will be of type xs:NCName."
	},
	{
		name: "index-of",
		signature: "index-of($input as xs:anyAtomicType*, $target as xs:anyAtomicType, $collation as xs:string? := fn:default-collation()) as xs:integer*",
		description: "Finds the positions of items in a sequence that match the second argument."
	},
	{
		name: "index-where",
		signature: "index-where($input as item()*, $predicate as fn(item(), xs:integer) as xs:boolean?) as xs:integer*",
		description: "Returns the positions in an input sequence of items that satisfy a supplied predicate."
	},
	{
		name: "innermost",
		signature: "innermost($nodes as gnode()*) as gnode()*",
		description: "Given a sequence of nodes, returns those nodes in the sequence that have no descendant that is also in the sequence."
	},
	{
		name: "insert-before",
		signature: "insert-before($input as item()*, $position as xs:integer, $insert as item()*) as item()*",
		description: "Insert an item into a sequence."
	},
	{
		name: "insert-separator",
		signature: "insert-separator($input as item()*, $separator as item()*) as item()*",
		description: "Inserts a separator between adjacent items in a sequence."
	},
	{
		name: "invisible-xml",
		signature: "invisible-xml($grammar as (xs:string | element(Q{}ixml))? := (), $options as map(*)? := {}) as fn(xs:string) as item()",
		description: "Creates an Invisible XML parser for a grammar."
	},
	{
		name: "iri-to-uri",
		signature: "iri-to-uri($value as xs:string?) as xs:string",
		description: "Applies the %HH escaping convention to a URI, escaping only disallowed characters (but not reserved characters such as \"/\" and \":\")."
	},
	{
		name: "is-NaN",
		signature: "is-NaN($value as xs:anyAtomicType) as xs:boolean",
		description: "Returns true if the argument is the xs:float or xs:double value NaN."
	},
	{
		name: "items-at",
		signature: "items-at($input as item()*, $at as xs:integer*) as item()*",
		description: "Returns a sequence containing the items from $input at positions defined by $at, in the order specified."
	},
	{
		name: "jkey",
		signature: "jkey($input as jnode()? := .) as xs:anyAtomicType?",
		description: "Returns the jkey property of a JNode."
	},
	{
		name: "jposition",
		signature: "jposition($input as jnode()? := .) as xs:integer?",
		description: "Returns the jposition property of a JNode."
	},
	{
		name: "json-doc",
		signature: "json-doc($source as xs:string?, $options as map(*)? := {}) as item()?",
		description: "Reads an external resource containing JSON, and returns the result of parsing the resource as JSON."
	},
	{
		name: "json-to-xml",
		signature: "json-to-xml($value as xs:string?, $options as map(*)? := {}) as document-node(fn:*)?",
		description: "Parses a string supplied in the form of a JSON text, returning the results in the form of an XML document node."
	},
	{
		name: "jtree",
		signature: "jtree($input as (map(*)|array(*))) as jnode((), (map(*)|array(*)))",
		description: "Delivers a root JNode wrapping a map or array, enabling the use of lookup expression to navigate a JTree rooted at that map or array."
	},
	{
		name: "jvalue",
		signature: "jvalue($input as jnode()? := .) as item()*",
		description: "Returns the jvalue property of a JNode."
	},
	{
		name: "lang",
		signature: "lang($language as xs:string?, $node as node() := .) as xs:boolean",
		description: "Returns true if the xml:lang value for the supplied node (or the context item if the second argument is omitted) matches the given language."
	},
	{
		name: "last",
		signature: "last() as xs:integer",
		description: "Returns the context size (the size of the sequence of items currently being processed)."
	},
	{
		name: "load-xquery-module",
		signature: "load-xquery-module($module-uri as xs:string, $options as map(*)? := {}) as fn:load-xquery-module-record",
		description: "Provides access to the public functions and global variables of a dynamically-loaded XQuery library module."
	},
	{
		name: "local-name",
		signature: "local-name($node as node()? := .) as xs:string",
		description: "Returns the local part of the name of a node."
	},
	{
		name: "local-name-from-QName",
		signature: "local-name-from-QName($value as xs:QName?) as xs:NCName?",
		description: "Extracts the local name component of a QName value, as an xs:NCName."
	},
	{
		name: "lower-case",
		signature: "lower-case($value as xs:string?) as xs:string",
		description: "Translates characters in a string to lower case."
	},
	{
		name: "lowest",
		signature: "lowest($input as item()*, $collation as xs:string? := fn:default-collation(), $key as (fn(item()) as xs:anyAtomicType*)? := fn:data#1) as item()*",
		description: "Returns those items from a supplied sequence that have the lowest value of a sort key, where the sort key can be computed using a caller-supplied function."
	},
	{
		name: "matches",
		signature: "matches($value as xs:string?, $pattern as xs:string, $flags as xs:string? := \"\") as xs:boolean",
		description: "Returns true if the given string matches the given regular expression."
	},
	{
		name: "max",
		signature: "max($values as xs:anyAtomicType*, $collation as xs:string? := fn:default-collation()) as xs:anyAtomicType?",
		description: "Returns the highest value in a sequence of comparable items."
	},
	{
		name: "message",
		signature: "message($input as item()*, $label as xs:string? := ()) as empty-sequence()",
		description: "Outputs trace information and discards the result."
	},
	{
		name: "min",
		signature: "min($values as xs:anyAtomicType*, $collation as xs:string? := fn:default-collation()) as xs:anyAtomicType?",
		description: "Returns the lowest value in a sequence of comparable items."
	},
	{
		name: "minutes-from-dateTime",
		signature: "minutes-from-dateTime($value as (xs:dateTime | xs:date | xs:time | xs:gYear | xs:gYearMonth | xs:gMonth | xs:gMonthDay | xs:gDay)?) as xs:integer?",
		description: "Extracts the minutes component of a dateTime value."
	},
	{
		name: "minutes-from-duration",
		signature: "minutes-from-duration($value as xs:duration?) as xs:integer?",
		description: "Extracts the minutes component of a duration value."
	},
	{
		name: "minutes-from-time",
		signature: "minutes-from-time($value as xs:time?) as xs:integer?",
		description: "Extracts the minutes component of a time value."
	},
	{
		name: "month-from-date",
		signature: "month-from-date($value as xs:date?) as xs:integer?",
		description: "Extracts the month component of a date value."
	},
	{
		name: "month-from-dateTime",
		signature: "month-from-dateTime($value as (xs:dateTime | xs:date | xs:time | xs:gYear | xs:gYearMonth | xs:gMonth | xs:gMonthDay | xs:gDay)?) as xs:integer?",
		description: "Extracts the month component of a dateTime value."
	},
	{
		name: "months-from-duration",
		signature: "months-from-duration($value as xs:duration?) as xs:integer?",
		description: "Extracts the months component of a duration value."
	},
	{
		name: "name",
		signature: "name($node as node()? := .) as xs:string",
		description: "Returns the name of a node, as a string in the lexical form of a QName."
	},
	{
		name: "namespace-uri",
		signature: "namespace-uri($node as node()? := .) as xs:anyURI",
		description: "Returns the namespace URI of the name of a node."
	},
	{
		name: "namespace-uri-for-prefix",
		signature: "namespace-uri-for-prefix($value as (xs:NCName | enum(''))?, $element as element()) as xs:anyURI?",
		description: "Returns the namespace URI corresponding to a given prefix, using the namespaces that are in scope for a given element."
	},
	{
		name: "namespace-uri-from-QName",
		signature: "namespace-uri-from-QName($value as xs:QName?) as xs:anyURI?",
		description: "Extracts the namespace URI component of a QName value."
	},
	{
		name: "nilled",
		signature: "nilled($node as node()? := .) as xs:boolean?",
		description: "Returns true if the argument is an element that has the \"nilled\" property."
	},
	{
		name: "node-name",
		signature: "node-name($node as node()? := .) as xs:QName?",
		description: "Returns the name of a node, as a QName value (that is, a namespace URI plus local name)."
	},
	{
		name: "node-type-annotation",
		signature: "node-type-annotation($node as (element() | attribute())) as fn:schema-type-record",
		description: "Returns a record containing information about the type annotation of an element or attribute node."
	},
	{
		name: "normalize-space",
		signature: "normalize-space($value as xs:anyAtomicType? := string(.)) as xs:string",
		description: "Eliminates redundant spaces from the supplied string, or the string value of the context item."
	},
	{
		name: "normalize-unicode",
		signature: "normalize-unicode($value as xs:string?, $form as xs:string? := \"NFC\") as xs:string",
		description: "Converts a string to the specified Unicode normalization form (the default is NFC) by modifying the way in which combining characters are represented."
	},
	{
		name: "not",
		signature: "not($input as item()*) as xs:boolean",
		description: "Returns true if the effective boolean value of the argument is false, and vice versa."
	},
	{
		name: "number",
		signature: "number($value as xs:anyAtomicType? := .) as xs:double",
		description: "Converts the supplied value (or the value of the context item) to a double, or returns NaN if conversion is not possible."
	},
	{
		name: "one-or-more",
		signature: "one-or-more($input as item()*) as item()+",
		description: "Tests whether $input contains one or more items; fails if it is an empty sequence."
	},
	{
		name: "op",
		signature: "op($operator as xs:string) as fn(item()*, item()*) as item()*",
		description: "Returns a function whose effect is to apply a supplied binary operator to two arguments."
	},
	{
		name: "outermost",
		signature: "outermost($nodes as gnode()*) as gnode()*",
		description: "Given a sequence of nodes, returns those nodes in the sequence that have no ancestor that is also in the sequence."
	},
	{
		name: "parse-csv",
		signature: "parse-csv($value as xs:string?, $options as map(*)? := {}) as fn:parsed-csv-structure-record?",
		description: "Parses CSV data, returning the results in the form of a record containing information about the names in the header, as well as the data itself."
	},
	{
		name: "parse-html",
		signature: "parse-html($value as (xs:string | xs:hexBinary | xs:base64Binary)?, $options as map(*)? := {}) as document-node(*:html)?",
		description: "This function takes as input an HTML document, and returns the document node at the root of an XDM tree representing the parsed document."
	},
	{
		name: "parse-ietf-date",
		signature: "parse-ietf-date($value as xs:string?) as xs:dateTime?",
		description: "Parses a string containing the date and time in IETF format, returning the corresponding xs:dateTime value."
	},
	{
		name: "parse-integer",
		signature: "parse-integer($value as xs:string?, $radix as xs:integer? := 10) as xs:integer?",
		description: "Converts a string to an integer, recognizing any radix in the range 2 to 36."
	},
	{
		name: "parse-json",
		signature: "parse-json($value as xs:string?, $options as map(*)? := {}) as item()?",
		description: "This function takes as input a string in JSON format and parses it typically returning a map or array."
	},
	{
		name: "parse-QName",
		signature: "parse-QName($value as xs:string?) as xs:QName?",
		description: "Returns an xs:QName value formed by parsing an EQName (i.e. a name in one of the formats \"local\", \"prefix:local\", or \"Q{uri}local\")."
	},
	{
		name: "parse-uri",
		signature: "parse-uri($value as xs:string?, $options as map(*)? := {}) as fn:uri-structure-record?",
		description: "Parses the URI provided and returns a map of its parts."
	},
	{
		name: "parse-xml",
		signature: "parse-xml($value as (xs:string | xs:hexBinary | xs:base64Binary)?, $options as map(*)? := {}) as document-node(*)?",
		description: "This function takes as input an XML document represented as a string, and returns the document node at the root of an XDM tree representing the parsed document."
	},
	{
		name: "parse-xml-fragment",
		signature: "parse-xml-fragment($value as (xs:string | xs:hexBinary | xs:base64Binary)?, $options as map(*)? := {}) as document-node()?",
		description: "This function takes as input an XML external entity represented as a string, and returns the document node at the root of an XDM tree representing the parsed document fragment."
	},
	{
		name: "partial-apply",
		signature: "partial-apply($function as fn(*), $arguments as map(xs:positiveInteger, item()*)) as fn(*)",
		description: "Performs partial application of a function item by binding values to selected arguments."
	},
	{
		name: "partition",
		signature: "partition($input as item()*, $split-when as fn(item()*, item(), xs:integer) as xs:boolean?) as array(item()*)*",
		description: "Partitions a sequence of items into a sequence of non-empty arrays containing the same items, starting a new partition when a supplied condition is true."
	},
	{
		name: "path",
		signature: "path($node as gnode()? := ., $options as map(*)? := {}) as xs:string?",
		description: "This function takes as input a node (defaulting to the context node), and returns an XPath expression defining a path to that node from the root of its containing tree (which must be a document node). The path will use expanded QNames so that it is not sensitive to the namespace context."
	},
	{
		name: "position",
		signature: "position() as xs:integer",
		description: "Returns the context position (that is, the position of the context item in the sequence currently being processed)."
	},
	{
		name: "prefix-from-QName",
		signature: "prefix-from-QName($value as xs:QName?) as xs:NCName?",
		description: "Extracts the prefix component of a QName value. Returns an empty sequence if the QName has no prefix."
	},
	{
		name: "QName",
		signature: "QName($uri as xs:string?, $qname as xs:string) as xs:QName",
		description: "Constructs a QName value from a URI and local name. The second argument may be a lexical QName, and the prefix of the lexical QName is returned in the constructed value, for use if it is converted back to a string."
	},
	{
		name: "random-number-generator",
		signature: "random-number-generator($seed as xs:anyAtomicType? := ()) as fn:random-number-generator-record",
		description: "Returns a random number generator, which can be used to generate sequences of random numbers."
	},
	{
		name: "remove",
		signature: "remove($input as item()*, $positions as xs:integer*) as item()*",
		description: "Removes the items at the given positions in a sequence."
	},
	{
		name: "replace",
		signature: "replace($value as xs:string?, $pattern as xs:string, $replacement as (xs:string | fn(xs:untypedAtomic, xs:untypedAtomic*) as item()?)? := \"\", $flags as xs:string? := \"\") as xs:string",
		description: "Replaces sequences of characters within a string that match a given regular expression."
	},
	{
		name: "replicate",
		signature: "replicate($input as item()*, $count as xs:nonNegativeInteger) as item()*",
		description: "Produces multiple copies of a sequence."
	},
	{
		name: "resolve-QName",
		signature: "resolve-QName($value as xs:string?, $element as element()) as xs:QName?",
		description: "Expands a lexical QName using the in-scope namespaces from the given element."
	},
	{
		name: "resolve-uri",
		signature: "resolve-uri($href as xs:string?, $base as xs:string? := ()) as xs:anyURI?",
		description: "Resolves a relative URI against a base URI."
	},
	{
		name: "reverse",
		signature: "reverse($input as item()*) as item()*",
		description: "Reverses the order of the items in the input sequence."
	},
	{
		name: "root",
		signature: "root($node as gnode()? := .) as gnode()?",
		description: "Returns the root node (typically but not necessarily a document node) of the tree containing a node."
	},
	{
		name: "round",
		signature: "round($value as xs:numeric?, $precision as xs:integer? := 0, $mode as enum('floor', 'ceiling', 'toward-zero', 'away-from-zero', 'half-to-floor', 'half-to-ceiling', 'half-toward-zero', 'half-away-from-zero', 'half-to-even')? := 'half-to-ceiling') as xs:numeric?",
		description: "Rounds a numeric value to a specified number of decimal places, with control over how the rounding takes place."
	},
	{
		name: "round-half-to-even",
		signature: "round-half-to-even($value as xs:numeric?, $precision as xs:integer? := 0) as xs:numeric?",
		description: "Rounds a numeric value to a specified number of decimal places, rounding to make the last digit even if two such values are equally near."
	},
	{
		name: "schema-type",
		signature: "schema-type($name as xs:QName) as fn:schema-type-record?",
		description: "Returns a record containing information about a named schema type in the static context."
	},
	{
		name: "seconds",
		signature: "seconds($value as xs:decimal?) as xs:dayTimeDuration?",
		description: "Returns an xs:dayTimeDuration whose length is a given number of seconds."
	},
	{
		name: "seconds-from-dateTime",
		signature: "seconds-from-dateTime($value as (xs:dateTime | xs:date | xs:time | xs:gYear | xs:gYearMonth | xs:gMonth | xs:gMonthDay | xs:gDay)?) as xs:decimal?",
		description: "Extracts the seconds component of a dateTime value."
	},
	{
		name: "seconds-from-duration",
		signature: "seconds-from-duration($value as xs:duration?) as xs:decimal?",
		description: "Extracts the seconds component of a dayTimeDuration value."
	},
	{
		name: "seconds-from-time",
		signature: "seconds-from-time($value as xs:time?) as xs:decimal?",
		description: "Extracts the seconds component of a time value."
	},
	{
		name: "serialize",
		signature: "serialize($input as item()*, $options as (element(output:serialization-parameters) | map(*))? := {}) as xs:string",
		description: "This function serializes the supplied input sequence $input, returning the serialized representation of the sequence as a string."
	},
	{
		name: "siblings",
		signature: "siblings($node as gnode()? := .) as gnode()*",
		description: "Returns the supplied GNode together with its siblings, in document order."
	},
	{
		name: "slice",
		signature: "slice($input as item()*, $start as xs:integer? := 0, $end as xs:integer? := 0, $step as xs:integer? := 0) as item()*",
		description: "Returns a sequence containing selected items from a supplied input sequence based on their position."
	},
	{
		name: "some",
		signature: "some($input as item()*, $predicate as (fn(item(), xs:integer) as xs:boolean?)? := fn:boolean#1) as xs:boolean",
		description: "Returns true if at least one item in the input sequence satisfies a supplied predicate."
	},
	{
		name: "sort",
		signature: "sort($input as item()*, $collation as xs:string? := fn:default-collation(), $key as fn(item()) as xs:anyAtomicType* := fn:data#1) as item()*",
		description: "Sorts a supplied sequence, based on the value of a sort key supplied as a function, using the supplied collation. Calling the single-argument version of the function is equivalent to calling the 3-argument form with fn:default-collation() as the second argument and fn:data#1 as the third argument: that is, it sorts a sequence of items according to the typed value of the items."
	},
	{
		name: "sort-by",
		signature: "sort-by($input as item()*, $keys as record(key? as (fn(item()) as xs:anyAtomicType*)?, collation? as xs:string?, order? as enum('ascending', 'descending')?)*) as item()*",
		description: "Sorts a supplied sequence, based on the value of a number of sort keys supplied as functions."
	},
	{
		name: "sort-with",
		signature: "sort-with($input as item()*, $comparators as (fn(item(), item()) as xs:integer)+) as item()*",
		description: "Sorts a supplied sequence, according to the order induced by the supplied comparator functions."
	},
	{
		name: "starts-with",
		signature: "starts-with($value as xs:string?, $substring as xs:string?, $collation as xs:string? := fn:default-collation()) as xs:boolean",
		description: "Tests whether one string starts with another string."
	},
	{
		name: "starts-with-subsequence",
		signature: "starts-with-subsequence($input as item()*, $subsequence as item()*, $compare as (fn(item(), item()) as xs:boolean?)? := fn:deep-equal#2) as xs:boolean",
		description: "Determines whether one sequence starts with another, using a supplied callback function to compare items."
	},
	{
		name: "static-base-uri",
		signature: "static-base-uri() as xs:anyURI?",
		description: "Returns the base URI of the static context."
	},
	{
		name: "string",
		signature: "string($value as item()? := .) as xs:string",
		description: "Returns the string value of the supplied value."
	},
	{
		name: "string-join",
		signature: "string-join($values as xs:anyAtomicType*, $separator as xs:string? := \"\") as xs:string",
		description: "Returns a string created by concatenating all the items in the given sequence (casting each item to a string), separated by the given separator."
	},
	{
		name: "string-length",
		signature: "string-length($value as xs:anyAtomicType? := fn:string(.)) as xs:integer",
		description: "Returns the number of characters in a string."
	},
	{
		name: "string-to-codepoints",
		signature: "string-to-codepoints($value as xs:string?) as xs:integer*",
		description: "Returns a sequence of integers representing the Unicode codepoints of the characters in the supplied string."
	},
	{
		name: "subsequence",
		signature: "subsequence($input as item()*, $start as xs:numeric, $length as xs:numeric? := ()) as item()*",
		description: "Returns those items in the given sequence from the given starting position to the end of the sequence, or $length items if fewer."
	},
	{
		name: "subsequence-where",
		signature: "subsequence-where($input as item()*, $from as (fn(item(), xs:integer) as xs:boolean?)? := true#0, $to as (fn(item(), xs:integer) as xs:boolean?)? := false#0) as item()*",
		description: "Returns a contiguous sequence of items from $input, with the start and end points located by applying predicates."
	},
	{
		name: "substring",
		signature: "substring($value as xs:string?, $start as xs:double, $length as xs:double? := ()) as xs:string",
		description: "Returns a substring of a given string starting at the given starting position and continuing to the end of the string, or $length characters if shorter."
	},
	{
		name: "substring-after",
		signature: "substring-after($value as xs:string?, $substring as xs:string?, $collation as xs:string? := fn:default-collation()) as xs:string",
		description: "Returns that part of the given input string that occurs after the first occurrence of the string given in $substring."
	},
	{
		name: "substring-before",
		signature: "substring-before($value as xs:string?, $substring as xs:string?, $collation as xs:string? := fn:default-collation()) as xs:string",
		description: "Returns that part of the given input string that occurs before the first occurrence of the string given in $substring."
	},
	{
		name: "sum",
		signature: "sum($values as xs:anyAtomicType*, $zero as xs:anyAtomicType? := 0) as xs:anyAtomicType?",
		description: "Returns the total of a sequence of numbers or durations."
	},
	{
		name: "tail",
		signature: "tail($input as item()*) as item()*",
		description: "Returns all but the first item in a sequence."
	},
	{
		name: "take-while",
		signature: "take-while($input as item()*, $predicate as fn(item(), xs:integer) as xs:boolean?) as item()*",
		description: "Returns items from the input sequence prior to the first one that fails to satisfy a supplied predicate."
	},
	{
		name: "timezone-from-date",
		signature: "timezone-from-date($value as xs:date?) as xs:dayTimeDuration?",
		description: "Extracts the timezone component of a date value."
	},
	{
		name: "timezone-from-dateTime",
		signature: "timezone-from-dateTime($value as (xs:dateTime | xs:date | xs:time | xs:gYear | xs:gYearMonth | xs:gMonth | xs:gMonthDay | xs:gDay)?) as xs:dayTimeDuration?",
		description: "Extracts the timezone component of a dateTime value."
	},
	{
		name: "timezone-from-time",
		signature: "timezone-from-time($value as xs:time?) as xs:dayTimeDuration?",
		description: "Extracts the timezone component of a time value."
	},
	{
		name: "tokenize",
		signature: "tokenize($value as xs:string?, $pattern as xs:string? := (), $flags as xs:string? := \"\") as xs:string*",
		description: "Returns a sequence of strings formed by breaking the input string at any substring that matches the given regular expression."
	},
	{
		name: "trace",
		signature: "trace($input as item()*, $label as xs:string? := ()) as item()*",
		description: "Returns the value of the first argument after outputting a diagnostic message."
	},
	{
		name: "transform",
		signature: "transform($options as map(*)) as map(*)",
		description: "Invokes a transformation using a dynamically-loaded XSLT stylesheet."
	},
	{
		name: "transitive-closure",
		signature: "transitive-closure($node as gnode()?, $step as fn(gnode()) as gnode()*) as gnode()*",
		description: "Returns all the GNodes reachable from a given start GNode by applying a supplied function repeatedly."
	},
	{
		name: "translate",
		signature: "translate($value as xs:string?, $replace as xs:string, $with as xs:string) as xs:string",
		description: "Returns a string formed by replacing individual characters that appear in the second argument with the characters that appear at the corresponding position in the third argument."
	},
	{
		name: "true",
		signature: "true() as xs:boolean",
		description: "Return the boolean value true."
	},
	{
		name: "trunk",
		signature: "trunk($input as item()*) as item()*",
		description: "Returns all but the last item in a sequence."
	},
	{
		name: "type-of",
		signature: "type-of($value as item()*) as xs:string",
		description: "Returns information about the type of a value, as a string."
	},
	{
		name: "unix-dateTime",
		signature: "unix-dateTime($value as xs:nonNegativeInteger? := 0) as xs:dateTimeStamp",
		description: "Returns a dateTime value for a Unix time."
	},
	{
		name: "unordered",
		signature: "unordered($input as item()*) as item()*",
		description: "Returns a random permutation of its argument."
	},
	{
		name: "unparsed-binary",
		signature: "unparsed-binary($source as xs:string?) as xs:base64Binary?",
		description: "Reads an external resource (for example, a file) and returns its contents in binary."
	},
	{
		name: "unparsed-text",
		signature: "unparsed-text($source as xs:string?, $options as (xs:string | map(*))? := {}) as xs:string?",
		description: "Returns the contents of an external text file, given its URI. The function attempts to infer the encoding. First it looks in the HTTP headers if available. Then it examines the start of the file looking first for a byte-order-mark, and failing that for an XML declaration. If none of this works, it assumes the encoding is UTF-8."
	},
	{
		name: "unparsed-text-available",
		signature: "unparsed-text-available($source as xs:string?, $options as (xs:string | map(*))? := {}) as xs:boolean",
		description: "Determines whether the corresponding call on unparsed-text() with the same arguments would succeed."
	},
	{
		name: "unparsed-text-lines",
		signature: "unparsed-text-lines($source as xs:string?, $options as (xs:string | map(*))? := {}) as xs:string*",
		description: "Equivalent to calling unparsed-text() and splitting the result at newline boundaries."
	},
	{
		name: "upper-case",
		signature: "upper-case($value as xs:string?) as xs:string",
		description: "Converts a string to upper case."
	},
	{
		name: "uri-collection",
		signature: "uri-collection($source as xs:string? := ()) as xs:anyURI*",
		description: "Returns a sequence of xs:anyURI values representing the URIs in a URI collection (either the default collection or a named collection)."
	},
	{
		name: "void",
		signature: "void($input as item()* := ()) as empty-sequence()",
		description: "Absorbs the argument."
	},
	{
		name: "while-do",
		signature: "while-do($input as item()*, $predicate as fn(item()*, xs:integer) as xs:boolean?, $action as fn(item()*, xs:integer) as item()*) as item()*",
		description: "Processes a supplied value repeatedly, continuing while some condition remains true, and returning the first value that does not satisfy the condition."
	},
	{
		name: "xml-to-json",
		signature: "xml-to-json($node as node()?, $options as map(*)? := {}) as xs:string?",
		description: "Converts an XML tree, whose format corresponds to the XML representation of JSON defined in the specification, into a string conforming to the JSON grammar."
	},
	{
		name: "xsd-validator",
		signature: "xsd-validator($options as map(*)? := {}) as function((document-node(*) | element() | attribute())?) as record(is-valid as xs:boolean, typed-node? as node(), error-details? as record(*)*)",
		description: "Given an XSD schema, delivers a function item that can be invoked to validate a document or element node against this schema."
	},
	{
		name: "year-from-date",
		signature: "year-from-date($value as xs:date?) as xs:integer?",
		description: "Extracts the year component of a date value."
	},
	{
		name: "year-from-dateTime",
		signature: "year-from-dateTime($value as (xs:dateTime | xs:date | xs:time | xs:gYear | xs:gYearMonth | xs:gMonth | xs:gMonthDay | xs:gDay)?) as xs:integer?",
		description: "Extracts the year component of a dateTime value."
	},
	{
		name: "years-from-duration",
		signature: "years-from-duration($value as xs:duration?) as xs:integer?",
		description: "Extracts the years component of a duration value."
	},
	{
		name: "zero-or-one",
		signature: "zero-or-one($input as item()*) as item()?",
		description: "Tests whether a given sequence contains zero or one items; fails if it contains multiple items."
	},
	{
		name: "math:acos",
		signature: "math:acos($value as xs:double?) as xs:double?",
		description: "Returns the arc cosine of the argument, the result being in the range zero to +π radians."
	},
	{
		name: "math:asin",
		signature: "math:asin($value as xs:double?) as xs:double?",
		description: "Returns the arc sine of the argument, the result being in the range -π/2 to +π/2 radians."
	},
	{
		name: "math:atan",
		signature: "math:atan($value as xs:double?) as xs:double?",
		description: "Returns the arc tangent of the argument, the result being in the range -π/2 to +π/2 radians."
	},
	{
		name: "math:atan2",
		signature: "math:atan2($y as xs:double, $x as xs:double) as xs:double",
		description: "Returns the angle in radians subtended at the origin by the point on a plane with coordinates (x, y) and the positive x-axis, the result being in the range -π to +π. (Note the order of arguments (y, x). There are some maths libraries that implement an atan2 function with the arguments in the order (x, y)."
	},
	{
		name: "math:cos",
		signature: "math:cos($radians as xs:double?) as xs:double?",
		description: "Returns the cosine of the argument, expressed in radians."
	},
	{
		name: "math:cosh",
		signature: "math:cosh($value as xs:double?) as xs:double?",
		description: "Returns the hyperbolic cosine of the argument."
	},
	{
		name: "math:e",
		signature: "math:e() as xs:double",
		description: "Returns an approximation to the mathematical constant e."
	},
	{
		name: "math:exp",
		signature: "math:exp($value as xs:double?) as xs:double?",
		description: "Returns e to the power of $value."
	},
	{
		name: "math:exp10",
		signature: "math:exp10($value as xs:double?) as xs:double?",
		description: "Returns 10 to the power of $value."
	},
	{
		name: "math:log",
		signature: "math:log($value as xs:double?) as xs:double?",
		description: "Returns the natural logarithm of $value."
	},
	{
		name: "math:log10",
		signature: "math:log10($value as xs:double?) as xs:double?",
		description: "Returns the base-10 logarithm of $value."
	},
	{
		name: "math:pi",
		signature: "math:pi() as xs:double",
		description: "Returns an approximation to the mathematical constant π."
	},
	{
		name: "math:pow",
		signature: "math:pow($x as xs:double?, $y as xs:numeric) as xs:double?",
		description: "Returns $x raised to the power of $y."
	},
	{
		name: "math:sin",
		signature: "math:sin($radians as xs:double?) as xs:double?",
		description: "Returns the sine of the argument, expressed in radians."
	},
	{
		name: "math:sinh",
		signature: "math:sinh($value as xs:double?) as xs:double?",
		description: "Returns the hyperbolic sine of the argument."
	},
	{
		name: "math:sqrt",
		signature: "math:sqrt($value as xs:double?) as xs:double?",
		description: "Returns the non-negative square root of the argument."
	},
	{
		name: "math:tan",
		signature: "math:tan($radians as xs:double?) as xs:double?",
		description: "Returns the tangent of the argument, expressed in radians."
	},
	{
		name: "math:tanh",
		signature: "math:tanh($value as xs:double?) as xs:double?",
		description: "Returns the hyperbolic tangent of the argument."
	},
	{
		name: "map:build",
		signature: "map:build($input as item()*, $key as (fn($item as item(), $position as xs:integer) as xs:anyAtomicType*)? := fn:identity#1, $value as (fn($item as item(), $position as xs:integer) as item()*)? := fn:identity#1, $options as map(*)? := {}) as map(*)",
		description: "Returns a map that typically contains one entry for each item in a supplied input sequence."
	},
	{
		name: "map:contains",
		signature: "map:contains($map as map(*), $key as xs:anyAtomicType) as xs:boolean",
		description: "Tests whether a particular key is present in a map. Returns true if the candidate key is present in the map, otherwise false."
	},
	{
		name: "map:empty",
		signature: "map:empty($map as map(*)) as xs:boolean",
		description: "Returns true if the supplied map contains no entries."
	},
	{
		name: "map:entries",
		signature: "map:entries($map as map(*)) as map(*)*",
		description: "Returns a sequence containing all the key-value pairs present in a map (in entry order), each represented as a single-entry map."
	},
	{
		name: "map:entry",
		signature: "map:entry($key as xs:anyAtomicType, $value as item()*) as map(*)",
		description: "Creates a map with a single entry. Used in conjunction with map:merge to create maps with multiple entries."
	},
	{
		name: "map:filter",
		signature: "map:filter($map as map(*), $predicate as fn($key as xs:anyAtomicType, $value as item()*, $position as xs:integer) as xs:boolean?) as map(*)",
		description: "Selects entries from a map, returning a new map."
	},
	{
		name: "map:find",
		signature: "map:find($input as item()*, $key as xs:anyAtomicType) as array(*)",
		description: "Searches the supplied input sequence (and any contained maps and arrays) for a map entry with the supplied key, and returns an array containing the corresponding values."
	},
	{
		name: "map:for-each",
		signature: "map:for-each($map as map(*), $action as fn($key as xs:anyAtomicType, $value as item()*, $position as xs:integer) as item()*) as item()*",
		description: "Processes every key/value pair in a map by applying the given function, returning the results as a sequence in entry order."
	},
	{
		name: "map:get",
		signature: "map:get($map as map(*), $key as xs:anyAtomicType, $default as item()* := ()) as item()*",
		description: "Gets an entry from a map. Returns the value associated with the given key if present, or the empty sequence otherwise."
	},
	{
		name: "map:items",
		signature: "map:items($map as map(*)) as item()*",
		description: "Returns a sequence containing all the values present in a map, in entry order."
	},
	{
		name: "map:keys",
		signature: "map:keys($map as map(*)) as xs:anyAtomicType*",
		description: "Returns a sequence containing all the keys present in a map, in entry order."
	},
	{
		name: "map:merge",
		signature: "map:merge($maps as map(*)*, $options as map(*)? := {}) as map(*)",
		description: "Creates a new map that combines entries from a number of existing maps. There is one entry in the new map for each distinct key present in the union of the input maps; the way duplicate keys are handled is determined by the supplied $options."
	},
	{
		name: "map:put",
		signature: "map:put($map as map(*), $key as xs:anyAtomicType, $value as item()*) as map(*)",
		description: "Creates a map that adds a single entry to an existing map, or replaces a single entry (with the specified key) in an existing map."
	},
	{
		name: "map:remove",
		signature: "map:remove($map as map(*), $keys as xs:anyAtomicType*) as map(*)",
		description: "Removes entries from a map. Returns a new map based on the supplied map, minus any entries whose key matches one of the supplied keys. The supplied map is unchanged."
	},
	{
		name: "map:size",
		signature: "map:size($map as map(*)) as xs:integer",
		description: "Returns the number of entries (key/value pairs) in the supplied map."
	},
	{
		name: "array:append",
		signature: "array:append($array as array(*), $member as item()*) as array(*)",
		description: "Returns an array containing all the members of a supplied array, plus one additional member at the end."
	},
	{
		name: "array:build",
		signature: "array:build($input as item()*, $action as (fn(item(), xs:integer) as item()*)? := fn:identity#1) as array(*)",
		description: "Returns an array obtained by evaluating the supplied function once for each item in the input sequence."
	},
	{
		name: "array:empty",
		signature: "array:empty($array as array(*)) as xs:boolean",
		description: "Returns true if the supplied array contains no members."
	},
	{
		name: "array:filter",
		signature: "array:filter($array as array(*), $predicate as fn(item()*, xs:integer) as xs:boolean?) as array(*)",
		description: "Returns an array containing those members of the $array for which $predicate returns true."
	},
	{
		name: "array:flatten",
		signature: "array:flatten($input as item()*) as item()*",
		description: "Replaces any array appearing in a supplied sequence with the members of the array, recursively."
	},
	{
		name: "array:fold-left",
		signature: "array:fold-left($array as array(*), $init as item()*, $action as fn(item()*, item()*) as item()*) as item()*",
		description: "Evaluates the supplied function cumulatively on successive values of the supplied array."
	},
	{
		name: "array:fold-right",
		signature: "array:fold-right($array as array(*), $init as item()*, $action as fn(item()*, item()*) as item()*) as item()*",
		description: "Evaluates the supplied function cumulatively on successive values of the supplied array."
	},
	{
		name: "array:foot",
		signature: "array:foot($array as array(*)) as item()*",
		description: "Returns the last member of an array."
	},
	{
		name: "array:for-each",
		signature: "array:for-each($array as array(*), $action as fn(item()*, xs:integer) as item()*) as array(*)",
		description: "Returns an array whose size is the same as array:size($array), in which each member is computed by applying $action to the corresponding member of $array."
	},
	{
		name: "array:for-each-pair",
		signature: "array:for-each-pair($array1 as array(*), $array2 as array(*), $action as fn(item()*, item()*, xs:integer) as item()*) as array(*)",
		description: "Returns an array obtained by evaluating the supplied function once for each pair of members at the same position in the two supplied arrays."
	},
	{
		name: "array:get",
		signature: "array:get($array as array(*), $position as xs:integer, $default as item()*) as item()*",
		description: "Returns the value at the specified position in the supplied array (counting from 1)."
	},
	{
		name: "array:head",
		signature: "array:head($array as array(*)) as item()*",
		description: "Returns the first member of an array, that is $array(1)."
	},
	{
		name: "array:index-of",
		signature: "array:index-of($array as array(*), $target as item()*, $collation as xs:string? := fn:default-collation()) as xs:integer*",
		description: "Returns a sequence of positive integers giving the positions within the array $array of members that are equal to $target."
	},
	{
		name: "array:index-where",
		signature: "array:index-where($array as array(*), $predicate as fn(item()*, xs:integer) as xs:boolean?) as xs:integer*",
		description: "Returns the positions in an input array of members that match a supplied predicate."
	},
	{
		name: "array:insert-before",
		signature: "array:insert-before($array as array(*), $position as xs:integer, $member as item()*) as array(*)",
		description: "Returns an array containing all the members of the supplied array, with one additional member at a specified position."
	},
	{
		name: "array:items",
		signature: "array:items($array as array(*)) as item()*",
		description: "Returns the sequence concatenation of the members of an array."
	},
	{
		name: "array:join",
		signature: "array:join($arrays as array(*)*) as array(*)",
		description: "Concatenates the contents of several arrays into a single array."
	},
	{
		name: "array:members",
		signature: "array:members($array as array(*)) as record(value as item()*)*",
		description: "Delivers the contents of an array as a sequence of value records. The inverse of the array:of-members function."
	},
	{
		name: "array:of-members",
		signature: "array:of-members($input as record(value as item()*)*) as array(*)",
		description: "Constructs an array from the contents of a sequence of value records. The inverse of the array:members function."
	},
	{
		name: "array:put",
		signature: "array:put($array as array(*), $position as xs:integer, $member as item()*) as array(*)",
		description: "Returns an array containing all the members of a supplied array, except for one member which is replaced with a new value."
	},
	{
		name: "array:remove",
		signature: "array:remove($array as array(*), $positions as xs:integer*) as array(*)",
		description: "Returns an array containing all the members of the supplied array, except for the members at the specified positions."
	},
	{
		name: "array:reverse",
		signature: "array:reverse($array as array(*)) as array(*)",
		description: "Returns an array containing all the members of a supplied array, but in reverse order."
	},
	{
		name: "array:size",
		signature: "array:size($array as array(*)) as xs:integer",
		description: "Returns the number of members in the supplied array."
	},
	{
		name: "array:slice",
		signature: "array:slice($array as array(*), $start as xs:integer? := 0, $end as xs:integer? := 0, $step as xs:integer? := 0) as array(*)",
		description: "Returns an array containing selected members of a supplied input array based on their position."
	},
	{
		name: "array:sort",
		signature: "array:sort($array as array(*), $collation as xs:string? := fn:default-collation(), $key as fn(item()*) as xs:anyAtomicType* := fn:data#1) as item()*",
		description: "Returns an array containing all the members of the supplied array, sorted according to the value of a sort key supplied as a function, using the supplied collation."
	},
	{
		name: "array:sort-by",
		signature: "array:sort-by($array as array(*), $keys as record(key? as (fn(item()*) as xs:anyAtomicType*)?, collation? as xs:string?, order? as enum('ascending', 'descending')?)*) as array(*)",
		description: "Sorts a supplied array, based on the value of a number of sort keys supplied as functions."
	},
	{
		name: "array:sort-with",
		signature: "array:sort-with($array as array(*), $comparators as (fn(item()*, item()*) as xs:integer)+) as array(*)",
		description: "Sorts a supplied array, according to the order induced by the supplied comparator functions."
	},
	{
		name: "array:split",
		signature: "array:split($array as array(*)) as array(*)*",
		description: "Delivers the contents of an array as a sequence of single-member arrays."
	},
	{
		name: "array:subarray",
		signature: "array:subarray($array as array(*), $start as xs:integer, $length as xs:integer? := ()) as array(*)",
		description: "Returns an array containing all members from a supplied array starting at a supplied position, up to a specified length."
	},
	{
		name: "array:tail",
		signature: "array:tail($array as array(*)) as array(*)",
		description: "Returns an array containing all members except the first from a supplied array."
	},
	{
		name: "array:trunk",
		signature: "array:trunk($array as array(*)) as array(*)",
		description: "Returns an array containing all members except the last from a supplied array."
	}
];

// XPath 4.0 function arities ('local-name#arity') by namespace, for checking function calls
export const xpath40Arities = {
	fn: [
		"abs#1",
		"adjust-date-to-timezone#1",
		"adjust-date-to-timezone#2",
		"adjust-dateTime-to-timezone#1",
		"adjust-dateTime-to-timezone#2",
		"adjust-time-to-timezone#1",
		"adjust-time-to-timezone#2",
		"all-different#1",
		"all-different#2",
		"all-equal#1",
		"all-equal#2",
		"analyze-string#2",
		"analyze-string#3",
		"apply#2",
		"atomic-equal#2",
		"atomic-type-annotation#1",
		"available-environment-variables#0",
		"avg#1",
		"base-uri#0",
		"base-uri#1",
		"boolean#1",
		"build-uri#1",
		"build-uri#2",
		"ceiling#1",
		"char#1",
		"characters#1",
		"civil-timezone#1",
		"civil-timezone#2",
		"codepoint-equal#2",
		"codepoints-to-string#1",
		"collation#1",
		"collation-available#1",
		"collation-key#1",
		"collation-key#2",
		"collection#0",
		"collection#1",
		"compare#2",
		"compare#3",
		"concat#0",
		"concat#1",
		"contains#2",
		"contains#3",
		"contains-subsequence#2",
		"contains-subsequence#3",
		"contains-token#2",
		"contains-token#3",
		"count#1",
		"csv-doc#1",
		"csv-doc#2",
		"csv-to-arrays#1",
		"csv-to-arrays#2",
		"csv-to-xml#1",
		"csv-to-xml#2",
		"current-date#0",
		"current-dateTime#0",
		"current-time#0",
		"data#0",
		"data#1",
		"dateTime#2",
		"day-from-date#1",
		"day-from-dateTime#1",
		"days-from-duration#1",
		"decode-from-uri#1",
		"deep-equal#2",
		"deep-equal#3",
		"default-collation#0",
		"default-language#0",
		"distinct-ordered-nodes#1",
		"distinct-values#1",
		"distinct-values#2",
		"divide-decimals#2",
		"divide-decimals#3",
		"do-until#3",
		"doc#1",
		"doc#2",
		"doc-available#1",
		"doc-available#2",
		"document-uri#0",
		"document-uri#1",
		"duplicate-values#1",
		"duplicate-values#2",
		"element-to-map#1",
		"element-to-map#2",
		"element-to-map-plan#1",
		"element-with-id#1",
		"element-with-id#2",
		"empty#1",
		"encode-for-uri#1",
		"ends-with#2",
		"ends-with#3",
		"ends-with-subsequence#2",
		"ends-with-subsequence#3",
		"environment-variable#1",
		"error#0",
		"error#1",
		"error#2",
		"error#3",
		"escape-html-uri#1",
		"every#1",
		"every#2",
		"exactly-one#1",
		"exists#1",
		"expanded-QName#1",
		"false#0",
		"filter#2",
		"floor#1",
		"fold-left#3",
		"fold-right#3",
		"foot#1",
		"for-each#2",
		"for-each-pair#3",
		"format-date#2",
		"format-date#3",
		"format-date#4",
		"format-date#5",
		"format-dateTime#2",
		"format-dateTime#3",
		"format-dateTime#4",
		"format-dateTime#5",
		"format-integer#2",
		"format-integer#3",
		"format-number#2",
		"format-number#3",
		"format-time#2",
		"format-time#3",
		"format-time#4",
		"format-time#5",
		"function-annotations#1",
		"function-arity#1",
		"function-identity#1",
		"function-lookup#2",
		"function-name#1",
		"generate-id#0",
		"generate-id#1",
		"graphemes#1",
		"has-children#0",
		"has-children#1",
		"hash#1",
		"hash#2",
		"hash#3",
		"head#1",
		"highest#1",
		"highest#2",
		"highest#3",
		"hours-from-dateTime#1",
		"hours-from-duration#1",
		"hours-from-time#1",
		"html-doc#1",
		"html-doc#2",
		"id#1",
		"id#2",
		"identity#1",
		"idref#1",
		"idref#2",
		"implicit-timezone#0",
		"in-scope-namespaces#1",
		"in-scope-prefixes#1",
		"index-of#2",
		"index-of#3",
		"index-where#2",
		"innermost#1",
		"insert-before#3",
		"insert-separator#2",
		"invisible-xml#0",
		"invisible-xml#1",
		"invisible-xml#2",
		"iri-to-uri#1",
		"is-NaN#1",
		"items-at#2",
		"jkey#0",
		"jkey#1",
		"jposition#0",
		"jposition#1",
		"json-doc#1",
		"json-doc#2",
		"json-to-xml#1",
		"json-to-xml#2",
		"jtree#1",
		"jvalue#0",
		"jvalue#1",
		"lang#1",
		"lang#2",
		"last#0",
		"load-xquery-module#1",
		"load-xquery-module#2",
		"local-name#0",
		"local-name#1",
		"local-name-from-QName#1",
		"lower-case#1",
		"lowest#1",
		"lowest#2",
		"lowest#3",
		"matches#2",
		"matches#3",
		"max#1",
		"max#2",
		"message#1",
		"message#2",
		"min#1",
		"min#2",
		"minutes-from-dateTime#1",
		"minutes-from-duration#1",
		"minutes-from-time#1",
		"month-from-date#1",
		"month-from-dateTime#1",
		"months-from-duration#1",
		"name#0",
		"name#1",
		"namespace-uri#0",
		"namespace-uri#1",
		"namespace-uri-for-prefix#2",
		"namespace-uri-from-QName#1",
		"nilled#0",
		"nilled#1",
		"node-name#0",
		"node-name#1",
		"node-type-annotation#1",
		"normalize-space#0",
		"normalize-space#1",
		"normalize-unicode#1",
		"normalize-unicode#2",
		"not#1",
		"number#0",
		"number#1",
		"one-or-more#1",
		"op#1",
		"outermost#1",
		"parse-csv#1",
		"parse-csv#2",
		"parse-html#1",
		"parse-html#2",
		"parse-ietf-date#1",
		"parse-integer#1",
		"parse-integer#2",
		"parse-json#1",
		"parse-json#2",
		"parse-QName#1",
		"parse-uri#1",
		"parse-uri#2",
		"parse-xml#1",
		"parse-xml#2",
		"parse-xml-fragment#1",
		"parse-xml-fragment#2",
		"partial-apply#2",
		"partition#2",
		"path#0",
		"path#1",
		"path#2",
		"position#0",
		"prefix-from-QName#1",
		"QName#2",
		"random-number-generator#0",
		"random-number-generator#1",
		"remove#2",
		"replace#2",
		"replace#3",
		"replace#4",
		"replicate#2",
		"resolve-QName#2",
		"resolve-uri#1",
		"resolve-uri#2",
		"reverse#1",
		"root#0",
		"root#1",
		"round#1",
		"round#2",
		"round#3",
		"round-half-to-even#1",
		"round-half-to-even#2",
		"schema-type#1",
		"seconds#1",
		"seconds-from-dateTime#1",
		"seconds-from-duration#1",
		"seconds-from-time#1",
		"serialize#1",
		"serialize#2",
		"siblings#0",
		"siblings#1",
		"slice#1",
		"slice#2",
		"slice#3",
		"slice#4",
		"some#1",
		"some#2",
		"sort#1",
		"sort#2",
		"sort#3",
		"sort-by#2",
		"sort-with#2",
		"starts-with#2",
		"starts-with#3",
		"starts-with-subsequence#2",
		"starts-with-subsequence#3",
		"static-base-uri#0",
		"string#0",
		"string#1",
		"string-join#1",
		"string-join#2",
		"string-length#0",
		"string-length#1",
		"string-to-codepoints#1",
		"subsequence#2",
		"subsequence#3",
		"subsequence-where#1",
		"subsequence-where#2",
		"subsequence-where#3",
		"substring#2",
		"substring#3",
		"substring-after#2",
		"substring-after#3",
		"substring-before#2",
		"substring-before#3",
		"sum#1",
		"sum#2",
		"tail#1",
		"take-while#2",
		"timezone-from-date#1",
		"timezone-from-dateTime#1",
		"timezone-from-time#1",
		"tokenize#1",
		"tokenize#2",
		"tokenize#3",
		"trace#1",
		"trace#2",
		"transform#1",
		"transitive-closure#2",
		"translate#3",
		"true#0",
		"trunk#1",
		"type-of#1",
		"unix-dateTime#0",
		"unix-dateTime#1",
		"unordered#1",
		"unparsed-binary#1",
		"unparsed-text#1",
		"unparsed-text#2",
		"unparsed-text-available#1",
		"unparsed-text-available#2",
		"unparsed-text-lines#1",
		"unparsed-text-lines#2",
		"upper-case#1",
		"uri-collection#0",
		"uri-collection#1",
		"void#0",
		"void#1",
		"while-do#3",
		"xml-to-json#1",
		"xml-to-json#2",
		"xsd-validator#0",
		"xsd-validator#1",
		"year-from-date#1",
		"year-from-dateTime#1",
		"years-from-duration#1",
		"zero-or-one#1"
	],
	map: [
		"build#1",
		"build#2",
		"build#3",
		"build#4",
		"contains#2",
		"empty#1",
		"entries#1",
		"entry#2",
		"filter#2",
		"find#2",
		"for-each#2",
		"get#2",
		"get#3",
		"items#1",
		"keys#1",
		"merge#1",
		"merge#2",
		"put#3",
		"remove#2",
		"size#1"
	],
	array: [
		"append#2",
		"build#1",
		"build#2",
		"empty#1",
		"filter#2",
		"flatten#1",
		"fold-left#3",
		"fold-right#3",
		"foot#1",
		"for-each#2",
		"for-each-pair#3",
		"get#3",
		"head#1",
		"index-of#2",
		"index-of#3",
		"index-where#2",
		"insert-before#3",
		"items#1",
		"join#1",
		"members#1",
		"of-members#1",
		"put#3",
		"remove#2",
		"reverse#1",
		"size#1",
		"slice#1",
		"slice#2",
		"slice#3",
		"slice#4",
		"sort#1",
		"sort#2",
		"sort#3",
		"sort-by#2",
		"sort-with#2",
		"split#1",
		"subarray#2",
		"subarray#3",
		"tail#1",
		"trunk#1"
	],
	math: [
		"acos#1",
		"asin#1",
		"atan#1",
		"atan2#2",
		"cos#1",
		"cosh#1",
		"e#0",
		"exp#1",
		"exp10#1",
		"log#1",
		"log10#1",
		"pi#0",
		"pow#2",
		"sin#1",
		"sinh#1",
		"sqrt#1",
		"tan#1",
		"tanh#1"
	]
};
