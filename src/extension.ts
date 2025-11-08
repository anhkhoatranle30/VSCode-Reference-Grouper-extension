import * as vscode from 'vscode';

interface GroupedReference {
    location: vscode.Location;
    isWrite: boolean;
}

class ReferenceTreeItem extends vscode.TreeItem {
    constructor(
        label: string | vscode.TreeItemLabel,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly location?: vscode.Location,
        public readonly isGroup: boolean = false,
        public readonly symbolName?: string,
        public readonly isFileGroup: boolean = false,
        public readonly hideIcon: boolean = false
    ) {
        super(label, collapsibleState);
        
        if (location) {
            this.command = {
                command: 'referenceGrouper.openReference',
                title: 'Open Reference',
                arguments: [location]
            };
            
            // Don't set resourceUri when we want to hide the icon
            if (!hideIcon) {
                this.resourceUri = location.uri;
            }
            
            // Put line number on the far right
            // VSCode will align description to the right automatically
            const lineNumber = location.range.start.line + 1;
            this.description = `Line ${lineNumber}`;
            
            this.tooltip = undefined;
        }
        
        if (isGroup) {
            this.iconPath = new vscode.ThemeIcon(label.toString().includes('Write') ? 'edit' : 'book');
        }
        
        if (isFileGroup) {
            this.iconPath = new vscode.ThemeIcon('file-code');
        }
    }
}

class ReferenceTreeProvider implements vscode.TreeDataProvider<ReferenceTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ReferenceTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private writes: vscode.Location[] = [];
    private reads: vscode.Location[] = [];
    private documents: Map<string, vscode.TextDocument> = new Map();
    private symbolName: string = '';
    private groupByFile: boolean = false;
    private showFullPath: boolean = false;

    setGroupByFile(value: boolean) {
        this.groupByFile = value;
        this._onDidChangeTreeData.fire();
    }

    setShowFullPath(value: boolean) {
        this.showFullPath = value;
        this._onDidChangeTreeData.fire();
    }

    async setReferences(writes: vscode.Location[], reads: vscode.Location[], symbolName: string) {
        this.writes = writes;
        this.reads = reads;
        this.symbolName = symbolName;
        
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
                    true,
                    undefined,
                    false,
                    false
                ));
            }
            
            if (this.reads.length > 0) {
                items.push(new ReferenceTreeItem(
                    `Reads (${this.reads.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    true,
                    undefined,
                    false,
                    false
                ));
            }
            
            return items;
        } else if (element.isGroup) {
            // Writes/Reads group - show files or references
            const labelText = typeof element.label === 'string' ? element.label : element.label?.label || '';
            const isWriteGroup = labelText.startsWith('Writes');
            const locations = isWriteGroup ? this.writes : this.reads;
            
            if (this.groupByFile) {
                // Group by file
                const fileGroups = new Map<string, vscode.Location[]>();
                for (const loc of locations) {
                    const filePath = loc.uri.toString();
                    if (!fileGroups.has(filePath)) {
                        fileGroups.set(filePath, []);
                    }
                    fileGroups.get(filePath)!.push(loc);
                }
                
                const items: ReferenceTreeItem[] = [];
                for (const [filePath, locs] of fileGroups) {
                    const uri = vscode.Uri.parse(filePath);
                    // Use setting to determine if showing full path or just filename
                    const displayName = this.showFullPath 
                        ? vscode.workspace.asRelativePath(uri)
                        : (uri.path.split('/').pop() || uri.path);
                    const item = new ReferenceTreeItem(
                        `${displayName} (${locs.length})`,
                        vscode.TreeItemCollapsibleState.Expanded,
                        undefined,
                        false,
                        undefined,
                        true,
                        false
                    );
                    // Override icon to show file type icon
                    item.resourceUri = uri;
                    item.iconPath = vscode.ThemeIcon.File;
                    // Store locations in a custom property
                    (item as any).fileLocations = locs;
                    items.push(item);
                }
                return items;
            } else {
                // Show references directly without file grouping - show file icons
                return this.createReferenceItems(locations, false);
            }
        } else if (element.isFileGroup) {
            // File group - show references without file icons (parent already shows file icon)
            const locations = (element as any).fileLocations as vscode.Location[];
            return this.createReferenceItems(locations, true);
        }
        
        return [];
    }

    private createReferenceItems(locations: vscode.Location[], hideIcon: boolean = false): ReferenceTreeItem[] {
        return locations.map(loc => {
            const doc = this.documents.get(loc.uri.toString());
            const lineText = doc ? doc.lineAt(loc.range.start.line).text.trim() : '';
            const displayText = lineText || `Line ${loc.range.start.line + 1}`;
            
            // Create label with highlight
            let itemLabel: string | vscode.TreeItemLabel = displayText;
            if (this.symbolName && displayText.includes(this.symbolName)) {
                const startIndex = displayText.indexOf(this.symbolName);
                itemLabel = {
                    label: displayText,
                    highlights: [[startIndex, startIndex + this.symbolName.length]]
                };
            }
            
            return new ReferenceTreeItem(
                itemLabel,
                vscode.TreeItemCollapsibleState.None,
                loc,
                false,
                this.symbolName,
                false,
                hideIcon
            );
        });
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

    // Register toggle group by file command
    const toggleGroupByFileCommand = vscode.commands.registerCommand('referenceGrouper.toggleGroupByFile', async () => {
        const config = vscode.workspace.getConfiguration('referenceGrouper');
        const currentValue = config.get('groupByFile', false);
        await config.update('groupByFile', !currentValue, vscode.ConfigurationTarget.Global);
        referenceTreeProvider.setGroupByFile(!currentValue);
    });

    // Register toggle show full path command
    const toggleShowFullPathCommand = vscode.commands.registerCommand('referenceGrouper.toggleShowFullPath', async () => {
        const config = vscode.workspace.getConfiguration('referenceGrouper');
        const currentValue = config.get('showFullPath', false);
        await config.update('showFullPath', !currentValue, vscode.ConfigurationTarget.Global);
        referenceTreeProvider.setShowFullPath(!currentValue);
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

            // Get the symbol name at cursor position for highlighting
            const document = editor.document;
            const wordRange = document.getWordRangeAtPosition(position);
            const symbolName = wordRange ? document.getText(wordRange) : '';

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
            
            // Get settings
            const config = vscode.workspace.getConfiguration('referenceGrouper');
            const groupByFile = config.get('groupByFile', false);
            const showFullPath = config.get('showFullPath', false);
            
            referenceTreeProvider.setGroupByFile(groupByFile);
            referenceTreeProvider.setShowFullPath(showFullPath);
            
            // Update tree view with symbol name for highlighting
            await referenceTreeProvider.setReferences(groupedRefs.writes, groupedRefs.reads, symbolName);
            
            // Focus the tree view (this will open the panel at bottom)
            await vscode.commands.executeCommand('referenceGrouper.referencesView.focus');
            
            // Update title
            referenceTreeView.message = `${groupedRefs.writes.length} writes, ${groupedRefs.reads.length} reads`;
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error}`);
        }
    });

    context.subscriptions.push(referenceTreeView, openReferenceCommand, toggleGroupByFileCommand, toggleShowFullPathCommand, findReferencesCommand);
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
