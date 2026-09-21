import { CancellationToken, MarkdownString, ParameterInformation, Position, ProviderResult, Range, SignatureHelp, SignatureHelpProvider, SignatureInformation, TextDocument } from "vscode";
import { XPathFunctionDetails } from "./xpathFunctionDetails";

interface EnclosingCall {
	functionName: string;
	activeParameter: number;
}

export class XSLTSignatureHelpProvider implements SignatureHelpProvider {

	private functionData = XPathFunctionDetails.dataPlusIxslPlus40;
	private signatureCache = new Map<string, SignatureInformation>();
	private static readonly maxLookbackLines = 200;

	provideSignatureHelp(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<SignatureHelp> {
		const enclosingCall = this.findEnclosingCall(document, position);
		if (!enclosingCall) {
			return undefined;
		}

		let fnName = enclosingCall.functionName;
		fnName = fnName.startsWith('fn:') ? fnName.substring(3) : fnName;

		const matchingData = this.functionData.find((item) => item.name === fnName);
		if (!matchingData) {
			return undefined;
		}

		const signatureInfo = this.getSignatureInformation(matchingData.name, matchingData.signature, matchingData.description);
		const help = new SignatureHelp();
		help.signatures = [signatureInfo];
		help.activeSignature = 0;
		const paramCount = signatureInfo.parameters.length;
		help.activeParameter = paramCount === 0 ? 0 : Math.min(enclosingCall.activeParameter, paramCount - 1);
		return help;
	}

	private getSignatureInformation(name: string, signature: string, description: string): SignatureInformation {
		const cached = this.signatureCache.get(name);
		if (cached) {
			return cached;
		}

		const info = new SignatureInformation(signature, new MarkdownString(description));
		const openParenIndex = signature.indexOf('(');

		if (openParenIndex > -1) {
			let depth = 0;
			let closeParenIndex = -1;
			for (let i = openParenIndex; i < signature.length; i++) {
				const ch = signature[i];
				if (ch === '(') {
					depth++;
				} else if (ch === ')') {
					depth--;
					if (depth === 0) {
						closeParenIndex = i;
						break;
					}
				}
			}

			if (closeParenIndex > -1) {
				const paramsText = signature.substring(openParenIndex + 1, closeParenIndex).trim();
				if (paramsText.length > 0) {
					const paramLabels = this.splitTopLevelParams(paramsText);
					info.parameters = paramLabels.map((label) => new ParameterInformation(label));
				}
			}
		}

		this.signatureCache.set(name, info);
		return info;
	}

	private splitTopLevelParams(paramsText: string): string[] {
		const params: string[] = [];
		let depth = 0;
		let start = 0;

		for (let i = 0; i < paramsText.length; i++) {
			const ch = paramsText[i];
			if (ch === '(' || ch === '[' || ch === '{') {
				depth++;
			} else if (ch === ')' || ch === ']' || ch === '}') {
				depth--;
			} else if (ch === ',' && depth === 0) {
				params.push(paramsText.substring(start, i).trim());
				start = i + 1;
			}
		}
		params.push(paramsText.substring(start).trim());
		return params;
	}

	private findEnclosingCall(document: TextDocument, position: Position): EnclosingCall | null {
		const startLine = Math.max(0, position.line - XSLTSignatureHelpProvider.maxLookbackLines);
		const text = document.getText(new Range(new Position(startLine, 0), position));

		let depth = 0;
		let commaCount = 0;
		let quoteChar: string | null = null;

		for (let i = text.length - 1; i >= 0; i--) {
			const ch = text[i];

			if (quoteChar) {
				if (ch === quoteChar) {
					quoteChar = null;
				}
				continue;
			}

			if (ch === '"' || ch === '\'') {
				quoteChar = ch;
			} else if (ch === ')' || ch === ']' || ch === '}') {
				depth++;
			} else if (ch === '(' || ch === '[' || ch === '{') {
				if (depth === 0) {
					if (ch !== '(') {
						return null;
					}
					return this.readFunctionName(text, i, commaCount);
				}
				depth--;
			} else if (ch === ',' && depth === 0) {
				commaCount++;
			}
		}

		return null;
	}

	private readFunctionName(text: string, openParenIndex: number, activeParameter: number): EnclosingCall | null {
		let j = openParenIndex - 1;
		while (j >= 0 && /\s/.test(text[j])) {
			j--;
		}
		const nameEnd = j + 1;
		while (j >= 0 && /[A-Za-z0-9_\-:]/.test(text[j])) {
			j--;
		}
		const nameStart = j + 1;

		if (nameStart === nameEnd) {
			return null;
		}

		return { functionName: text.substring(nameStart, nameEnd), activeParameter };
	}
}
