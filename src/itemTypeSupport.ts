/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as vscode from 'vscode';
import { SchemaData, XSLTSchema } from './xsltSchema';
import { XSLTSchema4 } from './xsltSchema4';

// XSLT 4.0 named item types - xsl:item-type, with record and enumeration types, also in 'as' attributes - and
// xsl:note are available in an XSLT 4.0 stylesheet, and in one for an earlier version when the setting
// XSLT.validation.xslt30ItemTypesAndNotes is on: for Saxon PE/EE 12.8 or later with syntax extensions, which accepts
// them in an XSLT 3.0 stylesheet. Other XSLT 4.0 and XPath 4.0 features still need version="4.0".
export class ItemTypeSupport {
	public static readonly section = 'XSLT.validation';
	public static readonly setting = 'xslt30ItemTypesAndNotes';
	// for tests, the value used instead of the setting
	public static before40Override: boolean | undefined;
	private static schema30: SchemaData | undefined;

	// item types and notes are available before XSLT 4.0
	public static isEnabledBefore40(): boolean {
		if (ItemTypeSupport.before40Override !== undefined) {
			return ItemTypeSupport.before40Override;
		}
		return vscode.workspace.getConfiguration(ItemTypeSupport.section).get<boolean>(ItemTypeSupport.setting, false);
	}

	// item types and notes are available: for XSLT 4.0, or before it with the setting
	public static isEnabled(isVersion4: boolean): boolean {
		return isVersion4 || ItemTypeSupport.isEnabledBefore40();
	}

	// the stylesheet is XSLT 4.0, from the version attribute of its root element
	public static isVersion4Text(text: string): boolean {
		return /\sversion\s*=\s*["']4\.0["']/.test(text.substring(0, 3000));
	}

	// item types and notes are available for the stylesheet's text
	public static isEnabledForText(text: string): boolean {
		return ItemTypeSupport.isEnabled(ItemTypeSupport.isVersion4Text(text));
	}

	// the XSLT 3.0 schema, with xsl:item-type as a declaration - for a stylesheet before XSLT 4.0 with the setting
	public static schemaData30(): SchemaData {
		if (!ItemTypeSupport.schema30) {
			const schema = new XSLTSchema();
			const itemType = new XSLTSchema4().substitutionGroups.declaration.elements['xsl:item-type'];
			schema.substitutionGroups.declaration.elements['xsl:item-type'] = itemType;
			ItemTypeSupport.schema30 = schema;
		}
		return ItemTypeSupport.schema30;
	}
}
