import * as vscode from 'vscode';
import * as path from 'path';

export class FileSelection {
  private fileList = new Map<string, string[]>();
  private static readonly PICK_FILE = "Pick File";
  private static readonly CLEAR_RECENTS = "Pick File (fresh recently used list)";
  private static commandList: string[] = [FileSelection.PICK_FILE];
  public async pickFile(obj: { label: string; extensions?: string[] }) {

    const { label, extensions } = obj;
    let fileListForLabel = this.fileList.get(label);
    if (!fileListForLabel) {
      fileListForLabel = [];
      this.fileList.set(label, fileListForLabel);
    }
    const fileItems = fileListForLabel.map(fsPath => ({ label: path.basename(fsPath), description: path.dirname(fsPath) }));
    const commandItems = FileSelection.commandList.map(label => ({ label }));
    if (fileListForLabel.length > 0) {
      commandItems.push({ label: FileSelection.CLEAR_RECENTS });
    }
    const OtherSeparator = {
      label: 'file explorer',
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

    if (currentFilePath) {
      listItems.push(currentSeparator);
      listItems.push({ label: path.basename(currentFilePath), description: path.dirname(currentFilePath)});
    }
    if (fileItems.length > 0) {
      listItems.push(fileSeparator);
      listItems = listItems.concat(fileItems);
    }
    listItems.push(OtherSeparator);
    listItems = listItems.concat(commandItems);
    const qpOptions: vscode.QuickPickOptions = {
      placeHolder: label
    };
    if (fileItems.length > 0 || currentFilePath) {
      // give option to select from recent files
      const picked = await vscode.window.showQuickPick(listItems, qpOptions);
      let exit = true;
      if (picked) {
        if (picked.kind === vscode.QuickPickItemKind.Separator) {
        } else if (picked.label === FileSelection.PICK_FILE) {
          exit = false;
        } else if (picked.label === FileSelection.CLEAR_RECENTS) {
          fileListForLabel.length = 0;
          exit = false;
        } else {
          const pickedFsPath = picked.description + path.sep + picked.label;
          if (pickedFsPath === currentFilePath) {
            if (!fileListForLabel.includes(pickedFsPath)) {
              fileListForLabel.push(pickedFsPath);
            }
          }
          return pickedFsPath;
        }
      }
      if (exit) {
        return;
      }
    }
    let extensionFilters: { [key: string]: string[] } = {};
    if (extensions) {
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
      return;
    } else {
      const newFilePath = APP_FILE[0].fsPath;
      fileListForLabel.unshift(newFilePath);
      if (fileListForLabel.length > 10) {
        fileListForLabel.pop();
      }
      return newFilePath;
    }
  }
}