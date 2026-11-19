// 待办清单 PWA —— UI 装配与事件
import {
  todayISO,
  fmtDate,
  fmtDateTime,
  fmtFull,
  fmtShort,
  planOf,
  relToPlan,
  weekLabel,
  monthStartOf,
  addMonths,
  fmtMonth,
  monthGrid,
  weekdayNames,
  datetimeLocalValue,
  tsFromDatetimeLocal,
  describeRule,
  diffDays,
} from './dates.js';
import {
  initStore,
  getState,
  subscribe,
  isPersistent,
  lastSaveError,
  addTask,
  updateTask,
  removeTask,
  toggleDone,
  setDoneAt,
  setFavorite,
  updateSettings,
  updateUi,
  resetFilters,
  setRemindLog,
  clearAll,
  filterTasks,
  sortTasks,
  stats,
  weekRange,
  tagColor,
  addTag,
  removeTag,
  setTagColor,
  moveTag,
  tasksOnDay,
  seriesTick,
  addSeries,
  updateSeries,
  removeSeries,
  toggleSeries,
  triggerSeries,
  withdrawSeries,
  occurrencesOf,
  TAG_COLORS,
} from './store.js';
import {
  pendingTasks,
  withReminded,
  playChime,
  vibrateNow,
  notifyOS,
  notifyPermission,
  requestNotifyPermission,
  remindLabel,
} from './remind.js';
import { buildXlsx, xlsxBlob } from './xlsx.js';
import {
  init as initBackup,
  setHooks as setBackupHooks,
  status as backupStatus,
  supportInfo as backupSupport,
  chooseDirectory as chooseBackupDir,
  backupNow as backupNowRun,
  schedule as scheduleBackup,
  flush as flushBackup,
  pruneNow as pruneBackup,
  listFiles as listBackupFiles,
  restoreLatest as restoreBackupLatest,
  restoreByName as restoreBackupByName,
  restoreFromFile as restoreBackupFile,
  requestAccess as requestBackupAccess,
  buildExport as buildBackupExport,
  humanSize,
} from './backup.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5 9.5 17.5 19.5 6.5"/></svg>';

const els = {
  todayLine: $('#todayLine'),
  statLine: $('#statLine'),
  list: $('#list'),
  viewSeg: $('#viewSeg'),
  btnFavorites: $('#btnFavorites'),
  btnSettings: $('#btnSettings'),
  btnCalendar: $('#btnCalendar'),
  weekNav: $('#weekNav'),
  weekLabel: $('#weekLabel'),
  weekPrev: $('#weekPrev'),
  weekNext: $('#weekNext'),
  search: $('#search'),
  btnFilter: $('#btnFilter'),
  filterCount: $('#filterCount'),
  activeFilters: $('#activeFilters'),
  sortKey: $('#sortKey'),
  sortDir: $('#sortDir'),
  calMonthTitle: $('#calMonthTitle'),
  calPrev: $('#calPrev'),
  calNext: $('#calNext'),
  calToday: $('#calToday'),
  calMode: $('#calMode'),
  calWeekdays: $('#calWeekdays'),
  calGrid: $('#calGrid'),
  calLegend: $('#calLegend'),
  fab: $('#fab'),
  taskForm: $('#taskForm'),
  taskTitle: $('#taskTitle'),
  taskContent: $('#taskContent'),
  taskDate: $('#taskDate'),
  taskPlanAt: $('#taskPlanAt'),
  taskTagPicker: $('#taskTagPicker'),
  taskTagInput: $('#taskTagInput'),
  taskNote: $('#taskNote'),
  taskReviewFields: $('#taskReviewFields'),
  taskDifficulty: $('#taskDifficulty'),
  taskSolution: $('#taskSolution'),
  tagList: $('#tagList'),
  tagAddForm: $('#tagAddForm'),
  tagNewName: $('#tagNewName'),
  btnSeriesManager: $('#btnSeriesManager'),
  btnNewSeries: $('#btnNewSeries'),
  seriesList: $('#seriesList'),
  seriesEmpty: $('#seriesEmpty'),
  seriesForm: $('#seriesForm'),
  seriesFormTitle: $('#seriesFormTitle'),
  seriesContent: $('#seriesContent'),
  seriesAnchor: $('#seriesAnchor'),
  seriesPlanTime: $('#seriesPlanTime'),
  seriesRuleType: $('#seriesRuleType'),
  ruleEveryDays: $('#ruleEveryDays'),
  ruleWeekly: $('#ruleWeekly'),
  ruleMonthly: $('#ruleMonthly'),
  ruleYearly: $('#ruleYearly'),
  seriesInterval: $('#seriesInterval'),
  seriesWeekdays: $('#seriesWeekdays'),
  seriesMonthDay: $('#seriesMonthDay'),
  seriesMonth: $('#seriesMonth'),
  seriesDay: $('#seriesDay'),
  seriesNote: $('#seriesNote'),
  seriesTagPicker: $('#seriesTagPicker'),
  seriesTagInput: $('#seriesTagInput'),
  filterTags: $('#filterTags'),
  filterTagEmpty: $('#filterTagEmpty'),
  completeTaskName: $('#completeTaskName'),
  completeAt: $('#completeAt'),
  dayTitle: $('#dayTitle'),
  dayMeta: $('#dayMeta'),
  dayList: $('#dayList'),
  remindList: $('#remindList'),
  remindAck: $('#remindAck'),
  toast: $('#toast'),
  storageHint: $('#storageHint'),
  backupStatus: $('#backupStatus'),
  saveErrorHint: $('#saveErrorHint'),
  btnChooseBackupDir: $('#btnChooseBackupDir'),
  btnBackupNow: $('#btnBackupNow'),
  btnExportBackup: $('#btnExportBackup'),
  btnRestoreDir: $('#btnRestoreDir'),
  btnRestoreFile: $('#btnRestoreFile'),
  restoreBackupInput: $('#restoreBackupInput'),
  btnSafeClean: $('#btnSafeClean'),
  restoreOtherDir: $('#restoreOtherDir'),
  restoreMeta: $('#restoreMeta'),
  restoreList: $('#restoreList'),
  restoreEmpty: $('#restoreEmpty'),
  notifyHint: $('#notifyHint'),
};

/* ---------------- 初始化 ---------------- */
initStore();
const snap = () => getState();

let editingTaskId = null;
let completingTaskId = null;
let completingMode = 'complete';
let pendingDeleteId = null;
let deleteTimer = null;
let pendingTagDelete = null;
let tagDeleteTimer = null;
let paletteOpenFor = null;
let selectedTags = [];
let seriesTags = [];
let seriesWeekdays = [];
let editingSeriesId = null;
let pendingSeriesDelete = null;
let seriesDeleteTimer = null;
let expandedIds = new Set();
let dayModalDate = '';
let toastTimer = null;
let remindTimer = null;
let installPrompt = null;
let searchTimer = null;

/* ---------------- 主题 ---------------- */
const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function applyTheme() {
  const pref = snap().settings.theme;
  const dark = pref === 'dark' || (pref === 'auto' && darkQuery && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0f1115' : '#f4f5f8');
}

if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', applyTheme);

/* ---------------- 提示 / 弹层 ---------------- */
function toast(msg, ms = 2200) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, ms);
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}
function closeAllModals() {
  $$('.modal').forEach((m) => (m.hidden = true));
}

document.addEventListener('click', (e) => {
  const closer = e.target.closest('[data-close]');
  if (closer) {
    closeModal(closer.dataset.close);
    return;
  }
  if (e.target.classList && e.target.classList.contains('modal')) closeAllModals();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAllModals();
});

/* ---------------- 顶部渲染 ---------------- */
function activeFilterList() {
  const ui = snap().settings.ui;
  const chips = [];
  if (ui.status !== 'all') {
    chips.push({ key: 'status', label: { active: '未完成', done: '已完成', fav: '已收藏' }[ui.status] || ui.status });
  }
  if (ui.tags.length) chips.push({ key: 'tags', label: `标签：${ui.tags.join('、')}` });
  if (ui.dateFrom || ui.dateTo) chips.push({ key: 'date', label: `任务日期 ${ui.dateFrom || '…'} ~ ${ui.dateTo || '…'}` });
  if (ui.doneFrom || ui.doneTo) chips.push({ key: 'done', label: `完成时间 ${ui.doneFrom || '…'} ~ ${ui.doneTo || '…'}` });
  if (ui.createdFrom || ui.createdTo) {
    chips.push({ key: 'created', label: `创建时间 ${ui.createdFrom || '…'} ~ ${ui.createdTo || '…'}` });
  }
  return chips;
}

function clearFilter(key) {
  if (key === 'status') updateUi({ status: 'all' });
  if (key === 'tags') updateUi({ tags: [] });
  if (key === 'date') updateUi({ dateFrom: '', dateTo: '' });
  if (key === 'done') updateUi({ doneFrom: '', doneTo: '' });
  if (key === 'created') updateUi({ createdFrom: '', createdTo: '' });
}

function render() {
  const s = snap();
  const today = todayISO();
  const ui = s.settings.ui;
  const st = stats(s.tasks, today);
  const isFav = ui.view === 'fav';

  els.todayLine.textContent = `${fmtDate(today)} · 共 ${st.total} 条任务`;

  $$('#viewSeg button').forEach((b) => b.setAttribute('aria-selected', String(!isFav && b.dataset.view === ui.view)));
  els.btnFavorites.setAttribute('aria-pressed', String(isFav));
  els.weekNav.hidden = isFav || ui.view !== 'week';
  if (ui.view === 'week' && !isFav) {
    const range = weekRange(today, ui.weekOffset, s.settings.weekStart);
    els.weekLabel.textContent = weekLabel(range.start, range.end) + (ui.weekOffset === 0 ? '（本周）' : '');
  }

  els.sortKey.value = s.settings.sort.key;
  els.sortDir.textContent = s.settings.sort.dir === 'asc' ? '↑' : '↓';
  els.sortDir.setAttribute('aria-label', s.settings.sort.dir === 'asc' ? '升序，点击改为降序' : '降序，点击改为升序');

  if (document.activeElement !== els.search && els.search.value !== ui.q) els.search.value = ui.q;

  const chips = activeFilterList();
  els.filterCount.hidden = chips.length === 0;
  els.filterCount.textContent = String(chips.length);
  els.btnFilter.setAttribute('aria-pressed', String(chips.length > 0));
  els.activeFilters.innerHTML = '';
  for (const chip of chips) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'filter-chip';
    b.dataset.clear = chip.key;
    b.textContent = `${chip.label} ×`;
    b.title = '移除这个筛选条件';
    els.activeFilters.appendChild(b);
  }

  const visible = sortTasks(
    filterTasks(s.tasks, {
      ...ui,
      view: isFav ? 'all' : ui.view,
      status: isFav ? 'fav' : ui.status,
      weekStart: s.settings.weekStart,
      today,
    }),
    s.settings.sort,
  );
  els.statLine.textContent = isFav
    ? `已收藏 ${st.favorites} 条 · 点卡片展开困难与解决方式`
    : `未完成 ${st.active} · 今日 ${st.today} · 已完成 ${st.done} · 已收藏 ${st.favorites} · 当前显示 ${visible.length} 条`;
  renderList(visible, today);

  els.storageHint.textContent = isPersistent()
    ? '数据已保存在本机浏览器（localStorage）。'
    : '当前环境无法写入本地存储，刷新后数据会丢失（可能是隐私模式或 file:// 打开）。';
  els.storageHint.classList.toggle('warn', !isPersistent());

  renderBackupStatus();
  const saveErr = lastSaveError();
  els.saveErrorHint.hidden = !saveErr;
  els.saveErrorHint.textContent = saveErr ? `本地存储写入失败（${saveErr}），新改动可能没存下来。先导出一份完整备份。` : '';

  const perm = notifyPermission();
  els.notifyHint.textContent =
    perm === 'granted'
      ? '系统通知已授权。'
      : perm === 'denied'
        ? '系统通知已被拒绝，可在浏览器站点设置中重新开启。'
        : perm === 'unsupported'
          ? '当前浏览器不支持系统通知。'
          : '首次开启时会申请通知权限。';
}

/* ---------------- 日历（左下角按钮打开） ---------------- */
function currentCalendarMonth() {
  return snap().settings.ui.calendarMonth || monthStartOf(todayISO());
}

function renderCalendar() {
  const s = snap();
  const ui = s.settings.ui;
  const today = todayISO();
  const monthISO = currentCalendarMonth();
  const mode = ui.calendarMode;
  els.calMonthTitle.textContent = fmtMonth(monthISO);
  $$('#calMode button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.calMode === mode)));

  els.calWeekdays.innerHTML = '';
  for (const name of weekdayNames(s.settings.weekStart)) {
    const span = document.createElement('span');
    span.textContent = name;
    els.calWeekdays.appendChild(span);
  }

  els.calGrid.innerHTML = '';
  const cells = monthGrid(monthISO, s.settings.weekStart);
  const monthPrefix = monthISO.slice(0, 7);
  let monthCount = 0;

  for (const cell of cells) {
    const dayTasks = tasksOnDay(s.tasks, cell.iso, mode);
    if (cell.inMonth) monthCount += dayTasks.length;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-cell' + (cell.inMonth ? '' : ' out') + (dayTasks.length ? ' has' : '') + (cell.iso === today ? ' today' : '');
    btn.dataset.day = cell.iso;
    btn.title = dayTasks.length ? dayTasks.map((t) => t.content).join('\n') : fmtDate(cell.iso);

    if (cell.iso.slice(0, 7) !== monthPrefix) btn.tabIndex = -1;

    const num = document.createElement('span');
    num.className = 'cal-num';
    num.textContent = String(cell.day);
    btn.appendChild(num);

    const dots = document.createElement('span');
    dots.className = 'cal-dots';
    const shown = dayTasks.slice(0, 3);
    for (const task of shown) {
      const dot = document.createElement('i');
      dot.className = 'cal-dot';
      if (task.done) dot.style.opacity = '0.35';
      dot.style.background = task.tags.length ? tagColor(task.tags[0]) : 'var(--accent)';
      dots.appendChild(dot);
    }
    if (dayTasks.length > shown.length) {
      const more = document.createElement('span');
      more.className = 'cal-more';
      more.textContent = `+${dayTasks.length - shown.length}`;
      dots.appendChild(more);
    }
    btn.appendChild(dots);

    const spacer = document.createElement('span');
    btn.appendChild(spacer);
    els.calGrid.appendChild(btn);
  }

  els.calLegend.textContent = `${fmtMonth(monthISO)} 共 ${monthCount} 条${mode === 'due' ? '到期' : '开始'}任务 · 点某天查看当天任务`;
}

els.btnCalendar.addEventListener('click', () => {
  renderCalendar();
  openModal('calendarModal');
});

els.calPrev.addEventListener('click', () => {
  updateUi({ calendarMonth: addMonths(currentCalendarMonth(), -1) });
  renderCalendar();
});
els.calNext.addEventListener('click', () => {
  updateUi({ calendarMonth: addMonths(currentCalendarMonth(), 1) });
  renderCalendar();
});
els.calToday.addEventListener('click', () => {
  updateUi({ calendarMonth: monthStartOf(todayISO()) });
  renderCalendar();
});
els.calMode.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-cal-mode]');
  if (!btn) return;
  updateUi({ calendarMode: btn.dataset.calMode });
  renderCalendar();
});

els.calGrid.addEventListener('click', (e) => {
  const cell = e.target.closest('.cal-cell');
  if (cell) openDayModal(cell.dataset.day);
});

/* ---------------- 某一天 ---------------- */
function openDayModal(day) {
  dayModalDate = day;
  const s = snap();
  const mode = s.settings.ui.calendarMode;
  const tasks = sortTasks(tasksOnDay(s.tasks, day, mode), s.settings.sort);
  els.dayTitle.textContent = fmtDate(day);
  els.dayMeta.textContent = `${mode === 'due' ? '当天到期' : '当天开始'} ${tasks.length} 条 · 点任务可编辑`;
  els.dayList.innerHTML = '';
  if (!tasks.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    const strong = document.createElement('strong');
    strong.textContent = '这天没有任务';
    const p = document.createElement('p');
    p.textContent = '可以点下面「在这天新建」直接加一条。';
    li.append(strong, p);
    els.dayList.appendChild(li);
  } else {
    for (const task of tasks) els.dayList.appendChild(taskCard(task, todayISO(), { compact: true }));
  }
  openModal('dayModal');
}

$('#dayAdd').addEventListener('click', () => {
  closeModal('dayModal');
  openTaskModal(null, dayModalDate || todayISO());
});

/* ---------------- 列表 ---------------- */
function renderList(tasks, today) {
  els.list.innerHTML = '';
  if (!tasks.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    const strong = document.createElement('strong');
    strong.textContent = '这里还没有任务';
    const p = document.createElement('p');
    p.textContent = '点右下角 + 新建一条；也可以先用「筛选」把范围缩小。';
    li.append(strong, p);
    // 本地一条任务都没有时，给「从备份恢复」入口。不能看「备份过」的标记——
    // 那个标记和任务存在同一个 localStorage 里，清站点数据时一起没了。
    if (snap().tasks.length === 0) li.appendChild(emptyRestoreButton());
    els.list.appendChild(li);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const t of tasks) frag.appendChild(taskCard(t, today));
  els.list.appendChild(frag);
}

function taskCard(t, today, options = {}) {
  const compact = !!options.compact;
  const li = document.createElement('li');
  li.className = 'card' + (t.done ? ' done' : '') + (t.favorite ? ' fav' : '');
  li.dataset.id = t.id;
  li.tabIndex = 0;

  const main = document.createElement('div');
  main.className = 'card-main';

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'check';
  check.dataset.act = 'toggle';
  check.setAttribute('aria-pressed', String(t.done));
  check.setAttribute('aria-label', t.done ? '取消完成' : '标记完成');
  if (t.done) check.innerHTML = CHECK_SVG;
  main.appendChild(check);

  const body = document.createElement('div');
  body.className = 'card-body';

  const title = document.createElement('p');
  title.className = 'card-content';
  title.textContent = t.content;
  body.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const dateSpan = document.createElement('span');
  dateSpan.textContent = `开始 ${fmtDate(t.date)}`;
  meta.appendChild(dateSpan);

  if (t.planAt) {
    const badge = document.createElement('span');
    badge.className = 'badge due';
    badge.textContent = `计划 ${fmtDateTime(t.planAt)} · ${relToPlan(t.planAt)}`;
    meta.appendChild(badge);
  }

  if (t.seriesId && t.seriesDate) {
    const seriesBadge = document.createElement('span');
    seriesBadge.className = 'badge series';
    seriesBadge.textContent = `↻ 周期 ${fmtShort(t.seriesDate)}`;
    seriesBadge.title = '由周期任务生成';
    meta.appendChild(seriesBadge);
  }
  for (const tag of t.tags) {
    const chip = document.createElement('span');
    chip.className = 'tag';
    chip.style.setProperty('--tag-color', tagColor(tag));
    chip.textContent = tag;
    meta.appendChild(chip);
  }
  body.appendChild(meta);

  if (t.done && t.doneAt) {
    const doneAt = document.createElement('div');
    doneAt.className = 'meta';
    doneAt.textContent = `完成于 ${fmtDateTime(t.doneAt)}`;
    body.appendChild(doneAt);
  }

  const hasNote = !!t.note;
  const hasReview = !!(t.review.difficulty || t.review.solution);
  if (hasNote || hasReview) {
    const expanded = expandedIds.has(t.id);
    const box = document.createElement('div');
    box.className = 'collapse' + (expanded ? ' open' : '');

    const head = document.createElement('div');
    head.className = 'collapse-head';
    head.dataset.act = 'expand';
    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = '›';
    const headLabel = document.createElement('span');
    headLabel.textContent = hasNote ? '注意事项' : '收藏回顾';
    head.append(chev, headLabel);
    box.appendChild(head);

    const detailBody = document.createElement('div');
    detailBody.className = 'collapse-body';
    const addDetail = (label, text) => {
      if (!text) return;
      const lab = document.createElement('p');
      lab.className = 'detail-label';
      lab.textContent = label;
      const val = document.createElement('p');
      val.className = 'detail-text';
      val.textContent = text;
      detailBody.append(lab, val);
    };
    addDetail('注意事项', t.note);
    if (t.favorite) {
      addDetail('困难', t.review.difficulty);
      addDetail('解决方式', t.review.solution);
    }
    box.appendChild(detailBody);
    body.appendChild(box);
  }

  main.appendChild(body);
  li.appendChild(main);

  if (!compact) {
    const actions = document.createElement('div');
    actions.className = 'card-actions';

    if (t.done) {
      const fav = document.createElement('button');
      fav.type = 'button';
      fav.className = 'act';
      fav.dataset.act = 'favorite';
      fav.setAttribute('aria-pressed', String(t.favorite));
      fav.textContent = t.favorite ? '已收藏' : '收藏';
      actions.appendChild(fav);

      const when = document.createElement('button');
      when.type = 'button';
      when.className = 'act';
      when.dataset.act = 'doneAt';
      when.textContent = '完成时间';
      actions.appendChild(when);
    }

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'act';
    edit.dataset.act = 'edit';
    edit.textContent = '编辑';
    actions.appendChild(edit);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'act' + (pendingDeleteId === t.id ? ' danger-on' : '');
    del.dataset.act = 'delete';
    del.textContent = pendingDeleteId === t.id ? '确认删除' : '删除';
    actions.appendChild(del);

    li.appendChild(actions);
  }

  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === li) openTaskModal(t.id);
  });

  return li;
}

function handleCardClick(e, scope) {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  const task = snap().tasks.find((t) => t.id === id);
  if (!task) return;
  const act = e.target.closest('[data-act]');

  if (!act) {
    if (scope === 'day') {
      closeModal('dayModal');
      openTaskModal(id);
      return;
    }
    toggleExpanded(id);
    return;
  }

  switch (act.dataset.act) {
    case 'expand':
      if (scope === 'day') {
        closeModal('dayModal');
        openTaskModal(id);
      } else {
        toggleExpanded(id);
      }
      break;
    case 'toggle': {
      if (task.done) {
        toggleDone(id);
        toast('已恢复为未完成');
      } else {
        openCompleteModal(id, 'complete');
      }
      break;
    }
    case 'favorite': {
      const next = setFavorite(id, !task.favorite);
      if (next && next.favorite) {
        toast('已收藏，可在这里补充困难与解决方式');
        openTaskModal(id);
      }
      break;
    }
    case 'doneAt':
      openCompleteModal(id, 'edit');
      break;
    case 'edit':
      if (scope === 'day') closeModal('dayModal');
      openTaskModal(id);
      break;
    case 'delete': {
      if (pendingDeleteId === id) {
        pendingDeleteId = null;
        clearTimeout(deleteTimer);
        removeTask(id);
        toast('已删除');
      } else {
        pendingDeleteId = id;
        clearTimeout(deleteTimer);
        deleteTimer = setTimeout(() => {
          pendingDeleteId = null;
          render();
        }, 4000);
        render();
      }
      break;
    }
  }
}

els.list.addEventListener('click', (e) => handleCardClick(e, 'list'));
els.dayList.addEventListener('click', (e) => handleCardClick(e, 'day'));

function toggleExpanded(id) {
  if (expandedIds.has(id)) expandedIds.delete(id);
  else expandedIds.add(id);
  render();
}

/* ---------------- 视图 / 搜索 / 排序 ---------------- */
els.viewSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  updateUi({ view: btn.dataset.view, weekOffset: 0 });
});

els.btnFavorites.addEventListener('click', () => {
  const ui = snap().settings.ui;
  updateUi({ view: ui.view === 'fav' ? 'all' : 'fav', weekOffset: 0 });
});

els.weekPrev.addEventListener('click', () => updateUi({ weekOffset: snap().settings.ui.weekOffset - 1 }));
els.weekNext.addEventListener('click', () => updateUi({ weekOffset: snap().settings.ui.weekOffset + 1 }));

els.sortKey.addEventListener('change', () => {
  updateSettings({ sort: { key: els.sortKey.value, dir: snap().settings.sort.dir } });
});
els.sortDir.addEventListener('click', () => {
  const dir = snap().settings.sort.dir === 'asc' ? 'desc' : 'asc';
  updateSettings({ sort: { key: snap().settings.sort.key, dir } });
});

els.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => updateUi({ q: els.search.value }), 120);
});

els.activeFilters.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-clear]');
  if (chip) clearFilter(chip.dataset.clear);
});

els.btnFilter.addEventListener('click', () => {
  syncFilterForm();
  renderFilterTags();
  openModal('filterModal');
});

/* ---------------- 标签选择器（任务表单 / 筛选） ---------------- */
function renderTagPicker(container, selected, onToggle) {
  const s = snap();
  container.innerHTML = '';
  for (const entry of s.tagLibrary) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pick';
    btn.dataset.tag = entry.name;
    btn.setAttribute('aria-pressed', String(selected.includes(entry.name)));
    btn.style.setProperty('--tag-color', entry.color);

    const dot = document.createElement('i');
    dot.className = 'dot';
    btn.appendChild(dot);

    const label = document.createElement('span');
    label.textContent = entry.name;
    btn.appendChild(label);

    btn.addEventListener('click', () => onToggle(entry.name));
    container.appendChild(btn);
  }
}

function renderTaskTagPicker() {
  renderTagPicker(els.taskTagPicker, selectedTags, (name) => {
    selectedTags = selectedTags.includes(name) ? selectedTags.filter((x) => x !== name) : [...selectedTags, name];
    renderTaskTagPicker();
  });
}

function renderFilterTags() {
  renderTagPicker(els.filterTags, snap().settings.ui.tags, (name) => {
    const current = snap().settings.ui.tags;
    const next = current.includes(name) ? current.filter((x) => x !== name) : [...current, name];
    updateUi({ tags: next });
    renderFilterTags();
  });
  els.filterTagEmpty.hidden = snap().tagLibrary.length > 0;
}

/* ---------------- 任务表单 ---------------- */
els.fab.addEventListener('click', () => openTaskModal(null));

function openTaskModal(id, presetDate) {
  const s = snap();
  const task = id ? s.tasks.find((t) => t.id === id) : null;
  editingTaskId = task ? task.id : null;
  els.taskTitle.textContent = task ? '编辑任务' : '新建任务';
  els.taskContent.value = task ? task.content : '';
  els.taskDate.value = task ? task.date : presetDate || todayISO();
  els.taskPlanAt.value = task && task.planAt ? datetimeLocalValue(task.planAt) : '';
  els.taskTagInput.value = '';
  els.taskNote.value = task ? task.note : '';
  els.taskDifficulty.value = task ? task.review.difficulty : '';
  els.taskSolution.value = task ? task.review.solution : '';
  // 只有已收藏的任务才展示困难 / 解决方式
  els.taskReviewFields.hidden = !(task && task.favorite);
  selectedTags = task ? [...task.tags] : [];
  renderTaskTagPicker();
  openModal('taskModal');
  setTimeout(() => els.taskContent.focus(), 30);
}

function commitTagInput() {
  const raw = els.taskTagInput.value.trim();
  if (!raw) return;
  for (const name of raw.split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean)) {
    addTag(name);
    if (!selectedTags.includes(name)) selectedTags.push(name);
  }
  els.taskTagInput.value = '';
  renderTaskTagPicker();
}

els.taskTagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
    e.preventDefault();
    commitTagInput();
    toast('标签已加入标签库');
  }
});

els.taskForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const content = els.taskContent.value.trim();
  if (!content) {
    toast('请填写任务内容');
    return;
  }
  commitTagInput();
  const planRaw = els.taskPlanAt.value.trim();
  const planAt = planRaw ? tsFromDatetimeLocal(planRaw, null) : null;
  const date = els.taskDate.value || todayISO();
  const tags = [...selectedTags];
  const note = els.taskNote.value.trim();

  if (editingTaskId) {
    const target = snap().tasks.find((t) => t.id === editingTaskId);
    const patch = { content, date, planAt, tags, note };
    if (target && target.favorite) {
      patch.review = {
        difficulty: els.taskDifficulty.value.trim(),
        solution: els.taskSolution.value.trim(),
      };
    }
    updateTask(editingTaskId, patch);
    toast('已保存');
  } else {
    addTask({ content, date, planAt, tags, note });
    toast('已添加');
  }
  closeModal('taskModal');
});

/* ---------------- 完成时间 ---------------- */
function openCompleteModal(id, mode) {
  const task = snap().tasks.find((t) => t.id === id);
  if (!task) return;
  completingTaskId = id;
  completingMode = mode;
  const title = document.querySelector('#completeModal .sheet-head h2');
  if (title) title.textContent = mode === 'edit' ? '修改完成时间' : '标记完成';
  els.completeTaskName.textContent = task.content;
  els.completeAt.value = datetimeLocalValue(mode === 'edit' && task.doneAt ? task.doneAt : Date.now());
  document.querySelector('#completeModal .btn.primary').textContent = mode === 'edit' ? '保存' : '完成';
  openModal('completeModal');
}

function submitComplete(ts) {
  if (!completingTaskId) return;
  if (completingMode === 'edit') setDoneAt(completingTaskId, ts);
  else toggleDone(completingTaskId, ts);
  completingTaskId = null;
  closeModal('completeModal');
  toast(completingMode === 'edit' ? '完成时间已更新' : '已完成，可在「已完成」里回顾');
}

$('#completeNow').addEventListener('click', () => submitComplete(Date.now()));
$('#completeSave').addEventListener('click', () => submitComplete(tsFromDatetimeLocal(els.completeAt.value)));
$('#completeCancel').addEventListener('click', () => {
  completingTaskId = null;
  closeModal('completeModal');
});

/* ---------------- 标签库管理 ---------------- */
function usageCount(name) {
  return snap().tasks.filter((t) => t.tags.includes(name)).length;
}

function renderTagList() {
  const s = snap();
  els.tagList.innerHTML = '';
  if (!s.tagLibrary.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '还没有标签，下面输入一个试试。';
    els.tagList.appendChild(li);
    return;
  }
  s.tagLibrary.forEach((entry, index) => {
    const li = document.createElement('li');
    li.className = 'tag-row';
    li.dataset.tagRow = '1';
    li.dataset.index = String(index);
    li.dataset.name = entry.name;

    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.dataset.drag = '1';
    grip.dataset.index = String(index);
    grip.textContent = '⠿';
    grip.setAttribute('role', 'button');
    grip.setAttribute('aria-label', `拖动排序：${entry.name}`);
    grip.tabIndex = 0;

    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'swatch';
    swatch.dataset.color = entry.name;
    swatch.style.background = entry.color;
    swatch.setAttribute('aria-label', `颜色：${entry.name}`);

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = entry.name;

    const used = document.createElement('span');
    used.className = 'used';
    used.textContent = `${usageCount(entry.name)} 条`;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.dataset.del = entry.name;
    del.textContent = pendingTagDelete === entry.name ? '确认删除' : '删除';

    li.append(grip, swatch, name, used, del);

    // 调色板始终在 DOM 里，只切换 hidden，避免状态与 DOM 不同步
    const palette = document.createElement('div');
    palette.className = 'palette';
    palette.dataset.paletteFor = entry.name;
    palette.hidden = paletteOpenFor !== entry.name;
    for (const color of TAG_COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = color;
      b.dataset.setColor = entry.name;
      b.dataset.colorValue = color;
      b.setAttribute('aria-pressed', String(color === entry.color));
      b.setAttribute('aria-label', `设为 ${color}`);
      palette.appendChild(b);
    }
    li.appendChild(palette);

    els.tagList.appendChild(li);
  });
}

function openTagModal() {
  paletteOpenFor = null;
  pendingTagDelete = null;
  renderTagList();
  openModal('tagModal');
}

$('#btnTagManager').addEventListener('click', () => {
  closeModal('settingsModal');
  openTagModal();
});

els.tagList.addEventListener('click', (e) => {
  const colorBtn = e.target.closest('[data-set-color]');
  if (colorBtn) {
    setTagColor(colorBtn.dataset.setColor, colorBtn.dataset.colorValue);
    paletteOpenFor = null;
    renderTagList();
    return;
  }
  const swatch = e.target.closest('[data-color]');
  if (swatch) {
    paletteOpenFor = paletteOpenFor === swatch.dataset.color ? null : swatch.dataset.color;
    renderTagList();
    return;
  }
  const del = e.target.closest('[data-del]');
  if (del) {
    const name = del.dataset.del;
    if (pendingTagDelete === name) {
      pendingTagDelete = null;
      clearTimeout(tagDeleteTimer);
      removeTag(name);
      renderTagList();
      renderTaskTagPicker();
      toast(`已删除标签「${name}」`);
    } else {
      pendingTagDelete = name;
      clearTimeout(tagDeleteTimer);
      tagDeleteTimer = setTimeout(() => {
        pendingTagDelete = null;
        renderTagList();
      }, 4000);
      renderTagList();
    }
  }
});

// 按住手柄拖动排序（pointer 事件，触屏可用）
els.tagList.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest('[data-drag]');
  if (!grip) return;
  e.preventDefault();
  const rows = Array.from(els.tagList.querySelectorAll('[data-tag-row]'));
  const from = Number(grip.dataset.index);
  rows[from].classList.add('dragging');
  let target = from;

  const move = (ev) => {
    let index = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return ev.clientY < rect.top + rect.height / 2;
    });
    if (index === -1) index = rows.length - 1;
    target = index;
    rows.forEach((row, i) => row.classList.toggle('drag-over', i === target && i !== from));
  };

  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    rows.forEach((row) => row.classList.remove('dragging', 'drag-over'));
    if (target !== from) {
      moveTag(from, target);
      renderTagList();
      toast('标签顺序已保存');
    }
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

els.tagAddForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = els.tagNewName.value.trim();
  if (!name) return;
  const entry = addTag(name);
  els.tagNewName.value = '';
  paletteOpenFor = entry ? entry.name : null;
  renderTagList();
  renderTaskTagPicker();
  toast(`已添加标签「${name}」`);
});

/* ---------------- 周期任务（设置内管理） ---------------- */
function openSeriesManager() {
  editingSeriesId = null;
  pendingSeriesDelete = null;
  renderSeriesList();
  openModal('seriesModal');
}

function seriesNextLabel(series) {
  const days = diffDays(todayISO(), series.nextDate);
  if (days > 0) return `下次生成 ${fmtDate(series.nextDate)}（${days} 天后）`;
  if (days === 0) return `下次生成 ${fmtDate(series.nextDate)}（今天）`;
  return `待生成 ${fmtDate(series.nextDate)}（已过 ${-days} 天）`;
}

function renderSeriesList() {
  const s = snap();
  els.seriesList.innerHTML = '';
  els.seriesEmpty.hidden = s.series.length > 0;
  if (!s.series.length) return;

  for (const series of s.series) {
    const li = document.createElement('li');
    li.className = 'series-card' + (series.active ? '' : ' paused');
    li.dataset.seriesId = series.id;

    const title = document.createElement('div');
    title.className = 'series-title';
    const name = document.createElement('span');
    name.textContent = series.content;
    const state = document.createElement('span');
    state.className = 'series-state' + (series.active ? '' : ' off');
    state.textContent = series.active ? '启用' : '已暂停';
    title.append(name, state);

    const meta = document.createElement('div');
    meta.className = 'series-meta';
    const rule = document.createElement('span');
    rule.textContent = describeRule(series.rule);
    const next = document.createElement('span');
    next.textContent = seriesNextLabel(series);
    const count = document.createElement('span');
    count.textContent = `已生成 ${occurrencesOf(series.id).length} 期`;
    meta.append(rule, next, count);

    const actions = document.createElement('div');
    actions.className = 'series-actions';
    const mk = (act, label, cls = 'act') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.dataset.seriesAct = act;
      b.dataset.seriesId = series.id;
      b.textContent = label;
      return b;
    };
    const futureCount = occurrencesOf(series.id).filter((t) => t.seriesDate > todayISO()).length;
    const withdrawBtn = mk('withdraw', futureCount ? `撤回未来 ${futureCount} 期` : '撤回未来期次');
    withdrawBtn.disabled = futureCount === 0;
    if (!futureCount) withdrawBtn.title = '没有今天以后的期次';

    actions.append(
      mk('trigger', '手动触发'),
      mk('toggle', series.active ? '暂停' : '启用'),
      withdrawBtn,
      mk('edit', '编辑'),
      mk('delete', pendingSeriesDelete === series.id ? '确认删除' : '删除', 'act' + (pendingSeriesDelete === series.id ? ' danger-on' : '')),
    );

    li.append(title, meta, actions);
    els.seriesList.appendChild(li);
  }
}

els.btnSeriesManager.addEventListener('click', () => {
  closeModal('settingsModal');
  openSeriesManager();
});
els.btnNewSeries.addEventListener('click', () => openSeriesForm(null));

els.seriesList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-series-act]');
  if (!btn) return;
  const id = btn.dataset.seriesId;
  const series = snap().series.find((s) => s.id === id);
  if (!series) return;

  switch (btn.dataset.seriesAct) {
    case 'trigger': {
      const res = triggerSeries(id);
      if (res.ok) toast(`已生成 ${fmtDate(res.date)} 这一期`);
      renderSeriesList();
      break;
    }
    case 'toggle': {
      const next = toggleSeries(id);
      if (next) toast(next.active ? '已启用，会自动生成' : '已暂停，不再自动生成');
      renderSeriesList();
      break;
    }
    case 'withdraw': {
      const res = withdrawSeries(id);
      toast(res.ok ? `已撤回 ${res.removed} 期，下次生成 ${fmtDate(res.nextDate)}` : res.reason);
      renderSeriesList();
      break;
    }
    case 'edit':
      openSeriesForm(id);
      break;
    case 'delete': {
      if (pendingSeriesDelete === id) {
        pendingSeriesDelete = null;
        clearTimeout(seriesDeleteTimer);
        removeSeries(id);
        renderSeriesList();
        toast('已删除周期任务（已生成的待办保留）');
      } else {
        pendingSeriesDelete = id;
        clearTimeout(seriesDeleteTimer);
        seriesDeleteTimer = setTimeout(() => {
          pendingSeriesDelete = null;
          renderSeriesList();
        }, 4000);
        renderSeriesList();
      }
      break;
    }
  }
});

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

function applyRuleVisibility() {
  const type = els.seriesRuleType.value;
  els.ruleEveryDays.hidden = type !== 'everyDays';
  els.ruleWeekly.hidden = type !== 'weekly';
  els.ruleMonthly.hidden = type !== 'monthly';
  els.ruleYearly.hidden = type !== 'yearly';
}

const WEEKDAY_TEXT = '日一二三四五六';

function renderSeriesWeekdays() {
  els.seriesWeekdays.innerHTML = '';
  for (let d = 0; d < 7; d++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.weekday = String(d);
    btn.textContent = `周${WEEKDAY_TEXT[d]}`;
    btn.setAttribute('aria-pressed', String(seriesWeekdays.includes(d)));
    els.seriesWeekdays.appendChild(btn);
  }
}

els.seriesWeekdays.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-weekday]');
  if (!btn) return;
  const day = Number(btn.dataset.weekday);
  seriesWeekdays = seriesWeekdays.includes(day) ? seriesWeekdays.filter((x) => x !== day) : [...seriesWeekdays, day];
  renderSeriesWeekdays();
});

els.seriesRuleType.addEventListener('change', applyRuleVisibility);

function renderSeriesTagPicker() {
  renderTagPicker(els.seriesTagPicker, seriesTags, (name) => {
    seriesTags = seriesTags.includes(name) ? seriesTags.filter((x) => x !== name) : [...seriesTags, name];
    renderSeriesTagPicker();
  });
}

function commitSeriesTagInput() {
  const raw = els.seriesTagInput.value.trim();
  if (!raw) return;
  for (const name of raw.split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean)) {
    addTag(name);
    if (!seriesTags.includes(name)) seriesTags.push(name);
  }
  els.seriesTagInput.value = '';
  renderSeriesTagPicker();
}

els.seriesTagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
    e.preventDefault();
    commitSeriesTagInput();
  }
});

function openSeriesForm(id) {
  const series = id ? snap().series.find((s) => s.id === id) : null;
  editingSeriesId = series ? series.id : null;
  els.seriesFormTitle.textContent = series ? '编辑周期任务' : '新建周期任务';
  els.seriesContent.value = series ? series.content : '';
  els.seriesAnchor.value = series ? series.anchor : todayISO();
  els.seriesPlanTime.value = series ? series.planTime : '';
  els.seriesRuleType.value = series ? series.rule.type : 'everyDays';
  els.seriesInterval.value = String(series ? series.rule.interval : 1);
  els.seriesMonthDay.value = String(series ? series.rule.monthDay : 1);
  els.seriesMonth.value = String(series ? series.rule.month : 1);
  els.seriesDay.value = String(series ? series.rule.day : 1);
  els.seriesNote.value = series ? series.note : '';
  els.seriesTagInput.value = '';
  seriesTags = series ? [...series.tags] : [];
  seriesWeekdays = series ? [...series.rule.weekdays] : [];
  renderSeriesWeekdays();
  renderSeriesTagPicker();
  applyRuleVisibility();
  openModal('seriesFormModal');
  setTimeout(() => els.seriesContent.focus(), 30);
}

els.seriesForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const content = els.seriesContent.value.trim();
  if (!content) {
    toast('请填写任务内容');
    return;
  }
  const type = els.seriesRuleType.value;
  if (type === 'weekly' && !seriesWeekdays.length) {
    toast('每周规则至少要选一天');
    return;
  }
  commitSeriesTagInput();
  const payload = {
    content,
    anchor: els.seriesAnchor.value || todayISO(),
    planTime: els.seriesPlanTime.value || '',
    note: els.seriesNote.value.trim(),
    tags: [...seriesTags],
    rule: {
      type,
      interval: clampInt(els.seriesInterval.value, 1, 365, 1),
      weekdays: [...seriesWeekdays].sort((a, b) => a - b),
      monthDay: clampInt(els.seriesMonthDay.value, 1, 31, 1),
      month: clampInt(els.seriesMonth.value, 1, 12, 1),
      day: clampInt(els.seriesDay.value, 1, 31, 1),
    },
  };
  if (editingSeriesId) {
    const next = updateSeries(editingSeriesId, payload);
    toast(next ? `已保存，下次生成 ${fmtDate(next.nextDate)}` : '保存失败');
  } else {
    const res = addSeries(payload);
    toast(res.created ? `已创建，并生成 ${res.created} 期待办` : '已创建周期任务');
  }
  closeModal('seriesFormModal');
  renderSeriesList();
  render();
});

function tickSeries() {
  const { created, remaining } = seriesTick();
  if (created) {
    toast(remaining ? `已生成 ${created} 期待办，还有 ${remaining} 个周期待生成` : `已生成 ${created} 期待办`);
  }
}

/* ---------------- 筛选 ---------------- */
const STATUS_VALUES = ['all', 'active', 'done', 'fav'];

function syncFilterForm() {
  const ui = snap().settings.ui;
  for (const el of $$('[data-ui]')) {
    const key = el.dataset.ui;
    el.value = ui[key] ?? '';
  }
  const statusSelect = document.querySelector('[data-ui="status"]');
  if (statusSelect && !STATUS_VALUES.includes(ui.status)) statusSelect.value = 'all';
}

$$('[data-ui]').forEach((el) => {
  el.addEventListener('change', () => {
    const key = el.dataset.ui;
    updateUi({ [key]: el.value });
  });
});

$$('[data-preset]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const today = todayISO();
    const week = weekRange(today, 0, snap().settings.weekStart);
    const month = today.slice(0, 7);
    const preset = btn.dataset.preset;
    if (preset === 'doneToday') updateUi({ doneFrom: today, doneTo: today });
    if (preset === 'doneWeek') updateUi({ doneFrom: week.start, doneTo: week.end });
    if (preset === 'doneMonth') updateUi({ doneFrom: `${month}-01`, doneTo: `${month}-31` });
    syncFilterForm();
  });
});

$('#filterReset').addEventListener('click', () => {
  resetFilters();
  syncFilterForm();
  render();
});

/* ---------------- 设置 ---------------- */
function setPath(path, value) {
  const parts = path.split('.');
  const out = {};
  let cursor = out;
  for (let i = 0; i < parts.length - 1; i++) {
    cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
  return out;
}

function syncSettingsForm() {
  const s = snap().settings;
  const values = {
    'remind.sound': s.remind.sound,
    'remind.vibrate': s.remind.vibrate,
    'remind.notification': s.remind.notification,
    'remind.thresholdHours': String(s.remind.thresholdHours),
    'remind.interval': s.remind.interval,
    'remind.maxPerDay': String(s.remind.maxPerDay),
    weekStart: String(s.weekStart),
    theme: s.theme,
    'backup.enabled': s.backup.enabled,
    'backup.keep': String(s.backup.keep),
  };
  for (const el of $$('[data-set]')) {
    const key = el.dataset.set;
    if (!(key in values)) continue;
    if (el.type === 'checkbox') el.checked = !!values[key];
    else el.value = values[key];
  }
}

$$('[data-set]').forEach((el) => {
  el.addEventListener('change', async () => {
    const key = el.dataset.set;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (key === 'backup.keep') value = Math.max(1, Math.min(20, Math.round(Number(el.value)) || 3));
    else if (el.type === 'number') value = Math.max(1, Math.min(10, Number(el.value) || 1));
    else if (key === 'weekStart') value = Number(el.value);
    else if (key === 'remind.thresholdHours' || key === 'remind.maxPerDay') value = Number(el.value);
    else value = el.value;

    if (key === 'remind.notification' && value) {
      const perm = await requestNotifyPermission();
      if (perm !== 'granted') {
        value = false;
        el.checked = false;
        toast(perm === 'denied' ? '通知权限被拒绝，已改用应用内弹窗' : '当前环境不支持系统通知');
      }
    }
    updateSettings(setPath(key, value));
    if (key === 'theme') applyTheme();
    if (key === 'backup.keep') {
      el.value = String(value);
      await pruneBackup();
      renderBackupStatus();
    }
    if (key === 'backup.enabled') {
      el.checked = !!value;
      renderBackupStatus();
      if (value) scheduleBackup();
    }
  });
});

$('#btnSettings').addEventListener('click', () => {
  syncSettingsForm();
  openModal('settingsModal');
});

let clearArmed = false;
$('#btnClear').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  if (!clearArmed) {
    clearArmed = true;
    btn.textContent = '再点一次确认清空';
    setTimeout(() => {
      clearArmed = false;
      btn.textContent = '清空全部数据';
    }, 4000);
    return;
  }
  clearArmed = false;
  btn.textContent = '清空全部数据';
  clearAll();
  closeModal('settingsModal');
  toast('已清空');
});

/* ---------------- 导出（只在设置里） ---------------- */
const EXPORT_HEADERS = ['序号', '任务内容', '开始日', '计划完成时间', '标签', '状态', '完成时间', '收藏', '周期', '注意事项', '困难', '解决方式'];

function seriesRuleText(task) {
  if (!task.seriesId) return '';
  const series = snap().series.find((s) => s.id === task.seriesId);
  return series ? describeRule(series.rule) : '周期';
}

function exportRows(tasks) {
  return tasks.map((t, i) => [
    i + 1,
    t.content,
    t.date,
    t.planAt ? fmtFull(t.planAt) : '',
    (t.tags || []).join('、'),
    t.done ? '已完成' : '未完成',
    t.doneAt ? fmtDateTime(t.doneAt) : '',
    t.favorite ? '是' : '',
    seriesRuleText(t),
    t.note,
    t.review.difficulty,
    t.review.solution,
  ]);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportExcel() {
  const tasks = snap().tasks.slice();
  if (!tasks.length) {
    toast('没有可导出的任务');
    return;
  }
  const bytes = buildXlsx({ sheetName: '待办清单', headers: EXPORT_HEADERS, rows: exportRows(tasks) });
  download(xlsxBlob(bytes), `todo-${stamp()}.xlsx`);
  toast(`已导出 ${tasks.length} 条任务（Excel）`);
}

function exportCsv() {
  const tasks = snap().tasks.slice();
  if (!tasks.length) {
    toast('没有可导出的任务');
    return;
  }
  const rows = [EXPORT_HEADERS, ...exportRows(tasks)];
  const csv = rows
    .map((r) =>
      r
        .map((v) => {
          const str = String(v ?? '');
          return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
        })
        .join(','),
    )
    .join('\r\n');
  download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `todo-${stamp()}.csv`);
  toast(`已导出 ${tasks.length} 条任务（CSV）`);
}

$('#btnExportXlsx').addEventListener('click', exportExcel);
$('#btnExportCsv').addEventListener('click', exportCsv);

/* ---------------- 备份：文件夹自动备份 / 恢复 ---------------- */
let restoreFiles = [];
let restoreArmed = null;
let restoreArmTimer = null;

function backupErrorMessage(err) {
  if (err && (err.name === 'AbortError' || err.code === 'CANCELLED')) return '';
  return (err && err.message) || '操作失败';
}

function renderBackupStatus() {
  const st = backupStatus();
  const parts = [];
  if (!st.supported) {
    parts.push('当前浏览器不支持「选择文件夹」自动备份（需要 Chrome 132+ 或桌面版），已降级为「导出完整备份 / 从文件恢复」');
  } else if (!st.hasHandle) {
    parts.push('还没选备份文件夹：选一个之后，每次改动 5 秒内会写一份快照进去');
  } else if (st.permission !== 'granted') {
    parts.push(`备份文件夹「${st.dirName}」需要点一下「立即备份」重新确认权限`);
  } else if (!st.enabled) {
    parts.push(`备份文件夹「${st.dirName}」（自动备份已关闭）`);
  } else {
    parts.push(`备份文件夹「${st.dirName}」`);
  }
  if (st.hasHandle && st.lastBackupAt) parts.push(`最近备份 ${fmtDateTime(st.lastBackupAt)}`);
  parts.push(`保留 ${st.keep} 份`);
  els.backupStatus.textContent = parts.join(' · ');
  els.backupStatus.classList.toggle('warn', st.hasHandle && st.permission !== 'granted');
  els.btnChooseBackupDir.hidden = !st.supported;
  els.btnRestoreDir.hidden = !st.supported;
  els.btnExportBackup.hidden = st.supported;
}

// 空列表里的入口：不依赖任何本地标记（标记本身也会被清掉）
function emptyRestoreButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'btnEmptyRestore';
  btn.className = 'btn ghost restore-cta';
  btn.textContent = backupSupport().supported ? '从备份恢复' : '从备份文件恢复';
  btn.addEventListener('click', () => {
    void oneTapRestore();
  });
  return btn;
}

async function oneTapRestore() {
  if (!backupSupport().supported) {
    pickBackupFile();
    return;
  }
  try {
    await chooseBackupDir();
    const res = await restoreBackupLatest();
    toast(
      `已从备份恢复 ${res.taskCount} 条任务${res.exportedAt ? `（备份于 ${fmtDateTime(res.exportedAt)}）` : ''}`,
      4200,
    );
    syncSettingsForm();
    render();
  } catch (err) {
    const msg = backupErrorMessage(err);
    if (!msg) return;
    toast(msg, 3600);
    renderBackupStatus();
  }
}

function pickBackupFile() {
  els.restoreBackupInput.value = '';
  els.restoreBackupInput.click();
}

function renderRestoreRows() {
  els.restoreMeta.textContent = restoreFiles.length
    ? `文件夹「${backupStatus().dirName}」里有 ${restoreFiles.length} 个文件，点一份覆盖当前数据。`
    : '';
  els.restoreEmpty.hidden = restoreFiles.length > 0;
  els.restoreList.innerHTML = '';
  for (const file of restoreFiles) {
    const li = document.createElement('li');
    li.className = 'backup-row' + (restoreArmed === file.name ? ' armed' : '');
    li.tabIndex = 0;
    li.dataset.name = file.name;

    const head = document.createElement('p');
    head.className = 'backup-row-head';
    head.textContent = restoreArmed === file.name ? '再点一次，覆盖当前数据' : fmtDateTime(file.ts);

    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = `${file.kind === 'backup' ? '备份' : '恢复前快照'} · ${humanSize(file.size)} · ${file.name}`;

    li.append(head, meta);
    li.addEventListener('click', () => onRestoreRowClick(file));
    els.restoreList.appendChild(li);
  }
}

function onRestoreRowClick(file) {
  // 本地空数据时没有东西可覆盖，一次点击就恢复
  if (snap().tasks.length === 0) {
    void doRestore(file);
    return;
  }
  if (restoreArmed === file.name) {
    restoreArmed = null;
    void doRestore(file);
    return;
  }
  restoreArmed = file.name;
  renderRestoreRows();
  clearTimeout(restoreArmTimer);
  restoreArmTimer = setTimeout(() => {
    restoreArmed = null;
    renderRestoreRows();
  }, 5000);
}

async function doRestore(file) {
  try {
    const res = await restoreBackupByName(file.name);
    closeModal('restoreModal');
    restoreArmed = null;
    syncSettingsForm();
    render();
    toast(`已恢复 ${res.taskCount} 条任务、${res.seriesCount} 个周期、${res.tagCount} 个标签`, 4200);
  } catch (err) {
    toast(backupErrorMessage(err) || '恢复失败', 3600);
    renderRestoreRows();
  }
}

async function openRestoreModal() {
  restoreArmed = null;
  restoreFiles = await listBackupFiles();
  renderRestoreRows();
  openModal('restoreModal');
}

els.btnChooseBackupDir.addEventListener('click', async () => {
  try {
    await chooseBackupDir();
    const res = await backupNowRun();
    syncSettingsForm();
    renderBackupStatus();
    if (res.ok) toast(`已备份到「${backupStatus().dirName}」`);
    else if (res.message) toast(res.message, 3600);
  } catch (err) {
    const msg = backupErrorMessage(err);
    if (msg) toast(msg, 3600);
    renderBackupStatus();
  }
});

els.btnBackupNow.addEventListener('click', async () => {
  let res = await backupNowRun();
  if (!res.ok && res.code === 'NO_PERM') {
    const perm = await requestBackupAccess();
    if (perm === 'granted') res = await backupNowRun();
  }
  renderBackupStatus();
  if (res.ok) toast(res.skipped ? '内容没变化，无需重复写入' : `已备份：${res.fileName}`);
  else toast(res.message || '备份失败', 3600);
});

els.btnExportBackup.addEventListener('click', () => {
  const { blob, fileName } = buildBackupExport();
  if (!blob) return;
  download(blob, fileName);
  toast(`已导出完整备份 ${fileName}`);
});

els.btnRestoreDir.addEventListener('click', async () => {
  const st = backupStatus();
  try {
    if (!st.hasHandle) await chooseBackupDir();
    else if (st.permission !== 'granted') await requestBackupAccess();
    await openRestoreModal();
  } catch (err) {
    const msg = backupErrorMessage(err);
    if (msg) toast(msg, 3600);
    else renderBackupStatus();
  }
});

els.restoreOtherDir.addEventListener('click', async () => {
  try {
    await chooseBackupDir();
    restoreFiles = await listBackupFiles();
    renderRestoreRows();
  } catch (err) {
    const msg = backupErrorMessage(err);
    if (msg) toast(msg, 3600);
  }
});

els.btnRestoreFile.addEventListener('click', () => pickBackupFile());

els.restoreBackupInput.addEventListener('change', async () => {
  const file = els.restoreBackupInput.files && els.restoreBackupInput.files[0];
  if (!file) return;
  try {
    const res = await restoreBackupFile(file);
    closeModal('restoreModal');
    syncSettingsForm();
    render();
    toast(`已从文件恢复 ${res.taskCount} 条任务`, 4200);
  } catch (err) {
    toast(backupErrorMessage(err) || '恢复失败', 3600);
  } finally {
    els.restoreBackupInput.value = '';
  }
});

els.btnSafeClean.addEventListener('click', async () => {
  let removed = 0;
  try {
    const keys = (await caches.keys()) || [];
    for (const key of keys) {
      if (await caches.delete(key)) removed += 1;
    }
  } catch {
    /* 没有 CacheStorage 就跳过 */
  }
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) await reg.update();
  } catch {
    /* 忽略 */
  }
  toast(`已清理 ${removed} 份离线缓存并检查更新（数据没动），下次打开生效`, 3600);
});

/* ---------------- 提醒 ---------------- */
let reminding = false;

function checkReminders() {
  if (reminding) return;
  const s = snap();
  const today = todayISO();
  const now = Date.now();
  const due = pendingTasks(s.tasks, s.settings, s.remindLog, now, today);
  if (!due.length) return;

  reminding = true;
  showReminder(due, today);
  setRemindLog(withReminded(s.remindLog, due.map((t) => t.id), now, today));

  if (s.settings.remind.sound) playChime();
  if (s.settings.remind.vibrate) vibrateNow();
  if (s.settings.remind.notification && notifyPermission() === 'granted') {
    notifyOS(
      `待办提醒 · ${due.length} 个任务`,
      due
        .slice(0, 3)
        .map((t) => `${t.content}（${remindLabel(t, today)}）`)
        .join('；'),
    );
  }
  setTimeout(() => {
    reminding = false;
  }, 1000);
}

function showReminder(tasks, today) {
  els.remindList.innerHTML = '';
  for (const t of tasks) {
    const li = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = t.content;
    const span = document.createElement('span');
    const plan = planOf(t);
    const late = !!plan && plan < Date.now();
    span.className = late ? 'late' : '';
    span.textContent = [fmtDate(t.date), plan ? `计划 ${fmtDateTime(plan)}` : '', plan ? remindLabel(t) : '']
      .filter(Boolean)
      .join(' · ');
    li.append(strong, span);
    li.addEventListener('click', () => {
      closeModal('remindModal');
      openTaskModal(t.id);
    });
    els.remindList.appendChild(li);
  }
  openModal('remindModal');
}

els.remindAck.addEventListener('click', () => closeModal('remindModal'));

function scheduleRemindLoop() {
  clearInterval(remindTimer);
  remindTimer = setInterval(() => {
    checkReminders();
    tickSeries();
  }, 60 * 1000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    checkReminders();
    tickSeries();
  } else {
    // 页面要进后台了，把挂起的自动备份尽快落盘（不保证写完）
    void flushBackup();
  }
});
window.addEventListener('focus', () => {
  checkReminders();
  tickSeries();
});

/* ---------------- PWA ---------------- */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 离线缓存不可用不影响应用本身 */
    });
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  const btn = $('#btnInstall');
  if (btn) btn.hidden = false;
});

$('#btnInstall').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('#btnInstall').hidden = true;
});

/* ---------------- 启动 ---------------- */
applyTheme();
syncSettingsForm();
syncFilterForm();
subscribe(() => render());
subscribe(() => scheduleBackup());
setBackupHooks({
  onChange: () => renderBackupStatus(),
  onError: (info) => {
    if (info && info.message) toast(info.message, 3600);
  },
});
render();
tickSeries();
registerServiceWorker();
scheduleRemindLoop();
setTimeout(checkReminders, 600);

function requestPersistentStorage() {
  const storage = navigator.storage;
  if (!storage || typeof storage.persist !== 'function') return;
  const ask = () => {
    storage.persist().catch(() => {
      /* 浏览器拒绝就算了，不影响使用 */
    });
  };
  if (typeof storage.persisted === 'function') {
    storage.persisted().then((already) => {
      if (!already) ask();
    }).catch(ask);
  } else {
    ask();
  }
}

(async () => {
  await initBackup();
  renderBackupStatus();
  syncSettingsForm();
  render();
  requestPersistentStorage();
  const saveErr = lastSaveError();
  if (saveErr && isPersistent()) toast(`本地存储写入失败（${saveErr}），建议先导出完整备份`, 4200);
})();
