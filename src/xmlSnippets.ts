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
	static generalTags: Snippet[] = [
		{
			name: 'block-start-end-tag-with',
			description: 'with attribute',
			body:
			`\${1:element} \${2:attribute}="\${3:value}">			 
\t\$0						 
</\${1:element}>`
		},
		{
			name: 'inline-start-end-tag-with',
			description: 'with attribute',
			body:
			`\${1:element} \${2:attribute}="\${3:value}">\${4:text}</\${1:element}>$0`
		},
		{
			name: 'self-closed-tag-with',
			description: 'with attribute',
			body:
			`\${1:element} \${2:attribute}="\${3:value}"\$0/>`
		},
		{
			name: 'block-start-end-tag',
			description: 'no attribute',
			body:
			`\${1:element}>			 
\t\$0						 
</\${1:element}>`
		},
		{
			name: 'inline-start-end-tag',
			description: 'no attribute',
			body:
			`\${1:element}>\${2:text}</\${1:element}>$0`
		},
		{
			name: 'self-closed-tag',
			description: 'no attribute',
			body:
			`\${1:element}$0/>`
		}
	]
	static generalAttributes: Snippet[] = [
		{
			name: 'attribute',
			description: 'attribute name="value"',
			body: `\${1:name}="\${2:value}"$0`
		}		
	]
}