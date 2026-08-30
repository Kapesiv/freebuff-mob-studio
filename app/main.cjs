/**
 * Freebuff Mob Studio — desktop app (Electron)
 *
 * Loads the self-contained preview.html straight from disk via file://,
 * so no web server or browser is needed. Works fully offline.
 *
 * Usage:
 *   npm run app                 # build + open the app
 *   npm run app -- --mob=dragonoi   # open with a specific mob loaded
 */
const { app, BrowserWindow, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');

app.setName('Freebuff Mob Studio');

const PREVIEW = path.join(__dirname, '..', 'preview.html');

// Optional: `--mob=<id>` (or `--mob <id>`) opens the app with that library mob loaded
function mobArg() {
    const i = process.argv.indexOf('--mob');
    if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
    const eq = process.argv.find((a) => a.startsWith('--mob='));
    if (eq) return eq.slice('--mob='.length);
    return null;
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1500,
        height: 940,
        minWidth: 1100,
        minHeight: 700,
        title: 'Freebuff Mob Studio',
        backgroundColor: '#14171c',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    const mob = mobArg();
    win.loadFile(PREVIEW, mob ? { query: { mob } } : undefined);

    // Open external links in the default browser, never inside the app
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    return win;
}

app.whenReady().then(() => {
    if (!fs.existsSync(PREVIEW)) {
        console.error('preview.html not found — run `npm run build:preview` first.');
        app.exit(1);
        return;
    }

    // Save exports (bbmodel / json / png) straight to ~/Downloads, like Blockbench
    session.defaultSession.on('will-download', (event, item) => {
        const safe = item.getFilename().replace(/[\\/:*?"<>|]/g, '_');
        item.setSavePath(path.join(app.getPath('downloads'), safe));
    });

    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
