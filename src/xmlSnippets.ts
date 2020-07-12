import { Snippet} from './xsltSnippets';

export class XMLSnippets {
	static xsltRootTags: Snippet[] = [
	{
		name: 'XML Root Element Snippet',
		description: 'Basic XML Template',
		body:
			`?xml version="1.0" encoding="UTF-8"?>
<\${1:element} \${2:attribute}="\${3:value}">
			 
\t<\${4:childElement}>
\t\t$0
\t</\${4:childElement}>
			 
</\${1:element}>`
	}
];
}