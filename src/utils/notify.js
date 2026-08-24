/**
 * 系统通知工具 — 权限确保 + 发送（自选通知、均线提醒、价格提醒共用）
 *
 * 注意：不要在模块顶层调用 getCurrentWindow()。
 * App.vue 会 import 本文件；若顶层就取 window，在 IPC metadata 未注入时会抛错导致整页白屏。
 */
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";

/** 确保通知权限已授予 */
async function ensureNotificationPermission() {
  let permitted = await isPermissionGranted();
  if (!permitted) {
    permitted = (await requestPermission()) === "granted";
  }
  return permitted;
}

/**
 * 发送一条 Windows 原生通知（自动确保权限 + 任务栏闪烁提醒）。
 * @param {string} title
 * @param {string} body
 * @returns {Promise<boolean>} 是否成功发送（权限被拒返回 false，调用方应中止后续发送）
 */
export async function sendAlertNotification(title, body) {
  const permitted = await ensureNotificationPermission();
  if (!permitted) return false;
  // 任务栏闪烁黄色（UserAttentionType.Critical），直到用户聚焦窗口
  try {
    await getCurrentWindow().requestUserAttention(UserAttentionType.Critical);
  } catch {
    /* 非 Tauri 环境或窗口 API 不可用时跳过闪烁 */
  }
  await sendNotification({ title, body });
  return true;
}
