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
/** 一屏可见行数 */
const PAGE_SIZE = 5;
const HEADER_HEIGHT = 38;
const FOOTER_HEIGHT = 30;
/** 离开托盘/弹窗后的隐藏延迟（需覆盖移向弹窗的空隙时间） */
const HIDE_DELAY_MS = 500;
/** 与任务栏顶部的间距（逻辑像素） */
const TASKBAR_GAP = 56;
/** 光标巡检间隔：防止 Leave / mouseleave 丢失导致弹窗残留 */
const CURSOR_WATCH_MS = 350;
/** 弹窗下方仍视为「途经区」的高度（逻辑像素，托盘空隙） */
const BRIDGE_PAD = 72;

function popupHeight(count) {
  const rows = Math.min(Math.max(count, 1), PAGE_SIZE);
  return HEADER_HEIGHT + FOOTER_HEIGHT + rows * ROW_HEIGHT;
}

/**
 * 托盘悬停时弹出完整持仓面板（绕过原生 tooltip 字数限制）
 * 仅在主窗口调用；受 settings.trayPositionsEnabled 控制。
 */
export function useTrayHoverPopup({ positionCount }) {
  const { state: settings } = useSettings();
  let hideTimer = null;
  let cursorWatchTimer = null;
  let popupHovered = false;
  let isShown = false;
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

  /** 延迟后一律隐藏（不再被卡住的 popupHovered 挡住） */
  function scheduleHide() {
    clearHideTimer();
    hideTimer = setTimeout(() => {
      hidePopup();
    }, HIDE_DELAY_MS);
  }

  function startCursorWatch() {
    stopCursorWatch();
    cursorWatchTimer = setInterval(() => {
      checkCursorStillRelated();
    }, CURSOR_WATCH_MS);
  }

  async function checkCursorStillRelated() {
    if (!isShown) return;
    // 鼠标明确在弹窗内时不强制关
    if (popupHovered) return;

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

      // 弹窗正下方到托盘之间的空隙，移动过程中不算离开
      const inBridge =
        cursor.x >= left - 24 &&
        cursor.x <= right + 24 &&
        cursor.y > bottom &&
        cursor.y <= bottom + pad;

      if (!inPopup && !inBridge) {
        hidePopup();
      }
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

  async function showPopup(x, y) {
    if (!settings.trayPositionsEnabled) {
      hidePopup();
      return;
    }
    clearHideTimer();
    const win = await ensurePopup();
    if (!win) return;

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

    try {
      await win.show();
      isShown = true;
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
        scheduleHide();
      }
    });

    unlistenPopupHover = await listen("tray-popup-hover", (event) => {
      const inside = !!(event.payload && event.payload.inside);
      popupHovered = inside;
      if (inside) {
        clearHideTimer();
      } else {
        scheduleHide();
      }
    });

    // 关闭开关时立即收起弹窗
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
