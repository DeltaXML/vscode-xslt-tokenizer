import * as vscode from 'vscode';

export class FileSelection {
  private fileList: string[] = ["one.xml", "two.xml"];
  private static commandist: string[] = ["Pick File"];
  public async pickFile(obj: { label: string; extensions?: string[] }) {

    const { label, extensions } = obj;
    const fileItems = this.fileList.map(label => ({ label }));
    const commandItems = FileSelection.commandist.map(label => ({ label }));
    const OtherSeparator = {
      label: 'command',
      kind: vscode.QuickPickItemKind.Separator
    };
    const fileSeparator = {
      label: 'recently used',
      kind: vscode.QuickPickItemKind.Separator
    };

    const quickPick = vscode.window.createQuickPick();
    let listItems: { label: string; kind?: vscode.QuickPickItemKind }[] = [];

    listItems.push(fileSeparator);
    listItems = listItems.concat(fileItems);
    listItems.push(OtherSeparator);
    listItems = listItems.concat(commandItems);
    const qpOptions: vscode.QuickPickOptions = {
      placeHolder: label
    };
    const picked = await vscode.window.showQuickPick(listItems, qpOptions);

    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
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
      return APP_FILE[0].fsPath;
    }
  }
}