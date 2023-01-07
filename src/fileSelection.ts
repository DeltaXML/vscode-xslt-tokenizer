import * as vscode from 'vscode';

export class FileSelection {
  public static async pickFile(obj: { label: string; extensions?: string[] }) {
    const { label, extensions } = obj;
    let extensionFilters: { [key: string]: string[] } = {};
    if (extensions) {
      const filterLabel = `Extensions ${extensions.join(', ')}`;
      extensionFilters[filterLabel] = extensions;
    }
    const APP_FILE = await vscode.window.showOpenDialog({
          
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