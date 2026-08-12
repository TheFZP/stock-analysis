<script setup>
/**
 * 托盘悬停持仓弹窗（?tray=1）
 * 最多展示 10 条；可视区域约 5 条，超出滚动。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { emit, listen } from "@tauri-apps/api/event";
import { usePositions } from "../composables/usePositions";
import { useQuoteLoader } from "../composables/useQuoteLoader";
import { signChar, fmtPct } from "../utils/format";

const MAX_DISPLAY = 10;

const {
  positions,
  positionStats,
  totalProfit,
  totalProfitPct,
  totalMarketValue,
  updatePositionQuote,
  reloadPositions,
} = usePositions();
const { loadQuotesBatch } = useQuoteLoader();

const lastUpdated = ref("");

/** 弹窗内最多展示 10 条 */
const displayStats = computed(() => positionStats.value.slice(0, MAX_DISPLAY));
const totalCount = computed(() => positionStats.value.length);
const hasMore = computed(() => totalCount.value > MAX_DISPLAY);

async function refreshAll() {
  // 托盘是独立窗口，需从 localStorage 同步主窗口最新持仓
  reloadPositions();
  const codes = positions.value.map((p) => p.code);
  if (codes.length === 0) {
    lastUpdated.value = "";
    return;
  }
  const quotes = await loadQuotesBatch(codes);
  if (quotes) {
    quotes.forEach((q) => updatePositionQuote(q.code, q));
  }
  lastUpdated.value = new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function onEnter() {
  emit("tray-popup-hover", { inside: true });
}

function onLeave() {
  emit("tray-popup-hover", { inside: false });
}

let timer = null;
let unlistenShow = null;

onMounted(async () => {
  await refreshAll();
  timer = setInterval(refreshAll, 10000);
  unlistenShow = await listen("tray-popup-show", () => {
    refreshAll();
  });
  window.addEventListener("blur", onLeave);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
  if (unlistenShow) unlistenShow();
  window.removeEventListener("blur", onLeave);
});
</script>

<template>
  <div class="tray-popup" @mouseenter="onEnter" @mouseleave="onLeave" @pointerleave="onLeave">
    <header class="tray-header">
      <div class="tray-title">
        <span class="tray-dot"></span>
        持仓
        <span class="tray-count">{{ totalCount }} 只</span>
      </div>
      <div class="tray-total" :class="totalProfit >= 0 ? 'up' : 'down'">
        <span class="tray-total-label">总盈亏</span>
        <span class="tray-total-value">
          {{ signChar(totalProfit) }}{{ totalProfit.toFixed(2) }}
        </span>
        <span class="tray-total-pct">{{ fmtPct(totalProfitPct) }}</span>
      </div>
    </header>

    <div v-if="displayStats.length === 0" class="tray-empty">
      暂无持仓
    </div>

    <div v-else class="tray-list">
      <div
        v-for="p in displayStats"
        :key="p.code"
        class="tray-row"
      >
        <div class="tray-row-left">
          <span class="tray-name">{{ p.name }}</span>
          <span class="tray-code">
            {{ p.code }}
            <span v-if="p.isHK" class="tray-hk">HK</span>
          </span>
        </div>
        <div class="tray-row-mid">
          <span class="tray-price">{{ p.currency }}{{ (p.currentPrice || 0).toFixed(2) }}</span>
          <span class="tray-meta">{{ p.quantity || 0 }} 股</span>
        </div>
        <div class="tray-row-right" :class="p.profit >= 0 ? 'up' : 'down'">
          <span class="tray-profit">
            {{ signChar(p.profit) }}{{ (p.profit || 0).toFixed(2) }}
          </span>
          <span class="tray-pct">{{ fmtPct(p.profitPct) }}</span>
        </div>
      </div>
      <div v-if="hasMore" class="tray-more">
        另有 {{ totalCount - MAX_DISPLAY }} 只未展示
      </div>
    </div>

    <footer class="tray-footer">
      <span>市值 ¥{{ totalMarketValue.toFixed(2) }}</span>
      <span v-if="displayStats.length">更新 {{ lastUpdated }}</span>
    </footer>
  </div>
</template>

<style scoped>
.tray-popup {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--card-bg, #fff);
  color: var(--text-primary, #1a1a1a);
  font-size: 12px;
  overflow: hidden;
  border: 1px solid var(--border, #e5e7eb);
  box-sizing: border-box;
}

.tray-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-light, #f0f0f0);
}

.tray-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  min-width: 0;
  white-space: nowrap;
}

.tray-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--rust, #c95e36);
  flex-shrink: 0;
}

.tray-count {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted, #9ca3af);
}

.tray-total {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-shrink: 0;
}

.tray-total-label {
  font-size: 11px;
  color: var(--text-secondary, #6b7280);
}

.tray-total-value {
  font-size: 14px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.tray-total-pct {
  font-size: 12px;
  font-weight: 600;
}

.tray-total.up,
.tray-row-right.up {
  color: var(--red, #e74c3c);
}
.tray-total.down,
.tray-row-right.down {
  color: var(--green, #27ae60);
}

.tray-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted, #9ca3af);
}

/* 可视约 5 行，超出滚动；最多渲染 10 条 */
.tray-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0;
}

.tray-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 10px;
  align-items: center;
  height: 40px;
  box-sizing: border-box;
  padding: 0 12px;
}

.tray-row:hover {
  background: var(--fog, #f3f4f6);
}

.tray-row-left {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.tray-name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

.tray-code {
  font-size: 11px;
  color: var(--text-muted, #9ca3af);
  line-height: 1.2;
}

.tray-hk {
  margin-left: 4px;
  font-size: 10px;
  color: #b45309;
  background: #fef3c7;
  padding: 0 4px;
  border-radius: 3px;
}

.tray-row-mid {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}

.tray-price {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.tray-meta {
  font-size: 11px;
  color: var(--text-muted, #9ca3af);
  line-height: 1.2;
}

.tray-row-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  min-width: 72px;
}

.tray-profit {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.tray-pct {
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
}

.tray-more {
  padding: 6px 12px 8px;
  text-align: center;
  font-size: 11px;
  color: var(--text-muted, #9ca3af);
}

.tray-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  padding: 6px 12px;
  border-top: 1px solid var(--border-light, #f0f0f0);
  font-size: 11px;
  color: var(--text-muted, #9ca3af);
}
</style>
