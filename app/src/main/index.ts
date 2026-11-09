import { app, dialog, shell, BrowserWindow } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { dataPlace, DB_FILE, prepareDataDir } from './dataDir'
import { openDb, type Db } from './db/db'
import { registerIpc } from './ipc'
import { createLog } from './log'
import { startupErrorText } from './startupError'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null

// A start that can't finish says so in a dialog and ends the process: with no window and the single-instance lock
// still held, every later launch would silently quit. showErrorBox is safe before the app is ready.
let startFailed = false
function failStart(what: string, path: string, err: unknown): void {
  startFailed = true
  dialog.showErrorBox('JOB-AUTO could not start', startupErrorText(what, path, err))
  app.exit(1)
}

const place = dataPlace(process.env, homedir(), is.dev)
// Electron's own files go in the data folder too, and this has to come first: Electron keeps the single-instance
// lock in userData, so the lock below is per data folder.
try {
  prepareDataDir(place)
  app.setPath('userData', join(place.dir, 'electron'))
} catch (err) {
  failStart('The data folder could not be prepared.', place.dir, err)
}

// One app at a time per data folder: starting it again brings the open window forward instead of running a second
// copy against the same database.
const isFirstInstance = !startFailed && app.requestSingleInstanceLock()
if (!startFailed) {
  if (!isFirstInstance) app.quit()
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.focus()
  })
}

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Links open in the browser, and only web links; the window itself never opens another one.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//i.test(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  // Nothing may take the window away from the app, such as a file dropped onto it.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault()
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  if (startFailed || !isFirstInstance) return
  const dbPath = join(place.dir, DB_FILE)
  let db: Db
  try {
    db = openDb(dbPath)
  } catch (err) {
    failStart('The database could not be opened.', dbPath, err)
    return
  }
  try {
    // Set app user model id for windows
    electronApp.setAppUserModelId('app.jobauto')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    const log = createLog(place.dir)
    const ipc = registerIpc(db, place, log)
    app.on('before-quit', () => {
      ipc.stop()
      log('app closing')
    })

    // No lookup starts by itself: a full one uses the Claude plan for hours, so the owner presses the button.
    // The job check is different: it only reads public job boards, so it starts on opening once a day.
    createWindow()
    // After the window exists, so it can show the progress; the check never rejects.
    void ipc.checkOnOpen()
    // Started after the check, not awaited; both share one fetcher, whose per-host pace keeps them polite.
    void ipc.refreshOnOpen()

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  } catch (err) {
    failStart('The app could not start.', place.dir, err)
  }
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
