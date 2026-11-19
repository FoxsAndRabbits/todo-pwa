// 文件夹自动备份：把完整快照写进用户自己选的文件夹（浏览器之外），清缓存后能找回。
//
// 分层：
//   1. 纯函数（快照序列化/校验、文件命名、保留策略）—— node 下可直接 import 与测试；
//   2. 浏览器部分（File System Access + IndexedDB 存目录句柄）—— 只在真正调用时才触碰
//      window / indexedDB，所以顶层没有任何副作用。
//
// 句柄为什么放 IndexedDB：FileSystemDirectoryHandle 不能 JSON 序列化，进不了
// localStorage 的 dsh.todo.v1；结构化克隆可以存进 IndexedDB。
import { getState, replaceState, updateSettings, snapshotState } from './store.js';

export const KIND = 'dsh-todo-backup';
export const SNAPSHOT_VERSION = 4;
export const BACKUP_PREFIX = 'todo-backup-';
export const RESTORE_PREFIX = 'todo-before-restore-';
export const EXT = '.json';
export const DEBOUNCE_MS = 5000;
export const DB_NAME = 'dsh-todo-backup';
export const DB_STORE = 'kv';
export const HANDLE_KEY = 'dirHandle';

const NAME_RE = /^todo-(backup|before-restore)-(\d{8})-(\d{6})\.json$/;

export class BackupError extends Error {
  constructor(message, code = 'ERROR') {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

/* ================= 纯函数 ================= */

// 本地时间 'YYYYMMDD-HHmmss'（与 app.js 的 stamp() 同格式，定长可字典序排序）
export function stampOf(ts = Date.now()) {
  const d = new Date(ts);
  const two = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}` +
    `-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`
  );
}

export function backupFileName(ts = Date.now()) {
  return `${BACKUP_PREFIX}${stampOf(ts)}${EXT}`;
}

export function restoreFileName(ts = Date.now()) {
  return `${RESTORE_PREFIX}${stampOf(ts)}${EXT}`;
}

// 从文件名解析时间戳（毫秒）；不是备份文件返回 null
export function parseBackupName(name) {
  const m = NAME_RE.exec(String(name || ''));
  if (!m) return null;
  const [, , day, time] = m;
  const ts = new Date(
    Number(day.slice(0, 4)),
    Number(day.slice(4, 6)) - 1,
    Number(day.slice(6, 8)),
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
    Number(time.slice(4, 6)),
  ).getTime();
  return Number.isFinite(ts) ? ts : null;
}

export function isBackupName(name) {
  return Boolean(parseBackupName(name)) && String(name).startsWith(BACKUP_PREFIX);
}

export function isRestoreName(name) {
  return Boolean(parseBackupName(name)) && String(name).startsWith(RESTORE_PREFIX);
}

export function buildSnapshot(state = getState(), now = Date.now()) {
  const data = state.tasks ? state : snapshotState();
  return {
    kind: KIND,
    version: SNAPSHOT_VERSION,
    exportedAt: now,
    data: {
      tasks: data.tasks || [],
      series: data.series || [],
      tagLibrary: data.tagLibrary || [],
      remindLog: data.remindLog || {},
      settings: data.settings || {},
    },
  };
}

// 2 空格缩进：出问题时能直接打开文件手工救
export function stringifySnapshot(state = getState(), now = Date.now()) {
  return JSON.stringify(buildSnapshot(state, now), null, 2);
}

// 校验并拆出可恢复的 data；失败给出人话原因
export function parseSnapshot(input) {
  let obj = input;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch {
      return { ok: false, error: '不是合法的 JSON 文件' };
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: '备份文件格式不对' };
  }
  if (obj.kind && obj.kind !== KIND) {
    return { ok: false, error: '这不是本应用的备份文件' };
  }
  const version = Number(obj.version) || 0;
  if (version > SNAPSHOT_VERSION) {
    return { ok: false, error: `备份来自更新的版本（v${version}），请先刷新应用再恢复` };
  }
  // 兼容：直接拿 localStorage 里 dsh.todo.v1 的内容当备份文件
  let data = obj.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = obj;
  if (!Array.isArray(data.tasks)) {
    return { ok: false, error: '备份里没有任务列表（tasks）' };
  }
  return {
    ok: true,
    data,
    meta: {
      version,
      exportedAt: Number(obj.exportedAt) || 0,
      taskCount: data.tasks.length,
      seriesCount: Array.isArray(data.series) ? data.series.length : 0,
      tagCount: Array.isArray(data.tagLibrary) ? data.tagLibrary.length : 0,
    },
  };
}

// 保留策略：普通快照留 keep 份（新的留下），恢复前快照只留最新 1 份，其它文件不动
export function prunePlan(names, keep = 3) {
  const raw = Math.round(Number(keep));
  const limit = Number.isFinite(raw) ? Math.min(20, Math.max(1, raw)) : 3;
  const list = (Array.isArray(names) ? names : []).map(String);
  const backups = list.filter(isBackupName).sort().reverse();
  const restores = list.filter(isRestoreName).sort().reverse();
  return {
    remove: [...backups.slice(limit), ...restores.slice(1)],
    keep: backups.slice(0, limit),
    keepRestores: restores.slice(0, 1),
  };
}

export function humanSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* ================= 浏览器部分：能力检测 ================= */

export function supportInfo() {
  const secure = globalThis.isSecureContext !== false;
  const picker = typeof globalThis.showDirectoryPicker === 'function';
  return { supported: picker && secure, secure, picker };
}

/* ================= 浏览器部分：IndexedDB 句柄存储 ================= */

function hasIdb() {
  return typeof globalThis.indexedDB !== 'undefined' && globalThis.indexedDB !== null;
}

function openDb() {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = globalThis.indexedDB.open(DB_NAME, 1);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbRun(mode, fn) {
  if (!hasIdb()) throw new BackupError('当前环境不支持 IndexedDB', 'NO_IDB');
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const store = tx.objectStore(DB_STORE);
      let request;
      try {
        request = fn(store);
      } catch (err) {
        reject(err);
        return;
      }
      let value;
      // 只有真拿到了 request.result 才算有值（缺键时 get 的 result 是 undefined）
      if (request && typeof request === 'object' && 'onsuccess' in request) {
        request.onsuccess = () => {
          value = request.result;
        };
      }
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadHandle() {
  try {
    const handle = await idbRun('readonly', (store) => store.get(HANDLE_KEY));
    return handle || null;
  } catch {
    return null;
  }
}

export async function saveHandle(handle) {
  return Boolean(await idbRun('readwrite', (store) => store.put(handle, HANDLE_KEY)));
}

export async function forgetHandle() {
  try {
    await idbRun('readwrite', (store) => store.delete(HANDLE_KEY));
  } catch {
    /* 忽略：句柄存不下来也不影响主流程 */
  }
}

/* ================= 浏览器部分：目录操作 ================= */

let currentHandle = null;
let lastWritten = '';
let timer = null;
let suppress = false;
let statusCache = {
  supported: false,
  hasHandle: false,
  dirName: '',
  permission: 'none',
  enabled: true,
  keep: 3,
  lastBackupAt: 0,
  lastName: '',
};
const hooks = { onChange: null, onError: null };

export function setHooks(next) {
  Object.assign(hooks, next || {});
}

export function status() {
  return { ...statusCache };
}

export function hasDirectory() {
  return Boolean(currentHandle);
}

export async function permissionOf(handle, { request = false } = {}) {
  if (!handle || typeof handle.queryPermission !== 'function') return 'unsupported';
  const opts = { mode: 'readwrite' };
  let state = await handle.queryPermission(opts);
  if (state === 'prompt' && request && typeof handle.requestPermission === 'function') {
    state = await handle.requestPermission(opts);
  }
  return state;
}

async function writeFile(handle, name, text) {
  const fileHandle = await handle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function readFileText(handle, name) {
  const fileHandle = await handle.getFileHandle(name);
  const file = await fileHandle.getFile();
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export async function listFiles(handle = currentHandle) {
  if (!handle) return [];
  const out = [];
  for await (const [name, entry] of handle.entries()) {
    if (!entry || entry.kind !== 'file') continue;
    const backup = isBackupName(name);
    const restore = isRestoreName(name);
    if (!backup && !restore) continue;
    let size = 0;
    let modified = 0;
    try {
      const file = await entry.getFile();
      size = file.size;
      modified = file.lastModified;
    } catch {
      /* 读不到大小不影响列出 */
    }
    const ts = parseBackupName(name) || modified || 0;
    out.push({ name, size, modified, kind: backup ? 'backup' : 'restore', ts });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

function describeError(err) {
  const code = err?.code || err?.name || 'ERROR';
  if (code === 'AbortError') return { code: 'CANCELLED', message: '' };
  if (code === 'NotAllowedError') return { code: 'DENIED', message: '浏览器拒绝了文件夹访问权限' };
  if (code === 'NotFoundError') return { code: 'GONE', message: '备份文件夹找不到了（被移动或删除），请重新选择' };
  if (code === 'QuotaExceededError') return { code: 'QUOTA', message: '存储空间不足，写不进备份文件' };
  if (err instanceof BackupError) return { code, message: err.message };
  return { code, message: err?.message ? `备份失败：${err.message}` : '备份失败' };
}

/* ================= 对外流程 ================= */

// 启动时调用：把上次的目录句柄取回来
export async function init() {
  const { supported } = supportInfo();
  currentHandle = supported ? await loadHandle() : null;
  await refreshStatus();
  return statusCache;
}

export async function refreshStatus() {
  const { supported } = supportInfo();
  const settings = getState().settings.backup || {};
  let permission = 'none';
  if (currentHandle) {
    try {
      permission = await permissionOf(currentHandle, { request: false });
    } catch {
      permission = 'lost';
    }
  }
  statusCache = {
    supported,
    hasHandle: Boolean(currentHandle),
    dirName: currentHandle ? currentHandle.name : '',
    permission,
    enabled: settings.enabled !== false,
    keep: settings.keep || 3,
    lastBackupAt: Number(settings.lastBackupAt) || 0,
    lastName: settings.lastName || '',
  };
  if (hooks.onChange) hooks.onChange(status());
  return statusCache;
}

// 必须在点击手势里调用：系统文件夹选择器
export async function chooseDirectory() {
  const { supported, secure } = supportInfo();
  if (!supported) {
    throw new BackupError(
      secure ? '当前浏览器不支持选择文件夹（需要 Chrome 132+）' : '需要 HTTPS 才能选择文件夹',
      'UNSUPPORTED',
    );
  }
  const handle = await globalThis.showDirectoryPicker({
    id: 'dsh-todo-backup',
    mode: 'readwrite',
    startIn: 'documents',
  });
  await saveHandle(handle);
  currentHandle = handle;
  lastWritten = '';
  const permission = await permissionOf(handle, { request: true });
  if (permission !== 'granted') throw new BackupError('没有拿到文件夹的写入权限', 'DENIED');
  updateSettingsMuted({ backup: { dirName: handle.name } });
  await refreshStatus();
  return handle;
}

// 内部状态写入不应该反过来再触发一次自动备份
function updateSettingsMuted(patch) {
  suppress = true;
  try {
    updateSettings(patch);
  } finally {
    suppress = false;
  }
}

// 写一份快照到已选的文件夹；返回 { ok, fileName } 或 { ok:false, code, message }
export async function backupNow() {
  if (!currentHandle) return { ok: false, code: 'NO_DIR', message: '还没有选择备份文件夹' };
  const permission = await permissionOf(currentHandle, { request: false });
  if (permission !== 'granted') return { ok: false, code: 'NO_PERM', message: '需要先确认备份文件夹的访问权限' };

  const text = stringifySnapshot(getState());
  if (text === lastWritten) return { ok: true, skipped: true };

  try {
    const name = backupFileName(Date.now());
    await writeFile(currentHandle, name, text);
    lastWritten = text;
    updateSettingsMuted({ backup: { lastBackupAt: Date.now(), lastName: name } });
    await pruneNow({ silent: true });
    await refreshStatus();
    return { ok: true, fileName: name };
  } catch (err) {
    const info = describeError(err);
    if (info.code === 'GONE') {
      currentHandle = null;
      await forgetHandle();
      await refreshStatus();
    }
    if (hooks.onError) hooks.onError(info);
    return { ok: false, ...info };
  }
}

export function schedule() {
  if (suppress) return;
  const settings = getState().settings.backup || {};
  if (settings.enabled === false) return;
  if (!currentHandle) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void backupNow();
  }, DEBOUNCE_MS);
}

// 页面要隐藏时尽力立刻写一次（不保证写完）
export async function flush() {
  if (!timer) return { ok: true, skipped: true };
  clearTimeout(timer);
  timer = null;
  return backupNow();
}

export async function pruneNow({ silent = false } = {}) {
  if (!currentHandle) return { ok: false, code: 'NO_DIR', message: '还没有选择备份文件夹' };
  const permission = await permissionOf(currentHandle, { request: false });
  if (permission !== 'granted') return { ok: false, code: 'NO_PERM', message: '需要先确认备份文件夹的访问权限' };
  try {
    const files = await listFiles(currentHandle);
    const keep = (getState().settings.backup || {}).keep || 3;
    const plan = prunePlan(files.map((f) => f.name), keep);
    for (const name of plan.remove) {
      try {
        await currentHandle.removeEntry(name);
      } catch {
        /* 单个删除失败继续 */
      }
    }
    if (plan.remove.length && !silent) await refreshStatus();
    return { ok: true, removed: plan.remove.length };
  } catch (err) {
    const info = describeError(err);
    if (hooks.onError) hooks.onError(info);
    return { ok: false, ...info };
  }
}

// 把一份快照文本恢复进应用；恢复前若有现存任务，先留一份退路文件
export async function restoreFromText(text) {
  const parsed = parseSnapshot(text);
  if (!parsed.ok) throw new BackupError(parsed.error, 'PARSE');

  const before = getState().tasks.length;
  if (before > 0 && currentHandle) {
    const permission = await permissionOf(currentHandle, { request: false });
    if (permission === 'granted') {
      try {
        await writeFile(currentHandle, restoreFileName(Date.now()), stringifySnapshot(getState()));
      } catch {
        /* 退路文件写不进去不阻断恢复 */
      }
    }
  }

  replaceState(parsed.data);
  lastWritten = '';
  if (currentHandle) updateSettingsMuted({ backup: { dirName: currentHandle.name } });
  await refreshStatus();
  return {
    taskCount: getState().tasks.length,
    seriesCount: getState().series.length,
    tagCount: getState().tagLibrary.length,
    exportedAt: parsed.meta.exportedAt,
    replaced: before,
  };
}

export async function restoreFromFile(file) {
  if (!file) throw new BackupError('没有选中文件', 'NO_FILE');
  const text =
    typeof file.text === 'function'
      ? await file.text()
      : await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsText(file);
        });
  return restoreFromText(text);
}

// 在点击手势里重新确认权限（浏览器重启后句柄会变回 prompt）
export async function requestAccess() {
  if (!currentHandle) return 'none';
  const state = await permissionOf(currentHandle, { request: true });
  await refreshStatus();
  return state;
}

// 从已选文件夹里取最新的一份快照恢复
export async function restoreLatest() {
  if (!currentHandle) throw new BackupError('还没有选择备份文件夹', 'NO_DIR');
  const permission = await permissionOf(currentHandle, { request: true });
  if (permission !== 'granted') throw new BackupError('没有拿到备份文件夹的读取权限', 'DENIED');
  const files = await listFiles(currentHandle);
  const latest = files.find((f) => f.kind === 'backup');
  if (!latest) throw new BackupError('这个文件夹里没有备份文件', 'EMPTY');
  const text = await readFileText(currentHandle, latest.name);
  const result = await restoreFromText(text);
  return { ...result, fileName: latest.name };
}

// 恢复指定文件名的快照（恢复弹层里点某一行）
export async function restoreByName(name) {
  if (!currentHandle) throw new BackupError('还没有选择备份文件夹', 'NO_DIR');
  const permission = await permissionOf(currentHandle, { request: true });
  if (permission !== 'granted') throw new BackupError('没有拿到备份文件夹的读取权限', 'DENIED');
  const text = await readFileText(currentHandle, name);
  const result = await restoreFromText(text);
  return { ...result, fileName: name };
}

// 降级路径：没有文件夹支持时，直接把完整快照下载成文件
export function buildExport(now = Date.now()) {
  const text = stringifySnapshot(getState(), now);
  return {
    text,
    fileName: backupFileName(now),
    blob: typeof Blob === 'function' ? new Blob([text], { type: 'application/json' }) : null,
  };
}

// 仅测试/调试用：重置模块内缓存
export function __resetForTests(handle = null) {
  currentHandle = handle;
  lastWritten = '';
  if (timer) clearTimeout(timer);
  timer = null;
  suppress = false;
}
