import * as vscode from 'vscode';
import * as path from 'path';

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

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }
  public pickedValues = new Map<string, string>();
  public completedPick = true;

  public async pickXsltFile() {
    return await this.pickFile({ label: "Select XSLT File", extensions: ["xsl", "xslt"] });
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

  public async pickFile(obj: { label: string; extensions?: string[]; isResult?: boolean; prevStageLabel?: string; prevStageGroup?: string }) {
    this.completedPick = true;
    const { label, extensions, isResult, prevStageLabel, prevStageGroup } = obj;
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

    let listItems: { label: string; kind?: vscode.QuickPickItemKind; description?: string }[] = [];
    let currentFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;

    if (isResult) {
      currentFilePath = undefined;
    } else if (currentFilePath) {
      if (!extensions || extensions.includes('*') || extensions.includes(path.extname(currentFilePath).substring(1))) {
        listItems.push(currentSeparator);
        listItems.push({ label: path.basename(currentFilePath), description: path.dirname(currentFilePath) });
      } else {
        currentFilePath = undefined;
      }
    }
    if (fileItems.length > 0) {
      listItems.push(fileSeparator);
      listItems = listItems.concat(fileItems);
    }
    if (prevStageFilePaths && prevStageFilePaths.length > 0) {
      const prevStageFileItems = prevStageFilePaths.map(fsPath => ({ label: path.basename(fsPath), description: path.dirname(fsPath) }));
      listItems.push(prevStageSeparator);
      listItems = listItems.concat(prevStageFileItems);
    }
    listItems.push(explorerSeparator);
    listItems = listItems.concat(commandItems);
    const qpOptions: vscode.QuickPickOptions = {
      placeHolder: label
    };
    if (fileItems.length > 0 || (prevStageFilePaths && prevStageFilePaths?.length > 0) || currentFilePath) {
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
          const typedPick = <pickedFileItem> picked;
          const pickedFsPath = typedPick.fullDirname + path.sep + picked.label;
          if (pickedFsPath === currentFilePath) {
            if (!fileListForLabel.includes(pickedFsPath)) {
              fileListForLabel.unshift(pickedFsPath);
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
      fileData = fileListForLabel.map((fsPath, i) => ({ label: path.basename(fsPath), description: shortenedPaths[i], fullDirname: path.dirname(fsPath)}));
    } else {
      fileData = fileListForLabel.map(fsPath => ({ label: path.basename(fsPath), description: path.dirname(fsPath), fullDirname: path.dirname(fsPath) }));
    }
    return fileData;
  }
}