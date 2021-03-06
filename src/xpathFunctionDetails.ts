import { FunctionCompletionData } from './xsltTokenCompletions'

export class XPathFunctionDetails {
	public static xsltData: FunctionCompletionData[] = [
		{name: "accumulator-after",  signature: "fn:accumulator-after( $name as xs:string ) asitem()*", description: "Returns the post-descent value of the selected accumulator at the context node."},
		{name: "accumulator-before",  signature: "fn:accumulator-before( $name as xs:string ) asitem()*", description: "Returns the pre-descent value of the selected accumulator at the context node."},
		{name: "available-system-properties",  signature: "fn:available-system-properties( ) asxs:QName*", description: "Returns a list of system property names that are suitable for passing to the system-property function, as a sequence of QNames."},
		{name: "copy-of",  signature: "fn:copy-of( $input as item()* ) asitem()*", description: "Returns a deep copy of the sequence supplied as the $input argument, or of the context item if the argument is absent.\n\nOptional argument: input"},
		{name: "current",  signature: "fn:current( ) asitem()", description: "Returns the item that is the context item for the evaluation of the containing XPath expression"},
		{name: "current-group",  signature: "fn:current-group( ) asitem()*", description: "Returns the group currently being processed by an xsl:for-each-group instruction."},
		{name: "current-grouping-key",  signature: "fn:current-grouping-key( ) asxs:anyAtomicType*", description: "Returns the grouping key of the group currently being processed using the xsl:for-each-group instruction."},
		{name: "current-merge-group",  signature: "fn:current-merge-group( $source as xs:string ) asitem()*", description: "Returns the group of items currently being processed by an xsl:merge instruction.\n\nOptional argument: source"},
		{name: "current-merge-key",  signature: "fn:current-merge-key( ) asxs:anyAtomicType*", description: "Returns the merge key of the merge group currently being processed using the xsl:merge instruction."},
		{name: "current-output-uri",  signature: "fn:current-output-uri( ) asxs:anyURI?", description: "Returns the value of the current output URI."},
		{name: "document",  signature: "fn:document( $uri-sequence as item()*, $base-node as node() ) asnode()*", description: "Provides access to XML documents identified by a URI.\n\nOptional argument: base-node"},
		{name: "element-available",  signature: "fn:element-available( $element-name as xs:string ) asxs:boolean", description: "Determines whether a particular instruction is or is not available for use. The function is particularly useful for calling within an [xsl:]use-when attribute to test whether a particular extension instruction is available."},
		{name: "function-available",  signature: "fn:function-available( $function-name as xs:string, $arity ) asxs:boolean", description: "Determines whether a particular function is or is not available for use. The function is particularly useful for calling within an [xsl:]use-when attribute to test whether a particular extension function is available.\n\nOptional argument: arity"},
		{name: "key",  signature: "fn:key( $key-name as xs:string, $key-value as xs:anyAtomicType*, $top as node() ) asnode()*", description: "Returns the nodes that match a supplied key value.\n\nOptional Argument: top"},
		{name: "regex-group",  signature: "fn:regex-group( $group-number as xs:integer ) asxs:string", description: "Returns the string captured by a parenthesized subexpression of the regular expression used during evaluation of the xsl:analyze-string instruction."},
		{name: "snapshot",  signature: "fn:snapshot( $input as item()* ) asitem()*", description: "Returns a copy of a sequence, retaining copies of the ancestors and descendants of any node in the input sequence, together with their attributes and namespaces.\n\nOptional argument: input"},
		{name: "stream-available",  signature: "fn:stream-available( $uri as xs:string? ) asxs:boolean", description: "Determines, as far as possible, whether a document is available for streamed processing using xsl:source-document."},
		{name: "system-property",  signature: "fn:system-property( $property-name as xs:string ) asxs:string", description: "Returns the value of a system property"},
		{name: "type-available",  signature: "fn:type-available( $type-name as xs:string ) asxs:boolean", description: "Used to control how a stylesheet behaves if a particular schema type is or is not available in the static context."},
		{name: "unparsed-entity-public-id",  signature: "fn:unparsed-entity-public-id( $entity-name as xs:string, $doc as node() ) asxs:string", description: "Returns the public identifier of an unparsed entity.\n\nOptional argument: doc"},
		{name: "unparsed-entity-uri",  signature: "fn:unparsed-entity-uri( $entity-name as xs:string, $doc as node() ) asxs:anyURI", description: "Returns the URI (system identifier) of an unparsed entity.\n\nOptional argument: doc"},
	]
	public static xpathData: FunctionCompletionData[] = [
		{

			name: "node-name",
			signature: "node-name( arg as node()? ) as xs:QName?",
			description: "Returns the name of a node, as an `xs:QName`.\n\nOptional argument: arg"
		},
		{

			name: "nilled",
			signature: "nilled( arg as node()? ) as xs:boolean?",
			description: "Returns true for an element that is nilled.\n\nOptional argument: arg"
		},
		{

			name: "string",
			signature: "string( arg as item()? ) as xs:string",
			description: "Returns the value of `$arg` represented as an `xs:string`.\n\nOptional argument: arg"
		},
		{

			name: "data",
			signature: "data( arg as item()* ) as xs:anyAtomicType*",
			description: "Returns the result of atomizing a sequence. This process flattens arrays, and replaces nodes by their typed values.\n\nOptional argument: arg"
		},
		{

			name: "base-uri",
			signature: "base-uri( arg as node()? ) as xs:anyURI?",
			description: "Returns the base URI of a node.\n\nOptional argument: arg"
		},
		{

			name: "document-uri",
			signature: "document-uri( arg as node()? ) as xs:anyURI?",
			description: "Returns the URI of a resource where a document can be found, if available.\n\nOptional argument: arg"
		},
		{

			name: "error",
			signature: "error( code as xs:QName?, description as xs:string, error-object as item()* ) as none",
			description: "Calling the `fn:error` function raises an application-defined error.\n\nOptional arguments: code, description, error-object"
		},
		{

			name: "trace",
			signature: "trace( value as item()*, label as xs:string ) as item()*",
			description: "Provides an execution trace intended to be used in debugging queries.\n\nOptional argument: label"
		},
		{

			name: "abs",
			signature: "abs( arg as xs:numeric? ) as xs:numeric?",
			description: "Returns the absolute value of `$arg`."
		},
		{

			name: "ceiling",
			signature: "ceiling( arg as xs:numeric? ) as xs:numeric?",
			description: "Rounds `$arg` upwards to a whole number."
		},
		{

			name: "floor",
			signature: "floor( arg as xs:numeric? ) as xs:numeric?",
			description: "Rounds `$arg` downwards to a whole number."
		},
		{

			name: "round",
			signature: "round( arg as xs:numeric?, precision as xs:integer ) as xs:numeric?",
			description: "Rounds a value to a specified number of decimal places, rounding upwards if two such values are equally near.\n\nOptional argument: precision"
		},
		{

			name: "round-half-to-even",
			signature: "round-half-to-even( arg as xs:numeric?, precision as xs:integer ) as xs:numeric?",
			description: "Rounds a value to a specified number of decimal places, rounding to make the last digit even if two such values are equally near.\n\nOptional argument: precision"
		},
		{

			name: "format-integer",
			signature: "format-integer( value as xs:integer?, picture as xs:string, lang as xs:string? ) as xs:string",
			description: "Formats an integer according to a given picture string, using the conventions of a given natural language if specified.\n\nOptional argument: lang"
		},
		{

			name: "format-number",
			signature: "format-number( value as xs:numeric?, picture as xs:string, decimal-format-name as xs:string? ) as xs:string",
			description: "Returns a string containing a number formatted according to a given picture string, taking account of decimal formats specified in the static context.\n\nOptional argument: decimal-format-name"
		},
		{

			name: "math:pi",
			signature: "math:pi() as xs:double",
			description: "Returns an approximation to the mathematical constant π."
		},
		{

			name: "math:exp",
			signature: "math:exp( arg as xs:double? ) as xs:double?",
			description: "Returns the value of ex."
		},
		{

			name: "math:exp10",
			signature: "math:exp10( arg as xs:double? ) as xs:double?",
			description: "Returns the value of `10`x."
		},
		{

			name: "math:log",
			signature: "math:log( arg as xs:double? ) as xs:double?",
			description: "Returns the natural logarithm of the argument."
		},
		{

			name: "math:log10",
			signature: "math:log10( arg as xs:double? ) as xs:double?",
			description: "Returns the base-ten logarithm of the argument."
		},
		{

			name: "math:sqrt",
			signature: "math:sqrt( arg as xs:double? ) as xs:double?",
			description: "Returns the non-negative square root of the argument."
		},
		{

			name: "math:pow",
			signature: "math:pow( x as xs:double?, y as xs:numeric ) as xs:double?",
			description: "Returns the result of raising the first argument to the power of the second."
		},
		{

			name: "math:sin",
			signature: "math:sin( θ as xs:double? ) as xs:double?",
			description: "Returns the sine of the argument. The argument is an angle in radians."
		},
		{

			name: "math:cos",
			signature: "math:cos( θ as xs:double? ) as xs:double?",
			description: "Returns the cosine of the argument. The argument is an angle in radians."
		},
		{

			name: "math:tan",
			signature: "math:tan( θ as xs:double? ) as xs:double?",
			description: "Returns the tangent of the argument. The argument is an angle in radians."
		},
		{

			name: "math:asin",
			signature: "math:asin( arg as xs:double? ) as xs:double?",
			description: "Returns the arc sine of the argument."
		},
		{

			name: "math:acos",
			signature: "math:acos( arg as xs:double? ) as xs:double?",
			description: "Returns the arc cosine of the argument."
		},
		{

			name: "math:atan",
			signature: "math:atan( arg as xs:double? ) as xs:double?",
			description: "Returns the arc tangent of the argument."
		},
		{

			name: "math:atan2",
			signature: "math:atan2( y as xs:double, x as xs:double ) as xs:double",
			description: "Returns the angle in radians subtended at the origin by the point on a plane with coordinates (x, y) and the positive x-axis."
		},
		{

			name: "codepoints-to-string",
			signature: "codepoints-to-string( arg as xs:integer* ) as xs:string",
			description: "Returns an `xs:string` whose characters have supplied codepoints."
		},
		{

			name: "string-to-codepoints",
			signature: "string-to-codepoints( arg as xs:string? ) as xs:integer*",
			description: "Returns the sequence of codepoints that constitute an `xs:string` value. "
		},
		{

			name: "compare",
			signature: "compare( comparand1 as xs:string?, comparand2 as xs:string?, collation as xs:string ) as xs:integer?",
			description: "Returns -1, 0, or 1, depending on whether `$comparand1` collates before, equal to, or after `$comparand2` according to the rules of a selected collation.\n\nOptional argument: collation"
		},
		{

			name: "codepoint-equal",
			signature: "codepoint-equal( comparand1 as xs:string?, comparand2 as xs:string? ) as xs:boolean?",
			description: "Returns true if two strings are equal, considered codepoint-by-codepoint."
		},
		{

			name: "concat",
			signature: "concat( arg1 as xs:anyAtomicType?, arg2 as xs:anyAtomicType?, ... as xs:anyAtomicType? ) as xs:string",
			description: "Returns the concatenation of the string values of the arguments."
		},
		{

			name: "string-join",
			signature: "string-join( arg1 as xs:anyAtomicType*, arg2 as xs:string ) as xs:string",
			description: "Returns a string created by concatenating the items in a sequence, with a defined separator between adjacent items.\n\nOptional argument: arg2"
		},
		{

			name: "substring",
			signature: "substring( sourceString as xs:string?, start as xs:double, length as xs:double ) as xs:string",
			description: "Returns the portion of the value of `$sourceString` beginning at the position indicated by the value of `$start` and continuing for the number of characters indicated by the value of `$length`.\n\nOptional argument: length"
		},
		{

			name: "string-length",
			signature: "string-length( arg as xs:string? ) as xs:integer",
			description: "Returns the number of characters in a string.\n\nOptional argument: arg"
		},
		{

			name: "normalize-space",
			signature: "normalize-space( arg as xs:string? ) as xs:string",
			description: "Returns the value of `$arg` with leading and trailing whitespace removed, and sequences of internal whitespace reduced to a single space character.\n\nOptional argument: arg"
		},
		{

			name: "normalize-unicode",
			signature: "normalize-unicode( arg as xs:string?, normalizationForm as xs:string ) as xs:string",
			description: "Returns the value of `$arg` after applying Unicode normalization.\n\nOptional argument: normalizationForm"
		},
		{

			name: "upper-case",
			signature: "upper-case( arg as xs:string? ) as xs:string",
			description: "Converts a string to upper case."
		},
		{

			name: "lower-case",
			signature: "lower-case( arg as xs:string? ) as xs:string",
			description: "Converts a string to lower case."
		},
		{

			name: "translate",
			signature: "translate( arg as xs:string?, mapString as xs:string, transString as xs:string ) as xs:string",
			description: "Returns the value of `$arg` modified by replacing or removing individual characters. "
		},
		{

			name: "encode-for-uri",
			signature: "encode-for-uri( uri-part as xs:string? ) as xs:string",
			description: "Encodes reserved characters in a string that is intended to be used in the path segment of a URI."
		},
		{

			name: "iri-to-uri",
			signature: "iri-to-uri( iri as xs:string? ) as xs:string",
			description: "Converts a string containing an IRI into a URI according to the rules of ``."
		},
		{

			name: "escape-html-uri",
			signature: "escape-html-uri( uri as xs:string? ) as xs:string",
			description: "Escapes a URI in the same way that HTML user agents handle attribute values expected to contain URIs."
		},
		{

			name: "contains",
			signature: "contains( arg1 as xs:string?, arg2 as xs:string?, collation as xs:string ) as xs:boolean",
			description: "Returns true if the string `$arg1` contains `$arg2` as a substring, taking collations into account.\n\nOptional argument: collation"
		},
		{

			name: "starts-with",
			signature: "starts-with( arg1 as xs:string?, arg2 as xs:string?, collation as xs:string ) as xs:boolean",
			description: "Returns true if the string `$arg1` contains `$arg2` as a leading substring, taking collations into account.\n\nOptional argument: collation"
		},
		{

			name: "ends-with",
			signature: "ends-with( arg1 as xs:string?, arg2 as xs:string?, collation as xs:string ) as xs:boolean",
			description: "Returns true if the string `$arg1` contains `$arg2` as a trailing substring, taking collations into account.\n\nOptional argument: collation"
		},
		{

			name: "substring-before",
			signature: "substring-before( arg1 as xs:string?, arg2 as xs:string?, collation as xs:string ) as xs:string",
			description: "Returns the part of `$arg1` that precedes the first occurrence of `$arg2`, taking collations into account.\n\nOptional argument: collation"
		},
		{

			name: "substring-after",
			signature: "substring-after( arg1 as xs:string?, arg2 as xs:string?, collation as xs:string ) as xs:string",
			description: "Returns the part of `$arg1` that follows the first occurrence of `$arg2`, taking collations into account.\n\nOptional argument: collation"
		},
		{

			name: "matches",
			signature: "matches( input as xs:string?, pattern as xs:string, flags as xs:string ) as xs:boolean",
			description: "Returns true if the supplied string matches a given regular expression.\n\nOptional argument: flags"
		},
		{

			name: "replace",
			signature: "replace( input as xs:string?, pattern as xs:string, replacement as xs:string, flags as xs:string ) as xs:string",
			description: "Returns a string produced from the input string by replacing any substrings that match a given regular expression with a supplied replacement string.\n\nOptional argument: flags"
		},
		{

			name: "tokenize",
			signature: "tokenize( input as xs:string?, pattern as xs:string, flags as xs:string ) as xs:string*",
			description: "Returns a sequence of strings constructed by splitting the input wherever a separator is found; the separator is any substring that matches a given regular expression.\n\nOptional arguments: pattern, flags"
		},
		{

			name: "analyze-string",
			signature: "analyze-string( input as xs:string?, pattern as xs:string, flags as xs:string ) as element(fn:analyze-string-result)",
			description: "Analyzes a string using a regular expression, returning an XML structure that identifies which parts of the input string matched or failed to match the regular expression, and in the case of matched substrings, which substrings matched each capturing group in the regular expression.\n\nOptional argument: flags"
		},
		{

			name: "contains-token",
			signature: "contains-token( input as xs:string*, token as xs:string, collation as xs:string ) as xs:boolean",
			description: "Determines whether or not any of the supplied strings, when tokenized at whitespace boundaries, contains the supplied token, under the rules of the supplied collation.\n\nOptional argument: collation"
		},
		{

			name: "resolve-uri",
			signature: "resolve-uri( relative as xs:string?, base as xs:string ) as xs:anyURI?",
			description: "Resolves a relative IRI reference against an absolute IRI.\n\nOptional argument: base"
		},
		{

			name: "true",
			signature: "true() as xs:boolean",
			description: "Returns the `xs:boolean` value `true`."
		},
		{

			name: "false",
			signature: "false() as xs:boolean",
			description: "Returns the `xs:boolean` value `false`."
		},
		{

			name: "boolean",
			signature: "boolean( arg as item()* ) as xs:boolean",
			description: "Computes the effective boolean value of the sequence `$arg`."
		},
		{

			name: "not",
			signature: "not( arg as item()* ) as xs:boolean",
			description: "Returns `true` if the effective boolean value of `$arg` is `false`, or `false` if it is `true`."
		},
		{

			name: "years-from-duration",
			signature: "years-from-duration( arg as xs:duration? ) as xs:integer?",
			description: "Returns the number of years in a duration."
		},
		{

			name: "months-from-duration",
			signature: "months-from-duration( arg as xs:duration? ) as xs:integer?",
			description: "Returns the number of months in a duration."
		},
		{

			name: "days-from-duration",
			signature: "days-from-duration( arg as xs:duration? ) as xs:integer?",
			description: "Returns the number of days in a duration."
		},
		{

			name: "hours-from-duration",
			signature: "hours-from-duration( arg as xs:duration? ) as xs:integer?",
			description: "Returns the number of hours in a duration."
		},
		{

			name: "minutes-from-duration",
			signature: "minutes-from-duration( arg as xs:duration? ) as xs:integer?",
			description: "Returns the number of minutes in a duration."
		},
		{

			name: "seconds-from-duration",
			signature: "seconds-from-duration( arg as xs:duration? ) as xs:decimal?",
			description: "Returns the number of seconds in a duration."
		},
		{

			name: "dateTime",
			signature: "dateTime( arg1 as xs:date?, arg2 as xs:time? ) as xs:dateTime?",
			description: "Returns an `xs:dateTime` value created by combining an `xs:date` and an `xs:time`."
		},
		{

			name: "year-from-dateTime",
			signature: "year-from-dateTime( arg as xs:dateTime? ) as xs:integer?",
			description: "Returns the year component of an `xs:dateTime`."
		},
		{

			name: "month-from-dateTime",
			signature: "month-from-dateTime( arg as xs:dateTime? ) as xs:integer?",
			description: "Returns the month component of an `xs:dateTime`."
		},
		{

			name: "day-from-dateTime",
			signature: "day-from-dateTime( arg as xs:dateTime? ) as xs:integer?",
			description: "Returns the day component of an `xs:dateTime`."
		},
		{

			name: "hours-from-dateTime",
			signature: "hours-from-dateTime( arg as xs:dateTime? ) as xs:integer?",
			description: "Returns the hours component of an `xs:dateTime`."
		},
		{

			name: "minutes-from-dateTime",
			signature: "minutes-from-dateTime( arg as xs:dateTime? ) as xs:integer?",
			description: "Returns the minute component of an `xs:dateTime`."
		},
		{

			name: "seconds-from-dateTime",
			signature: "seconds-from-dateTime( arg as xs:dateTime? ) as xs:decimal?",
			description: "Returns the seconds component of an `xs:dateTime`."
		},
		{

			name: "timezone-from-dateTime",
			signature: "timezone-from-dateTime( arg as xs:dateTime? ) as xs:dayTimeDuration?",
			description: "Returns the timezone component of an `xs:dateTime`."
		},
		{

			name: "year-from-date",
			signature: "year-from-date( arg as xs:date? ) as xs:integer?",
			description: "Returns the year component of an `xs:date`."
		},
		{

			name: "month-from-date",
			signature: "month-from-date( arg as xs:date? ) as xs:integer?",
			description: "Returns the month component of an `xs:date`."
		},
		{

			name: "day-from-date",
			signature: "day-from-date( arg as xs:date? ) as xs:integer?",
			description: "Returns the day component of an `xs:date`."
		},
		{

			name: "timezone-from-date",
			signature: "timezone-from-date( arg as xs:date? ) as xs:dayTimeDuration?",
			description: "Returns the timezone component of an `xs:date`."
		},
		{

			name: "hours-from-time",
			signature: "hours-from-time( arg as xs:time? ) as xs:integer?",
			description: "Returns the hours component of an `xs:time`."
		},
		{

			name: "minutes-from-time",
			signature: "minutes-from-time( arg as xs:time? ) as xs:integer?",
			description: "Returns the minutes component of an `xs:time`."
		},
		{

			name: "seconds-from-time",
			signature: "seconds-from-time( arg as xs:time? ) as xs:decimal?",
			description: "Returns the seconds component of an `xs:time`."
		},
		{

			name: "timezone-from-time",
			signature: "timezone-from-time( arg as xs:time? ) as xs:dayTimeDuration?",
			description: "Returns the timezone component of an `xs:time`."
		},
		{

			name: "adjust-dateTime-to-timezone",
			signature: "adjust-dateTime-to-timezone( arg as xs:dateTime?, timezone as xs:dayTimeDuration? ) as xs:dateTime?",
			description: "Adjusts an `xs:dateTime` value to a specific timezone, or to no timezone at all.\n\nOptional argument: timezone"
		},
		{

			name: "adjust-date-to-timezone",
			signature: "adjust-date-to-timezone( arg as xs:date?, timezone as xs:dayTimeDuration? ) as xs:date?",
			description: "Adjusts an `xs:date` value to a specific timezone, or to no timezone at all; the result is the date in the target timezone that contains the starting instant of the supplied date.\n\nOptional argument: timezone"
		},
		{

			name: "adjust-time-to-timezone",
			signature: "adjust-time-to-timezone( arg as xs:time?, timezone as xs:dayTimeDuration? ) as xs:time?",
			description: "Adjusts an `xs:time` value to a specific timezone, or to no timezone at all.\n\nOptional argument: timezone"
		},
		{

			name: "format-dateTime",
			signature: "format-dateTime( value as xs:dateTime?, picture as xs:string, language as xs:string?, calendar as xs:string?, place as xs:string? ) as xs:string?",
			description: "Returns a string containing an `xs:dateTime` value formatted for display.\n\nOptional arguments: language, calendar, place"
		},
		{

			name: "format-date",
			signature: "format-date( value as xs:date?, picture as xs:string, language as xs:string?, calendar as xs:string?, place as xs:string? ) as xs:string?",
			description: "Returns a string containing an `xs:date` value formatted for display.\n\nOptional arguments: language, calendar, place"
		},
		{

			name: "format-time",
			signature: "format-time( value as xs:time?, picture as xs:string, language as xs:string?, calendar as xs:string?, place as xs:string? ) as xs:string?",
			description: "Returns a string containing an `xs:time` value formatted for display.\n\nOptional arguments: language, calendar, place"
		},
		{

			name: "parse-ietf-date",
			signature: "parse-ietf-date( value as xs:string? ) as xs:dateTime?",
			description: "Parses a string containing the date and time in IETF format, returning the corresponding `xs:dateTime` value."
		},
		{

			name: "resolve-QName",
			signature: "resolve-QName( qname as xs:string?, element as element() ) as xs:QName?",
			description: "Returns an `xs:QName` value (that is, an expanded-QName) by taking an `xs:string` that has the lexical form of an `xs:QName` (a string in the form \"prefix:local-name\" or \"local-name\") and resolving it using the in-scope namespaces for a given element."
		},
		{

			name: "QName",
			signature: "QName( paramURI as xs:string?, paramQName as xs:string ) as xs:QName",
			description: "Returns an `xs:QName` value formed using a supplied namespace URI and lexical QName."
		},
		{

			name: "prefix-from-QName",
			signature: "prefix-from-QName( arg as xs:QName? ) as xs:NCName?",
			description: "Returns the prefix component of the supplied QName."
		},
		{

			name: "local-name-from-QName",
			signature: "local-name-from-QName( arg as xs:QName? ) as xs:NCName?",
			description: "Returns the local part of the supplied QName."
		},
		{

			name: "namespace-uri-from-QName",
			signature: "namespace-uri-from-QName( arg as xs:QName? ) as xs:anyURI?",
			description: "Returns the namespace URI part of the supplied QName."
		},
		{

			name: "namespace-uri-for-prefix",
			signature: "namespace-uri-for-prefix( prefix as xs:string?, element as element() ) as xs:anyURI?",
			description: "Returns the namespace URI of one of the in-scope namespaces for `$element`, identified by its namespace prefix."
		},
		{

			name: "in-scope-prefixes",
			signature: "in-scope-prefixes( element as element() ) as xs:string*",
			description: "Returns the prefixes of the in-scope namespaces for an element node."
		},
		{

			name: "name",
			signature: "name( arg as node()? ) as xs:string",
			description: "Returns the name of a node, as an `xs:string` that is either the zero-length string, or has the lexical form of an `xs:QName`. \n\nOptional argument: arg"
		},
		{

			name: "local-name",
			signature: "local-name( arg as node()? ) as xs:string",
			description: "Returns the local part of the name of `$arg` as an `xs:string` that is either the zero-length string, or has the lexical form of an `xs:NCName`.\n\nOptional argument: arg"
		},
		{

			name: "namespace-uri",
			signature: "namespace-uri( arg as node()? ) as xs:anyURI",
			description: "Returns the namespace URI part of the name of `$arg`, as an `xs:anyURI` value.\n\nOptional argument: arg"
		},
		{

			name: "number",
			signature: "number( arg as xs:anyAtomicType? ) as xs:double",
			description: "Returns the value indicated by `$arg` or, if `$arg` is not specified, the context item after atomization, converted to an `xs:double`. \n\nOptional argument: arg"
		},
		{

			name: "lang",
			signature: "lang( testlang as xs:string?, node as node() ) as xs:boolean",
			description: "This function tests whether the language of `$node`, or the context item if the second argument is omitted, as specified by `xml:lang` attributes is the same as, or is a sublanguage of, the language specified by `$testlang`.\n\nOptional argument: node"
		},
		{

			name: "path",
			signature: "path( arg as node()? ) as xs:string?",
			description: "Returns a path expression that can be used to select the supplied node relative to the root of its containing document.\n\nOptional argument: arg"
		},
		{

			name: "root",
			signature: "root( arg as node()? ) as node()?",
			description: "Returns the root of the tree to which `$arg` belongs. This will usually, but not necessarily, be a document node.\n\nOptional argument: arg"
		},
		{

			name: "has-children",
			signature: "has-children( node as node()? ) as xs:boolean",
			description: "Returns true if the supplied node has one or more child nodes (of any kind).\n\nOptional argument: node"
		},
		{

			name: "innermost",
			signature: "innermost( nodes as node()* ) as node()*",
			description: "Returns every node within the input sequence that is not an ancestor of another member of the input sequence; the nodes are returned in document order with duplicates eliminated."
		},
		{

			name: "outermost",
			signature: "outermost( nodes as node()* ) as node()*",
			description: "Returns every node within the input sequence that has no ancestor that is itself a member of the input sequence; the nodes are returned in document order with duplicates eliminated."
		},
		{

			name: "index-of",
			signature: "index-of( seq as xs:anyAtomicType*, search as xs:anyAtomicType, collation as xs:string ) as xs:integer*",
			description: "Returns a sequence of positive integers giving the positions within the sequence `$seq` of items that are equal to `$search`.\n\nOptional argument: collation"
		},
		{

			name: "empty",
			signature: "empty( arg as item()* ) as xs:boolean",
			description: "Returns true if the argument is the empty sequence."
		},
		{

			name: "exists",
			signature: "exists( arg as item()* ) as xs:boolean",
			description: "Returns true if the argument is a non-empty sequence."
		},
		{

			name: "distinct-values",
			signature: "distinct-values( arg as xs:anyAtomicType*, collation as xs:string ) as xs:anyAtomicType*",
			description: "Returns the values that appear in a sequence, with duplicates eliminated.\n\nOptional argument: collation"
		},
		{

			name: "insert-before",
			signature: "insert-before( target as item()*, position as xs:integer, inserts as item()* ) as item()*",
			description: "Returns a sequence constructed by inserting an item or a sequence of items at a given position within an existing sequence."
		},
		{

			name: "remove",
			signature: "remove( target as item()*, position as xs:integer ) as item()*",
			description: "Returns a new sequence containing all the items of `$target` except the item at position `$position`."
		},
		{

			name: "head",
			signature: "head( arg as item()* ) as item()?",
			description: "Returns the first item in a sequence. "
		},
		{

			name: "tail",
			signature: "tail( arg as item()* ) as item()*",
			description: "Returns all but the first item in a sequence. "
		},
		{

			name: "reverse",
			signature: "reverse( arg as item()* ) as item()*",
			description: "Reverses the order of items in a sequence. "
		},
		{

			name: "subsequence",
			signature: "subsequence( sourceSeq as item()*, startingLoc as xs:double, length as xs:double ) as item()*",
			description: "Returns the contiguous sequence of items in the value of `$sourceSeq` beginning at the position indicated by the value of `$startingLoc` and continuing for the number of items indicated by the value of `$length`. \n\nOptional argument: length"
		},
		{

			name: "unordered",
			signature: "unordered( sourceSeq as item()* ) as item()*",
			description: "Returns the items of `$sourceSeq` in an implementation-dependent order."
		},
		{

			name: "zero-or-one",
			signature: "zero-or-one( arg as item()* ) as item()?",
			description: "Returns `$arg` if it contains zero or one items. Otherwise, raises an error."
		},
		{

			name: "one-or-more",
			signature: "one-or-more( arg as item()* ) as item()+",
			description: "Returns `$arg` if it contains one or more items. Otherwise, raises an error. "
		},
		{

			name: "exactly-one",
			signature: "exactly-one( arg as item()* ) as item()",
			description: "Returns `$arg` if it contains exactly one item. Otherwise, raises an error. "
		},
		{

			name: "deep-equal",
			signature: "deep-equal( parameter1 as item()*, parameter2 as item()*, collation as xs:string ) as xs:boolean",
			description: " This function assesses whether two sequences are deep-equal to each other. To be deep-equal, they must contain items that are pairwise deep-equal; and for two items to be deep-equal, they must either be atomic values that compare equal, or nodes of the same kind, with the same name, whose children are deep-equal, or maps with matching entries, or arrays with matching members.\n\nOptional argument: collation"
		},
		{

			name: "count",
			signature: "count( arg as item()* ) as xs:integer",
			description: "Returns the number of items in a sequence."
		},
		{

			name: "avg",
			signature: "avg( arg as xs:anyAtomicType* ) as xs:anyAtomicType?",
			description: "Returns the average of the values in the input sequence `$arg`, that is, the sum of the values divided by the number of values."
		},
		{

			name: "max",
			signature: "max( arg as xs:anyAtomicType*, collation as xs:string ) as xs:anyAtomicType?",
			description: "Returns a value that is equal to the highest value appearing in the input sequence.\n\nOptional argument: collation"
		},
		{

			name: "min",
			signature: "min( arg as xs:anyAtomicType*, collation as xs:string ) as xs:anyAtomicType?",
			description: "Returns a value that is equal to the lowest value appearing in the input sequence.\n\nOptional argument: collation"
		},
		{

			name: "sum",
			signature: "sum( arg as xs:anyAtomicType*, zero as xs:anyAtomicType? ) as xs:anyAtomicType?",
			description: "Returns a value obtained by adding together the values in `$arg`.\n\nOptional argument: zero"
		},
		{

			name: "id",
			signature: "id( arg as xs:string*, node as node() ) as element()*",
			description: "Returns the sequence of element nodes that have an `ID` value matching the value of one or more of the `IDREF` values supplied in `$arg`.\n\nOptional argument: node"
		},
		{

			name: "element-with-id",
			signature: "element-with-id( arg as xs:string*, node as node() ) as element()*",
			description: " Returns the sequence of element nodes that have an `ID` value matching the value of one or more of the `IDREF` values supplied in `$arg`.\n\nOptional argument: node"
		},
		{

			name: "idref",
			signature: "idref( arg as xs:string*, node as node() ) as node()*",
			description: "Returns the sequence of element or attribute nodes with an `IDREF` value matching the value of one or more of the `ID` values supplied in `$arg`.\n\nOptional argument: node"
		},
		{

			name: "doc",
			signature: "doc( uri as xs:string? ) as document-node()?",
			description: "Retrieves a document using a URI supplied as an `xs:string`, and returns the corresponding document node."
		},
		{

			name: "doc-available",
			signature: "doc-available( uri as xs:string? ) as xs:boolean",
			description: "The function returns true if and only if the function call `fn:doc($uri)` would return a document node."
		},
		{

			name: "collection",
			signature: "collection( arg as xs:string? ) as item()*",
			description: "Returns a sequence of items identified by a collection URI; or a default collection if no URI is supplied.\n\nOptional argument: arg"
		},
		{

			name: "uri-collection",
			signature: "uri-collection( arg as xs:string? ) as xs:anyURI*",
			description: "Returns a sequence of `xs:anyURI` values representing the URIs in a URI collection.\n\nOptional argument: arg"
		},
		{

			name: "unparsed-text",
			signature: "unparsed-text( href as xs:string?, encoding as xs:string ) as xs:string?",
			description: "The `fn:unparsed-text` function reads an external resource (for example, a file) and returns a string representation of the resource.\n\nOptional argument: encoding"
		},
		{

			name: "unparsed-text-lines",
			signature: "unparsed-text-lines( href as xs:string?, encoding as xs:string ) as xs:string*",
			description: "The `fn:unparsed-text-lines` function reads an external resource (for example, a file) and returns its contents as a sequence of strings, one for each line of text in the string representation of the resource.\n\nOptional argument: encoding"
		},
		{

			name: "unparsed-text-available",
			signature: "unparsed-text-available( href as xs:string?, encoding as xs:string ) as xs:boolean",
			description: "Because errors in evaluating the `fn:unparsed-text` function are non-recoverable, these two functions are provided to allow an application to determine whether a call with particular arguments would succeed.\n\nOptional argument: encoding"
		},
		{

			name: "environment-variable",
			signature: "environment-variable( name as xs:string ) as xs:string?",
			description: "Returns the value of a system environment variable, if it exists."
		},
		{

			name: "available-environment-variables",
			signature: "available-environment-variables() as xs:string*",
			description: "Returns a list of environment variable names that are suitable for passing to `fn:environment-variable`, as a (possibly empty) sequence of strings."
		},
		{

			name: "generate-id",
			signature: "generate-id( arg as node()? ) as xs:string",
			description: "This function returns a string that uniquely identifies a given node. \n\nOptional argument: arg"
		},
		{

			name: "parse-xml",
			signature: "parse-xml( arg as xs:string? ) as document-node(element(*))?",
			description: "This function takes as input an XML document represented as a string, and returns the document node at the root of an XDM tree representing the parsed document."
		},
		{

			name: "parse-xml-fragment",
			signature: "parse-xml-fragment( arg as xs:string? ) as document-node()?",
			description: "This function takes as input an XML external entity represented as a string, and returns the document node at the root of an XDM tree representing the parsed document fragment."
		},
		{

			name: "serialize",
			signature: "serialize( arg as item()*, params as item()? ) as xs:string",
			description: "This function serializes the supplied input sequence `$arg` as described in ``, returning the serialized representation of the sequence as a string.\n\nOptional argument: params"
		},
		{

			name: "position",
			signature: "position() as xs:integer",
			description: "Returns the context position from the dynamic context."
		},
		{

			name: "last",
			signature: "last() as xs:integer",
			description: "Returns the context size from the dynamic context."
		},
		{

			name: "current-dateTime",
			signature: "current-dateTime() as xs:dateTimeStamp",
			description: "Returns the current date and time (with timezone)."
		},
		{

			name: "current-date",
			signature: "current-date() as xs:date",
			description: "Returns the current date."
		},
		{

			name: "current-time",
			signature: "current-time() as xs:time",
			description: "Returns the current time."
		},
		{

			name: "implicit-timezone",
			signature: "implicit-timezone() as xs:dayTimeDuration",
			description: "Returns the value of the implicit timezone property from the dynamic context. "
		},
		{

			name: "default-collation",
			signature: "default-collation() as xs:string",
			description: "Returns the value of the default collation property from the static context. "
		},
		{

			name: "default-language",
			signature: "default-language() as xs:language",
			description: "Returns the value of the default language property from the dynamic context. "
		},
		{

			name: "static-base-uri",
			signature: "static-base-uri() as xs:anyURI?",
			description: "This function returns the value of the static base URI property from the static context."
		},
		{

			name: "function-lookup",
			signature: "function-lookup( name as xs:QName, arity as xs:integer ) as function(*)?",
			description: "Returns the function having a given name and arity, if there is one."
		},
		{

			name: "function-name",
			signature: "function-name( func as function(*) ) as xs:QName?",
			description: "Returns the name of the function identified by a function item."
		},
		{

			name: "function-arity",
			signature: "function-arity( func as function(*) ) as xs:integer",
			description: "Returns the arity of the function identified by a function item."
		},
		{

			name: "for-each",
			signature: "for-each( seq as item()*, action as function(item()) as item()* ) as item()*",
			description: "Applies the function item $action to every item from the sequence $seq in turn, returning the concatenation of the resulting sequences in order."
		},
		{

			name: "filter",
			signature: "filter( seq as item()*, f as function(item()) as xs:boolean ) as item()*",
			description: "Returns those items from the sequence $seq for which the supplied function $f returns true."
		},
		{

			name: "fold-left",
			signature: "fold-left( seq as item()*, zero as item()*, f as function(item()*, item()) as item()* ) as item()*",
			description: "Processes the supplied sequence from left to right, applying the supplied function repeatedly to each item in turn, together with an accumulated result value."
		},
		{

			name: "fold-right",
			signature: "fold-right( seq as item()*, zero as item()*, f as function(item(), item()*) as item()* ) as item()*",
			description: "Processes the supplied sequence from right to left, applying the supplied function repeatedly to each item in turn, together with an accumulated result value."
		},
		{

			name: "for-each-pair",
			signature: "for-each-pair( seq1 as item()*, seq2 as item()*, action as function(item(), item()) as item()* ) as item()*",
			description: "Applies the function item $action to successive pairs of items taken one from $seq1 and one from $seq2, returning the concatenation of the resulting sequences in order."
		},
		{

			name: "sort",
			signature: "sort( input as item()*, collation as xs:string?, key as function(item()) as xs:anyAtomicType* ) as item()*",
			description: "Sorts a supplied sequence, based on the value of a sort key supplied as a function.\n\nOptional arguments: collation, key"
		},
		{

			name: "apply",
			signature: "apply( function as function(*), array as array(*) ) as item()*",
			description: "Makes a dynamic call on a function with an argument list supplied in the form of an array."
		},
		{

			name: "map:merge",
			signature: "map:merge( maps as map(*)*, options as map(*) ) as map(*)",
			description: "Returns a map that combines the entries from a number of existing maps.\n\nOptional argument: options"
		},
		{

			name: "map:keys",
			signature: "map:keys( map as map(*) ) as xs:anyAtomicType*",
			description: "Returns a sequence containing all the keys present in a map"
		},
		{

			name: "map:contains",
			signature: "map:contains( map as map(*), key as xs:anyAtomicType ) as xs:boolean",
			description: "Tests whether a supplied map contains an entry for a given key"
		},
		{

			name: "map:get",
			signature: "map:get( map as map(*), key as xs:anyAtomicType ) as item()*",
			description: "Returns the value associated with a supplied key in a given map."
		},
		{

			name: "map:find",
			signature: "map:find( input as item()*, key as xs:anyAtomicType ) as array(*)",
			description: "Searches the supplied input sequence and any contained maps and arrays for a map entry with the supplied key, and returns the corresponding values."
		},
		{

			name: "map:put",
			signature: "map:put( map as map(*), key as xs:anyAtomicType, value as item()* ) as map(*)",
			description: "Returns a map containing all the contents of the supplied map, but with an additional entry, which replaces any existing entry for the same key."
		},
		{

			name: "map:entry",
			signature: "map:entry( key as xs:anyAtomicType, value as item()* ) as map(*)",
			description: "Returns a map that contains a single entry (a key-value pair)."
		},
		{

			name: "map:remove",
			signature: "map:remove( map as map(*), keys as xs:anyAtomicType* ) as map(*)",
			description: "Returns a map containing all the entries from a supplied map, except those having a specified key."
		},
		{

			name: "map:for-each",
			signature: "map:for-each( map as map(*), action as function(xs:anyAtomicType, item()*) as item()* ) as item()*",
			description: "Applies a supplied function to every entry in a map, returning the concatenation of the results."
		},
		{

			name: "map:size",
			signature: "map:size( map as map(*) ) as xs:integer",
			description: "Returns the number of entries in the supplied map."
		},
		{

			name: "collation-key",
			signature: "collation-key( key as xs:string, collation as xs:string ) as xs:base64Binary",
			description: "Given a string value and a collation, generates an internal value called a collation key, with the property that the matching and ordering of collation keys reflects the matching and ordering of strings under the specified collation.\n\nOptional argument: collation"
		},
		{

			name: "json-to-xml",
			signature: "json-to-xml( json-text as xs:string?, options as map(*) ) as document-node()?",
			description: "Parses a string supplied in the form of a JSON text, returning the results in the form of an XML document node.\n\nOptional argument: options"
		},
		{

			name: "xml-to-json",
			signature: "xml-to-json( input as node()?, options as map(*) ) as xs:string?",
			description: "Converts an XML tree, whose format corresponds to the XML representation of JSON defined in this specification, into a string conforming to the JSON grammar.\n\nOptional argument: options"
		},
		{

			name: "parse-json",
			signature: "parse-json( json-text as xs:string?, options as map(*) ) as item()?",
			description: "Parses a string supplied in the form of a JSON text, returning the results typically in the form of a map or array.\n\nOptional argument: options"
		},
		{

			name: "json-doc",
			signature: "json-doc( href as xs:string?, options as map(*) ) as item()?",
			description: "Reads an external resource containing JSON, and returns the result of parsing the resource as JSON.\n\nOptional argument: options"
		},
		{

			name: "array:size",
			signature: "array:size( array as array(*) ) as xs:integer",
			description: "Returns the number of members in the supplied array."
		},
		{

			name: "array:get",
			signature: "array:get( array as array(*), position as xs:integer ) as item()*",
			description: "Returns the value at the specified position in the supplied array (counting from 1)."
		},
		{

			name: "array:put",
			signature: "array:put( array as array(*), position as xs:integer, member as item()* ) as array(*)",
			description: "Returns an array containing all the members of a supplied array, except for one member which is replaced with a new value."
		},
		{

			name: "array:append",
			signature: "array:append( array as array(*), appendage as item()* ) as array(*)",
			description: "Returns an array containing all the members of a supplied array, plus one additional member at the end."
		},
		{

			name: "array:join",
			signature: "array:join( arrays as array(*)* ) as array(*)",
			description: "Concatenates the contents of several arrays into a single array."
		},
		{

			name: "array:subarray",
			signature: "array:subarray( array as array(*), start as xs:integer, length as xs:integer ) as array(*)",
			description: "Returns an array containing all members from a supplied array starting at a supplied position, up to a specified length.\n\nOptional argument: length"
		},
		{

			name: "array:remove",
			signature: "array:remove( array as array(*), positions as xs:integer* ) as array(*)",
			description: "Returns an array containing all the members of the supplied array, except for the members at specified positions."
		},
		{

			name: "array:insert-before",
			signature: "array:insert-before( array as array(*), position as xs:integer, member as item()* ) as array(*)",
			description: "Returns an array containing all the members of the supplied array, with one additional member at a specified position."
		},
		{

			name: "array:head",
			signature: "array:head( array as array(*) ) as item()*",
			description: "Returns the first member of an array, that is `$array(1)`."
		},
		{

			name: "array:tail",
			signature: "array:tail( array as array(*) ) as array(*)",
			description: "Returns an array containing all members except the first from a supplied array."
		},
		{

			name: "array:reverse",
			signature: "array:reverse( array as array(*) ) as array(*)",
			description: "Returns an array containing all the members of a supplied array, but in reverse order."
		},
		{

			name: "array:for-each",
			signature: "array:for-each( array as array(*), action as function(item()*) as item()* ) as array(*)",
			description: "Returns an array whose size is the same as `array:size($array)`, in which each member is computed by applying `$function` to the corresponding member of `$array`."
		},
		{

			name: "array:filter",
			signature: "array:filter( array as array(*), function as function(item()*) as xs:boolean ) as array(*)",
			description: "Returns an array containing those members of the `$array` for which `$function` returns true."
		},
		{

			name: "array:fold-left",
			signature: "array:fold-left( array as array(*), zero as item()*, function as function(item()*, item()*) as item()* ) as item()*",
			description: "Evaluates the supplied function cumulatively on successive members of the supplied array."
		},
		{

			name: "array:fold-right",
			signature: "array:fold-right( array as array(*), zero as item()*, function as function(item()*, item()*) as item()* ) as item()*",
			description: "Evaluates the supplied function cumulatively on successive values of the supplied array."
		},
		{

			name: "array:for-each-pair",
			signature: "array:for-each-pair( array1 as array(*), array2 as array(*), function as function(item()*, item()*) as item()* ) as array(*)",
			description: "Returns an array obtained by evaluating the supplied function once for each pair of members at the same position in the two supplied arrays."
		},
		{

			name: "array:sort",
			signature: "array:sort( array as array(*), collation as xs:string?, key as function(item()*) as xs:anyAtomicType* ) as array(*)",
			description: "Returns an array containing all the members of the supplied array, sorted according to the value of a sort key supplied as a function.\n\nOptional arguments: collation, key"
		},
		{

			name: "array:flatten",
			signature: "array:flatten( input as item()* ) as item()*",
			description: "Replaces any array appearing in a supplied sequence with the members of the array, recursively."
		},
		{

			name: "load-xquery-module",
			signature: "load-xquery-module( module-uri as xs:string, options as map(*) ) as map(*)",
			description: "Provides access to the public functions and global variables of a dynamically-loaded XQuery library module.\n\nOptional argument: options"
		},
		{

			name: "transform",
			signature: "transform( options as map(*) ) as map(*)",
			description: "Invokes a transformation using a dynamically-loaded XSLT stylesheet."
		},
		{

			name: "random-number-generator",
			signature: "random-number-generator( seed as xs:anyAtomicType? ) as map(xs:string, item())",
			description: "Returns a random number generator, which can be used to generate sequences of random numbers.\n\nOptional argument: seed"
		},
		{name: "xs:string" , signature: "xs:string( $arg as xs:anyAtomicType? ) as xs:string?" , description: "Consctuctor function."},
		{name: "xs:boolean" , signature: "xs:boolean( $arg as xs:anyAtomicType? ) as xs:boolean?" , description: "Consctuctor function."},
		{name: "xs:decimal" , signature: "xs:decimal( $arg as xs:anyAtomicType? ) as xs:decimal?" , description: "Consctuctor function."},
		{name: "xs:float" , signature: "xs:float( $arg as xs:anyAtomicType? ) as xs:float?" , description: "Consctuctor function."},
		{name: "xs:double" , signature: "xs:double( $arg as xs:anyAtomicType? ) as xs:double?" , description: "Consctuctor function."},
		{name: "xs:duration" , signature: "xs:duration( $arg as xs:anyAtomicType? ) as xs:duration?" , description: "Consctuctor function."},
		{name: "xs:dateTime" , signature: "xs:dateTime( $arg as xs:anyAtomicType? ) as xs:dateTime?" , description: "Consctuctor function."},
		{name: "xs:time" , signature: "xs:time( $arg as xs:anyAtomicType? ) as xs:time?" , description: "Consctuctor function."},
		{name: "xs:date" , signature: "xs:date( $arg as xs:anyAtomicType? ) as xs:date?" , description: "Consctuctor function."},
		{name: "xs:gYearMonth" , signature: "xs:gYearMonth( $arg as xs:anyAtomicType? ) as xs:gYearMonth?" , description: "Consctuctor function."},
		{name: "xs:gYear" , signature: "xs:gYear( $arg as xs:anyAtomicType? ) as xs:gYear?" , description: "Consctuctor function."},
		{name: "xs:gMonthDay" , signature: "xs:gMonthDay( $arg as xs:anyAtomicType? ) as xs:gMonthDay?" , description: "Consctuctor function."},
		{name: "xs:gDay" , signature: "xs:gDay( $arg as xs:anyAtomicType? ) as xs:gDay?" , description: "Consctuctor function."},
		{name: "xs:gMonth" , signature: "xs:gMonth( $arg as xs:anyAtomicType? ) as xs:gMonth?" , description: "Consctuctor function."},
		{name: "xs:hexBinary" , signature: "xs:hexBinary( $arg as xs:anyAtomicType? ) as xs:hexBinary?" , description: "Consctuctor function."},
		{name: "xs:base64Binary" , signature: "xs:base64Binary( $arg as xs:anyAtomicType? ) as xs:base64Binary?" , description: "Consctuctor function."},
		{name: "xs:anyURI" , signature: "xs:anyURI( $arg as xs:anyAtomicType? ) as xs:anyURI?" , description: "Consctuctor function."},
		{name: "xs:QName" , signature: "xs:QName( $arg as xs:anyAtomicType? ) as xs:QName?" , description: "Consctuctor function."},
		{name: "xs:normalizedString" , signature: "xs:normalizedString( $arg as xs:anyAtomicType? ) as xs:normalizedString?" , description: "Consctuctor function."},
		{name: "xs:token" , signature: "xs:token( $arg as xs:anyAtomicType? ) as xs:token?" , description: "Consctuctor function."},
		{name: "xs:language" , signature: "xs:language( $arg as xs:anyAtomicType? ) as xs:language?" , description: "Consctuctor function."},
		{name: "xs:NMTOKEN" , signature: "xs:NMTOKEN( $arg as xs:anyAtomicType? ) as xs:NMTOKEN?" , description: "Consctuctor function."},
		{name: "xs:Name" , signature: "xs:Name( $arg as xs:anyAtomicType? ) as xs:Name?" , description: "Consctuctor function."},
		{name: "xs:NCName" , signature: "xs:NCName( $arg as xs:anyAtomicType? ) as xs:NCName?" , description: "Consctuctor function."},
		{name: "xs:ID" , signature: "xs:ID( $arg as xs:anyAtomicType? ) as xs:ID?" , description: "Consctuctor function."},
		{name: "xs:IDREF" , signature: "xs:IDREF( $arg as xs:anyAtomicType? ) as xs:IDREF?" , description: "Consctuctor function."},
		{name: "xs:ENTITY" , signature: "xs:ENTITY( $arg as xs:anyAtomicType? ) as xs:ENTITY?" , description: "Consctuctor function."},
		{name: "xs:integer" , signature: "xs:integer( $arg as xs:anyAtomicType? ) as xs:integer?" , description: "Consctuctor function."},
		{name: "xs:nonPositiveInteger" , signature: "xs:nonPositiveInteger( $arg as xs:anyAtomicType? ) as xs:nonPositiveInteger?" , description: "Consctuctor function."},
		{name: "xs:negativeInteger" , signature: "xs:negativeInteger( $arg as xs:anyAtomicType? ) as xs:negativeInteger?" , description: "Consctuctor function."},
		{name: "xs:long" , signature: "xs:long( $arg as xs:anyAtomicType? ) as xs:long?" , description: "Consctuctor function."},
		{name: "xs:int" , signature: "xs:int( $arg as xs:anyAtomicType? ) as xs:int?" , description: "Consctuctor function."},
		{name: "xs:short" , signature: "xs:short( $arg as xs:anyAtomicType? ) as xs:short?" , description: "Consctuctor function."},
		{name: "xs:byte" , signature: "xs:byte( $arg as xs:anyAtomicType? ) as xs:byte?" , description: "Consctuctor function."},
		{name: "xs:nonNegativeInteger" , signature: "xs:nonNegativeInteger( $arg as xs:anyAtomicType? ) as xs:nonNegativeInteger?" , description: "Consctuctor function."},
		{name: "xs:unsignedLong" , signature: "xs:unsignedLong( $arg as xs:anyAtomicType? ) as xs:unsignedLong?" , description: "Consctuctor function."},
		{name: "xs:unsignedInt" , signature: "xs:unsignedInt( $arg as xs:anyAtomicType? ) as xs:unsignedInt?" , description: "Consctuctor function."},
		{name: "xs:unsignedShort" , signature: "xs:unsignedShort( $arg as xs:anyAtomicType? ) as xs:unsignedShort?" , description: "Consctuctor function."},
		{name: "xs:unsignedByte" , signature: "xs:unsignedByte( $arg as xs:anyAtomicType? ) as xs:unsignedByte?" , description: "Consctuctor function."},
		{name: "xs:positiveInteger" , signature: "xs:positiveInteger( $arg as xs:anyAtomicType? ) as xs:positiveInteger?" , description: "Consctuctor function."},
		{name: "xs:yearMonthDuration" , signature: "xs:yearMonthDuration( $arg as xs:anyAtomicType? ) as xs:yearMonthDuration?" , description: "Consctuctor function."},
		{name: "xs:dayTimeDuration" , signature: "xs:dayTimeDuration( $arg as xs:anyAtomicType? ) as xs:dayTimeDuration?" , description: "Consctuctor function."},
		{name: "xs:untypedAtomic" , signature: "xs:untypedAtomic( $arg as xs:anyAtomicType? ) as xs:untypedAtomic?" , description: "Consctuctor function."},
		{name: "xs:dateTimeStamp" , signature: "xs:dateTimeStamp( $arg as xs:anyAtomicType? ) as xs:dateTimeStamp?" , description: "Consctuctor function."}
	]

	public static data: FunctionCompletionData[] = XPathFunctionDetails.xpathData.concat(XPathFunctionDetails.xsltData);
}