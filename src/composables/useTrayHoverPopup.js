import { onMounted, onUnmounted, watch } from "vue";
import { listen, emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { TrayIcon } from "@tauri-apps/api/tray";
import { cursorPosition } from "@tauri-apps/api/window";
import { useSettings } from "./useSettings";

const TRAY_ID = "main";
const POPUP_LABEL = "tray-popup";
const POPUP_WIDTH = 280;
const ROW_HEIGHT = 40;
const PAGE_SIZE = 5;
const HEADER_HEIGHT = 38;
const FOOTER_HEIGHT = 30;
/** 离开托盘后延迟关闭（给鼠标移入弹窗的时间） */
const TRAY_LEAVE_DELAY_MS = 280;
/** Enter 后忽略 Leave 的宽限期（Windows 托盘常 Enter 后立刻 Leave） */
const LEAVE_GRACE_MS = 450;
/** 与任务栏顶部的间距（逻辑像素） */
const TASKBAR_GAP = 56;
const CURSOR_WATCH_MS = 400;
/** 弹窗下方途经区（逻辑像素），需覆盖到托盘图标 */
const BRIDGE_PAD = 120;
/** 托盘热点半径（物理像素近似，按 DPI 再乘） */
const TRAY_HOTSPOT = 40;

function popupHeight(count) {
  const rows = Math.min(Math.max(count, 1), PAGE_SIZE);
  return HEADER_HEIGHT + FOOTER_HEIGHT + rows * ROW_HEIGHT;
}

/**
 * 托盘悬停持仓弹窗；受 settings.trayPositionsEnabled 控制。
 */
export function useTrayHoverPopup({ positionCount }) {
  const { state: settings } = useSettings();
  let hideTimer = null;
  let cursorWatchTimer = null;
  let popupHovered = false;
  let isShown = false;
  let showToken = 0;
  let leaveGraceUntil = 0;
  let lastTrayX = 0;
  let lastTrayY = 0;
  let unlistenTray = null;
  let unlistenPopupHover = null;

  function clearHideTimer() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function stopCursorWatch() {
    if (cursorWatchTimer) {
      clearInterval(cursorWatchTimer);
      cursorWatchTimer = null;
    }
  }

  function scheduleHide(delayMs = 0) {
    clearHideTimer();
    const token = showToken;
    if (delayMs <= 0) {
      if (token === showToken) hidePopup();
      return;
    }
    hideTimer = setTimeout(() => {
      // 宽限期内或已有更新的展示，不关
      if (Date.now() < leaveGraceUntil) return;
      if (token !== showToken) return;
      hidePopup();
    }, delayMs);
  }

  function startCursorWatch() {
    stopCursorWatch();
    cursorWatchTimer = setInterval(() => {
      checkCursorStillRelated();
    }, CURSOR_WATCH_MS);
  }

  function isNearTray(cursorX, cursorY, factor) {
    const r = TRAY_HOTSPOT * factor;
    return (
      Math.abs(cursorX - lastTrayX) <= r * 2 &&
      Math.abs(cursorY - lastTrayY) <= r * 2
    );
  }

  async function checkCursorStillRelated() {
    if (!isShown) return;
    if (popupHovered) return;
    if (Date.now() < leaveGraceUntil) return;

    try {
      const win = await WebviewWindow.getByLabel(POPUP_LABEL);
      if (!win || !(await win.isVisible())) return;

      const [cursor, pos, size, factor] = await Promise.all([
        cursorPosition(),
        win.outerPosition(),
        win.outerSize(),
        win.scaleFactor().catch(() => 1),
      ]);

      const left = pos.x;
      const top = pos.y;
      const right = pos.x + size.width;
      const bottom = pos.y + size.height;
      const pad = BRIDGE_PAD * factor;

      const inPopup =
        cursor.x >= left &&
        cursor.x <= right &&
        cursor.y >= top &&
        cursor.y <= bottom;

      const inBridge =
        cursor.x >= left - 40 &&
        cursor.x <= right + 40 &&
        cursor.y > bottom &&
        cursor.y <= bottom + pad;

      if (inPopup || inBridge || isNearTray(cursor.x, cursor.y, factor)) {
        return;
      }

      hidePopup();
    } catch {
      /* ignore */
    }
  }

  async function ensurePopup() {
    let win = await WebviewWindow.getByLabel(POPUP_LABEL);
    if (win) return win;

    const count = Math.max(positionCount?.value ?? 0, 1);
    const height = popupHeight(count);

    win = new WebviewWindow(POPUP_LABEL, {
      url: `${window.location.origin}${window.location.pathname}?tray=1`,
      title: "持仓概览",
      width: POPUP_WIDTH,
      height,
      decorations: false,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      focus: false,
      visible: false,
      shadow: true,
    });

    await new Promise((resolve) => {
      win.once("tauri://created", resolve);
      win.once("tauri://error", resolve);
      setTimeout(resolve, 1500);
    });

    return win;
  }

  async function applyPopupLayout(win, x, y) {
    const count = Math.max(positionCount?.value ?? 0, 0);
    const height = popupHeight(count);

    try {
      await win.setSize(new LogicalSize(POPUP_WIDTH, height));
    } catch {
      /* ignore */
    }

    let factor = 1;
    try {
      factor = await win.scaleFactor();
    } catch {
      /* ignore */
    }
    const physW = POPUP_WIDTH * factor;
    const physH = height * factor;
    const gap = TASKBAR_GAP * factor;
    const posX = Math.round(x - physW / 2);
    const posY = Math.round(y - physH - gap);
    try {
      await win.setPosition(new PhysicalPosition(Math.max(8, posX), Math.max(8, posY)));
    } catch {
      /* ignore */
    }
    return height;
  }

  async function showPopup(x, y) {
    if (!settings.trayPositionsEnabled) {
      hidePopup();
      return;
    }

    lastTrayX = x;
    lastTrayY = y;
    leaveGraceUntil = Date.now() + LEAVE_GRACE_MS;
    clearHideTimer();

    // 已显示：只续期，不跟随鼠标挪动位置（Move 很频繁）
    if (isShown) {
      return;
    }

    showToken += 1;
    const token = showToken;

    const win = await ensurePopup();
    if (!win || token !== showToken) return;

    await applyPopupLayout(win, x, y);
    if (token !== showToken) return;

    try {
      await win.show();
      isShown = true;
      leaveGraceUntil = Date.now() + LEAVE_GRACE_MS;
      startCursorWatch();
      await emit("tray-popup-show");
    } catch {
      /* ignore */
    }
  }

  async function hidePopup() {
    clearHideTimer();
    stopCursorWatch();
    popupHovered = false;
    isShown = false;
    const win = await WebviewWindow.getByLabel(POPUP_LABEL);
    if (!win) return;
    try {
      await win.hide();
    } catch {
      /* ignore */
    }
  }

  async function clearTooltip() {
    try {
      const tray = await TrayIcon.getById(TRAY_ID);
      if (tray) await tray.setTooltip(null);
    } catch {
      /* ignore */
    }
  }

  onMounted(async () => {
    await clearTooltip();

    unlistenTray = await listen("tray-hover", (event) => {
      const payload = event.payload || {};
      if (payload.action === "enter") {
        if (!settings.trayPositionsEnabled) return;
        showPopup(Number(payload.x) || 0, Number(payload.y) || 0);
      } else if (payload.action === "leave") {
        if (Date.now() < leaveGraceUntil) return;
        if (payload.x != null && payload.y != null) {
          lastTrayX = Number(payload.x);
          lastTrayY = Number(payload.y);
        }
        scheduleHide(TRAY_LEAVE_DELAY_MS);
      }
    });

    unlistenPopupHover = await listen("tray-popup-hover", (event) => {
      const inside = !!(event.payload && event.payload.inside);
      popupHovered = inside;
      if (inside) {
        clearHideTimer();
        leaveGraceUntil = Date.now() + LEAVE_GRACE_MS;
      } else {
        scheduleHide(0);
      }
    });

    watch(
      () => settings.trayPositionsEnabled,
      (enabled) => {
        if (!enabled) hidePopup();
      }
    );
  });

  onUnmounted(() => {
    clearHideTimer();
    stopCursorWatch();
    if (unlistenTray) unlistenTray();
    if (unlistenPopupHover) unlistenPopupHover();
  });

  return { showPopup, hidePopup };
}
