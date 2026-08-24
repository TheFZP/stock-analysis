<script setup>
import KlineChart from "./KlineChart.vue";
import IntradayChart from "./IntradayChart.vue";
import MoneyFlowModal from "./MoneyFlowModal.vue";
import AlertsModal from "./AlertsModal.vue";
import DetailActionBar from "./DetailActionBar.vue";
import { signChar } from "../utils/format";
import { useT0Signals } from "../composables/useT0Signals.js";
import { useMaAlerts } from "../composables/useMaAlerts.js";
import { usePriceAlerts } from "../composables/usePriceAlerts.js";
import { ref, computed, watch } from "vue";

const props = defineProps({
  selectedStock: { type: Object, default: null },
  watchlist: { type: Array, default: () => [] },
  klineData: { type: Array, default: null },
  klineLoading: { type: Boolean, default: false },
  klinePeriod: { type: String, default: "day" },
  intradayData: { type: Object, default: null },
  intradayLoading: { type: Boolean, default: false },
  moneyFlow: { type: Object, default: null },
  moneyFlowLoading: { type: Boolean, default: false },
  moneyFlowHistory: { type: Array, default: null },
  moneyFlowHistoryLoading: { type: Boolean, default: false },
  watchlistMarkers: { type: Array, default: () => [] },
  positions: { type: Array, default: () => [] },
});

const emit = defineEmits([
  "toggle-watchlist",
  "change-kline-period",
  "open-industry-modal",
  "open-tech-modal",
  "open-ai-modal",
  "open-chip-modal",
  "load-intraday",
  "add-position",
]);

const chartMode = ref("intraday"); // "kline" | "intraday"
const showSR = ref(false);
const klineChartRef = ref(null);

/** 均线提醒配置（合并弹窗「均线提醒」Tab 用） */
const { getConfig: getMaConfig } = useMaAlerts();

/** 价格提醒数量（合并弹窗「价格提醒」Tab 用） */
const { countEnabledForCode: countPriceAlerts } = usePriceAlerts();

/** 合并提醒弹窗 / 资金流向弹窗 */
const showAlertsModal = ref(false);
const showMoneyFlowModal = ref(false);

/** 当前股票是否已配置均线提醒（合并按钮徽标用） */
const maAlertActive = computed(() =>
  props.selectedStock ? getMaConfig(props.selectedStock.code) : null
);

/** 当前股票启用中的价格提醒数量（合并按钮徽标用） */
const priceAlertCount = computed(() =>
  props.selectedStock ? countPriceAlerts(props.selectedStock.code) : 0
);

/** 提醒按钮徽标：均线周期数 + 价格提醒数 */
const alertCount = computed(
  () => (maAlertActive.value?.periods?.length || 0) + priceAlertCount.value
);

/** 港股识别与货币符号 */
const isHK = computed(() => {
  const stock = props.selectedStock;
  if (!stock) return false;
  return stock.market === "HK" || (stock.code && stock.code.length === 5);
});
const currencySymbol = computed(() => isHK.value ? "HK$" : "¥");

/** T+0 信号系统 */
const { signalMarkers, summary: t0Summary, compute: computeT0Signals } = useT0Signals();

// 当分时数据或K线数据变化时重新计算信号
watch(
  [() => props.klineData, () => props.intradayData, () => props.selectedStock],
  ([kline, intraday, stock]) => {
    if (intraday && intraday.items && intraday.items.length > 0) {
      // 信号分析为尽力而为的辅助功能：内部异常不得打断组件更新队列
      // （历史教训：一次未捕获异常会级联打崩整个渲染周期）
      try {
        computeT0Signals(kline, intraday, stock);
      } catch (e) {
        console.error("计算 T+0/量价陷阱信号失败:", e);
      }
    }
  },
  { immediate: true, deep: false }
);

function handleToggleSR() {
  showSR.value = !showSR.value;
  klineChartRef.value?.toggleSR();
}

function switchChartMode(mode) {
  if (mode === chartMode.value) return;
  chartMode.value = mode;




  if (mode === "intraday") {
    emit("load-intraday");
  }
}

function isInWatchlist(code) {
  return props.watchlist.some((s) => s.code === code);
}

function isInPositions(code) {
  return props.positions.some((p) => p.code === code);
}

/** 自选以来涨跌幅 */
const sinceAddedPct = computed(() => {
  const stock = props.selectedStock;
  const klines = props.klineData;
  if (!stock?.addedAt) return null;
  const currentPrice = stock.price;
  if (!currentPrice || currentPrice === 0) return null;
  // 优先使用加入自选时记录的价格
  if (stock.addedPrice && stock.addedPrice > 0) {
    return ((currentPrice - stock.addedPrice) / stock.addedPrice) * 100;
  }
  // 回退：从 K 线中找加入自选当日的收盘价
  if (!klines || !Array.isArray(klines) || klines.length === 0) return null;
  const addedKline = klines.find((k) => k.date === stock.addedAt);
  if (!addedKline?.close || addedKline.close === 0) return null;
  return ((currentPrice - addedKline.close) / addedKline.close) * 100;
});
</script>

<template>
  <main class="main-content">
    <section class="detail-card" v-if="selectedStock">
      <div class="stock-header">
        <div class="stock-header-main">
          <div class="stock-title-row">
            <div class="stock-tag" :class="selectedStock.change >= 0 ? 'up' : 'down'">
              <span class="tag-arrow">{{ selectedStock.change >= 0 ? "▲" : "▼" }}</span>
              <span class="tag-text">{{ selectedStock.change >= 0 ? "上涨" : "下跌" }}</span>
            </div>
            <div class="stock-identity">
              <h2 class="stock-name">{{ selectedStock.name }}</h2>
              <span class="stock-code">{{ selectedStock.code }}</span>
              <span v-if="isHK" class="market-badge market-hk">港股</span>
              <span
                v-if="sinceAddedPct != null"
                class="since-added"
                :class="sinceAddedPct >= 0 ? 'up' : 'down'"
              >
                {{ signChar(sinceAddedPct) }}{{ sinceAddedPct.toFixed(2) }}%
                <span class="since-added-label">自选以来</span>
              </span>
            </div>
          </div>

          <div class="price-area">
            <div class="price-main">
              <span class="price" :class="selectedStock.change >= 0 ? 'up' : 'down'">
                {{ currencySymbol }}{{ selectedStock.price.toFixed(2) }}
              </span>
              <span class="price-change" :class="selectedStock.change >= 0 ? 'up' : 'down'">
                {{ signChar(selectedStock.change) }}{{ selectedStock.change.toFixed(2) }}
              </span>
              <span class="price-pct" :class="selectedStock.change >= 0 ? 'up' : 'down'">
                {{ signChar(selectedStock.changePct) }}{{ selectedStock.changePct.toFixed(2) }}%
              </span>
            </div>
          </div>
        </div>

        <div class="action-bar">
          <button v-if="!isHK" class="btn btn-industry" @click="$emit('open-industry-modal')">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="2" y="8" width="3" height="6" rx="0.5"/>
              <rect x="6.5" y="5.5" width="3" height="8.5" rx="0.5"/>
              <rect x="11" y="3" width="3" height="11" rx="0.5"/>
            </svg>
            <span>行业分析</span>
          </button>
          <button class="btn btn-tech" @click="$emit('open-tech-modal')">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2 14L14 2M2 14l4-1M2 14l1-4" stroke-linejoin="round"/>
              <circle cx="12" cy="4" r="1" fill="currentColor"/>
            </svg>
            <span>技术分析</span>
          </button>
          <button class="btn btn-sr" :class="{ active: showSR }" @click="handleToggleSR">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <circle cx="4" cy="4" r="1.5" fill="#27ae60"/>
              <circle cx="12" cy="8" r="1.5" fill="#e74c3c"/>
              <circle cx="7" cy="12" r="1.5" fill="#7c3aed"/>
            </svg>
            <span>支撑/阻力</span>
          </button>
          <button class="btn btn-chip" @click="$emit('open-chip-modal')">
            <svg width="18" height="18" viewBox="0 0 20 18" fill="none">
              <path d="M1 16 6 9l3.5 3L14 3l5 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              <circle cx="14" cy="3" r="2.8" fill="currentColor" opacity="0.85"/>
              <path d="M1 16h18" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
            <span>筹码峰</span>
          </button>
          <button class="btn btn-ai" @click="$emit('open-ai-modal')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L14.09 8.26L20 9.27L15.5 13.97L16.82 20L12 16.77L7.18 20L8.5 13.97L4 9.27L9.91 8.26L12 2Z" fill="currentColor" stroke="currentColor" stroke-width="0.5"/>
            </svg>
            <span>AI 分析</span>
          </button>
          <button
            class="btn btn-position"
            :class="{ 'in-position': selectedStock && isInPositions(selectedStock.code) }"
            @click="selectedStock && $emit('add-position', selectedStock)"
          >
            {{ selectedStock && isInPositions(selectedStock.code) ? "✓ 已持仓" : "+ 加入持仓" }}
          </button>
          <button
            class="btn btn-ghost"
            :class="{ 'in-watchlist': selectedStock && isInWatchlist(selectedStock.code) }"
            @click="selectedStock && $emit('toggle-watchlist', selectedStock)"
          >
            {{ selectedStock && isInWatchlist(selectedStock.code) ? "✓ 已自选" : "+ 加自选" }}
          </button>
        </div>
      </div>

      <!-- 图表切换标签 -->
      <div class="chart-tabs">
        <button
          class="chart-tab"
          :class="{ active: chartMode === 'kline' }"
          @click="switchChartMode('kline')"
        >K 线</button>
        <button
          class="chart-tab"
          :class="{ active: chartMode === 'intraday' }"
          @click="switchChartMode('intraday')"
        >分时</button>
      </div>

      <!-- K 线图 -->
      <div v-show="chartMode === 'kline'" class="kline-flex-wrap">
        <KlineChart
          ref="klineChartRef"
          :data="klineData"
          :loading="klineLoading"
          :period="klinePeriod"
          :markers="watchlistMarkers"
          :show-sr="showSR"
          :signal-markers="signalMarkers"
          :code="selectedStock?.code ?? ''"
          @change-period="emit('change-kline-period', $event)"
        />
      </div>

      <!-- 分时图 -->
      <div v-show="chartMode === 'intraday'" class="kline-flex-wrap">
        <IntradayChart
          :data="intradayData"
          :loading="intradayLoading"
          :signal-markers="signalMarkers"
          :code="selectedStock?.code ?? ''"
        />
      </div>

      <!-- 今开/最高/昨收/最低 已作为参考线叠加在分时图中（IntradayChart），此处只保留量额类指标 -->
            
            
      <div class="meta-grid">
        <div class="meta-item">
          <span class="meta-label">成交量</span>
          <span class="meta-value">{{ selectedStock.volume != null ? (selectedStock.volume / 10000).toFixed(2) + ' 万手' : '--' }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">成交额</span>
          <span class="meta-value">{{ selectedStock.turnover != null ? (selectedStock.turnover / 10000).toFixed(2) + ' 亿' : '--' }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">换手率</span>
          <span class="meta-value">{{ selectedStock.turnoverRate != null ? selectedStock.turnoverRate.toFixed(2) + '%' : '--' }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">市盈率</span>
          <span class="meta-value">{{ selectedStock.pe?.toFixed(2) ?? '--' }}</span>
        </div>
      </div>

      <!-- 操作按钮栏 -->
      <DetailActionBar
        :is-hk="isHK"
        :show-sr="showSR"
        :alert-count="alertCount"
        :selected-stock="selectedStock"
        :in-watchlist="selectedStock && isInWatchlist(selectedStock.code)"
        @open-industry-modal="emit('open-industry-modal')"
        @open-tech-modal="emit('open-tech-modal')"
        @toggle-sr="handleToggleSR"
        @open-chip-modal="emit('open-chip-modal')"
        @open-money-flow="showMoneyFlowModal = true"
        @open-alerts="showAlertsModal = true"
        @open-ai-modal="emit('open-ai-modal')"
        @toggle-watchlist="emit('toggle-watchlist', $event)"
      />
    </section>

    <!-- 空状态：未选中股票 -->
    <div v-else class="detail-empty">
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 42 20 28l8 7 12-16 8 9" />
        <path d="M8 42h40" opacity="0.4" />
        <circle cx="40" cy="12" r="5" opacity="0.5" />
      </svg>
      <p class="detail-empty-title">从左侧选择一只股票</p>
      <p class="detail-empty-sub">或按 Ctrl+K 搜索 · 问财选股窗口双击结果也可联动</p>
    </div>

    <!-- 资金流向弹窗（主力资金 + 分档 + T+0 信号 + 历史柱状图） -->
    <MoneyFlowModal
      :show="showMoneyFlowModal"
      :stock="selectedStock"
      :money-flow="moneyFlow"
      :money-flow-loading="moneyFlowLoading"
      :money-flow-history="moneyFlowHistory"
      :money-flow-history-loading="moneyFlowHistoryLoading"
      :t0-summary="t0Summary"
      :chart-mode="chartMode"
      @close="showMoneyFlowModal = false"
    />

    <!-- 合并提醒弹窗（均线提醒 / 价格提醒） -->
    <AlertsModal
      :show="showAlertsModal"
      :stock="selectedStock"
      :kline-data="klineData"
      :kline-period="klinePeriod"
      @close="showAlertsModal = false"
    />
  </main>

</template>

<style scoped>
/* ===== Steep: 详情区 ===== */
.main-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* ===== Steep: 详情卡片 — 24px 圆角 ===== */
.detail-card {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  padding: 28px 32px;
  box-shadow: var(--shadow-card);
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.stock-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  column-gap: 16px;
  row-gap: 10px;
  margin-bottom: 12px;
}

/* 左侧：名称 + 价格绑在一起，窄屏换行时按钮也不会插进中间 */
.stock-header-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 0 1 auto;
  min-width: 0;
}

.stock-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 30px;
}

.stock-tag {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 14px;
  border-radius: var(--radius-full);
  font-size: 13px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

/* 中国 A 股标准：红涨绿跌 */
.stock-tag.up {
  color: var(--red);
  background: var(--red-bg);
}

.stock-tag.down {
  color: var(--green);
  background: var(--green-bg);
}

.tag-arrow {
  font-size: 11px;
}

.stock-identity {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.stock-name {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.015em;
  white-space: nowrap;
  line-height: 1.2;
  margin: 0;
  color: var(--text-primary);
}

.stock-code {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

/* 市场标签 */
.market-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: var(--radius-full);
}
.market-badge.market-hk {
  color: #b45309;
  background: #fef3c7;
}

/* 自选以来涨跌幅徽标 */
.since-added {
  font-size: 12px;
  font-weight: 700;
  padding: 3px 12px;
  border-radius: var(--radius-full);
  white-space: nowrap;
}
.since-added.up {
  color: var(--red);
  background: var(--red-bg);
}
.since-added.down {
  color: var(--green);
  background: var(--green-bg);
}
.since-added-label {
  font-weight: 500;
  opacity: 0.75;
  margin-left: 2px;
}

/* ===== 价格区域 ===== */
.price-area {
  margin-bottom: 24px;
}

.price-main {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.price {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.4px;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.price.up { color: var(--red); }
.price.down { color: var(--green); }

.price-change {
  font-size: 14px;
  font-weight: 700;
}

.price-change.up { color: var(--red); }
.price-change.down { color: var(--green); }

.price-pct {
  font-size: 13px;
  font-weight: 600;
  padding: 3px 14px;
  border-radius: var(--radius-full);
  padding: 1px 8px;
  border-radius: 5px;
}

.price-pct.up {
  color: var(--red);
  background: var(--red-bg);
}

.price-pct.down {
  color: var(--green);
  background: var(--green-bg);
}

/* ===== 四维数据网格（紧凑横排，给图表留高） ===== */
/* ===== 四维数据网格 — 柔和卡片式 ===== */
.meta-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
  border-top: 1px solid var(--border);
  border-left: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 10px;
  flex-shrink: 0;
  gap: 10px;
  margin-bottom: 24px;
}

/* 窗口较窄时数据网格降为 2 列 */
@media (max-width: 1024px) {
  .meta-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .meta-grid {
    grid-template-columns: 1fr;
  }
}

.meta-item {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 10px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--fog);
}

.meta-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
  letter-spacing: 0.2px;
  flex-shrink: 0;
}

.meta-value {
  font-size: 13px;
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.meta-value.up { color: var(--red); }
.meta-value.down { color: var(--green); }

/* ===== 图表切换标签 — 胶囊分段控件 ===== */
/* ===== 主力资金流向 ===== */
.flow-section {
  margin-bottom: 8px;
  flex-shrink: 0;
}

.flow-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 0;
}

.flow-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  flex-shrink: 0;
  letter-spacing: -0.009em;
}

.flow-loading {
  font-size: 12px;
  color: var(--text-muted);
}

/* T+0 信号内联 */
.flow-sep {
  color: var(--border-light);
  font-size: 16px;
  margin: 0 6px;
  user-select: none;
}

.t0-badge-inline {
  font-size: 13px;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 4px;
  letter-spacing: -0.009em;
  white-space: nowrap;
  cursor: pointer;
}
.t0-badge-inline.dir-up {
  color: var(--red);
  background: rgba(231, 76, 60, 0.1);
}
.t0-badge-inline.dir-down {
  color: var(--green);
  background: rgba(39, 174, 96, 0.1);
}
.t0-badge-inline.dir-wait {
  color: var(--text-secondary);
  background: rgba(163, 166, 175, 0.12);
}

.t0-chip-inline {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  color: var(--rust);
  background: rgba(201, 94, 54, 0.1);
  white-space: nowrap;
  letter-spacing: -0.005em;
  cursor: pointer;
}

.flow-text {
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.flow-pct-text {
  font-size: 13px;
  font-weight: 600;
}

.flow-text.inflow,
.flow-pct-text.inflow { color: var(--red); }
.flow-text.outflow,
.flow-pct-text.outflow { color: var(--green); }

/* 分档资金明细（超大单/大单/中单/小单） */
.flow-tiers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 16px;
  margin-top: 6px;
}

.flow-tier {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
}

.tier-name {
  color: var(--text-secondary);
  font-size: 12px;
  flex-shrink: 0;
}

.tier-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.tier-pct {
  font-size: 12px;
  font-weight: 500;
}

.tier-value.inflow,
.tier-pct.inflow { color: var(--red); }
.tier-value.outflow,
.tier-pct.outflow { color: var(--green); }

/* ===== Steep: 操作按钮（详情右上角，右对齐且不挤压左侧名称） ===== */
.action-bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-content: flex-start;
  align-items: center;
  margin-left: auto;
  flex: 1 1 320px;
  min-width: min(100%, 280px);
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 14px;
  border: none;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
  letter-spacing: -0.009em;
  white-space: nowrap;
}

.btn svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

/* Steep: Primary CTA — Rust fill, full round */
.btn-industry {
  background: var(--rust);
  color: #fff;
  box-shadow: var(--shadow-card);
}
.btn-industry:hover {
  background: #4a2215;
  box-shadow: var(--shadow-elevated);
}

/* Steep: Secondary filled CTA — Ink fill */
.btn-tech {
  background: var(--ink);
  color: #fff;
  box-shadow: var(--shadow-card);
}
.btn-tech:hover {
  background: #2a2d30;
  box-shadow: var(--shadow-elevated);
}

/* Steep: Ghost button — 1px ink border */
.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  transition: all 0.15s;
}
.btn-ghost:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.btn-ghost.in-watchlist {
  color: var(--green);
  border-color: var(--green);
}
.btn-ghost.in-watchlist:hover {
  color: var(--red);
  border-color: var(--red);
}

/* Steep: SR toggle — ghost style */
.btn-sr {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  transition: all 0.15s;
}
.btn-sr:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.btn-sr.active {
  background: var(--apricot-wash);
  border-color: var(--rust);
  color: var(--rust);
}

/* Steep: 筹码峰按钮 — 山峰图标 + Purple 色调 */
.btn-chip {
  background: rgba(124, 58, 237, 0.08);
  color: #7c3aed;
  border: 1px solid rgba(124, 58, 237, 0.35);
  box-shadow: var(--shadow-card);
}
.btn-chip:hover {
  background: #7c3aed;
  color: #fff;
  border-color: #7c3aed;
  box-shadow: var(--shadow-elevated);
}

/* Steep: AI 分析按钮 — 星形图标 + Rust 色 */
.btn-ai {
  background: var(--apricot-wash);
  color: var(--rust);
  border: 1px solid var(--rust);
  box-shadow: var(--shadow-card);
}
.btn-ai:hover {
  background: var(--rust);
  color: #fff;
  box-shadow: var(--shadow-elevated);
}

/* 加入持仓 */
.btn-position {
  background: transparent;
  color: var(--red);
  border: 1px solid rgba(231, 76, 60, 0.45);
  transition: all 0.15s;
}
.btn-position:hover {
  background: var(--red-bg);
  border-color: var(--red);
  color: var(--red);
}
.btn-position.in-position {
  color: var(--green);
  border-color: var(--green);
  background: transparent;
}
.btn-position.in-position:hover {
  background: var(--green-bg);
}

/* 窄窗：按钮缩小，仍保持右对齐 */
@media (max-width: 1400px) {
  .action-bar {
    gap: 6px;
  }

  .btn {
    padding: 6px 11px;
    font-size: 11px;
    gap: 4px;
  }

  .btn svg {
    width: 12px;
    height: 12px;
  }
}

@media (max-width: 1100px) {
  .btn {
    padding: 6px 10px;
    font-size: 11px;
  }
}

/* Steep: 均线提醒按钮 — 铃铛图标 + Ghost 风格，启用时橙色高亮 */
.btn-ma {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  transition: all 0.15s;
  position: relative;
}
.btn-ma:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.btn-ma.active {
  background: var(--apricot-wash);
  border-color: var(--rust);
  color: var(--rust);
}

/* 已配置时显示周期数徽标 */
.ma-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--radius-full);
  background: var(--rust);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}

/* ===== 图表切换标签 ===== */
.chart-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 12px;
  background: var(--bg);
  border-radius: var(--radius-full);
  padding: 3px;
  width: fit-content;
}

.chart-tab {
  padding: 6px 18px;
  border: none;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
  letter-spacing: -0.01em;
}

.chart-tab.active {
  background: var(--card-bg);
  color: var(--text-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.chart-tab:hover:not(.active) {
  color: var(--text-secondary);
}

/* ===== K 线弹性填充 ===== */
.kline-flex-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.kline-flex-wrap :deep(.kline-wrapper) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-bottom: 0;
}

.kline-flex-wrap :deep(.kline-chart-wrap) {
  flex: 1;
  min-height: 0;
  height: auto;
  max-height: none;
}

.kline-flex-wrap :deep(.kline-chart) {
  height: 100%;
  min-height: 200px;
}

/* ===== 宽窗口（>1200px）：右侧详情更舒展 =====
   内容够高时一屏展示、无滚动条；内容超高时自动出现滚动条 */
@media (min-width: 1201px) {
  .main-content {
    overflow-y: auto;
  }
  .detail-card {
    padding: 20px 28px;
  }
  .stock-header {
    margin-bottom: 14px;
  }
  .price-area {
    margin-bottom: 16px;
  }
  .price {
    font-size: 36px;
  }
  .chart-tabs {
    margin-bottom: 10px;
  }
  /* 宽窗口：图表区域固定高度，不再弹性拉伸占满剩余空间。
     图表高度受控（360px），底部信息栏紧贴图表完整显示，
     既不产生图表与信息栏之间的空白，也不会因图表过大挤压信息栏 */
  .kline-flex-wrap {
    flex: none;
  }
  .kline-flex-wrap :deep(.kline-wrapper) {
    flex: none;
  }
  .kline-flex-wrap :deep(.kline-chart-wrap) {
    flex: none;
    height: 480px;
    max-height: none;
  }
  .kline-flex-wrap :deep(.kline-chart) {
    min-height: 0;
  }
  .kline-flex-wrap :deep(.intraday-wrapper) {
    flex: none;
  }
  .kline-flex-wrap :deep(.intraday-chart-wrap) {
    flex: none;
    height: 480px;
    max-height: none;
  }
  .kline-flex-wrap :deep(.intraday-chart) {
    min-height: 0;
  }
  .meta-grid {
    margin-bottom: 18px;
  }
  .meta-item {
    padding: 12px 14px;
  }
}

/* ===== 空状态 ===== */
.detail-empty {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
  background: var(--card-bg);
}
.detail-empty svg {
  opacity: 0.4;
  margin-bottom: 10px;
}
.detail-empty-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-secondary);
}
.detail-empty-sub {
  margin: 0;
  font-size: 12px;
  opacity: 0.8;
}
</style>
