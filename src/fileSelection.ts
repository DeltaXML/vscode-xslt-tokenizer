import * as vscode from 'vscode';
import * as path from 'path';
import { XsltSymbolProvider } from './xsltSymbolProvider';
import { XslLexer, XSLTokenLevelState } from './xslLexer';
import { XMLConfiguration } from './languageConfigurations';
import { BaseToken, TokenLevelState } from './xpLexer';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';
import { CodeActionDocument } from './codeActionDocument';

type removeTokenVotes = { otherMatchCount: number }[];
type pickedFileItem = { label: string; description: string; fullDirname: string };

export class FileSelection {
  private static readonly PICK_FILE = "$(explorer-view-icon) Pick File";
  private static readonly CLEAR_RECENTS = "$(root-folder) Clear Recently Used";
  private static readonly XML_SOURCE_LABEL = "Select XML Source File";
  private static readonly RESULT_LABEL = "Set Result File";
  private static commandList: string[] = [FileSelection.PICK_FILE];
  private static readonly MMO_PREFIX = 'qfs:';
  private static readonly PATH_LENGTH_LIMIT = 50;
  private context: vscode.ExtensionContext;
  private static xmlLexer = new XslLexer(XMLConfiguration.configuration);

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }
  public pickedValues = new Map<string, string>();
  public completedPick = true;

  public async pickXsltFile() {
    return await this.pickFile({ label: "Select XSLT File", extensions: ["xsl", "xslt"], xmlStylesheetPI: true });
  }
  public async pickXmlSourceFile() {
    return await this.pickFile({ label: FileSelection.XML_SOURCE_LABEL, extensions: ["xml", "html", "xhtml", "svg", "dcp", "xspec", "sch", "docbook", "dita", "ditamap", "xsd", "xbrl"] });
  }
  public async pickStage2XmlSourceFile() {
    return await this.pickFile({
      label: "Select Stage2 XML Source File",
      prevStageLabel: FileSelection.RESULT_LABEL,
      prevStageGroup: 'recent files from previous stage',
      extensions: ["xml", "html", "xhtml", "svg", "dcp", "xspec", "sch", "docbook", "dita", "ditamap", "xsd", "xbrl"]
    });
  }

  public async pickResultFile() {
    return await this.pickFile({ label: FileSelection.RESULT_LABEL, isResult: true });
  }
  public async pickStage2ResultFile() {
    return await this.pickFile({ label: "Set Stage2 Result File", isResult: true });
  }

  public async pickFile(obj: { label: string; extensions?: string[]; isResult?: boolean; prevStageLabel?: string; prevStageGroup?: string; xmlStylesheetPI?: boolean }) {
    // <?xml-stylesheet type="text/xsl" href="02list11.xsl"?>
    this.completedPick = true;
    const { label, extensions, isResult, prevStageLabel, prevStageGroup, xmlStylesheetPI } = obj;
    const workspaceLabel = FileSelection.MMO_PREFIX + label;
    let fileListForLabel: string[] | undefined = this.context.workspaceState.get(workspaceLabel);
    if (!fileListForLabel) {
      fileListForLabel = [];
    }
    const fileItems = this.createFileItems(fileListForLabel);
    let prevStageFilePaths: string[] | undefined = prevStageLabel ? this.context.workspaceState.get(FileSelection.MMO_PREFIX + prevStageLabel) : undefined;
    const commandItems: { label: string; description?: string }[] = FileSelection.commandList.map(label => ({ label, description: '- file explorer' }));
    if (fileListForLabel.length > 0) {
      commandItems.push({ label: FileSelection.CLEAR_RECENTS });
    }
    const explorerSeparator = {
      label: '',
      kind: vscode.QuickPickItemKind.Separator
    };
    const prevStageSeparatorName = prevStageGroup ? prevStageGroup : 'recent filesfrom previous stage';
    const prevStageSeparator = {
      label: prevStageSeparatorName,
      kind: vscode.QuickPickItemKind.Separator
    };
    const fileSeparator = {
      label: 'recently used',
      kind: vscode.QuickPickItemKind.Separator
    };
    const currentSeparator = {
      label: 'current file',
      kind: vscode.QuickPickItemKind.Separator
    };
    const xmlStylePISeparator = {
      label: 'xml-stylesheet',
      kind: vscode.QuickPickItemKind.Separator
    };

    let listItems: { label: string; kind?: vscode.QuickPickItemKind; description?: string; fullDirname?: string }[] = [];
    let currentFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;

    let xmlStylesheetFileItems: { label: string; kind?: vscode.QuickPickItemKind; description?: string }[] = [];
    if (xmlStylesheetPI) {
      xmlStylesheetFileItems = this.createXmlStylesheetItems();
    }

    if (isResult) {
      currentFilePath = undefined;
    } else if (currentFilePath) {
      if (!extensions || extensions.includes('*') || extensions.includes(path.extname(currentFilePath).substring(1))) {
        listItems.push(currentSeparator);
        const dirPath = path.dirname(currentFilePath);
        listItems.push({ label: path.basename(currentFilePath), description: dirPath, fullDirname: dirPath });
      } else {
        currentFilePath = undefined;
      }
    }
    if (xmlStylesheetFileItems.length > 0) {
      listItems.push(xmlStylePISeparator);
      listItems = listItems.concat(xmlStylesheetFileItems);
    }
    if (fileItems.length > 0) {
      listItems.push(fileSeparator);
      listItems = listItems.concat(fileItems);
    }
    if (prevStageFilePaths && prevStageFilePaths.length > 0) {
      const prevStageFileItems = prevStageFilePaths.map(fsPath => ({
        label: path.basename(fsPath), description: path.dirname(fsPath), fullDirname: path.dirname(fsPath)
      }));
      listItems.push(prevStageSeparator);
      listItems = listItems.concat(prevStageFileItems);
    }
    if (listItems.length > 0) {
      listItems.push(explorerSeparator);
      listItems = listItems.concat(commandItems);
    }
    const qpOptions: vscode.QuickPickOptions = {
      placeHolder: label
    };
    if (listItems.length > 0) {
      // give option to select from recent files
      const picked = await vscode.window.showQuickPick(listItems, qpOptions);
      let exit = true;
      if (picked) {
        if (picked.kind === vscode.QuickPickItemKind.Separator) {
        } else if (picked.label === FileSelection.PICK_FILE) {
          exit = false;
        } else if (picked.label === FileSelection.CLEAR_RECENTS) {
          fileListForLabel.length = 0;
          this.context.workspaceState.update(workspaceLabel, fileListForLabel);
        } else {
          const typedPick = <pickedFileItem>picked;
          const pickedFsPath = typedPick.fullDirname + path.sep + picked.label;
          if (fileListForLabel.includes(pickedFsPath)) {
            // promote - remove and insert at top:
            fileListForLabel = fileListForLabel.filter(item => item !== pickedFsPath);
            fileListForLabel.unshift(pickedFsPath);
          } else {
            fileListForLabel.unshift(pickedFsPath);
            if (fileListForLabel.length > 10) {
              fileListForLabel.pop();
            }
          }
          this.pickedValues.set(label, pickedFsPath);
          this.context.workspaceState.update(workspaceLabel, fileListForLabel);
          return pickedFsPath;
        }
      }
      if (exit) {
        this.completedPick = false;
        return;
      }
    }
    if (isResult) {
      const RESULT_FILE = await vscode.window.showSaveDialog({
        title: label
      });
      if (RESULT_FILE) {
        const newFilePath = RESULT_FILE.fsPath;

        if (fileListForLabel.includes(newFilePath)) {
          // promote - remove and insert at top:
          fileListForLabel = fileListForLabel.filter(item => item !== newFilePath);
          fileListForLabel.unshift(newFilePath);
        } else {
          fileListForLabel.unshift(newFilePath);
          // add:
          if (fileListForLabel.length > 10) {
            fileListForLabel.pop();
          }
          this.pickedValues.set(label, newFilePath);
        }
        this.context.workspaceState.update(workspaceLabel, fileListForLabel);
        return newFilePath;
      }
    } else {
      let extensionFilters: { [key: string]: string[] } = {};
      if (extensions && extensions.length > 0) {
        const filterLabel = extensions.map(ext => '*.' + ext).join(', ');
        extensionFilters[filterLabel] = extensions;
        extensionFilters['*.*'] = ['*'];
      }
      const APP_FILE = await vscode.window.showOpenDialog({
        title: label,
        filters: extensionFilters,
        canSelectFolders: false,
        canSelectFiles: true,
        canSelectMany: false,
        openLabel: label,
      });

      if (!APP_FILE || APP_FILE.length < 1) {
        this.completedPick = false;
        return;
      } else {
        const newFilePath = APP_FILE[0].fsPath;
        if (!fileListForLabel.includes(newFilePath)) {
          fileListForLabel.unshift(newFilePath);
          if (fileListForLabel.length > 10) {
            fileListForLabel.pop();
          }
          this.pickedValues.set(label, newFilePath);
          this.context.workspaceState.update(workspaceLabel, fileListForLabel);
        }
        return newFilePath;
      }
    }
  }

  private createXmlStylesheetItems() {
    const result: { label: string; kind?: vscode.QuickPickItemKind; description?: string; fullDirname: string }[] = [];
    const doc = vscode.window.activeTextEditor?.document;
    if (doc) {
      const docUri = doc.uri;
      const symbols = XsltSymbolProvider.getSymbolsForActiveDocument();
      if (symbols.length < 1) {
        return [];
      }
      const rootElementStartPos = symbols[0].range.start;
      const startPos = new vscode.Position(0, 0);
      const precedingRange = new vscode.Range(startPos, rootElementStartPos);
      const docText = doc.getText(precedingRange);
      const tokens = FileSelection.xmlLexer.analyse(docText, false);
      let i = 0;
      let foundStylesheetPi = false;
      let foundXslType = false;
      let resolvedXslPath: string | undefined;
      tokens.forEach((token) => {
        let xmlTokenType = <XSLTokenLevelState>(token.tokenType - XsltTokenDiagnostics.xsltStartTokenNumber);
        if (xmlTokenType === XSLTokenLevelState.processingInstrName) {
          const piName = XsltTokenDiagnostics.getTextForToken(token.line, token, doc);
          foundStylesheetPi = (piName === 'xml-stylesheet');
        }
        if (foundStylesheetPi && xmlTokenType === XSLTokenLevelState.processingInstrValue) {
          const piValue = XsltTokenDiagnostics.getTextForToken(token.line, token, doc);
          const fakedXml = '<a ' + piValue;
          const fakedDoc = new CodeActionDocument(docUri, fakedXml);
          const piTokens = FileSelection.xmlLexer.analyse(fakedXml, false);
          let foundHref = false;
          let foundType = false;
          piTokens.forEach((piToken) => {
            let piTokenType = <XSLTokenLevelState>(piToken.tokenType - XsltTokenDiagnostics.xsltStartTokenNumber);
            if (piTokenType === XSLTokenLevelState.attributeName) {
              const piAttrName = this.getTokenValueFromDoc(piToken, fakedDoc);
              foundHref = (piAttrName === 'href');
              foundType = (piAttrName === 'type');
            }
            if (piTokenType === XSLTokenLevelState.attributeValue && (foundHref)) {
              const piAttrValue = this.getTokenValueFromDoc(piToken, fakedDoc);
              const hrefValue = piAttrValue.substring(1, piAttrValue.length - 1);
              const basePathPos = docUri.path.lastIndexOf('/');
              const baseUri = docUri.with({ path: docUri.path.substring(0, basePathPos) });
              // don't resolve if appears to be an absolute path:
              const resolvedPath = hrefValue.startsWith(path.sep) || hrefValue.charAt(1) === ':' ? hrefValue : vscode.Uri.joinPath(baseUri, hrefValue).fsPath;
              resolvedXslPath = resolvedPath;
            } else if (piTokenType === XSLTokenLevelState.attributeValue && (foundType)) {
              const piAttrValue = this.getTokenValueFromDoc(piToken, fakedDoc);
              const typeValue = piAttrValue.substring(1, piAttrValue.length - 1);
              foundXslType = typeValue === 'text/xsl' || typeValue === 'text/xslt';
            }
          });
        }
        i++;
      }); // ends outer for-each
      if (foundXslType && resolvedXslPath) {
        // path SHOULD be an IRI - but just in case its a windows path like c:\path-to-file
        const separator = resolvedXslPath.indexOf('\\') > -1 ? '\\' : '/';
        const lastSlashPosInPath = resolvedXslPath.lastIndexOf(separator);
        const fullDir = resolvedXslPath.substring(0, lastSlashPosInPath);
        result.push({
          label: resolvedXslPath.substring(lastSlashPosInPath + 1),
          description: fullDir,
          fullDirname: fullDir
        });
      }
    }
    return result;
  }

  private getTokenValueFromDoc(piToken: BaseToken, fakedDoc: CodeActionDocument) {
    const startPos = new vscode.Position(piToken.line, piToken.startCharacter);
    const endPos = new vscode.Position(piToken.line, piToken.startCharacter + piToken.length);
    const rng = new vscode.Range(startPos, endPos);
    const piAttrName = fakedDoc.getText(rng);
    return piAttrName;
  }

  private createFileItems(fileListForLabel: string[]) {
    const pathCount = fileListForLabel.length;
    const filenames = fileListForLabel.map((file) => path.basename(file));
    const filepathLengths = fileListForLabel.map((file) => file.length);
    const maxFoundFilepathLength = Math.max(...filepathLengths);
    const hasDupeFilenames = filenames.length !== new Set(filenames).size;

    let fileData: pickedFileItem[] = [];
    if (fileListForLabel.length > 1 && hasDupeFilenames && maxFoundFilepathLength > FileSelection.PATH_LENGTH_LIMIT) {
      const dirNames = fileListForLabel.map((file) => path.dirname(file));
      const dirNameTokens = dirNames.map(dirname => dirname.split(/\\|\//));
      const tokensForFirstPath = dirNameTokens[0];
      const dirnameRemoveTokenVotes: removeTokenVotes = tokensForFirstPath.map(() => {
        return { otherMatchCount: 1 };
      });
      // check other tokens exist in other paths
      const nextPathStartIndex = 1;
      for (let pathIndex = nextPathStartIndex; pathIndex < dirNameTokens.length; pathIndex++) {
        const tokensForNextPath = dirNameTokens[pathIndex];
        for (let tknIndex = 0; tknIndex < tokensForFirstPath.length; tknIndex++) {
          if (tknIndex < tokensForNextPath.length) {
            const pathToken = tokensForFirstPath[tknIndex];
            const otherPathToken = tokensForNextPath[tknIndex];
            if (pathToken === otherPathToken) {
              // mark pathToken with a remove vote;
              // the vote must be unanimously remove to remove it
              dirnameRemoveTokenVotes[tknIndex].otherMatchCount++;
            } else {
              break;
            }
          } else {
            break;
          }
        }
      }

      // ------------- now remove tokens at start with unanimous vote --------
      let tokensToRemove = 0;
      for (let z = 0; z < dirnameRemoveTokenVotes.length; z++) {
        const tokenVotes = dirnameRemoveTokenVotes[z];
        if (tokenVotes.otherMatchCount === pathCount) {
          tokensToRemove++;
        }
      }
      const prefix = tokensToRemove > 0 ? '\u2026' + path.sep : '';

      const shortenedPaths = dirNameTokens.map(
        (tokens) => prefix + tokens.slice(tokensToRemove).join(path.sep)
      );
      fileData = fileListForLabel.map((fsPath, i) => ({ label: path.basename(fsPath), description: shortenedPaths[i], fullDirname: path.dirname(fsPath) }));
    } else {
      fileData = fileListForLabel.map(fsPath => ({ label: path.basename(fsPath), description: path.dirname(fsPath), fullDirname: path.dirname(fsPath) }));
    }
    return fileData;
  }
}