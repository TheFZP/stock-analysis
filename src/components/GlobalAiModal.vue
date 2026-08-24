<script setup>
import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useAiAnalysis } from "../composables/useAiAnalysis";
import AiApiKeySetup from "./ai/AiApiKeySetup.vue";
import AiChatMessages from "./ai/AiChatMessages.vue";
import AiChatFooter from "./ai/AiChatFooter.vue";
import AiModelControls from "./ai/AiModelControls.vue";

const props = defineProps({
  show: { type: Boolean, default: false },
  indices: { type: Array, default: null },
  positions: { type: Array, default: () => [] },
  /** 问财窗口"AI 分析这批股票"注入请求 { question, total, columns, rows } */
  screeningRequest: { type: Object, default: null },
});

const emit = defineEmits(["close", "screening-consumed", "add-watchlist", "view-stock"]);

const {
  messages,
  loading,
  error,
  apiKey,
  setApiKey,
  sendGlobalMessage,
  injectContextMessage,
  clearHistory,
  switchGlobal,
} = useAiAnalysis(true);

// 弹窗打开时加载全局对话
watch(() => props.show, (val) => {
  if (val) {
    switchGlobal();
  }
});

const inputText = ref("");
const showApiKeyInput = ref(!apiKey.value);
const apiKeyInput = ref(apiKey.value);

// @代码 快捷引用的股票（发送时作为上下文注入，AI 直接分析无需现查行情）
const quickStock = ref(null);

watch(
  () => props.show,
  (val) => {
    if (val) {
      showApiKeyInput.value = !apiKey.value;
      apiKeyInput.value = apiKey.value;
    }
  }
);

function saveApiKey() {
  const key = apiKeyInput.value.trim();
  if (!key) return;
  setApiKey(key);
  showApiKeyInput.value = false;
}

function closeModal() {
  emit("close");
}

/** 解析文本中的 @代码（支持 sh/sz/hk 前缀，如 @600519 / @sh600519 / @00700） */
function parseAtCode(text) {
  const m = text.match(/@\s*(?:sh|sz|hk)?\s*(\d{5,6})/i);
  return m ? m[1] : null;
}

/** 代码 → 市场推断（5 位=港股，6 开头=沪市，其余=深市） */
function inferMarket(code) {
  if (/^\d{5}$/.test(code)) return "HK";
  return code.startsWith("6") ? "SH" : "SZ";
}

async function handleSend() {
  const text = inputText.value.trim();
  if (!text || loading.value) return;

  // 解析 @代码 → 拉取实时行情作为快捷引用上下文
  const atCode = parseAtCode(text);
  if (atCode && quickStock.value?.code !== atCode) {
    try {
      const quote = await invoke("get_stock_quote", { code: atCode });
      if (quote) {
        quickStock.value = { market: inferMarket(atCode), ...quote };
      }
    } catch {
      // 获取失败则不带股票上下文，仍按全局回答
    }
  }

  inputText.value = "";

  try {
    // 注入大盘指数 + 用户持仓 + 快捷股票上下文
    await sendGlobalMessage(text, quickStock.value, {
      indices: props.indices,
      positions: props.positions,
    });
  } catch (e) {
    if (e.message === "NO_API_KEY") {
      showApiKeyInput.value = true;
    }
  } finally {
    // @代码快捷引用只对当前消息生效：发送后清除，
    // 否则下一条无关消息仍会把该股作为上下文注入（AI 会误以为还在该股语境）
    quickStock.value = null;
  }
}

function handleClear() {
  clearHistory();
}

// ============ 问财选股结果 AI 解读 ============

/** 列选择白名单：只保留代码/名称/现价及条件相关列，控制注入 token */
function pickScreeningColumns(columns) {
  const ALWAYS = ["股票代码", "股票简称", "代码", "名称", "现价", "最新价"];
  const KEYWORDS = [
    "市值", "市盈率", "市净率", "净资产收益率", "roe", "净利润", "营收",
    "涨幅", "涨跌幅", "换手", "量比", "股息", "负债", "毛利", "自由流通", "成交",
  ];
  const picked = [];
  for (const col of columns || []) {
    if (picked.length >= 6) break;
    const n = String(col.name || col.key || "").toLowerCase();
    if (ALWAYS.some((a) => n.includes(a.toLowerCase())) || KEYWORDS.some((k) => n.includes(k))) {
      picked.push(col);
    }
  }
  if (!picked.some((c) => /代码/.test(String(c.name || "")))) {
    const codeCol = (columns || []).find((c) => /代码/.test(String(c.name || "")));
    if (codeCol) picked.unshift(codeCol);
  }
  if (!picked.some((c) => /简称|名称/.test(String(c.name || "")))) {
    const nameCol = (columns || []).find((c) => /简称|名称/.test(String(c.name || "")));
    if (nameCol) picked.unshift(nameCol);
  }
  return picked;
}

/** 把问财结果表渲染成 markdown 表格（整个列表，≤50 行） */
function buildScreeningPrompt(req) {
  const cols = pickScreeningColumns(req.columns);
  const rows = (req.rows || []).slice(0, 50);
  const header = cols.map((c) => c.name).join(" | ");
  const sep = cols.map(() => "---").join(" | ");
  const lines = rows.map((row) =>
    cols.map((c) => String(row[c.key] ?? row[c.name] ?? "--")).join(" | ")
  );
  const table = [header, sep, ...lines].join("\n");
  const total = req.total ?? rows.length;
  const countNote = total > rows.length ? `以下为前 ${rows.length} 条：` : `以下为全部 ${rows.length} 条：`;
  return (
    `[选股结果注入] 用户在问财中筛选「${req.question}」，共 ${total} 条，${countNote}\n` +
    table +
    `\n\n请基于以上真实数据解读：` +
    `1. 筛选逻辑是否合理、结果整体有什么特征（估值/行业/风险分布）；` +
    `2. 哪些股票值得关注（可对候选调用 get_stock_quote / get_stock_money_flow 验证）；` +
    `3. 有哪些风险点。` +
    `4. **超短线买入建议**：结合主力资金流向、换手率、量比、涨跌幅、量能与题材热度，` +
    `从列表中筛出**超短线值得买入**的股票（建议 3-10 只，按确定性从高到低排序），` +
    `每只说明买入逻辑与风险；必要时调用 get_stock_quote / get_stock_money_flow / get_stock_intraday 验证，` +
    `并用 render_stock_picks 把超短买入清单渲染成卡片。` +
    `5. 列表中没有符合超短买入条件的股票时，明确告知「当前列表无超短买入标的」，不要硬凑或编造。` +
    `若用户需要调整条件，也可用 stock_screener 工具重新筛选。`
  );
}

/** 触发选股结果 AI 解读（成功后才消费请求，失败保留以便 API Key 配置后重试） */
async function analyzeScreening(req) {
  try {
    await injectContextMessage(buildScreeningPrompt(req), {
      indices: props.indices,
      positions: props.positions,
    });
    emit("screening-consumed");
  } catch (e) {
    if (e.message === "NO_API_KEY") {
      showApiKeyInput.value = true;
    } else {
      error.value = `选股结果分析失败: ${e.message || e}`;
    }
  }
}

// 打开弹窗或收到新的选股结果注入请求时触发分析
watch(
  () => [props.show, props.screeningRequest],
  ([show, req]) => {
    if (show && req) analyzeScreening(req);
  }
);

// API Key 配置完成后，若有未消费的选股结果注入请求则自动重试
watch(showApiKeyInput, (v) => {
  if (!v || !props.show) return;
  if (props.screeningRequest) analyzeScreening(props.screeningRequest);
});

function doSuggestion(text) {
  if (loading.value) return;
  inputText.value = text;
  handleSend();
}

function removeQuickStock() {
  quickStock.value = null;
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="closeModal">
      <div class="modal-container">
        <!-- 头部 -->
        <div class="modal-header">
          <div class="modal-header-left">
            <span class="modal-title">AI</span>
            <span class="ai-badge">助手</span>

            <span class="ctrl-divider"></span>

            <AiModelControls />
          </div>
          <div class="modal-header-actions">
            <button v-if="messages.length > 0" class="btn-close" @click="handleClear" title="清空对话">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M5 4V2.5A.5.5 0 015.5 2h5a.5.5 0 01.5.5V4M3 4l1 9.5a1 1 0 001 1h6a1 1 0 001-1L13 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <button class="btn-close" @click="closeModal">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <!-- 主体 -->
        <div class="modal-body">
          <!-- 错误提示 -->
          <div v-if="error && !showApiKeyInput" class="error-banner">
            <span class="error-icon">⚠️</span>
            <span class="error-text">{{ error }}</span>
          </div>

          <!-- API Key 设置 -->
          <AiApiKeySetup
            v-if="showApiKeyInput"
            :api-key-input="apiKeyInput"
            @save="saveApiKey"
            @update:api-key-input="apiKeyInput = $event"
          />

          <!-- 对话区域 -->
          <AiChatMessages
            v-else
            :messages="messages"
            :loading="loading"
            :selected-stock="null"
            :global-mode="true"
            @suggestion="doSuggestion"
            @add-watchlist="emit('add-watchlist', $event)"
            @view-stock="emit('view-stock', $event)"
          />
        </div>

        <!-- 底部输入 -->
        <AiChatFooter
          v-if="!showApiKeyInput"
          :input-text="inputText"
          :disabled="loading"
          :selected-stock="quickStock"
          :loading="loading"
          :global-mode="true"
          @send="handleSend"
          @update:input-text="inputText = $event"
          @remove-context="removeQuickStock"
        />
      </div>
    </div>
  </Teleport>
</template>

<style>
@import "../assets/modal.css";
</style>

<style scoped>

/* GlobalAiModal 特有样式：覆盖宽高（与 AiAnalysisModal 保持一致） */
.modal-container {
  width: 900px;
  height: 680px;
}
</style>
