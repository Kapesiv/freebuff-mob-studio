/**
 * Simple undo/redo stack using JSON snapshots.
 */
export class History {
    constructor(maxSize = 50) {
        this.maxSize = maxSize;
        this.undoStack = [];
        this.redoStack = [];
    }

    push(state) {
        this.undoStack.push(JSON.stringify(state));
        if (this.undoStack.length > this.maxSize) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    undo(currentState) {
        if (this.undoStack.length === 0) return null;
        this.redoStack.push(JSON.stringify(currentState));
        return JSON.parse(this.undoStack.pop());
    }

    redo(currentState) {
        if (this.redoStack.length === 0) return null;
        this.undoStack.push(JSON.stringify(currentState));
        return JSON.parse(this.redoStack.pop());
    }

    canUndo() { return this.undoStack.length > 0; }
    canRedo() { return this.redoStack.length > 0; }
}
