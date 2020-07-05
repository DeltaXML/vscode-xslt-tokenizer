import { Snippet} from './xsltSnippets';

export class DCPSnippets {
	static xsltRootTags: Snippet[] = [{
		name: 'Side-by-side diff report',
		description: 'DCP to generate a side-by-side diffreport',
		body:
			`?xml version="1.0" encoding="UTF-8"?>
<documentComparator version="1.0"
	                id="\${1:pipeline-id}" 
	                description="\${2:short description}" >
			 
\t<pipelineParameters>
\t\t\$0<booleanParameter name="load-external-dtd" defaultValue="false"/>
\t\t<booleanParameter name="resolve-formatting-diffs" defaultValue="false"/>
\t\t<stringParameter name="formatting-element-list" defaultValue="b,i,u,strong,emph"/>
\t</pipelineParameters>
			 
\t<standardConfig>
\t\t<lexicalPreservation>
\t\t\t<defaults>
\t\t\t\t<retain literalValue="true"/>
\t\t\t\t<processingMode literalValue="change"/>
\t\t\t\t<outputType literalValue="encoded"/>
\t\t\t</defaults>
\t\t\t<overrides>
\t\t\t\t<preserveItems>
\t\t\t\t\t<ignorableWhitespace>
\t\t\t\t\t\t<retain literalValue="false"/>
\t\t\t\t\t</ignorableWhitespace>
\t\t\t\t</preserveItems>
\t\t\t</overrides>
\t\t</lexicalPreservation>
\t\t<outputFormatConfiguration>
\t\t\t<modifiedFormatOutput xpath="if (\\\$resolve-formatting-diffs) then 'BA' else 'change'"/>
\t\t</outputFormatConfiguration>
\t\t<resultReadabilityOptions>
\t\t\t<modifiedWhitespaceBehaviour literalValue="normalize"/>
\t\t\t<mixedContentDetectionScope literalValue="local"/>
\t\t</resultReadabilityOptions>
\t</standardConfig>
			 
\t<advancedConfig>
\t\t<parserFeatures>
\t\t\t<feature name="http://apache.org/xml/features/nonvalidating/load-external-dtd"
\t\t\t         parameterRef="load-external-dtd"/>      
\t\t</parserFeatures>
\t</advancedConfig>
			 
\t<extensionPoints>
\t\t<inputPreFlatteningPoint>
\t\t\t<filter>
\t\t\t\t<resource name="xsl/delta-2_1-mark-formatting.xsl"/>
\t\t\t\t<parameter name="formatting-element-names" xpath="tokenize(\\\$formatting-element-list, ',')"/>
\t\t\t</filter>
\t\t</inputPreFlatteningPoint>
			  
\t\t<outputExtensionPoints>
\t\t\t<postTablePoint>
\t\t\t\t<filter>
\t\t\t\t\t<resource name="xsl/ignore-deltaxml-elements.xsl"/>
\t\t\t\t\t<parameter name="deltaxml-element-names" literalValue="important"/>       
\t\t\t\t</filter>
\t\t\t</postTablePoint>
\t\t\t<finalPoint>
\t\t\t\t<filter>
\t\t\t\t\t<resource name="xsl/dx2-deltaxml-sbs-folding-html.xsl"/>
\t\t\t\t</filter>
\t\t\t</finalPoint>
\t\t</outputExtensionPoints>
\t</extensionPoints>
</documentComparator>`
	},
	{
		name: 'Standard Configuration DCP',
		description: 'DCP structure with basic configuration',
		body:
			`?xml version="1.0" encoding="UTF-8"?>
<documentComparator version="1.0"
	                id="\${1:pipeline-id}" 
	                description="\${2:short description}" >
			 
\t<standardConfig>

\t\t<lexicalPreservation>
\t\t\t<defaults>
\t\t\t\t<retain literalValue="true"/>
\t\t\t</defaults>
\t\t\t<overrides>
\t\t\t\t<preserveItems>
\t\t\t\t\t<ignorableWhitespace>
\t\t\t\t\t\t<retain literalValue="false"/>
\t\t\t\t\t</ignorableWhitespace>
\t\t\t\t</preserveItems>
\t\t\t</overrides>
\t\t</lexicalPreservation>

\t\t<resultReadabilityOptions>
\t\t\t<modifiedWhitespaceBehaviour literalValue="normalize"/>
\t\t\t<mixedContentDetectionScope literalValue="local"/>
\t\t</resultReadabilityOptions>

\t</standardConfig>
			 
</documentComparator>`
	}
];
}