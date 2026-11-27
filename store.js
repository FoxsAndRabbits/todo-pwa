// 数据层：schema、localStorage 持久化、标签库、CRUD、筛选与排序（纯函数部分可被 node 测试直接引用）。
import {
  todayISO,
  weekStartOf,
  addDays,
  isoOf,
  parseISO,
  planDayOf,
  nextOccurrence,
  occurrencePlanAt,
} from './dates.js';

const KEY = 'dsh.todo.v1';

// 标签默认配色，新建标签按顺序取色
export const TAG_COLORS = [
  '#4f6df5',
  '#2f8f5b',
  '#d9822b',
  '#c2410c',
  '#8b5cf6',
  '#0ea5e9',
  '#14b8a6',
  '#e11d48',
  '#a16207',
  '#64748b',
  '#db2777',
  '#65a30d',
];

let state = null;
let backend = null;
let persistent = true;
let saveError = '';
const listeners = new Set();

/* ---------------- 默认值 ---------------- */

export function defaultSettings() {
  return {
    remind: {
      modal: true,
      sound: false,
      vibrate: false,
      notification: false,
      thresholdHours: 24,
      interval: 'open',
      maxPerDay: 2,
    },
    sort: { key: 'due', dir: 'asc' },
    weekStart: 1,
    theme: 'auto',
    // 文件夹自动备份（句柄本身存在 IndexedDB，不在这里）
    backup: { enabled: true, keep: 3, lastBackupAt: 0, lastName: '', dirName: '' },
    ui: {
      view: 'all',
      status: 'all',
      tags: [],
      q: '',
      weekOffset: 0,
      calendarMode: 'due',
      dateFrom: '',
      dateTo: '',
      doneFrom: '',
      doneTo: '',
      createdFrom: '',
      createdTo: '',
    },
  };
}

export function emptyState() {
  return { version: 5, tasks: [], series: [], tagLibrary: [], remindLog: {}, settings: defaultSettings() };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!isPlainObject(patch)) return out;
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

export function uid() {
  return 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function normalizeColor(color, index = 0) {
  const value = String(color || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  return TAG_COLORS[index % TAG_COLORS.length];
}

export function normalizeTask(raw) {
  const now = Date.now();
  const t = raw || {};
  const done = !!t.done;
  // 旧版本有「总结」，改为迁移进「注意事项」，避免丢内容
  const legacySummary = String(t.review?.summary ?? '').trim();
  const note = String(t.note ?? '').trim() || legacySummary;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(t.date)) ? t.date : todayISO();
  // 旧版本用「计划完成天数」，升级为具体时间：起始日 + 天数 - 1 的 23:59
  const legacyDays = Number(t.planDays);
  let planAt = Number(t.planAt) > 0 ? Number(t.planAt) : null;
  if (!planAt && Number.isFinite(legacyDays) && legacyDays >= 1) {
    planAt = parseISO(addDays(date, Math.round(legacyDays) - 1)).getTime();
    const end = new Date(planAt);
    end.setHours(23, 59, 0, 0);
    planAt = end.getTime();
  }
  return {
    id: t.id || uid(),
    content: String(t.content ?? '').trim(),
    date,
    planAt,
    tags: Array.isArray(t.tags) ? [...new Set(t.tags.map((x) => String(x).trim()).filter(Boolean))] : [],
    subs: Array.isArray(t.subs) ? t.subs.map(normalizeSub).filter((s) => s.content).slice(0, 50) : [],
    note,
    done,
    doneAt: done ? Number(t.doneAt) || now : null,
    favorite: !!t.favorite,
    review: {
      difficulty: String(t.review?.difficulty ?? ''),
      solution: String(t.review?.solution ?? ''),
    },
    seriesId: t.seriesId ? String(t.seriesId) : null,
    seriesDate: /^\d{4}-\d{2}-\d{2}$/.test(String(t.seriesDate)) ? t.seriesDate : null,
    createdAt: Number(t.createdAt) || now,
    updatedAt: Number(t.updatedAt) || now,
  };
}

// 子任务：任务下面可勾选的小步骤。内容为空的行在归一化时直接丢弃。
export function normalizeSub(raw) {
  const s = isPlainObject(raw) ? raw : {};
  const done = !!s.done;
  return {
    id: s.id ? String(s.id) : uid(),
    content: String(s.content ?? '').trim().slice(0, 200),
    done,
    doneAt: done ? Number(s.doneAt) || Date.now() : null,
  };
}

/* ---------------- 周期任务（系列） ---------------- */

export function normalizeRule(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const type = ['everyDays', 'weekly', 'monthly', 'yearly'].includes(r.type) ? r.type : 'everyDays';
  return {
    type,
    interval: Math.min(365, Math.max(1, Math.round(Number(r.interval) || 1))),
    weekdays: [...new Set((Array.isArray(r.weekdays) ? r.weekdays : []).map(Number).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b),
    monthDay: Math.min(31, Math.max(1, Math.round(Number(r.monthDay) || 1))),
    month: Math.min(12, Math.max(1, Math.round(Number(r.month) || 1))),
    day: Math.min(31, Math.max(1, Math.round(Number(r.day) || 1))),
  };
}

export function normalizeSeries(raw) {
  const now = Date.now();
  const s = raw || {};
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(String(s.anchor)) ? s.anchor : todayISO();
  const rule = normalizeRule(s.rule);
  // 首次生成日按规则从 anchor 推算（例如每月 15 日、anchor 是 19 日 → 下月 15 日）
  const first = nextOccurrence(rule, anchor, anchor);
  let nextDate = /^\d{4}-\d{2}-\d{2}$/.test(String(s.nextDate)) ? s.nextDate : first;
  if (nextDate < anchor) nextDate = first;
  return {
    id: s.id || 's_' + now.toString(36) + Math.random().toString(36).slice(2, 6),
    content: String(s.content ?? '').trim(),
    note: String(s.note ?? ''),
    tags: Array.isArray(s.tags) ? [...new Set(s.tags.map((x) => String(x).trim()).filter(Boolean))] : [],
    planTime: /^\d{2}:\d{2}$/.test(String(s.planTime)) ? s.planTime : '',
    rule,
    anchor,
    nextDate,
    suppressed: Array.isArray(s.suppressed)
      ? [...new Set(s.suppressed.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d))))].sort()
      : [],
    active: s.active !== false,
    createdAt: Number(s.createdAt) || now,
    updatedAt: Number(s.updatedAt) || now,
  };
}

// 标签库：保留顺序、去重、补齐 color；任务里出现但库里没有的标签自动补进去
export function normalizeLibrary(raw, tasks = []) {
  const list = [];
  const seen = new Set();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const name = String(entry?.name ?? '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      list.push({ name, color: normalizeColor(entry?.color, list.length) });
    }
  }
  for (const task of tasks) {
    for (const tag of task.tags || []) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      list.push({ name: tag, color: TAG_COLORS[list.length % TAG_COLORS.length] });
    }
  }
  return list;
}

function normalize(raw) {
  const base = emptyState();
  const merged = deepMerge(base, isPlainObject(raw) ? raw : {});
  merged.version = 5;
  merged.tasks = Array.isArray(merged.tasks) ? merged.tasks.filter((t) => t && t.id).map(normalizeTask) : [];
  merged.series = Array.isArray(merged.series) ? merged.series.filter((s) => s && s.id).map(normalizeSeries) : [];
  merged.remindLog = isPlainObject(merged.remindLog) ? merged.remindLog : {};
  merged.tagLibrary = normalizeLibrary(merged.tagLibrary, merged.tasks);

  if (!isPlainObject(merged.settings.remind)) merged.settings.remind = defaultSettings().remind;
  const r = merged.settings.remind;
  const threshold = Number(r.thresholdHours);
  r.thresholdHours = Number.isFinite(threshold) && threshold >= 0 ? threshold : 24;
  const maxPerDay = Number(r.maxPerDay);
  r.maxPerDay = Number.isFinite(maxPerDay) && maxPerDay >= 1 ? Math.min(10, Math.round(maxPerDay)) : 2;
  merged.settings.weekStart = Number(merged.settings.weekStart) === 0 ? 0 : 1;

  const ui = merged.settings.ui;
  if (!['all', 'today', 'week', 'fav'].includes(ui.view)) ui.view = 'all';
  if (!['due', 'start'].includes(ui.calendarMode)) ui.calendarMode = 'due';
  // 日历不再记住上次翻到的月份：打开时总是回到今天，旧数据里的字段顺手清掉
  delete ui.calendarMonth;
  ui.tags = Array.isArray(ui.tags) ? ui.tags.filter((tag) => merged.tagLibrary.some((t) => t.name === tag)) : [];
  // 搜索词不跨会话保留，其余筛选保留
  ui.q = '';

  if (!isPlainObject(merged.settings.backup)) merged.settings.backup = defaultSettings().backup;
  const b = merged.settings.backup;
  const keep = Math.round(Number(b.keep));
  b.keep = Number.isFinite(keep) ? Math.min(20, Math.max(1, keep)) : 3;
  b.enabled = b.enabled !== false;
  b.lastBackupAt = Number(b.lastBackupAt) > 0 ? Number(b.lastBackupAt) : 0;
  b.lastName = String(b.lastName ?? '');
  b.dirName = String(b.dirName ?? '');
  return merged;
}

/* ---------------- 初始化 / 持久化 ---------------- */

export function initStore(storage) {
  backend = storage || null;
  if (!backend) {
    try {
      backend = globalThis.localStorage;
    } catch {
      backend = null;
    }
  }
  let raw = null;
  if (backend) {
    try {
      raw = backend.getItem(KEY);
    } catch {
      backend = null;
    }
  }
  if (!backend) persistent = false;
  let parsed = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  state = normalize(parsed || emptyState());
  return state;
}

function save() {
  if (!backend) {
    persistent = false;
    return;
  }
  try {
    backend.setItem(KEY, JSON.stringify(state));
    saveError = '';
  } catch (err) {
    // 配额写满 / 隐私模式：不能静默吞掉，否则用户以为存好了，刷新就没了
    persistent = false;
    saveError = String(err?.name || err?.message || err || '写入失败');
  }
}

function touch() {
  save();
  for (const fn of listeners) fn(state);
}

export function getState() {
  if (!state) initStore();
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isPersistent() {
  return persistent;
}

// 最近一次保存失败的原因（'' = 正常），供设置界面提示
export function lastSaveError() {
  return saveError;
}

export function storageKey() {
  return KEY;
}

// 用一份完整快照替换内存状态（恢复备份用）：复用 normalize 的迁移与清洗
export function replaceState(raw) {
  state = normalize(isPlainObject(raw) ? raw : emptyState());
  touch();
  return state;
}

// 当前状态的纯净可序列化副本（不含函数/句柄），备份与导出用
export function snapshotState() {
  const s = getState();
  return {
    tasks: s.tasks,
    series: s.series,
    tagLibrary: s.tagLibrary,
    remindLog: s.remindLog,
    settings: s.settings,
  };
}

/* ---------------- 任务操作 ---------------- */

export function addTask({ content, date, planAt, tags, note, subs }) {
  const now = Date.now();
  const task = normalizeTask({ id: uid(), content, date, planAt, tags, note, subs, createdAt: now, updatedAt: now });
  state.tasks.unshift(task);
  ensureTags(task.tags);
  touch();
  return task;
}

export function updateTask(id, patch) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return null;
  const next = normalizeTask({ ...task, ...patch, id, createdAt: task.createdAt, updatedAt: Date.now() });
  Object.assign(task, next);
  ensureTags(task.tags);
  touch();
  return task;
}

// 勾选 / 取消一条子任务（主界面的小圆勾用，不动父任务的完成状态）
export function toggleSubDone(taskId, subId, doneAt) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return null;
  const sub = (task.subs || []).find((s) => s.id === subId);
  if (!sub) return null;
  if (sub.done) {
    sub.done = false;
    sub.doneAt = null;
  } else {
    sub.done = true;
    sub.doneAt = Number(doneAt) || Date.now();
  }
  task.updatedAt = Date.now();
  touch();
  return sub;
}

export function removeTask(id) {
  const before = state.tasks.length;
  state.tasks = state.tasks.filter((t) => t.id !== id);
  delete state.remindLog[id];
  if (state.tasks.length !== before) touch();
}

// 完成（可指定完成时间）/ 取消完成
export function toggleDone(id, doneAt) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return null;
  if (task.done) {
    task.done = false;
    task.doneAt = null;
  } else {
    task.done = true;
    task.doneAt = Number(doneAt) || Date.now();
  }
  task.updatedAt = Date.now();
  touch();
  return task;
}

export function setDoneAt(id, ts) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task || !task.done) return null;
  task.doneAt = Number(ts) || Date.now();
  task.updatedAt = Date.now();
  touch();
  return task;
}

export function setFavorite(id, favorite) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return null;
  task.favorite = !!favorite;
  task.updatedAt = Date.now();
  touch();
  return task;
}

export function setReview(id, review) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return null;
  task.review = { ...task.review, ...review };
  task.updatedAt = Date.now();
  touch();
  return task;
}

/* ---------------- 周期任务操作 ---------------- */

function createOccurrence(series, date) {
  const exists = state.tasks.some((t) => t.seriesId === series.id && t.seriesDate === date);
  if (exists) return null;
  const now = Date.now();
  const task = normalizeTask({
    id: uid(),
    content: series.content,
    date,
    planAt: occurrencePlanAt(date, series.planTime),
    tags: [...series.tags],
    note: series.note,
    createdAt: now,
    updatedAt: now,
    seriesId: series.id,
    seriesDate: date,
  });
  state.tasks.unshift(task);
  return task;
}

// 补齐所有到期的期次；返回 { created, remaining }，不触发订阅
export function materializeSeries(today = todayISO(), limit = 30) {
  let created = 0;
  let remaining = 0;
  for (const series of state.series) {
    if (!series.active) continue;
    let guard = 0;
    while (series.nextDate <= today && guard < limit) {
      const date = series.nextDate;
      series.nextDate = nextOccurrence(series.rule, addDays(date, 1), series.anchor);
      guard += 1;
      if (series.suppressed.includes(date)) continue;
      if (createOccurrence(series, date)) created += 1;
    }
    if (series.nextDate <= today) remaining += 1;
  }
  if (created) save();
  return { created, remaining };
}

// 供 UI 调用的 tick：生成后通知订阅者
export function seriesTick(today = todayISO()) {
  const result = materializeSeries(today);
  if (result.created) touch();
  return result;
}

export function addSeries(payload, today = todayISO()) {
  const now = Date.now();
  const series = normalizeSeries({
    ...payload,
    id: 's_' + now.toString(36) + Math.random().toString(36).slice(2, 6),
    createdAt: now,
    updatedAt: now,
  });
  state.series.push(series);
  ensureTags(series.tags);
  const result = materializeSeries(today);
  touch();
  return { series, ...result };
}

export function updateSeries(id, patch) {
  const series = state.series.find((s) => s.id === id);
  if (!series) return null;
  const next = normalizeSeries({ ...series, ...patch, id, createdAt: series.createdAt, updatedAt: Date.now() });
  const ruleChanged = JSON.stringify(next.rule) !== JSON.stringify(series.rule) || next.anchor !== series.anchor;
  Object.assign(series, next);
  if (ruleChanged) {
    const today = todayISO();
    series.nextDate = nextOccurrence(series.rule, today > series.anchor ? today : series.anchor, series.anchor);
    series.suppressed = series.suppressed.filter((d) => d >= series.nextDate);
  }
  ensureTags(series.tags);
  touch();
  return series;
}

// 删除系列：默认保留已生成的待办并解除关联
export function removeSeries(id, { deleteOpenOccurrences = false } = {}) {
  const series = state.series.find((s) => s.id === id);
  if (!series) return false;
  state.series = state.series.filter((s) => s.id !== id);
  if (deleteOpenOccurrences) {
    const removed = state.tasks.filter((t) => t.seriesId === id && !t.done).map((t) => t.id);
    state.tasks = state.tasks.filter((t) => !(t.seriesId === id && !t.done));
    for (const taskId of removed) delete state.remindLog[taskId];
  }
  for (const task of state.tasks) {
    if (task.seriesId === id) {
      task.seriesId = null;
      task.seriesDate = null;
    }
  }
  touch();
  return true;
}

export function toggleSeries(id) {
  const series = state.series.find((s) => s.id === id);
  if (!series) return null;
  series.active = !series.active;
  series.updatedAt = Date.now();
  touch();
  return series;
}

// 手动触发：立即生成下一期（无视 suppressed）
export function triggerSeries(id) {
  const series = state.series.find((s) => s.id === id);
  if (!series) return { ok: false, reason: '周期任务不存在' };
  const date = series.nextDate;
  const task = createOccurrence(series, date);
  series.suppressed = series.suppressed.filter((d) => d !== date);
  series.nextDate = nextOccurrence(series.rule, addDays(date, 1), series.anchor);
  series.updatedAt = Date.now();
  touch();
  return { ok: true, task, date };
}

// 撤回：删除该系列「今天以后」的全部期次，并让下次生成日回到最早被删的那一天
export function withdrawSeries(seriesId, today = todayISO()) {
  const series = state.series.find((s) => s.id === seriesId);
  if (!series) return { ok: false, reason: '周期任务不存在' };

  const future = state.tasks.filter((t) => t.seriesId === seriesId && t.seriesDate > today);
  if (!future.length) return { ok: false, reason: '没有今天以后的期次可撤回' };

  const earliest = future.map((t) => t.seriesDate).sort()[0];
  const ids = new Set(future.map((t) => t.id));
  state.tasks = state.tasks.filter((t) => !ids.has(t.id));
  for (const id of ids) delete state.remindLog[id];
  series.nextDate = earliest;
  // 之后重新生成时不受旧的抑制记录影响
  series.suppressed = series.suppressed.filter((d) => d < earliest);
  series.updatedAt = Date.now();
  touch();
  return { ok: true, removed: future.length, nextDate: earliest, series };
}

export function occurrencesOf(seriesId) {
  return (state?.tasks || []).filter((t) => t.seriesId === seriesId);
}

/* ---------------- 标签库操作 ---------------- */
export function tagColor(name) {
  const entry = state?.tagLibrary?.find((t) => t.name === name);
  return entry ? entry.color : TAG_COLORS[0];
}

export function tagEntry(name) {
  return state?.tagLibrary?.find((t) => t.name === name) || null;
}

// 新增标签（同名视为已存在），返回标签对象
export function addTag(name, color) {
  const value = String(name ?? '').trim().slice(0, 20);
  if (!value) return null;
  const existing = state.tagLibrary.find((t) => t.name === value);
  if (existing) {
    if (color) existing.color = normalizeColor(color);
    touch();
    return existing;
  }
  const entry = { name: value, color: normalizeColor(color, state.tagLibrary.length) };
  state.tagLibrary.push(entry);
  touch();
  return entry;
}

// 批量确保标签存在（新建任务时把标签同步进标签库）
export function ensureTags(names) {
  const added = [];
  for (const raw of names || []) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    if (!state.tagLibrary.some((t) => t.name === name)) {
      added.push({ name, color: TAG_COLORS[state.tagLibrary.length % TAG_COLORS.length] });
    }
  }
  if (added.length) {
    state.tagLibrary.push(...added);
    save();
  }
  return added;
}

// 删除标签：同时从所有任务和当前筛选里移除
export function removeTag(name) {
  const before = state.tagLibrary.length;
  state.tagLibrary = state.tagLibrary.filter((t) => t.name !== name);
  for (const task of state.tasks) {
    if (task.tags.includes(name)) task.tags = task.tags.filter((x) => x !== name);
  }
  state.settings.ui.tags = state.settings.ui.tags.filter((x) => x !== name);
  if (state.tagLibrary.length !== before) touch();
}

export function setTagColor(name, color) {
  const entry = state.tagLibrary.find((t) => t.name === name);
  if (!entry) return null;
  entry.color = normalizeColor(color);
  touch();
  return entry;
}

// 拖动排序：把 from 位置的标签移到 to 位置
export function moveTag(from, to) {
  const list = state.tagLibrary;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return list;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  touch();
  return list;
}

export function updateSettings(patch) {
  state.settings = deepMerge(state.settings, patch);
  touch();
}

export function updateUi(patch) {
  state.settings.ui = { ...state.settings.ui, ...patch };
  touch();
}

export function resetFilters() {
  state.settings.ui = {
    ...state.settings.ui,
    status: 'all',
    tags: [],
    q: '',
    dateFrom: '',
    dateTo: '',
    doneFrom: '',
    doneTo: '',
    createdFrom: '',
    createdTo: '',
  };
  touch();
}

export function setRemindLog(log) {
  state.remindLog = log;
  touch();
}

export function clearAll() {
  state.tasks = [];
  state.remindLog = {};
  touch();
}

/* ---------------- 纯函数：筛选 / 排序 / 统计 ---------------- */

export function allTags(tasks, library = []) {
  const counts = new Map();
  for (const t of tasks) for (const tag of t.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  // 先按标签库顺序，再按使用次数
  const order = new Map(library.map((entry, i) => [entry.name, i]));
  return [...counts.entries()]
    .sort((a, b) => {
      const oa = order.has(a[0]) ? order.get(a[0]) : Number.MAX_SAFE_INTEGER;
      const ob = order.has(b[0]) ? order.get(b[0]) : Number.MAX_SAFE_INTEGER;
      return oa - ob || b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'zh-CN');
    })
    .map(([tag, count]) => ({ tag, count }));
}

export function weekRange(today, weekOffset = 0, weekStart = 1) {
  const start = addDays(weekStartOf(today, weekStart), weekOffset * 7);
  return { start, end: addDays(start, 6) };
}

function inRange(value, from, to) {
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

export function filterTasks(tasks, opts = {}) {
  const {
    view = 'all',
    status = 'all',
    tags = [],
    q = '',
    weekOffset = 0,
    weekStart = 1,
    today = todayISO(),
    dateFrom = '',
    dateTo = '',
    doneFrom = '',
    doneTo = '',
    createdFrom = '',
    createdTo = '',
  } = opts;
  const { start, end } = weekRange(today, weekOffset, weekStart);
  const needle = String(q).trim().toLowerCase();

  return tasks.filter((t) => {
    if (view === 'today' && !(t.date === today || (!t.done && t.date < today))) return false;
    if (view === 'week' && !((t.date >= start && t.date <= end) || (!t.done && t.date < start))) return false;
    if (status === 'active' && t.done) return false;
    if (status === 'done' && !t.done) return false;
    if (status === 'fav' && !t.favorite) return false;
    if (tags.length && !tags.every((x) => (t.tags || []).includes(x))) return false;
    if (dateFrom || dateTo) {
      if (!inRange(t.date, dateFrom, dateTo)) return false;
    }
    if (doneFrom || doneTo) {
      if (!t.done || !t.doneAt) return false;
      if (!inRange(isoOf(t.doneAt), doneFrom, doneTo)) return false;
    }
    if (createdFrom || createdTo) {
      if (!inRange(isoOf(t.createdAt), createdFrom, createdTo)) return false;
    }
    if (needle) {
      const hay = [
        t.content,
        t.note,
        ...(t.tags || []),
        ...(t.subs || []).map((s) => s.content),
        t.review?.difficulty,
        t.review?.solution,
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

// 日历用：某任务归属哪一天（开始日 or 计划完成日）
export function dayOf(task, mode = 'due') {
  if (mode === 'start') return task.date;
  return planDayOf(task);
}

export function tasksOnDay(tasks, day, mode = 'due') {
  return tasks.filter((t) => dayOf(t, mode) === day);
}

function sortValue(task, key) {
  switch (key) {
    case 'due':
      return Number(task.planAt) > 0 ? Number(task.planAt) : null;
    case 'date':
      return Date.parse(task.date + 'T00:00:00');
    case 'created':
      return task.createdAt || 0;
    case 'done':
      return task.doneAt || 0;
    case 'content':
      return String(task.content || '').toLowerCase();
    default:
      return 0;
  }
}

export function sortTasks(tasks, { key = 'due', dir = 'asc' } = {}) {
  const sign = dir === 'desc' ? -1 : 1;
  return tasks.slice().sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    // 无到期日的任务永远排在末尾
    if (key === 'due') {
      if (av === null && bv === null) return String(a.createdAt) < String(b.createdAt) ? 1 : -1;
      if (av === null) return 1;
      if (bv === null) return -1;
    }
    if (typeof av === 'string' || typeof bv === 'string') {
      return sign * String(av).localeCompare(String(bv), 'zh-CN');
    }
    if (av === bv) return a.createdAt - b.createdAt;
    return sign * (av < bv ? -1 : 1);
  });
}

export function stats(tasks, today = todayISO()) {
  let active = 0;
  let done = 0;
  let todayCount = 0;
  let favorites = 0;
  for (const t of tasks) {
    if (t.done) done += 1;
    else active += 1;
    if (t.date === today) todayCount += 1;
    if (t.favorite) favorites += 1;
  }
  return { total: tasks.length, active, done, today: todayCount, favorites };
}

export function isOverdue(task, now = Date.now()) {
  if (task.done) return false;
  const plan = Number(task.planAt);
  return Number.isFinite(plan) && plan > 0 && plan < now;
}
