import * as vscode from 'vscode';

interface GroupedReference {
    location: vscode.Location;
    isWrite: boolean;
}

class ReferenceTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly location?: vscode.Location,
        public readonly isGroup: boolean = false
    ) {
        super(label, collapsibleState);
        
        if (location) {
            this.command = {
                command: 'referenceGrouper.openReference',
                title: 'Open Reference',
                arguments: [location]
            };
            
            this.resourceUri = location.uri;
            this.description = `${vscode.workspace.asRelativePath(location.uri)}:${location.range.start.line + 1}`;
        }
        
        if (isGroup) {
            this.iconPath = new vscode.ThemeIcon(label.includes('Write') ? 'edit' : 'book');
        }
    }
}

class ReferenceTreeProvider implements vscode.TreeDataProvider<ReferenceTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ReferenceTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private writes: vscode.Location[] = [];
    private reads: vscode.Location[] = [];
    private documents: Map<string, vscode.TextDocument> = new Map();

    async setReferences(writes: vscode.Location[], reads: vscode.Location[]) {
        this.writes = writes;
        this.reads = reads;
        
        // Preload documents for display
        this.documents.clear();
        for (const loc of [...writes, ...reads]) {
            const key = loc.uri.toString();
            if (!this.documents.has(key)) {
                try {
                    const doc = await vscode.workspace.openTextDocument(loc.uri);
                    this.documents.set(key, doc);
                } catch (e) {
                    // Ignore errors
                }
            }
        }
        
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ReferenceTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ReferenceTreeItem): Promise<ReferenceTreeItem[]> {
        if (!element) {
            // Root level - show groups
            const items: ReferenceTreeItem[] = [];
            
            if (this.writes.length > 0) {
                items.push(new ReferenceTreeItem(
                    `Writes (${this.writes.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    true
                ));
            }
            
            if (this.reads.length > 0) {
                items.push(new ReferenceTreeItem(
                    `Reads (${this.reads.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    true
                ));
            }
            
            return items;
        } else {
            // Child level - show references
            const isWriteGroup = element.label.startsWith('Writes');
            const locations = isWriteGroup ? this.writes : this.reads;
            
            return locations.map(loc => {
                const doc = this.documents.get(loc.uri.toString());
                const lineText = doc ? doc.lineAt(loc.range.start.line).text.trim() : '';
                
                return new ReferenceTreeItem(
                    lineText || `Line ${loc.range.start.line + 1}`,
                    vscode.TreeItemCollapsibleState.None,
                    loc,
                    false
                );
            });
        }
    }
}

let referenceTreeProvider: ReferenceTreeProvider;
let referenceTreeView: vscode.TreeView<ReferenceTreeItem>;

export function activate(context: vscode.ExtensionContext) {
    console.log('Reference Grouper extension is now active');

    // Create tree view in panel area (bottom)
    referenceTreeProvider = new ReferenceTreeProvider();
    referenceTreeView = vscode.window.createTreeView('referenceGrouper.referencesView', {
        treeDataProvider: referenceTreeProvider,
        showCollapseAll: true
    });

    // Register command to open reference
    const openReferenceCommand = vscode.commands.registerCommand('referenceGrouper.openReference', async (location: vscode.Location) => {
        const editor = await vscode.window.showTextDocument(location.uri, {
            selection: location.range,
            preserveFocus: false
        });
        editor.revealRange(location.range, vscode.TextEditorRevealType.InCenter);
    });

    // Register main command
    const findReferencesCommand = vscode.commands.registerCommand('referenceGrouper.findAllReferences', async () => {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor');
                return;
            }

            const uri = editor.document.uri;
            const position = editor.selection.active;

            // Get all references
            const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                uri,
                position
            );

            if (!locations || locations.length === 0) {
                vscode.window.showInformationMessage('No references found');
                return;
            }

            // Group references by read/write
            const groupedRefs = await groupReferencesByReadWrite(locations, uri, position);
            
            // Update tree view
            await referenceTreeProvider.setReferences(groupedRefs.writes, groupedRefs.reads);
            
            // Focus the tree view (this will open the panel at bottom)
            await vscode.commands.executeCommand('referenceGrouper.referencesView.focus');
            
            // Update title
            referenceTreeView.message = `${groupedRefs.writes.length} writes, ${groupedRefs.reads.length} reads`;
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error}`);
        }
    });

    context.subscriptions.push(referenceTreeView, openReferenceCommand, findReferencesCommand);
}

async function groupReferencesByReadWrite(
    locations: vscode.Location[],
    symbolUri: vscode.Uri,
    symbolPosition: vscode.Position
): Promise<{ reads: vscode.Location[], writes: vscode.Location[] }> {
    const reads: vscode.Location[] = [];
    const writes: vscode.Location[] = [];

    for (const location of locations) {
        // Skip the definition itself
        if (location.uri.toString() === symbolUri.toString() &&
            location.range.contains(symbolPosition)) {
            continue;
        }

        const isWrite = await isWriteReference(location);
        
        if (isWrite) {
            writes.push(location);
        } else {
            reads.push(location);
        }
    }

    return { reads, writes };
}

async function isWriteReference(location: vscode.Location): Promise<boolean> {
    try {
        const document = await vscode.workspace.openTextDocument(location.uri);
        const line = document.lineAt(location.range.start.line);
        const lineText = line.text;
        
        // Get context around the reference
        const beforeText = lineText.substring(0, location.range.start.character).trim();
        const afterText = lineText.substring(location.range.end.character).trim();

        // Check if it's on the left side of an assignment
        const afterMatch = afterText.match(/^\s*(=(?!=)|\+=|-=|\*=|\/=|%=|\|=|&=|\^=|<<=|>>=|\*\*=)/);
        if (afterMatch) {
            return true;
        }

        // Check for increment/decrement operators
        if (/(\+\+|--)/.test(afterText) || /(\+\+|--)/.test(beforeText)) {
            return true;
        }

        // Check for destructuring assignment
        if (/^(let|const|var)\s+.*\[/.test(beforeText) || /^(let|const|var)\s+.*\{/.test(beforeText)) {
            return true;
        }

        // Check for function parameters (these are writes)
        if (/function\s+\w*\s*\([^)]*$/.test(beforeText)) {
            return true;
        }

        // TypeScript/JavaScript specific: check for mutations
        if (afterText.match(/^\s*\.(push|pop|shift|unshift|splice|sort|reverse|fill)/)) {
            return true;
        }

        return false;
    } catch (error) {
        return false;
    }
}

export function deactivate() {
    if (referenceTreeView) {
        referenceTreeView.dispose();
    }
}
