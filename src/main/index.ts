import { app, BrowserWindow, session } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import { join } from "node:path";

let mainWindow: BrowserWindow | null = null;
let apiProcess: ChildProcess | null = null;
let frontendProcess: ChildProcess | null = null;

const API_PORT = 8000;
const FRONTEND_PORT = 58888;
const isDev = !app.isPackaged && process.env.AI_STACK_PRODUCTION !== "1";

function getAppRoot(): string {
  if (process.env.AI_STACK_BASE) return process.env.AI_STACK_BASE;
  return isDev ? join(__dirname, "..", "..", "..") : process.resourcesPath;
}

function startApiServer(): void {
  const root = getAppRoot();
  if (isDev) {
    const tsxPath = join(root, "src", "api", "node_modules", ".bin", "tsx");
    apiProcess = spawn(tsxPath, ["src/api/src/server.ts"], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(API_PORT),
        FRONTEND_PORT: String(FRONTEND_PORT),
        AI_STACK_BASE: root,
        MODELS_ROOT: join(root, "models"),
        AI_STACK_BIND_ADDR: "127.0.0.1",
      },
      stdio: "pipe",
    });
  } else {
    apiProcess = spawn(
      "node",
      [join(root, "src", "api", "dist", "server.js")],
      {
        env: {
          ...process.env,
          PORT: String(API_PORT),
          FRONTEND_PORT: String(FRONTEND_PORT),
          AI_STACK_BASE: root,
          MODELS_ROOT: join(root, "models"),
          AI_STACK_BIND_ADDR: "127.0.0.1",
        },
        stdio: "pipe",
      }
    );
  }

  apiProcess.stdout?.on("data", (d) => console.log(`[API] ${d.toString().trim()}`));
  apiProcess.stderr?.on("data", (d) => console.error(`[API] ${d.toString().trim()}`));
  apiProcess.on("exit", (code) => console.log(`[API] exited with code ${code}`));
}

function startFrontendServer(): void {
  if (!isDev) return; // In production, frontend is served as static files

  const vitePath = join(getAppRoot(), "src", "frontend", "node_modules", ".bin", "vite");
  frontendProcess = spawn(vitePath, ["--host", "127.0.0.1", "--port", String(FRONTEND_PORT)], {
    cwd: join(getAppRoot(), "src", "frontend"),
    env: { ...process.env },
    stdio: "pipe",
  });

  frontendProcess.stdout?.on("data", (d) => console.log(`[VITE] ${d.toString().trim()}`));
  frontendProcess.stderr?.on("data", (d) => console.error(`[VITE] ${d.toString().trim()}`));
  frontendProcess.on("exit", (code) => console.log(`[VITE] exited with code ${code}`));
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Amuin AI Stack",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL(`http://localhost:${FRONTEND_PORT}`);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(
      join(getAppRoot(), "src", "frontend", "dist", "index.html")
    );
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function setupCSP(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? [
          "default-src 'self'",
          `script-src 'self' 'unsafe-eval' 'unsafe-inline' http://localhost:${FRONTEND_PORT}`,
          `style-src 'self' 'unsafe-inline' http://localhost:${FRONTEND_PORT}`,
          `connect-src 'self' http://localhost:${FRONTEND_PORT} ws://localhost:${FRONTEND_PORT} http://localhost:${API_PORT} ws://localhost:${API_PORT}`,
          "img-src 'self' data: http://localhost:*",
          "font-src 'self' data:",
        ].join("; ")
      : [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          `connect-src 'self' http://127.0.0.1:${API_PORT} ws://127.0.0.1:${API_PORT}`,
          "img-src 'self' data:",
          "font-src 'self' data:",
        ].join("; ");

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

// Allow running without SUID sandbox
app.commandLine.appendSwitch("no-sandbox");

// Handle headless/SSH environments
const display = process.env.DISPLAY ?? "";
if (process.env.ELECTRON_DISABLE_GPU === "1" || display.startsWith(":99")) {
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-software-rasterizer");
}

app.whenReady().then(() => {
  setupCSP();
  startApiServer();
  startFrontendServer();
  // Give Vite + API time to start before loading the window
  setTimeout(() => createWindow(), 4000);
});

app.on("window-all-closed", () => {
  // Keep running in tray on Linux
});

app.on("before-quit", () => {
  apiProcess?.kill("SIGTERM");
  frontendProcess?.kill("SIGTERM");
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});
