import * as vscode from 'vscode';

export class FileSelection {
  private fileList = new Map<string, string[]>();
  private static readonly PICK_FILE = "Pick File";
  private static commandist: string[] = [FileSelection.PICK_FILE];
  public async pickFile(obj: { label: string; extensions?: string[] }) {

    const { label, extensions } = obj;
    let fileListForLabel = this.fileList.get(label);
    if (!fileListForLabel) {
      fileListForLabel = [];
      this.fileList.set(label, fileListForLabel);
    }
    const fileItems = fileListForLabel.map(fsPath => ({ label: fsPath }));
    const commandItems = FileSelection.commandist.map(label => ({ label }));
    const OtherSeparator = {
      label: 'command',
      kind: vscode.QuickPickItemKind.Separator
    };
    const fileSeparator = {
      label: 'recently used',
      kind: vscode.QuickPickItemKind.Separator
    };

    let listItems: { label: string; kind?: vscode.QuickPickItemKind }[] = [];

    listItems.push(fileSeparator);
    listItems = listItems.concat(fileItems);
    listItems.push(OtherSeparator);
    listItems = listItems.concat(commandItems);
    const qpOptions: vscode.QuickPickOptions = {
      placeHolder: label
    };
    if (fileItems.length > 0) {
      // give option to select from recent files
      const picked = await vscode.window.showQuickPick(listItems, qpOptions);
      let exit = true;
      if (picked) {
        if (picked.kind === vscode.QuickPickItemKind.Separator) {
        } else if (picked.label === FileSelection.PICK_FILE) {
          exit = false;
        } else {
          return picked.label;
        }
      }
      if (exit) {
        return;
      }
    }
    let extensionFilters: { [key: string]: string[] } = {};
    if (extensions) {
      const filterLabel = `Extensions ${extensions.join(', ')}`;
      extensionFilters[filterLabel] = extensions;
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
      return newFilePath;
    }
  }
}