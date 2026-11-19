// 日期工具：全部按设备本地时区计算，日期以 'YYYY-MM-DD' 字符串表示。
const MS_DAY = 86400000;

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function todayISO(now) {
  const d = now ? new Date(now) : new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function toISO(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// 时间戳 -> 本地日期（用于完成时间、创建时间的日期归属）
export function isoOf(ts) {
  if (!ts) return '';
  return toISO(new Date(ts));
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + Number(n || 0));
  return toISO(d);
}

// b - a，单位天（用四舍五入抵消夏令时偏移）
export function diffDays(aISO, bISO) {
  return Math.round((parseISO(bISO).getTime() - parseISO(aISO).getTime()) / MS_DAY);
}

// 计划完成时间（时间戳，null = 不限期）
export function planOf(task) {
  const value = Number(task?.planAt);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// 计划完成时间落在哪一天
export function planDayOf(task) {
  const plan = planOf(task);
  return plan ? isoOf(plan) : null;
}

// 周一（weekStart=1）或周日（weekStart=0）为一周开始
export function weekStartOf(iso, weekStart = 1) {
  const d = parseISO(iso);
  const delta = (d.getDay() - weekStart + 7) % 7;
  d.setDate(d.getDate() - delta);
  return toISO(d);
}

export function weekDays(startISO) {
  return Array.from({ length: 7 }, (_, i) => addDays(startISO, i));
}

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

export function fmtDate(iso) {
  if (!iso) return '';
  const d = parseISO(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK_CN[d.getDay()]}`;
}

export function fmtShort(iso) {
  if (!iso) return '';
  const d = parseISO(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fmtFull(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// 相对计划完成时间的中文标签（按小时/天）
export function relToPlan(planMs, now = Date.now()) {
  if (!planMs) return '';
  const diff = planMs - now;
  const abs = Math.abs(diff);
  if (diff >= 0) {
    if (abs < 3600000) return '不到 1 小时';
    if (abs < 86400000) return `剩 ${Math.ceil(abs / 3600000)} 小时`;
    return `剩 ${Math.ceil(abs / 86400000)} 天`;
  }
  if (abs < 3600000) return '刚逾期';
  if (abs < 86400000) return `逾期 ${Math.ceil(abs / 3600000)} 小时`;
  return `逾期 ${Math.ceil(abs / 86400000)} 天`;
}

// 某年某月的天数（month 1..12）
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// 计划时间 "HH:mm" + 日期 -> 时间戳
export function occurrencePlanAt(dateISO, planTime) {
  if (!/^\d{2}:\d{2}$/.test(String(planTime || ''))) return null;
  const [h, m] = String(planTime).split(':').map(Number);
  const d = parseISO(dateISO);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

/**
 * 下一个满足规则的日期（>= fromISO）。
 * rule = { type: 'everyDays'|'weekly'|'monthly'|'yearly', interval, weekdays[0-6], monthDay, month, day }
 */
export function nextOccurrence(rule, fromISO, anchorISO) {
  const type = rule?.type || 'everyDays';
  const anchor = anchorISO || fromISO;

  if (type === 'everyDays') {
    const step = Math.max(1, Math.round(Number(rule?.interval) || 1));
    const diff = diffDays(anchor, fromISO);
    const k = diff <= 0 ? 0 : Math.ceil(diff / step);
    return addDays(anchor, k * step);
  }

  if (type === 'weekly') {
    const days = [...new Set((rule?.weekdays || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
    if (!days.length) return fromISO;
    const cursor = parseISO(fromISO);
    for (let i = 0; i < 14; i++) {
      if (days.includes(cursor.getDay())) return toISO(cursor);
      cursor.setDate(cursor.getDate() + 1);
    }
    return fromISO;
  }

  if (type === 'monthly') {
    const wanted = Math.min(31, Math.max(1, Math.round(Number(rule?.monthDay) || 1)));
    const cursor = parseISO(fromISO);
    for (let i = 0; i < 24; i++) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth() + 1;
      const day = Math.min(wanted, daysInMonth(year, month));
      if (cursor.getDate() <= day) {
        cursor.setDate(day);
        return toISO(cursor);
      }
      cursor.setDate(1);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return fromISO;
  }

  if (type === 'yearly') {
    const month = Math.min(12, Math.max(1, Math.round(Number(rule?.month) || 1)));
    const wanted = Math.min(31, Math.max(1, Math.round(Number(rule?.day) || 1)));
    const cursor = parseISO(fromISO);
    for (let i = 0; i < 8; i++) {
      const year = cursor.getFullYear();
      const day = Math.min(wanted, daysInMonth(year, month));
      const candidate = new Date(year, month - 1, day);
      if (candidate >= parseISO(toISO(cursor))) return toISO(candidate);
      cursor.setFullYear(year + 1, 0, 1);
    }
    return fromISO;
  }

  return fromISO;
}

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

export function describeRule(rule) {
  const type = rule?.type || 'everyDays';
  if (type === 'everyDays') return `每 ${Math.max(1, Math.round(Number(rule?.interval) || 1))} 天`;
  if (type === 'weekly') {
    const days = [...new Set((rule?.weekdays || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
    if (!days.length) return '每周（未选择星期）';
    return `每周${days.map((d) => WEEKDAY_CN[d]).join('、')}`;
  }
  if (type === 'monthly') return `每月 ${Math.min(31, Math.max(1, Math.round(Number(rule?.monthDay) || 1)))} 日`;
  if (type === 'yearly') {
    return `每年 ${Math.min(12, Math.max(1, Math.round(Number(rule?.month) || 1)))} 月 ${Math.min(31, Math.max(1, Math.round(Number(rule?.day) || 1)))} 日`;
  }
  return '自定义周期';
}

export function weekLabel(startISO, endISO) {
  return `${fmtShort(startISO)} – ${fmtShort(endISO)}`;
}

/* ---------------- 月份 / 日历 ---------------- */

export function monthStartOf(iso) {
  const d = parseISO(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
}

export function addMonths(monthISO, n) {
  const d = parseISO(monthISO);
  return toISO(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

export function fmtMonth(monthISO) {
  const d = parseISO(monthISO);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}

export function weekdayNames(weekStart = 1) {
  const names = ['日', '一', '二', '三', '四', '五', '六'];
  return Array.from({ length: 7 }, (_, i) => names[(weekStart + i) % 7]);
}

// 固定 42 格（6 周），避免月份切换时高度跳动
export function monthGrid(monthISO, weekStart = 1) {
  const d = parseISO(monthISO);
  const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const start = weekStartOf(toISO(firstOfMonth), weekStart);
  return Array.from({ length: 42 }, (_, i) => {
    const iso = addDays(start, i);
    const cell = parseISO(iso);
    return {
      iso,
      day: cell.getDate(),
      inMonth: cell.getMonth() === d.getMonth() && cell.getFullYear() === d.getFullYear(),
    };
  });
}

// <input type="datetime-local"> 需要的本地时间字符串
export function datetimeLocalValue(ts) {
  const d = ts ? new Date(ts) : new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function tsFromDatetimeLocal(value, fallback = Date.now()) {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : fallback;
}
