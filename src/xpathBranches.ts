/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import { BaseToken } from './xpLexer';

// an item of the stack of open XPath constructs, as kept by Go to Definition and completion - with what's needed for the
// branches of for, let, some, every and if: 'return', 'satisfies' and 'else'
export interface BranchStackItem<V> {
	token: BaseToken;
	// the variables in scope before the item - a copy, so those it declares aren't added to them
	variables: V[];
	preXPathVariable: boolean;
	xpathVariableCurrentlyBeingDefined: boolean;
	isRangeVar?: boolean;
	// a for, let, some, every or then - whose branch, e.g. 'return', takes the item over
	opensBranch?: boolean;
	// the branch the item is now: 'return', 'satisfies' or 'else' - ended by a ',' or a closing bracket, as by an
	// 'else' when it's in a 'then' branch. The keyword's token value can't be used: it isn't set for these tokens
	branch?: string;
}

export interface BranchState<V> {
	inScopeXPathVariablesList: V[];
	preXPathVariable: boolean;
	xpathVariableCurrentlyBeingDefined: boolean;
}

export class XPathBranches {
	// ends the branches at the top of the stack - several, for a cascade, e.g. if (a) then 1 else if (b) then 2 else 3, or
	// let $x := 1 return if (a) then 1 else 2 - returning the outermost one ended, whose variables are those in scope
	// after it, if any. keep: the number of items that stay, at least
	public static endBranches<V, T extends BranchStackItem<V>>(xpathStack: T[], keep = 0): T | undefined {
		let ended: T | undefined;
		while (xpathStack.length > keep && xpathStack[xpathStack.length - 1].branch) {
			ended = xpathStack.pop();
		}
		return ended;
	}

	// the state after a ',' - it ends the branches before it, e.g. the last $v in let $v := 1 return $v, $v is another
	// variable: the variables in scope are those before the outermost branch
	public static afterComma<V, T extends BranchStackItem<V>>(xpathStack: T[], state: BranchState<V>): BranchState<V> {
		const ended = XPathBranches.endBranches<V, T>(xpathStack);
		if (!ended) {
			return state;
		}
		return {
			inScopeXPathVariablesList: ended.variables,
			preXPathVariable: ended.branch === 'else' ? ended.preXPathVariable : false,
			xpathVariableCurrentlyBeingDefined: false
		};
	}

	// the state after 'return', 'satisfies' or 'else': it ends any branch before it - e.g. the 'return' in
	// if (a) then let $x := 1 return $x else 2 - and takes over the item it belongs to, its for, let, some, every or
	// then, whose variables stay in scope in the branch until it's ended
	public static startBranch<V, T extends BranchStackItem<V>>(xpathStack: T[], token: BaseToken, keyword: string, state: BranchState<V>): BranchState<V> {
		const ended = XPathBranches.endBranches<V, T>(xpathStack, 1);
		let inScopeXPathVariablesList = ended ? ended.variables : state.inScopeXPathVariablesList;
		const top = xpathStack.length > 0 ? xpathStack[xpathStack.length - 1] : undefined;
		if (!top || !top.opensBranch) {
			// not after a for, let, some, every or then, e.g. an XPath expression with an error
			return { inScopeXPathVariablesList, preXPathVariable: false, xpathVariableCurrentlyBeingDefined: false };
		}
		top.token = token;
		top.branch = keyword;
		top.opensBranch = false;
		// no longer the clause where variables are declared, e.g. for 'return' completion or a string restoring it
		top.isRangeVar = false;
		if (keyword !== 'else') {
			top.preXPathVariable = false;
		}
		return { inScopeXPathVariablesList, preXPathVariable: top.preXPathVariable, xpathVariableCurrentlyBeingDefined: top.xpathVariableCurrentlyBeingDefined };
	}
}
