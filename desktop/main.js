'use strict';

// 职事英语 桌面外壳。
// 职责：首次运行用 uv 在当前用户数据目录里建好 Python 虚拟环境（联网下载
// whisper / torch 等依赖），然后启动 FastAPI 后端并把构建好的前端加载进窗口。
//
// 资源布局（打包后位于 Contents/Resources，开发时可设 DSH_RESOURCES_DIR 覆盖）：
//   backend/   后端源码 + requirements.txt + .env
//   frontend/  npm run build 产物
//   bin/uv     uv 运行时（首次用来自动下载 CPython 并建 venv）

const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const isDev = !!process.env.DSH_DEV;
const RES = process.env.DSH_RESOURCES_DIR || process.resourcesPath;
const LOADING_PAGE = path.join(__dirname, 'assets', 'loading.html');

let mainWindow = null;
let serverProcess = null;
let chosenPort = null;

const APP_DATA = app.getPath('userData');

// 打包态：RES 下真实文件；开发态：复用仓库自带 venv，跳过 uv 建环境。
let BACKEND_DIR;
let FRONTEND_DIST;
let REQUIREMENTS;
let VENV_UVICORN;
let ENV_FILE;
let HF_HOME;
let UV_BIN;
let VENV_DIR;
let VENV_PY;
if (isDev) {
  const REPO_ROOT = path.resolve(__dirname, '..');
  BACKEND_DIR = path.join(REPO_ROOT, 'backend');
  FRONTEND_DIST = path.join(REPO_ROOT, 'frontend', 'dist');
  REQUIREMENTS = path.join(BACKEND_DIR, 'requirements.txt');
  const DEV_VENV = path.join(BACKEND_DIR, '.venv');
  VENV_UVICORN = path.join(DEV_VENV, 'bin', 'uvicorn');
} else {
  BACKEND_DIR = path.join(RES, 'backend');
  FRONTEND_DIST = path.join(RES, 'frontend');
  REQUIREMENTS = path.join(BACKEND_DIR, 'requirements.txt');
  UV_BIN = path.join(RES, 'bin', 'uv');
  VENV_DIR = path.join(APP_DATA, 'venv');
  VENV_PY = path.join(VENV_DIR, 'bin', 'python');
  VENV_UVICORN = path.join(VENV_DIR, 'bin', 'uvicorn');
  ENV_FILE = path.join(APP_DATA, '.env');
  HF_HOME = path.join(APP_DATA, 'hf');
}

function log(...args) {
  console.log('[main]', ...args);
}

// ---------- 小工具 ----------

function sendProgress(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('setup-progress', message);
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`命令失败(code ${code}): ${cmd} ${args.join(' ')}\n${stderr}`));
    });
  });
}

function ensureEnvFile() {
  if (isDev) return; // 开发态直接沿用仓库 backend/.env
  const bundledEnv = path.join(BACKEND_DIR, '.env');
  if (fs.existsSync(ENV_FILE)) return;
  if (fs.existsSync(bundledEnv)) {
    fs.copyFileSync(bundledEnv, ENV_FILE);
  } else {
    fs.writeFileSync(
      ENV_FILE,
      [
        '# 每次覆盖安装/升级时，若此文件被替换，请重新填写密钥。',
        'WHISPER_MODEL=small',
        'WHISPER_DEVICE=cpu',
        'WHISPER_COMPUTE_TYPE=int8',
        '',
        '# DeepSeek（可选）：留空则跳过文本润色/生词释义',
        'DEEPSEEK_API_KEY=',
        'DEEPSEEK_BASE_URL=https://api.deepseek.com',
        'DEEPSEEK_MODEL=deepseek-v4-flash',
        '',
        '# Azure Speech（可选）：留空则跳过发音评分/标准音合成',
        'AZURE_SPEECH_KEY=',
        'AZURE_SPEECH_REGION=',
        '',
      ].join('\n')
    );
  }
}

// ---------- 后端生命周期 ----------

async function ensureBackend() {
  if (isDev) {
    log('dev 模式：复用仓库 backend/.venv');
    return;
  }
  if (fs.existsSync(VENV_UVICORN)) {
    log('venv 已就绪，跳过安装');
    return;
  }

  sendProgress('正在准备 Python 运行环境（首次运行会自动下载，约 1–2 分钟）…');
  // uv venv --python 3.11 会在缺少 CPython 时自动下载对应架构的独立版 CPython
  await run(UV_BIN, ['venv', '--python', '3.11', VENV_DIR]);

  sendProgress('正在安装依赖（含 whisper / torch，体积较大，请耐心等待）…');
  await run(UV_BIN, ['pip', 'install', '--python', VENV_PY, '-r', REQUIREMENTS]);
}

async function waitForHealth(timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (Date.now() > deadline) return reject(new Error('后端启动超时'));
      try {
        const res = await fetch(`http://127.0.0.1:${chosenPort}/api/health`);
        if (res.ok) return resolve();
      } catch (_) {
        /* 尚未就绪 */
      }
      setTimeout(tick, 500);
    };
    tick();
  });
}

async function startBackend() {
  chosenPort = await getFreePort();
  ensureEnvFile();
  await ensureBackend();

  log('启动后端 @', chosenPort);
  const env = { ...process.env, FRONTEND_DIST };
  if (!isDev) {
    env.APP_DATA_DIR = APP_DATA;
    env.APP_ENV_FILE = ENV_FILE;
    env.HF_HOME = HF_HOME;
  }
  serverProcess = spawn(
    VENV_UVICORN,
    ['app.main:app', '--host', '127.0.0.1', '--port', String(chosenPort)],
    {
      cwd: BACKEND_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  serverProcess.stdout.on('data', (d) => log('[backend]', d.toString().trim()));
  serverProcess.stderr.on('data', (d) => log('[backend-err]', d.toString().trim()));
  serverProcess.on('exit', (code) => log('后端进程退出', code));

  await waitForHealth();
  log('后端就绪');
  return `http://127.0.0.1:${chosenPort}`;
}

function stopBackend() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

// ---------- 窗口 ----------

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    backgroundColor: '#0f1115',
    title: '职事英语',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 先显示“正在初始化”的本地页面，后端就绪后再切换到真实页面。
  mainWindow.loadFile(LOADING_PAGE);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  try {
    const url = await startBackend();
    sendProgress('ready');
    mainWindow.loadURL(url);
  } catch (err) {
    log('启动失败', err);
    const detail = err && err.message ? err.message : String(err);
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: '职事英语启动失败',
      message: '无法启动本地服务。',
      detail: `请检查网络（首次运行需联网下载依赖）后重试。\n\n${detail}`,
      buttons: ['重试', '退出'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      if (serverProcess) stopBackend();
      createWindow();
    } else {
      app.quit();
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------- 应用生命周期 ----------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    stopBackend();
    app.quit();
  });

  app.on('before-quit', () => {
    stopBackend();
  });
}
