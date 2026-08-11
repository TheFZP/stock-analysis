import { watch } from "vue";
import { TrayIcon } from "@tauri-apps/api/tray";
import { signChar } from "../utils/format";

const TRAY_ID = "main";
/** Windows 托盘 tooltip 上限约 128 字符，留余量 */
const MAX_TOOLTIP_LEN = 120;

/**
 * 将持仓汇总格式化为托盘悬浮提示文本
 * @param {Array} stats - positionStats
 * @param {number} totalProfit
 * @param {number} totalProfitPct
 */
export function formatPositionsTooltip(stats, totalProfit, totalProfitPct) {
  if (!stats || stats.length === 0) {
    return "stock-analysis\n暂无持仓";
  }

  const lines = [];
  const profitSign = signChar(totalProfit);
  const pctSign = signChar(totalProfitPct);
  lines.push(
    `持仓 ${stats.length} 只 | ${profitSign}${Math.abs(totalProfit).toFixed(0)} (${pctSign}${Math.abs(totalProfitPct).toFixed(2)}%)`
  );

  for (const p of stats) {
    const pct = p.profitPct ?? 0;
    const price = p.currentPrice ?? p.price ?? p.buyPrice ?? 0;
    const line = `${p.name} ${p.currency || "¥"}${Number(price).toFixed(2)} ${signChar(pct)}${Math.abs(pct).toFixed(2)}%`;
    const candidate = [...lines, line].join("\n");
    if (candidate.length > MAX_TOOLTIP_LEN) {
      const remain = stats.length - (lines.length - 1);
      if (remain > 0) {
        const more = `…另有 ${remain} 只`;
        if ((lines.join("\n") + "\n" + more).length <= MAX_TOOLTIP_LEN) {
          lines.push(more);
        }
      }
      break;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * 监听持仓变化，同步更新系统托盘悬浮提示
 * @param {{ positionStats: import('vue').Ref, totalProfit: import('vue').Ref, totalProfitPct: import('vue').Ref }} opts
 */
export function useTrayPositionsTooltip({ positionStats, totalProfit, totalProfitPct }) {
  let tray = null;
  let lastText = "";

  async function ensureTray() {
    if (tray) return tray;
    try {
      tray = await TrayIcon.getById(TRAY_ID);
    } catch {
      tray = null;
    }
    return tray;
  }

  async function syncTooltip() {
    const text = formatPositionsTooltip(
      positionStats.value,
      totalProfit.value,
      totalProfitPct.value
    );
    if (text === lastText) return;
    lastText = text;
    const icon = await ensureTray();
    if (!icon) return;
    try {
      await icon.setTooltip(text);
    } catch {
      /* 非 Tauri 环境或权限不足时忽略 */
    }
  }

  watch(
    [positionStats, totalProfit, totalProfitPct],
    () => { syncTooltip(); },
    { deep: true, immediate: true }
  );

  return { syncTooltip };
}
