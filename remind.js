// 提醒：到期判定、节流、三种提醒方式的降级封装。
import { todayISO, planOf, relToPlan } from './dates.js';

export const INTERVAL_MS = {
  open: 0,
  '30m': 30 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

export function thresholdMs(settings) {
  const hours = Number(settings?.remind?.thresholdHours ?? 24);
  return Math.max(0, hours) * 3600000;
}

// 快到期（含已逾期）的未完成任务，按计划完成时间升序
export function collectDue(tasks, settings, now = Date.now()) {
  const limit = thresholdMs(settings);
  return tasks
    .filter((task) => {
      if (task.done) return false;
      const plan = planOf(task);
      if (!plan) return false;
      return plan - now <= limit;
    })
    .sort((a, b) => planOf(a) - planOf(b));
}

// 是否因「当天次数上限 / 提醒周期」被节流
export function isThrottled(log, task, settings, now = Date.now(), today = todayISO()) {
  const s = settings?.remind || {};
  const max = Math.max(1, Number(s.maxPerDay) || 2);
  const entry = log ? log[task.id] : null;
  if (!entry || entry.day !== today) return false;
  if (Number(entry.count) >= max) return true;
  const gap = INTERVAL_MS[s.interval] ?? 0;
  return gap > 0 && now - Number(entry.lastAt || 0) < gap;
}

// 本次真正需要弹窗的任务
export function pendingTasks(tasks, settings, log, now = Date.now(), today = todayISO()) {
  return collectDue(tasks, settings, now).filter((t) => !isThrottled(log, t, settings, now, today));
}

// 返回新的提醒日志（不修改入参），与 store 的不可变约定一致
export function withReminded(log, ids, now = Date.now(), today = todayISO()) {
  const next = { ...(log || {}) };
  for (const id of ids) {
    const entry = next[id];
    if (!entry || entry.day !== today) next[id] = { day: today, count: 1, lastAt: now };
    else next[id] = { day: today, count: Number(entry.count) + 1, lastAt: now };
  }
  return next;
}

export function remindLabel(task, now = Date.now()) {
  return relToPlan(planOf(task), now);
}

/* ---------------- 提醒方式（全部静默降级） ---------------- */

let audioCtx = null;

export function playChime() {
  try {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return false;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    [0, 0.18].forEach((offset, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 0 ? 880 : 1174;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.18);
    });
    return true;
  } catch {
    return false;
  }
}

export function vibrateNow() {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
    return navigator.vibrate([90, 60, 90]);
  } catch {
    return false;
  }
}

export function notifyPermission() {
  try {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
}

export async function requestNotifyPermission() {
  try {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission !== 'default') return Notification.permission;
    return await Notification.requestPermission();
  } catch {
    return 'unsupported';
  }
}

export function notifyOS(title, body) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    new Notification(title, { body, icon: './icon-192.png', tag: 'dsh-todo-remind' });
    return true;
  } catch {
    return false;
  }
}
