const STORAGE_KEY = "stock-ledger-v1";
const CLOUD_CONFIG = window.STOCK_LEDGER_SUPABASE || {};
const CLOUD_TABLE = CLOUD_CONFIG.table || "stock_ledger_state";
const CLOUD_ROW_ID = CLOUD_CONFIG.rowId || "main";

const state = loadState();
let cloudClient = null;
let cloudSaveTimer = null;
let editingHistoryDate = "";
const openHistoryMonths = new Set();
let editingHoldingId = "";
let editingFundId = "";

const pieColorFamilies = [
  ["#fee2e2", "#fecaca", "#fca5a5", "#f87171"],
  ["#ffedd5", "#fed7aa", "#fdba74", "#fb923c"],
  ["#fff2b8", "#ffd966", "#ffcc00"],
  ["#dcfce7", "#bbf7d0", "#86efac", "#4ade80"],
  ["#e0f2fe", "#bae6fd", "#7dd3fc", "#38bdf8"],
  ["#e0e7ff", "#a5b4fc", "#6366f1", "#4338ca"],
  ["#fae8ff", "#f0abfc", "#d946ef", "#a21caf"],
];

const assetChartColors = {
  cashFill: "#fee2e2",
  cashLine: "#f87171",
  stockFill: "#dbeafe",
  stockLine: "#60a5fa",
  cryptoFill: "#ffedd5",
  cryptoLine: "#fb923c",
  fundFill: "#dcfce7",
  fundLine: "#4ade80",
};

const chineseNameSorter = new Intl.Collator("zh-Hant-u-co-stroke", {
  numeric: true,
  sensitivity: "base",
});

const stockCodeOrder = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const els = {
  form: document.querySelector("#holdingForm"),
  fundForm: document.querySelector("#fundForm"),
  cryptoForm: document.querySelector("#cryptoForm"),
  symbol: document.querySelector("#symbolInput"),
  name: document.querySelector("#nameInput"),
  shares: document.querySelector("#sharesInput"),
  cost: document.querySelector("#costInput"),
  price: document.querySelector("#priceInput"),
  fundName: document.querySelector("#fundNameInput"),
  fundCost: document.querySelector("#fundCostInput"),
  fundAmount: document.querySelector("#fundAmountInput"),
  cryptoName: document.querySelector("#cryptoNameInput"),
  cryptoSide: document.querySelector("#cryptoSideInput"),
  cryptoLeverage: document.querySelector("#cryptoLeverageInput"),
  cryptoMargin: document.querySelector("#cryptoMarginInput"),
  cryptoQuantity: document.querySelector("#cryptoQuantityInput"),
  cryptoEntryPrice: document.querySelector("#cryptoEntryPriceInput"),
  cryptoCurrentPrice: document.querySelector("#cryptoCurrentPriceInput"),
  cryptoFxRate: document.querySelector("#cryptoFxRateInput"),
  cash: document.querySelector("#cashInput"),
  holdingsBody: document.querySelector("#holdingsBody"),
  fundsBody: document.querySelector("#fundsBody"),
  cryptoList: document.querySelector("#cryptoList"),
  settlementDate: document.querySelector("#settlementDate"),
  settlementNote: document.querySelector("#settlementNote"),
  settlementRows: document.querySelector("#settlementRows"),
  settleBtn: document.querySelector("#settleBtn"),
  importBtn: document.querySelector("#importBtn"),
  importFile: document.querySelector("#importFile"),
  exportBtn: document.querySelector("#exportBtn"),
  totalValue: document.querySelector("#totalValue"),
  cashTotal: document.querySelector("#cashTotal"),
  totalCost: document.querySelector("#totalCost"),
  stockTotal: document.querySelector("#stockTotal"),
  stockCost: document.querySelector("#stockCost"),
  fundTotal: document.querySelector("#fundTotal"),
  fundCost: document.querySelector("#fundCost"),
  cryptoTotal: document.querySelector("#cryptoTotal"),
  cryptoCost: document.querySelector("#cryptoCost"),
  stockPnl: document.querySelector("#stockPnl"),
  stockPnlPct: document.querySelector("#stockPnlPct"),
  fundPnl: document.querySelector("#fundPnl"),
  fundPnlPct: document.querySelector("#fundPnlPct"),
  cryptoPnl: document.querySelector("#cryptoPnl"),
  cryptoPnlPct: document.querySelector("#cryptoPnlPct"),
  totalPnl: document.querySelector("#totalPnl"),
  totalPnlPct: document.querySelector("#totalPnlPct"),
  statusText: document.querySelector("#statusText"),
  assetCharts: Array.from(document.querySelectorAll("[data-asset-chart]")),
  pieChart: document.querySelector("#stockPieChart"),
  categoryPieChart: document.querySelector("#categoryPieChart"),
  historyList: document.querySelector("#historyList"),
  emptyTemplate: document.querySelector("#emptyTemplate"),
};

els.settlementDate.value = formatDateForInput(todayISO());
els.cash.value = state.cash ? String(state.cash) : "";

els.form.addEventListener("submit", (event) => {
  event.preventDefault();

  const holding = {
    id: crypto.randomUUID(),
    symbol: normalizeSymbol(els.symbol.value),
    name: els.name.value.trim(),
    shares: toNumber(els.shares.value),
    avgCost: toNumber(els.cost.value),
    currentPrice: toOptionalNumber(els.price.value),
    lastUpdated: "",
  };

  state.holdings.push(holding);
  saveAndRender("已新增股票。");
  els.form.reset();
  els.symbol.focus();
});

els.fundForm.addEventListener("submit", (event) => {
  event.preventDefault();

  state.funds.push({
    id: crypto.randomUUID(),
    name: els.fundName.value.trim(),
    cost: toNumber(els.fundCost.value),
    currentValue: toNumber(els.fundAmount.value),
    lastUpdated: "",
  });
  saveAndRender("已新增基金。");
  els.fundForm.reset();
  els.fundName.focus();
});

els.cryptoForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.cryptoContracts.push({
    id: crypto.randomUUID(),
    name: normalizeSymbol(els.cryptoName.value),
    side: els.cryptoSide.value === "short" ? "short" : "long",
    leverage: Math.max(1, toNumber(els.cryptoLeverage.value)),
    marginUsdt: toNumber(els.cryptoMargin.value),
    quantity: toNumber(els.cryptoQuantity.value),
    entryPrice: toNumber(els.cryptoEntryPrice.value),
    currentPrice: toNumber(els.cryptoCurrentPrice.value),
    fxRate: toNumber(els.cryptoFxRate.value),
  });
  saveAndRender("已新增加密貨幣合約。");
  els.cryptoForm.reset();
  els.cryptoName.value = "BTCUSDT";
  els.cryptoFxRate.value = "32.5";
  els.cryptoName.focus();
});

els.cryptoList.addEventListener("change", (event) => {
  const input = event.target.closest("[data-crypto-field]");
  if (!input) return;
  const contract = findCryptoContract(input.dataset.cryptoId);
  if (!contract) return;
  const field = input.dataset.cryptoField;
  contract[field] = field === "side"
    ? (input.value === "short" ? "short" : "long")
    : field === "leverage"
      ? Math.max(1, toNumber(input.value))
      : toNumber(input.value);
  saveAndRender("已更新加密貨幣合約。");
});

els.cryptoList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-crypto-id]");
  if (!button) return;
  const contract = findCryptoContract(button.dataset.deleteCryptoId);
  if (!contract || !confirm(`確定刪除 ${contract.name || "這筆加密貨幣合約"}？`)) return;
  state.cryptoContracts = state.cryptoContracts.filter((item) => item.id !== contract.id);
  saveAndRender("已刪除加密貨幣合約。");
});

els.holdingsBody.addEventListener("change", (event) => {
  const input = event.target.closest("[data-price-id]");
  if (!input) return;
  const holding = findHolding(input.dataset.priceId);
  if (!holding) return;
  holding.currentPrice = toOptionalNumber(input.value);
  holding.lastUpdated = holding.currentPrice === null ? "" : "手動";
  saveAndRender();
});

els.holdingsBody.addEventListener("click", (event) => {
  const editBtn = event.target.closest("[data-edit-id]");
  if (editBtn) {
    editingHoldingId = editBtn.dataset.editId;
    renderHoldings();
    return;
  }

  const cancelBtn = event.target.closest("[data-edit-cancel-id]");
  if (cancelBtn) {
    editingHoldingId = "";
    renderHoldings();
    return;
  }

  const saveBtn = event.target.closest("[data-edit-save-id]");
  if (saveBtn) {
    const holding = findHolding(saveBtn.dataset.editSaveId);
    const editRow = saveBtn.closest("[data-edit-row]");
    if (!holding || !editRow) return;
    const symbol = normalizeSymbol(editRow.querySelector("[data-edit-field='symbol']").value);
    if (!symbol) {
      setStatus("股號不能空白。");
      return;
    }
    holding.name = editRow.querySelector("[data-edit-field='name']").value.trim();
    holding.symbol = symbol;
    holding.shares = toNumber(editRow.querySelector("[data-edit-field='shares']").value);
    holding.avgCost = toNumber(editRow.querySelector("[data-edit-field='avgCost']").value);
    editingHoldingId = "";
    saveAndRender("已更新股票資料。");
    return;
  }

  const deleteBtn = event.target.closest("[data-delete-id]");
  if (!deleteBtn) return;
  const holding = findHolding(deleteBtn.dataset.deleteId);
  if (!holding) return;
  const label = holding.name || holding.symbol || "這筆股票";
  if (!confirm(`確定刪除 ${label}？`)) return;
  const index = state.holdings.findIndex((item) => item.id === deleteBtn.dataset.deleteId);
  if (index >= 0) {
    state.holdings.splice(index, 1);
    if (editingHoldingId === deleteBtn.dataset.deleteId) editingHoldingId = "";
    saveAndRender("已刪除股票。");
  }
});

els.fundsBody.addEventListener("change", (event) => {
  const valueInput = event.target.closest("[data-fund-value-id]");
  const costInput = event.target.closest("[data-fund-cost-id]");
  if (!valueInput && !costInput) return;
  const fund = findFund(valueInput?.dataset.fundValueId || costInput?.dataset.fundCostId);
  if (!fund) return;
  if (valueInput) fund.currentValue = toOptionalNumber(valueInput.value) ?? 0;
  if (costInput) fund.cost = toOptionalNumber(costInput.value) ?? 0;
  fund.lastUpdated = "手動";
  saveAndRender();
});

els.cash.addEventListener("change", () => {
  state.cash = toNumber(els.cash.value);
  els.cash.value = state.cash ? String(state.cash) : "";
  saveAndRender("已更新現金水位。");
});

els.fundsBody.addEventListener("click", (event) => {
  const editBtn = event.target.closest("[data-edit-fund-id]");
  if (editBtn) {
    editingFundId = editBtn.dataset.editFundId;
    renderFunds();
    return;
  }

  const cancelBtn = event.target.closest("[data-edit-fund-cancel-id]");
  if (cancelBtn) {
    editingFundId = "";
    renderFunds();
    return;
  }

  const saveBtn = event.target.closest("[data-edit-fund-save-id]");
  if (saveBtn) {
    const fund = findFund(saveBtn.dataset.editFundSaveId);
    const editRow = saveBtn.closest("[data-edit-fund-row]");
    if (!fund || !editRow) return;
    const name = editRow.querySelector("[data-edit-fund-field='name']").value.trim();
    if (!name) {
      setStatus("基金名稱不能空白。");
      return;
    }
    fund.name = name;
    fund.cost = toNumber(editRow.querySelector("[data-edit-fund-field='cost']").value);
    fund.currentValue = toNumber(editRow.querySelector("[data-edit-fund-field='currentValue']").value);
    fund.lastUpdated = "手動";
    editingFundId = "";
    saveAndRender("已更新基金資料。");
    return;
  }

  const deleteBtn = event.target.closest("[data-delete-fund-id]");
  if (!deleteBtn) return;
  const fund = findFund(deleteBtn.dataset.deleteFundId);
  if (!fund) return;
  if (!confirm(`確定刪除 ${fund.name || "這筆基金"}？`)) return;
  const index = state.funds.findIndex((item) => item.id === deleteBtn.dataset.deleteFundId);
  if (index >= 0) {
    state.funds.splice(index, 1);
    if (editingFundId === deleteBtn.dataset.deleteFundId) editingFundId = "";
    saveAndRender("已刪除基金。");
  }
});

els.settleBtn.addEventListener("click", () => {
  if (!state.holdings.length && !state.funds.length && !state.cryptoContracts.length && !state.cash) {
    setStatus("請先新增股票、基金、加密貨幣合約或現金水位。");
    return;
  }

  const date = parseDateInput(els.settlementDate.value) || todayISO();
  els.settlementDate.value = formatDateForInput(date);
  let stockTotal = 0;
  let fundTotal = 0;
  let stockCost = 0;
  let fundCost = 0;
  let cryptoTotal = 0;
  let cryptoCost = 0;
  const prices = {};
  const fundValues = {};
  const cryptoValues = {};

  for (const holding of state.holdings) {
    const price = holding.currentPrice ?? holding.avgCost;
    prices[holding.id] = price;
    holding.currentPrice = price;
    stockTotal += holding.shares * price;
    stockCost += holding.shares * holding.avgCost;
  }

  for (const fund of state.funds) {
    const value = fund.currentValue ?? 0;
    fundValues[fund.id] = value;
    fund.currentValue = value;
    fundTotal += value;
    fundCost += fund.cost || 0;
  }

  for (const contract of state.cryptoContracts) {
    const position = calculateCryptoPosition(contract);
    cryptoValues[contract.id] = position.currentValueTwd;
    cryptoTotal += position.currentValueTwd;
    cryptoCost += position.costTwd;
  }

  state.currentFundTotal = fundTotal;
  const existingIndex = state.history.findIndex((item) => item.date === date);
  const existingRecord = existingIndex >= 0 ? state.history[existingIndex] : null;
  const note = els.settlementNote.value.trim() || existingRecord?.note || "";
  const cash = toNumber(state.cash);
  const total = stockTotal + fundTotal + cryptoTotal + cash;
  const cost = stockCost + fundCost + cryptoCost;
  const record = {
    date,
    total,
    stockTotal,
    fundTotal,
    cryptoTotal,
    cash,
    cashRecorded: cash > 0,
    stockCost,
    fundCost,
    cryptoCost,
    cost,
    pnl: stockTotal + fundTotal + cryptoTotal - cost,
    prices,
    fundValues,
    cryptoValues,
    note,
  };
  if (existingIndex >= 0) {
    state.history[existingIndex] = record;
  } else {
    state.history.push(record);
  }
  state.history.sort((a, b) => a.date.localeCompare(b.date));
  els.settlementNote.value = "";

  saveAndRender(`已記錄 ${date} 的資產總額。`);
});

els.exportBtn.addEventListener("click", async () => {
  const fileName = `stock-ledger-${todayISO()}.json`;
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });

  if (navigator.canShare && navigator.share) {
    const file = new File([blob], fileName, { type: "application/json" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "股票記帳本資料備份" });
        setStatus("資料已匯出。");
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.target = "_blank";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus("資料已匯出。");
});

els.importBtn.addEventListener("click", () => {
  els.importFile.click();
});

els.importFile.addEventListener("change", async () => {
  const file = els.importFile.files?.[0];
  if (!file) return;

  try {
    const imported = migrateState(JSON.parse(await file.text()));
    if (!confirm("匯入會用備份檔覆蓋目前畫面中的資料，確定要匯入？")) return;
    state.holdings = imported.holdings;
    state.funds = imported.funds;
    state.cryptoContracts = imported.cryptoContracts;
    state.history = imported.history;
    state.currentFundTotal = imported.currentFundTotal;
    state.cash = imported.cash;
    els.cash.value = state.cash ? String(state.cash) : "";
    saveAndRender("資料已匯入。");
  } catch {
    setStatus("匯入失敗，請確認檔案是本 app 匯出的 JSON。");
  } finally {
    els.importFile.value = "";
  }
});

els.historyList.addEventListener("click", (event) => {
  const monthToggle = event.target.closest("[data-history-month-toggle]");
  if (monthToggle) {
    const month = monthToggle.dataset.historyMonthToggle;
    if (openHistoryMonths.has(month)) {
      openHistoryMonths.delete(month);
    } else {
      openHistoryMonths.add(month);
    }
    renderHistory();
    return;
  }

  const button = event.target.closest("[data-history-action]");
  if (!button) return;

  const date = button.dataset.historyDate;
  const action = button.dataset.historyAction;
  const record = state.history.find((item) => item.date === date);
  if (!record) return;

  if (action === "toggle-note") {
    const card = button.closest("[data-history-card]");
    const note = card?.querySelector("[data-history-note]");
    if (!note) return;
    const isOpen = note.hidden;
    note.hidden = !isOpen;
    button.setAttribute("aria-expanded", String(isOpen));
    return;
  }

  if (action === "unlock") {
    editingHistoryDate = date;
    openHistoryMonths.add(String(date || "").slice(0, 7));
    renderHistory();
    return;
  }

  if (action === "cancel") {
    editingHistoryDate = "";
    renderHistory();
    return;
  }

  if (action === "delete") {
    if (!confirm(`確定刪除 ${date} 的歷史紀錄？`)) return;
    state.history = state.history.filter((item) => item.date !== date);
    editingHistoryDate = "";
    saveAndRender(`已刪除 ${date} 的歷史紀錄。`);
    return;
  }

  if (action === "save") {
    const card = button.closest("[data-history-card]");
    const nextDate = parseDateInput(card.querySelector("[data-history-field='date']").value) || date;
    if (nextDate !== date && state.history.some((item) => item.date === nextDate)) {
      setStatus(`${nextDate} 已經有紀錄，請先改成其他日期。`);
      return;
    }

    const stockTotal = toNumber(card.querySelector("[data-history-field='stockTotal']").value);
    const fundTotal = toNumber(card.querySelector("[data-history-field='fundTotal']").value);
    const stockCost = toNumber(card.querySelector("[data-history-field='stockCost']").value);
    const fundCost = toNumber(card.querySelector("[data-history-field='fundCost']").value);
    const cryptoTotal = toNumber(card.querySelector("[data-history-field='cryptoTotal']").value);
    const cryptoCost = toNumber(card.querySelector("[data-history-field='cryptoCost']").value);
    const cash = toNumber(card.querySelector("[data-history-field='cash']").value);
    const note = card.querySelector("[data-history-field='note']").value.trim();
    record.date = nextDate;
    record.stockTotal = stockTotal;
    record.fundTotal = fundTotal;
    record.cash = cash;
    record.cashRecorded = cash > 0;
    record.stockCost = stockCost;
    record.fundCost = fundCost;
    record.cryptoTotal = cryptoTotal;
    record.cryptoCost = cryptoCost;
    record.total = stockTotal + fundTotal + cryptoTotal + cash;
    record.cost = stockCost + fundCost + cryptoCost;
    record.pnl = stockTotal + fundTotal + cryptoTotal - record.cost;
    record.note = note;
    state.history.sort((a, b) => a.date.localeCompare(b.date));
    editingHistoryDate = "";
    openHistoryMonths.add(String(nextDate || "").slice(0, 7));
    saveAndRender(`已更新 ${nextDate} 的歷史紀錄。`);
  }
});

window.addEventListener("resize", drawCharts);

function render() {
  renderSummary();
  renderHoldings();
  renderFunds();
  renderCryptoContracts();
  renderSettlementRows();
  renderHistory();
  drawCharts();
}

function renderSummary() {
  const totals = getPortfolioTotals();
  els.totalValue.textContent = money(totals.value);
  els.cashTotal.textContent = money(totals.cash);
  els.totalCost.textContent = money(totals.cost);
  els.stockTotal.textContent = money(totals.stockTotal);
  els.stockCost.textContent = money(totals.stockCost);
  els.fundTotal.textContent = money(totals.fundTotal);
  els.fundCost.textContent = money(totals.fundCost);
  els.cryptoTotal.textContent = money(totals.cryptoTotal);
  els.cryptoCost.textContent = money(totals.cryptoCost);
  els.stockPnl.textContent = signedMoney(totals.stockPnl);
  els.stockPnlPct.textContent = signedPercent(totals.stockPnlPct);
  els.fundPnl.textContent = signedMoney(totals.fundPnl);
  els.fundPnlPct.textContent = signedPercent(totals.fundPnlPct);
  els.cryptoPnl.textContent = signedMoney(totals.cryptoPnl);
  els.cryptoPnlPct.textContent = signedPercent(totals.cryptoPnlPct);
  els.totalPnl.textContent = signedMoney(totals.pnl);
  els.totalPnlPct.textContent = signedPercent(totals.pnlPct);
  els.stockPnl.className = totals.stockPnl >= 0 ? "gain" : "loss";
  els.stockPnlPct.className = totals.stockPnl >= 0 ? "gain" : "loss";
  els.fundPnl.className = totals.fundPnl >= 0 ? "gain" : "loss";
  els.fundPnlPct.className = totals.fundPnl >= 0 ? "gain" : "loss";
  els.cryptoPnl.className = totals.cryptoPnl >= 0 ? "gain" : "loss";
  els.cryptoPnlPct.className = totals.cryptoPnl >= 0 ? "gain" : "loss";
  els.totalPnl.className = totals.pnl >= 0 ? "gain" : "loss";
  els.totalPnlPct.className = totals.pnl >= 0 ? "gain" : "loss";
}

function renderHoldings() {
  els.holdingsBody.innerHTML = "";

  if (!state.holdings.length) {
    els.holdingsBody.append(els.emptyTemplate.content.cloneNode(true));
    return;
  }

  const sortedHoldings = [...state.holdings].sort(compareHoldingsByDisplayName);

  for (const holding of sortedHoldings) {
    const price = holding.currentPrice ?? 0;
    const marketValue = holding.shares * price;
    const costValue = holding.shares * holding.avgCost;
    const pnl = marketValue - costValue;
    const pnlPct = costValue ? (pnl / costValue) * 100 : 0;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${escapeHTML(holding.name || holding.symbol)}</strong>
        <span class="stock-name">${escapeHTML(holding.symbol)}</span>
      </td>
      <td class="shares-cell">${formatNumber(holding.shares, 3)}</td>
      <td class="cost-cell">${unitMoney(holding.avgCost)}</td>
      <td class="price-cell">
        <input data-price-id="${holding.id}" type="number" min="0" step="0.01" value="${holding.currentPrice ?? ""}" aria-label="${escapeHTML(holding.symbol)} 現價" />
      </td>
      <td class="amount-cell">${money(costValue)}</td>
      <td class="amount-cell">${money(marketValue)}</td>
      <td class="pnl-cell ${pnl >= 0 ? "gain" : "loss"}">
        ${signedMoney(pnl)}
        <span class="stock-name">${formatNumber(pnlPct)}%</span>
      </td>
      <td>
        <div class="row-actions">
          <button class="mini-btn" data-edit-id="${escapeHTML(holding.id)}" type="button" aria-label="修改 ${escapeHTML(holding.symbol)}">${editIcon()}</button>
          <button class="mini-btn" data-delete-id="${escapeHTML(holding.id)}" type="button" aria-label="刪除 ${escapeHTML(holding.symbol)}">x</button>
        </div>
      </td>
    `;
    els.holdingsBody.append(row);

    if (editingHoldingId === holding.id) {
      const editRow = document.createElement("tr");
      editRow.className = "edit-holding-row";
      editRow.dataset.editRow = holding.id;
      editRow.innerHTML = `
        <td colspan="8">
          <div class="edit-holding-form">
            <label>
              中文名
              <input data-edit-field="name" autocomplete="off" value="${escapeHTML(holding.name || "")}" />
            </label>
            <label>
              股號
              <input data-edit-field="symbol" autocomplete="off" value="${escapeHTML(holding.symbol || "")}" />
            </label>
            <label>
              張數
              <input data-edit-field="shares" type="number" min="0" step="0.001" value="${holding.shares}" />
            </label>
            <label>
              買入價格
              <input data-edit-field="avgCost" type="number" min="0" step="0.01" value="${holding.avgCost}" />
            </label>
            <button class="primary-btn" data-edit-save-id="${escapeHTML(holding.id)}" type="button">儲存</button>
            <button class="secondary-btn" data-edit-cancel-id="${escapeHTML(holding.id)}" type="button">取消</button>
          </div>
        </td>
      `;
      els.holdingsBody.append(editRow);
    }
  }
}

function renderFunds() {
  els.fundsBody.innerHTML = "";

  if (!state.funds.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="5" class="empty-cell">尚未新增基金</td>';
    els.fundsBody.append(row);
    return;
  }

  for (const fund of state.funds) {
    const pnl = (fund.currentValue || 0) - (fund.cost || 0);
    const pnlPct = fund.cost ? (pnl / fund.cost) * 100 : 0;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${escapeHTML(fund.name)}</strong>
        <span class="stock-name">${escapeHTML(fund.lastUpdated || "基金")}</span>
      </td>
      <td class="fund-input-cell">
        <input data-fund-cost-id="${fund.id}" type="number" min="0" step="0.01" value="${fund.cost ?? 0}" aria-label="${escapeHTML(fund.name)} 基金成本" />
      </td>
      <td class="fund-input-cell">
        <input data-fund-value-id="${fund.id}" type="number" min="0" step="0.01" value="${fund.currentValue ?? 0}" aria-label="${escapeHTML(fund.name)} 目前總額" />
      </td>
      <td class="fund-pnl-cell ${pnl >= 0 ? "gain" : "loss"}">
        <div class="fund-bottom-line">
          <div class="fund-pnl-line">
            <span>${signedMoney(pnl)}</span>
            <span class="stock-name">${signedPercent(pnlPct)}</span>
          </div>
          <div class="row-actions">
            <button class="mini-btn" data-delete-fund-id="${escapeHTML(fund.id)}" type="button" aria-label="刪除 ${escapeHTML(fund.name)}">x</button>
          </div>
        </div>
      </td>
      <td class="fund-actions-cell"></td>
    `;
    els.fundsBody.append(row);

    if (editingFundId === fund.id) {
      const editRow = document.createElement("tr");
      editRow.className = "edit-fund-row";
      editRow.dataset.editFundRow = fund.id;
      editRow.innerHTML = `
        <td colspan="5">
          <div class="edit-fund-form">
            <label>
              基金名稱
              <input data-edit-fund-field="name" autocomplete="off" value="${escapeHTML(fund.name || "")}" />
            </label>
            <label>
              基金成本
              <input data-edit-fund-field="cost" type="number" min="0" step="1" value="${fund.cost ?? 0}" />
            </label>
            <label>
              目前總額
              <input data-edit-fund-field="currentValue" type="number" min="0" step="1" value="${fund.currentValue ?? 0}" />
            </label>
            <button class="primary-btn" data-edit-fund-save-id="${escapeHTML(fund.id)}" type="button">儲存</button>
            <button class="secondary-btn" data-edit-fund-cancel-id="${escapeHTML(fund.id)}" type="button">取消</button>
          </div>
        </td>
      `;
      els.fundsBody.append(editRow);
    }
  }
}

function renderCryptoContracts() {
  els.cryptoList.innerHTML = "";

  if (!state.cryptoContracts.length) {
    const empty = document.createElement("p");
    empty.className = "status-text";
    empty.textContent = "尚未新增加密貨幣合約";
    els.cryptoList.append(empty);
    return;
  }

  for (const contract of state.cryptoContracts) {
    const position = calculateCryptoPosition(contract);
    const card = document.createElement("article");
    card.className = "crypto-card";
    card.innerHTML = `
      <div class="crypto-card-head">
        <strong>${escapeHTML(contract.name)}</strong>
        <span class="crypto-leverage">${contract.side === "short" ? "做空" : "做多"}・${formatNumber(contract.leverage)}x</span>
      </div>
      <div class="crypto-card-fields">
      <label>
        方向
        <select data-crypto-id="${escapeHTML(contract.id)}" data-crypto-field="side">
          <option value="long"${contract.side === "long" ? " selected" : ""}>做多</option>
          <option value="short"${contract.side === "short" ? " selected" : ""}>做空</option>
        </select>
      </label>
      <label>
        合約倍數
        <input data-crypto-id="${escapeHTML(contract.id)}" data-crypto-field="leverage" type="number" min="1" step="1" value="${contract.leverage}" />
      </label>
      <label>
        保證金 USDT
        <input data-crypto-id="${escapeHTML(contract.id)}" data-crypto-field="marginUsdt" type="number" min="0" step="0.01" value="${contract.marginUsdt}" />
      </label>
      <label>
        持倉數量 BTC
        <input data-crypto-id="${escapeHTML(contract.id)}" data-crypto-field="quantity" type="number" min="0" step="0.000001" value="${contract.quantity}" />
      </label>
      <label>
        開倉價
        <input data-crypto-id="${escapeHTML(contract.id)}" data-crypto-field="entryPrice" type="number" min="0" step="0.01" value="${contract.entryPrice}" />
      </label>
      <label>
        目前價
        <input data-crypto-id="${escapeHTML(contract.id)}" data-crypto-field="currentPrice" type="number" min="0" step="0.01" value="${contract.currentPrice}" />
      </label>
      <label>
        USDT/TWD
        <input data-crypto-id="${escapeHTML(contract.id)}" data-crypto-field="fxRate" type="number" min="0" step="0.001" value="${contract.fxRate}" />
      </label>
      </div>
      <div class="crypto-position-details">
        <span>開倉部位 <strong>${formatNumber(position.notionalUsdt, 2)}</strong></span>
        <span>BTC 數量 <strong>${formatNumber(position.quantity, 6)}</strong></span>
        <span>未實現損益 <strong>${signedNumber(position.pnlUsdt, 2)}</strong></span>
        <span>目前權益 <strong>${formatNumber(position.equityUsdt, 2)}</strong></span>
      </div>
      <div class="crypto-card-bottom ${position.pnlTwd >= 0 ? "gain" : "loss"}">
        <span class="crypto-pnl-label">損益</span>
        <div class="fund-bottom-line">
          <div class="fund-pnl-line">
            <span>${signedMoney(position.pnlTwd)}</span>
            <span class="stock-name">${signedPercent(position.pnlPct)}</span>
          </div>
          <div class="row-actions">
            <button class="mini-btn" data-delete-crypto-id="${escapeHTML(contract.id)}" type="button" aria-label="刪除 ${escapeHTML(contract.name)}">x</button>
          </div>
        </div>
      </div>
    `;
    els.cryptoList.append(card);
  }
}

function renderSettlementRows() {
  els.settlementRows.innerHTML = "";

  if (!state.holdings.length && !state.funds.length && !state.cryptoContracts.length && !state.cash) {
    const empty = document.createElement("p");
    empty.className = "status-text";
    empty.textContent = "尚未新增股票、基金、加密貨幣合約或現金水位";
    els.settlementRows.append(empty);
    return;
  }

  const totals = getPortfolioTotals();
  const summary = document.createElement("div");
  summary.className = "settlement-summary";
  summary.innerHTML = `
    <div>
      <span>現金</span>
      <strong>${money(totals.cash)}</strong>
    </div>
    <div>
      <span>股票</span>
      <strong>${money(totals.stockTotal)}</strong>
    </div>
    <div>
      <span>基金</span>
      <strong>${money(totals.fundTotal)}</strong>
    </div>
    <div>
      <span>加密</span>
      <strong>${money(totals.cryptoTotal)}</strong>
    </div>
    <div>
      <span>資產總和</span>
      <strong>${money(totals.value)}</strong>
    </div>
  `;
  els.settlementRows.append(summary);
}

function renderHistory() {
  els.historyList.innerHTML = "";
  const historyItems = [...state.history].sort((a, b) => a.date.localeCompare(b.date));
  const monthGroups = new Map();
  const monthLists = new Map();

  for (const item of historyItems) {
    const month = String(item.date || "").slice(0, 7) || "未分類";
    const monthItems = monthGroups.get(month) || [];
    monthItems.push(item);
    monthGroups.set(month, monthItems);
  }

  const monthTabs = document.createElement("div");
  monthTabs.className = "history-month-tabs";
  monthTabs.setAttribute("role", "tablist");
  els.historyList.append(monthTabs);

  for (const [month] of monthGroups) {
    const isOpen = openHistoryMonths.has(month) || Boolean(editingHistoryDate && editingHistoryDate.startsWith(month));
    const monthButton = document.createElement("button");
    monthButton.type = "button";
    monthButton.className = `history-month-tab${isOpen ? " is-active" : ""}`;
    monthButton.dataset.historyMonthToggle = month;
    monthButton.setAttribute("aria-expanded", String(isOpen));
    monthButton.setAttribute("aria-controls", `history-month-${month}`);
    monthButton.textContent = month;
    monthTabs.append(monthButton);

    const monthPanel = document.createElement("div");
    monthPanel.id = `history-month-${month}`;
    monthPanel.className = "history-month-panel history-month-list";
    monthPanel.hidden = !isOpen;
    els.historyList.append(monthPanel);
    monthLists.set(month, monthPanel);
  }

  for (const [index, item] of historyItems.entries()) {
    const node = document.createElement("div");
    node.className = "history-item";
    node.dataset.historyCard = item.date;

    if (editingHistoryDate === item.date) {
      node.classList.add("is-editing");
      node.innerHTML = `
        <label>
          日期
          <input data-history-field="date" type="text" inputmode="numeric" autocomplete="off" value="${escapeHTML(formatDateForInput(item.date))}" />
        </label>
        <label>
          現金
          <input data-history-field="cash" type="number" min="0" step="1" value="${toNumber(item.cash)}" />
        </label>
        <label>
          股票總和
          <input data-history-field="stockTotal" type="number" min="0" step="1" value="${toNumber(item.stockTotal)}" />
        </label>
        <label>
          股票成本
          <input data-history-field="stockCost" type="number" min="0" step="1" value="${toNumber(item.stockCost)}" />
        </label>
        <label>
          基金總和
          <input data-history-field="fundTotal" type="number" min="0" step="1" value="${toNumber(item.fundTotal)}" />
        </label>
        <label>
          基金成本
          <input data-history-field="fundCost" type="number" min="0" step="1" value="${toNumber(item.fundCost)}" />
        </label>
        <label>
          加密總和
          <input data-history-field="cryptoTotal" type="number" min="0" step="1" value="${toNumber(item.cryptoTotal)}" />
        </label>
        <label>
          加密成本
          <input data-history-field="cryptoCost" type="number" min="0" step="1" value="${toNumber(item.cryptoCost)}" />
        </label>
        <label>
          備註
          <textarea data-history-field="note" rows="3" placeholder="記錄當天事件">${escapeHTML(item.note || "")}</textarea>
        </label>
        <div class="history-actions">
          <button type="button" data-history-action="save" data-history-date="${escapeHTML(item.date)}">鎖定</button>
          <button type="button" data-history-action="cancel" data-history-date="${escapeHTML(item.date)}">取消</button>
          <button type="button" data-history-action="delete" data-history-date="${escapeHTML(item.date)}">刪除</button>
        </div>
      `;
    } else {
      const noteId = `history-note-${escapeHTML(item.date)}`;
      const previousItem = index > 0 ? historyItems[index - 1] : null;
      const dailyPnl = previousItem ? item.total - previousItem.total : 0;
      const dailyPnlPct = previousItem?.total ? (dailyPnl / previousItem.total) * 100 : 0;
      const dailyPnlText = previousItem
        ? `<small class="history-daily-pnl">今日損益: ${signedMoney(dailyPnl)} ${dailyPnlPct >= 0 ? "+" : ""}${formatNumber(dailyPnlPct, 2)}%</small>`
        : "";
      node.innerHTML = `
        <div class="history-card-head">
          <span>${escapeHTML(item.date)}</span>
          <div class="history-card-tools">
            ${item.note ? `
              <button class="icon-btn note-toggle" type="button" data-history-action="toggle-note" data-history-date="${escapeHTML(item.date)}" aria-label="查看 ${escapeHTML(item.date)} 重要事件" aria-expanded="false" aria-controls="${noteId}" title="重要事件">
                ${starIcon()}
              </button>
            ` : ""}
            <button class="icon-btn" type="button" data-history-action="unlock" data-history-date="${escapeHTML(item.date)}" aria-label="解鎖 ${escapeHTML(item.date)} 歷史紀錄" title="解鎖">
              ${keyIcon()}
            </button>
          </div>
        </div>
        <div class="history-total-line">
          <strong>${money(item.total)}</strong>
        </div>
        ${dailyPnlText}
        <em>現金 ${money(item.cash || 0)}</em>
        <em>股票 ${money(item.stockTotal || 0)}</em>
        <em>基金 ${money(item.fundTotal || 0)}</em>
        <em>加密 ${money(item.cryptoTotal || 0)}</em>
        <em>損益 ${signedMoney(item.pnl || 0)}</em>
        ${item.note ? `<p class="history-note" id="${noteId}" data-history-note hidden>${escapeHTML(item.note)}</p>` : ""}
      `;
    }

    const month = String(item.date || "").slice(0, 7) || "未分類";
    monthLists.get(month)?.append(node);
  }
}

function drawCharts() {
  drawAssetCharts();
  drawPieChart();
  drawCategoryPieChart();
}

function drawAssetCharts() {
  for (const canvas of els.assetCharts) {
    drawAssetChart(canvas, canvas.dataset.assetChart || "combined");
  }
}

function drawAssetChart(canvas, mode = "combined") {
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, Math.floor(rect.width * ratio));
  canvas.height = Math.floor(340 * ratio);
  context.scale(ratio, ratio);

  const width = rect.width;
  const height = 340;
  const compactChart = width < 720;
  context.clearRect(0, 0, width, height);

  const padding = compactChart
    ? { top: 54, right: 18, bottom: 50, left: 54 }
    : { top: 54, right: 76, bottom: 50, left: 76 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const history = getChartHistoryWithLivePoint();

  if (history.length === 0) {
    context.fillStyle = "#6c756f";
    context.font = "14px sans-serif";
    context.textAlign = "center";
    context.fillText("尚未有每日結帳紀錄", width / 2, height / 2);
    return;
  }

  const values = history.map((item) => getAssetChartValue(item, mode));
  const min = 0;
  const gridStep = getAssetChartGridStep(mode);
  const max = getAssetChartMax(values, mode, gridStep);
  const range = max - min || Math.max(max, 1);

  const points = history.map((item, index) => {
    const x = padding.left + (history.length === 1 ? chartWidth / 2 : (index / (history.length - 1)) * chartWidth);
    const stockTotal = toNumber(item.stockTotal);
    const fundTotal = toNumber(item.fundTotal);
    const cryptoTotal = toNumber(item.cryptoTotal);
    const cash = getRecordedCash(item);
    const value = getAssetChartValue(item, mode);
    const valueY = padding.top + chartHeight - ((value - min) / range) * chartHeight;
    const fundY = padding.top + chartHeight - ((fundTotal - min) / range) * chartHeight;
    const cryptoY = padding.top + chartHeight - ((fundTotal + cryptoTotal - min) / range) * chartHeight;
    const stockY = padding.top + chartHeight - ((fundTotal + cryptoTotal + stockTotal - min) / range) * chartHeight;
    const totalY = padding.top + chartHeight - ((cryptoTotal + stockTotal + fundTotal + cash - min) / range) * chartHeight;
    return { x, valueY, stockY, fundY, cryptoY, totalY, item, stockTotal, fundTotal, cryptoTotal, cash, value };
  });

  if (mode === "combined") {
    if (points.length === 1) {
      drawSingleStackedColumn(context, points[0], padding, chartWidth, chartHeight);
    } else {
      fillStackedArea(context, points, padding.top + chartHeight, "fundY", assetChartColors.fundFill);
      fillStackedBand(context, points, "cryptoY", "fundY", assetChartColors.cryptoFill);
      fillStackedBand(context, points, "stockY", "cryptoY", assetChartColors.stockFill);
      fillStackedBand(context, points, "totalY", "stockY", assetChartColors.cashFill);
    }
  } else {
    fillStackedArea(context, points, padding.top + chartHeight, "valueY", getSingleAssetChartColor(mode, "fill"));
  }

  drawGrid(context, padding, chartWidth, chartHeight, max, gridStep, !compactChart);

  if (mode === "combined") {
    drawAssetLine(context, points, "fundY", assetChartColors.fundLine, 4.5);
    drawAssetLine(context, points, "cryptoY", assetChartColors.cryptoLine, 4.5);
    drawAssetLine(context, points, "stockY", assetChartColors.stockLine, 4);
    drawAssetLine(context, points, "totalY", assetChartColors.cashLine, 4.5, (point) => point.cash > 0);
  } else {
    drawAssetLine(context, points, "valueY", getSingleAssetChartColor(mode, "line"), 4.5);
  }

  context.fillStyle = "#6c756f";
  context.font = compactChart ? "10px sans-serif" : "12px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "top";
  points.forEach((point, index) => {
    if (!shouldDrawChartDateLabel(index, points.length, compactChart, chartWidth)) return;
    const previousDate = points[index - 1]?.item.date || "";
    const label = formatChartDateLabel(point.item.date, index, points[0].item.date, previousDate);
    context.fillText(label, point.x, padding.top + chartHeight + 22);
  });

  drawAssetLegend(context, padding.left, 24, mode);
}

function getChartHistoryWithLivePoint() {
  const history = state.history.map((item) => ({ ...item }));
  const totals = getPortfolioTotals();
  if (!totals.value) return history;

  const date = todayISO();
  const livePoint = {
    date,
    total: totals.value,
    stockTotal: totals.stockTotal,
    fundTotal: totals.fundTotal,
    cryptoTotal: totals.cryptoTotal,
    cash: totals.cash,
    cashRecorded: true,
  };
  const existingIndex = history.findIndex((item) => item.date === date);
  if (existingIndex >= 0) {
    history[existingIndex] = { ...history[existingIndex], ...livePoint };
  } else {
    history.push(livePoint);
  }
  return history.sort((a, b) => a.date.localeCompare(b.date));
}

function getAssetChartValue(item, mode) {
  const stockTotal = toNumber(item.stockTotal);
  const fundTotal = toNumber(item.fundTotal);
  const cryptoTotal = toNumber(item.cryptoTotal);
  const cash = getRecordedCash(item);
  if (mode === "stock") return stockTotal;
  if (mode === "fund") return fundTotal;
  if (mode === "cash") return cash;
  if (mode === "crypto") return cryptoTotal;
  return Math.max(toNumber(item.total), stockTotal + fundTotal + cryptoTotal + cash);
}

function hasRecordedCash(item) {
  return Boolean(item.cashRecorded) || (String(item.date || "") >= "2026-07-15" && toNumber(item.cash) > 0);
}

function getRecordedCash(item) {
  return hasRecordedCash(item) ? toNumber(item.cash) : 0;
}

function getAssetChartGridStep(mode) {
  return mode === "fund" || mode === "crypto" ? 100000 : 500000;
}

function getAssetChartMax(values, mode, gridStep) {
  const highest = Math.max(...values);
  if (mode === "fund" || mode === "crypto") {
    return Math.max(gridStep, Math.floor(highest / gridStep) * gridStep + 200000);
  }
  return Math.ceil(highest / gridStep) * gridStep || gridStep;
}

function getSingleAssetChartColor(mode, type) {
  if (mode === "fund") return type === "line" ? assetChartColors.fundLine : assetChartColors.fundFill;
  if (mode === "cash") return type === "line" ? assetChartColors.cashLine : assetChartColors.cashFill;
  if (mode === "crypto") return type === "line" ? assetChartColors.cryptoLine : assetChartColors.cryptoFill;
  return type === "line" ? assetChartColors.stockLine : assetChartColors.stockFill;
}

function shouldDrawChartDateLabel(index, total, compactChart, chartWidth = 320) {
  if (!compactChart) {
    if (total <= 7) return true;
    const desktopLabelIndexes = Array.from({ length: 7 }, (_, slot) =>
      Math.round((slot * (total - 1)) / 6)
    );
    return desktopLabelIndexes.includes(index);
  }
  if (total <= 4) return true;
  const mobileLabelIndexes = Array.from({ length: 4 }, (_, slot) =>
    Math.round((slot * (total - 1)) / 3)
  );
  return mobileLabelIndexes.includes(index);
}

function formatChartDateLabel(date, index, firstDate, previousDate) {
  const current = String(date || "");
  const [year, month, day] = current.split("-");
  if (!year || !month || !day) return current.replaceAll("-", "");
  if (index === 0) return `${year}${month}${day}`;

  const firstYear = String(firstDate || "").slice(0, 4);
  const previousYear = String(previousDate || "").slice(0, 4);
  if (year !== firstYear && year !== previousYear) return `${year}${month}${day}`;

  return `${month}${day}`;
}

function drawPieChart() {
  const canvas = els.pieChart;
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 320;
  const compactPie = width < 720;

  const slices = state.holdings
    .map((holding) => ({
      label: holding.name || holding.symbol,
      symbol: holding.symbol,
      group: getHoldingGroupName(holding),
      value: holding.shares * (holding.currentPrice ?? holding.avgCost),
    }))
    .filter((slice) => slice.value > 0);
  const groupTotals = new Map();
  for (const slice of slices) {
    groupTotals.set(slice.group, (groupTotals.get(slice.group) || 0) + slice.value);
  }
  const stockGroupNames = [...groupTotals.keys()].sort((a, b) =>
    groupTotals.get(b) - groupTotals.get(a) || chineseNameSorter.compare(a, b)
  );
  const groupRanks = new Map(stockGroupNames.map((group, index) => [group, index]));
  slices.sort((a, b) =>
    groupRanks.get(a.group) - groupRanks.get(b.group)
      || b.value - a.value
      || chineseNameSorter.compare(a.label, b.label)
  );
  if (toNumber(state.cash) > 0) {
    slices.unshift({
      label: "Cash",
      symbol: "Cash",
      group: "Cash",
      value: toNumber(state.cash),
      isCash: true,
    });
  }
  const groupNames = toNumber(state.cash) > 0 ? ["Cash", ...stockGroupNames] : stockGroupNames;
  const groupColorFamilies = assignPieColorFamilies(slices);
  const groupCounts = {};
  const coloredSlices = slices
    .map((slice) => ({
      ...slice,
      color: getGroupedPieColor(slice.group, groupColorFamilies, groupCounts),
    }));
  slices.splice(0, slices.length, ...coloredSlices);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const summaryRows = buildPieGroupSummary(slices, groupNames, groupColorFamilies, total);
  const chartHeight = compactPie ? 560 : Math.max(620, Math.min(760, width * 0.62));
  const summaryHeight = getPieGroupSummaryHeight(summaryRows, width, compactPie);
  const height = chartHeight + summaryHeight;
  canvas.style.height = `${height}px`;
  canvas.width = Math.max(320, Math.floor(width * ratio));
  canvas.height = Math.floor(height * ratio);
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  if (!total) {
    context.fillStyle = "#6c756f";
    context.font = "14px sans-serif";
    context.textAlign = "center";
    context.fillText("尚未有股票市值", width / 2, height / 2);
    return;
  }

  const labelRoom = compactPie ? 104 : 180;
  const radius = compactPie ? Math.min((width - labelRoom * 2) / 2, 76) : Math.min((width - labelRoom * 2) / 2, chartHeight * 0.34, 210);
  const centerX = width / 2;
  const centerY = chartHeight / 2;
  const cashAngle = slices[0]?.isCash ? (slices[0].value / total) * Math.PI * 2 : 0;
  let start = cashAngle ? (-Math.PI * 3) / 4 - cashAngle / 2 : -Math.PI / 2;

  for (const slice of slices) {
    const angle = (slice.value / total) * Math.PI * 2;
    slice.start = start;
    slice.end = start + angle;
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.arc(centerX, centerY, radius, start, start + angle);
    context.closePath();
    context.fillStyle = slice.color;
    context.fill();
    context.strokeStyle = "rgba(23, 33, 28, 0.32)";
    context.lineWidth = 0.8;
    context.stroke();
    start += angle;
  }

  const outsideLabels = [];
  for (const slice of slices) {
    const percent = (slice.value / total) * 100;
    const mid = (slice.start + slice.end) / 2;
    const lines = [slice.label, `${formatNumber(percent)}%`, money(slice.value)];
    if (percent >= (compactPie ? 16 : 12)) {
      const labelRadius = radius * 0.58;
      const x = centerX + Math.cos(mid) * labelRadius;
      const y = centerY + Math.sin(mid) * labelRadius;
      context.fillStyle = "#17211c";
      context.font = compactPie ? "700 8.5px sans-serif" : "700 11.5px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      drawPieLabelLines(context, lines, x, y, compactPie ? 10 : 14);
    } else {
      outsideLabels.push({
        lines,
        color: slice.color,
        side: Math.cos(mid) >= 0 ? "right" : "left",
        anchorX: centerX + Math.cos(mid) * radius,
        anchorY: centerY + Math.sin(mid) * radius,
        targetY: centerY + Math.sin(mid) * (radius + 30),
        compact: compactPie,
      });
    }
  }

  if (compactPie) {
    drawMobileOutsidePieLabels(context, outsideLabels, centerX, centerY, radius, chartHeight, width);
  } else {
    drawOutsidePieLabels(context, outsideLabels, centerX, radius, chartHeight);
  }
  drawPieGroupSummary(context, summaryRows, width, chartHeight, summaryHeight, compactPie);
}

function drawCategoryPieChart() {
  const canvas = els.categoryPieChart;
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 320;
  const compactPie = width < 720;
  const totals = getPortfolioTotals();
  const categorySlices = [
    { label: "Cash", group: "Cash", value: totals.cash, isCash: true },
    { label: "股票", group: "股票", value: totals.stockTotal },
    { label: "基金", group: "基金", value: totals.fundTotal },
    { label: "加密合約", group: "加密合約", value: totals.cryptoTotal },
  ].filter((slice) => slice.value > 0);
  const cashSlice = categorySlices.find((slice) => slice.isCash);
  const slices = categorySlices
    .filter((slice) => !slice.isCash)
    .sort((a, b) => b.value - a.value || chineseNameSorter.compare(a.label, b.label));
  if (cashSlice) slices.unshift(cashSlice);
  const groupColorFamilies = assignPieColorFamilies(slices);
  const groupCounts = {};
  for (const slice of slices) {
    slice.color = getGroupedPieColor(slice.group, groupColorFamilies, groupCounts);
  }
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const summaryRows = slices.map((slice) => ({ group: slice.label, value: slice.value, percent: total ? (slice.value / total) * 100 : 0, color: slice.color }));
  const chartHeight = compactPie ? Math.max(320, width) : Math.max(620, Math.min(760, width * 0.62));
  const summaryHeight = getPieGroupSummaryHeight(summaryRows, width, compactPie);
  const height = chartHeight + summaryHeight;

  canvas.style.height = `${height}px`;
  canvas.width = Math.max(320, Math.floor(width * ratio));
  canvas.height = Math.floor(height * ratio);
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  if (!total) {
    context.fillStyle = "#6c756f";
    context.font = "14px sans-serif";
    context.textAlign = "center";
    context.fillText("尚未有資產資料", width / 2, height / 2);
    return;
  }

  const labelRoom = compactPie ? 12 : 180;
  const radius = compactPie ? Math.min(width / 2 - labelRoom, 180) : Math.min((width - labelRoom * 2) / 2, chartHeight * 0.34, 210);
  const centerX = width / 2;
  const centerY = chartHeight / 2;
  const cashAngle = slices[0]?.isCash ? (slices[0].value / total) * Math.PI * 2 : 0;
  let start = cashAngle ? (-Math.PI * 3) / 4 - cashAngle / 2 : -Math.PI / 2;

  for (const slice of slices) {
    const angle = (slice.value / total) * Math.PI * 2;
    slice.start = start;
    slice.end = start + angle;
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.arc(centerX, centerY, radius, start, start + angle);
    context.closePath();
    context.fillStyle = slice.color;
    context.fill();
    context.strokeStyle = "rgba(23, 33, 28, 0.32)";
    context.lineWidth = 0.8;
    context.stroke();
    start += angle;
  }

  const outsideLabels = [];
  for (const slice of slices) {
    const percent = (slice.value / total) * 100;
    const mid = (slice.start + slice.end) / 2;
    const lines = [slice.label, `${formatNumber(percent)}%`, money(slice.value)];
    if (compactPie || percent >= 12) {
      const labelRadius = radius * (compactPie ? 0.62 : 0.58);
      context.fillStyle = "#17211c";
      context.font = compactPie ? "700 8px sans-serif" : "700 11.5px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      drawPieLabelLines(context, lines, centerX + Math.cos(mid) * labelRadius, centerY + Math.sin(mid) * labelRadius, compactPie ? 9 : 14);
    } else {
      outsideLabels.push({
        lines,
        color: slice.color,
        side: Math.cos(mid) >= 0 ? "right" : "left",
        anchorX: centerX + Math.cos(mid) * radius,
        anchorY: centerY + Math.sin(mid) * radius,
        targetY: centerY + Math.sin(mid) * (radius + 30),
      });
    }
  }

  if (compactPie) {
    drawMobileOutsidePieLabels(context, outsideLabels, centerX, centerY, radius, chartHeight, width);
  } else {
    drawOutsidePieLabels(context, outsideLabels, centerX, radius, chartHeight);
  }
  drawPieGroupSummary(context, summaryRows, width, chartHeight, summaryHeight, compactPie, "資產類別小計");
}

function getHoldingGroupName(holding) {
  const rawName = String(holding.name || holding.symbol || "").trim();
  const compactName = stripBrokerNames(rawName.replace(/\s+/g, ""));
  const starred = compactName.match(/^([\u4e00-\u9fff]+)\*/);
  if (starred?.[1]) return `${starred[1]}*`;
  const matched = compactName.match(/^([\u4e00-\u9fff]+?)(?:[A-Z]*\d[A-Z0-9]*.*)$/i);
  if (matched?.[1]) return matched[1];
  return rawName || "未命名";
}

function compareHoldingsByDisplayName(a, b) {
  const groupCompare = chineseNameSorter.compare(getHoldingGroupName(a), getHoldingGroupName(b));
  if (groupCompare) return groupCompare;
  return compareStockCodes(getHoldingTailCode(a), getHoldingTailCode(b))
    || compareStockCodes(a.symbol, b.symbol);
}

function getHoldingTailCode(holding) {
  return getNameTailCode(holding.name || holding.symbol, holding.symbol);
}

function getNameTailCode(name, fallback = "") {
  const compactName = stripBrokerNames(String(name || "").replace(/\s+/g, "").toUpperCase());
  const matched = compactName.match(/([0-9A-Z]{4})$/);
  if (matched?.[1]) return matched[1];
  return String(fallback || "").toUpperCase().slice(-4);
}

function stripBrokerNames(name) {
  return name.replace(/(?:中國信託|華南永昌|第一金|元大|凱基|群益|富邦|國泰|永豐|統一|兆豐|台新|元富|中信|玉山|日盛|康和|宏遠)/g, "");
}

function assignPieColorFamilies(slices) {
  const visualGroups = [];
  for (const slice of slices) {
    if (visualGroups[visualGroups.length - 1] !== slice.group) visualGroups.push(slice.group);
  }

  const assignments = new Map();
  const usage = Array(pieColorFamilies.length).fill(0);

  visualGroups.forEach((group, index) => {
    const previousFamily = index > 0 ? assignments.get(visualGroups[index - 1]) : undefined;
    const firstFamily = assignments.get(visualGroups[0]);
    const forbidden = new Set();
    if (previousFamily !== undefined) forbidden.add(previousFamily);
    if (index === visualGroups.length - 1 && visualGroups.length > 1 && firstFamily !== undefined) {
      forbidden.add(firstFamily);
    }

    let selected = 0;
    let selectedUsage = Infinity;
    for (let familyIndex = 0; familyIndex < pieColorFamilies.length; familyIndex += 1) {
      if (forbidden.has(familyIndex)) continue;
      if (usage[familyIndex] < selectedUsage) {
        selected = familyIndex;
        selectedUsage = usage[familyIndex];
      }
    }

    assignments.set(group, selected);
    usage[selected] += 1;
  });

  return assignments;
}

function getGroupedPieColor(group, groupColorFamilies, groupCounts) {
  const groupIndex = groupColorFamilies.get(group) ?? 0;
  const family = pieColorFamilies[groupIndex % pieColorFamilies.length];
  const shadeIndex = groupCounts[group] || 0;
  groupCounts[group] = shadeIndex + 1;
  return family[shadeIndex % family.length];
}

function assignPieGroupOrder(groupNames) {
  const preferred = ["中砂", "同欣電", "佳必琪", "南亞科", "致茂", "智邦", "Cash"];
  return [...groupNames].sort((a, b) => {
    const preferredA = preferred.indexOf(a);
    const preferredB = preferred.indexOf(b);
    const rankA = preferredA >= 0 ? preferredA : preferred.length + groupNames.indexOf(a);
    const rankB = preferredB >= 0 ? preferredB : preferred.length + groupNames.indexOf(b);
    return rankA - rankB;
  });
}

function buildPieGroupSummary(slices, groupNames, groupColorFamilies, total) {
  const summary = new Map();
  for (const slice of slices) {
    const current = summary.get(slice.group) || 0;
    summary.set(slice.group, current + slice.value);
  }
  return groupNames
    .filter((group) => summary.has(group))
    .map((group) => ({
      group,
      value: summary.get(group),
      percent: total ? (summary.get(group) / total) * 100 : 0,
      color: getPieGroupBaseColor(group, groupColorFamilies),
    }))
    .sort((a, b) => {
      if (a.group === "Cash") return -1;
      if (b.group === "Cash") return 1;
      return b.value - a.value || chineseNameSorter.compare(a.group, b.group);
    });
}

function getPieGroupBaseColor(group, groupColorFamilies) {
  const groupIndex = groupColorFamilies.get(group) ?? 0;
  const family = pieColorFamilies[groupIndex % pieColorFamilies.length];
  return family[Math.min(2, family.length - 1)];
}

function compareStockCodes(a = "", b = "") {
  const left = String(a).toUpperCase();
  const right = String(b).toUpperCase();
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (index >= left.length) return -1;
    if (index >= right.length) return 1;
    const leftRank = stockCodeOrder.indexOf(left[index] || "");
    const rightRank = stockCodeOrder.indexOf(right[index] || "");
    const safeLeftRank = leftRank >= 0 ? leftRank : stockCodeOrder.length + left.charCodeAt(index);
    const safeRightRank = rightRank >= 0 ? rightRank : stockCodeOrder.length + right.charCodeAt(index);
    if (safeLeftRank !== safeRightRank) return safeLeftRank - safeRightRank;
  }
  return 0;
}

function fillStackedArea(context, points, baselineY, key, color) {
  context.fillStyle = color;
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, baselineY);
    context.lineTo(point.x, point[key]);
  });
  for (let index = points.length - 1; index >= 0; index -= 1) {
    context.lineTo(points[index].x, baselineY);
  }
  context.closePath();
  context.fill();
}

function fillStackedBand(context, points, topKey, bottomKey, color) {
  context.fillStyle = color;
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point[bottomKey]);
    context.lineTo(point.x, point[topKey]);
  });
  for (let index = points.length - 1; index >= 0; index -= 1) {
    context.lineTo(points[index].x, points[index][bottomKey]);
  }
  context.closePath();
  context.fill();
}

function drawSingleStackedColumn(context, point, padding, chartWidth, chartHeight) {
  const baselineY = padding.top + chartHeight;
  const columnWidth = Math.min(120, Math.max(54, chartWidth * 0.22));
  const x = point.x - columnWidth / 2;

  context.fillStyle = assetChartColors.fundFill;
  context.fillRect(x, point.fundY, columnWidth, baselineY - point.fundY);
  context.fillStyle = assetChartColors.cryptoFill;
  context.fillRect(x, point.cryptoY, columnWidth, point.fundY - point.cryptoY);
  context.fillStyle = assetChartColors.stockFill;
  context.fillRect(x, point.stockY, columnWidth, point.cryptoY - point.stockY);
  context.fillStyle = assetChartColors.cashFill;
  context.fillRect(x, point.totalY, columnWidth, point.stockY - point.totalY);

  context.strokeStyle = assetChartColors.fundLine;
  context.lineWidth = 1.5;
  context.strokeRect(x, point.fundY, columnWidth, baselineY - point.fundY);
  context.strokeStyle = assetChartColors.cryptoLine;
  context.strokeRect(x, point.cryptoY, columnWidth, point.fundY - point.cryptoY);
  context.strokeStyle = assetChartColors.stockLine;
  context.strokeRect(x, point.stockY, columnWidth, point.cryptoY - point.stockY);
  context.strokeStyle = assetChartColors.cashLine;
  context.strokeRect(x, point.totalY, columnWidth, point.stockY - point.totalY);
}

function drawAssetLine(context, points, key, color, pointRadius, shouldDraw = () => true) {
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();
  let hasLine = false;
  let isDrawing = false;
  for (const point of points) {
    if (!shouldDraw(point)) {
      isDrawing = false;
      continue;
    }
    if (!isDrawing) {
      context.moveTo(point.x, point[key]);
      isDrawing = true;
    } else {
      context.lineTo(point.x, point[key]);
    }
    hasLine = true;
  }
  if (hasLine) context.stroke();

  for (const point of points) {
    if (!shouldDraw(point)) continue;
    context.fillStyle = "#ffffff";
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(point.x, point[key], pointRadius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
}

function drawAssetLegend(context, x, y, mode = "combined") {
  const items = mode === "stock"
    ? [{ label: "股票", color: assetChartColors.stockFill }]
    : mode === "fund"
      ? [{ label: "基金", color: assetChartColors.fundFill }]
      : mode === "cash"
        ? [{ label: "現金", color: assetChartColors.cashFill }]
        : mode === "crypto"
          ? [{ label: "加密", color: assetChartColors.cryptoFill }]
        : [
            { label: "現金", color: assetChartColors.cashFill },
            { label: "股票", color: assetChartColors.stockFill },
            { label: "加密", color: assetChartColors.cryptoFill },
            { label: "基金", color: assetChartColors.fundFill },
          ];
  context.font = "12px sans-serif";
  context.textAlign = "left";
  context.textBaseline = "middle";
  for (const item of items) {
    context.fillStyle = item.color;
    context.fillRect(x, y - 7, 12, 12);
    context.fillStyle = "#6c756f";
    context.fillText(item.label, x + 18, y);
    x += 66;
  }
}

function drawWrappedLabel(context, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (context.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  const offset = ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => context.fillText(line, x, y - offset + index * lineHeight));
}

function drawMobileOutsidePieLabels(context, labels, centerX, centerY, radius, height, width) {
  const minGap = 48;
  const top = Math.max(54, centerY - radius - 98);
  const bottom = Math.min(height - 44, centerY + radius + 124);
  const lineHeight = 10;
  const markerSize = 7;

  for (const side of ["left", "right"]) {
    const sideLabels = labels
      .filter((label) => label.side === side)
      .sort((a, b) => a.targetY - b.targetY);
    let previousY = top - minGap;

    for (const label of sideLabels) {
      const targetY = Math.min(bottom, Math.max(top, label.targetY));
      label.y = Math.max(targetY, previousY + minGap);
      previousY = label.y;
    }

    const last = sideLabels[sideLabels.length - 1];
    if (last && last.y > bottom) {
      const overflow = last.y - bottom;
      for (const label of sideLabels) {
        label.y -= overflow;
      }
    }

    for (let index = 1; index < sideLabels.length; index += 1) {
      const previous = sideLabels[index - 1];
      const current = sideLabels[index];
      if (current.y - previous.y < minGap) {
        current.y = previous.y + minGap;
      }
    }

    for (const label of sideLabels) {
      const direction = side === "right" ? 1 : -1;
      const textX = side === "right" ? width - 74 : 74;
      const markerX = textX - direction * 9;
      const markerY = label.y - lineHeight;
      const elbowX = centerX + direction * (radius + 10);

      context.strokeStyle = "rgba(23, 33, 28, 0.55)";
      context.lineWidth = 0.9;
      context.beginPath();
      context.moveTo(label.anchorX, label.anchorY);
      context.lineTo(elbowX, markerY);
      context.lineTo(markerX, markerY);
      context.stroke();

      context.fillStyle = label.color;
      context.fillRect(markerX - markerSize / 2, markerY - markerSize / 2, markerSize, markerSize);
      context.strokeStyle = "rgba(23, 33, 28, 0.25)";
      context.strokeRect(markerX - markerSize / 2, markerY - markerSize / 2, markerSize, markerSize);

      context.fillStyle = "#17211c";
      context.font = "700 8.5px sans-serif";
      context.textAlign = side === "right" ? "left" : "right";
      context.textBaseline = "middle";
      drawPieLabelLines(context, label.lines, textX, label.y, lineHeight);
    }
  }
}

function drawOutsidePieLabels(context, labels, centerX, radius, height) {
  const minGap = 54;
  const top = 48;
  const bottom = height - 48;

  for (const side of ["left", "right"]) {
    const sideLabels = labels
      .filter((label) => label.side === side)
      .sort((a, b) => a.targetY - b.targetY);
    let previousY = top - minGap;

    for (const label of sideLabels) {
      label.y = Math.min(bottom, Math.max(label.targetY, previousY + minGap));
      previousY = label.y;
    }

    for (let index = sideLabels.length - 2; index >= 0; index -= 1) {
      const next = sideLabels[index + 1];
      const current = sideLabels[index];
      current.y = Math.min(current.y, next.y - minGap);
      current.y = Math.max(top, current.y);
    }

    for (const label of sideLabels) {
      const direction = side === "right" ? 1 : -1;
      const lineStartX = label.anchorX;
      const lineStartY = label.anchorY;
      const elbowX = centerX + direction * (radius + 30);
      const textX = centerX + direction * (radius + 66);
      const markerSize = 8;
      const markerX = textX - direction * 12;
      const markerY = label.y;

      context.strokeStyle = "rgba(23, 33, 28, 0.55)";
      context.lineWidth = 0.9;
      context.beginPath();
      context.moveTo(lineStartX, lineStartY);
      context.lineTo(elbowX, markerY);
      context.lineTo(markerX, markerY);
      context.stroke();

      context.fillStyle = label.color;
      context.fillRect(markerX - markerSize / 2, markerY - markerSize / 2, markerSize, markerSize);
      context.strokeStyle = "rgba(23, 33, 28, 0.25)";
      context.strokeRect(markerX - markerSize / 2, markerY - markerSize / 2, markerSize, markerSize);

      context.fillStyle = "#17211c";
      context.font = "700 11.5px sans-serif";
      context.textAlign = side === "right" ? "left" : "right";
      context.textBaseline = "middle";
      drawPieLabelLines(context, label.lines, textX, label.y, 14);
    }
  }
}

function drawPieGroupSummary(context, rows, width, chartHeight, summaryHeight, compactPie, title = "中文股名小計") {
  if (!rows.length) return;

  const x = 18;
  const y = chartHeight + 8;
  const panelWidth = width - 36;
  const panelHeight = summaryHeight - 16;

  context.fillStyle = "rgba(255, 255, 255, 0.88)";
  context.strokeStyle = "rgba(220, 226, 220, 0.95)";
  context.lineWidth = 1;
  context.fillRect(x, y, panelWidth, panelHeight);
  context.strokeRect(x, y, panelWidth, panelHeight);

  if (compactPie) {
    drawMobilePieGroupSummary(context, rows, x, y, panelWidth, title);
    return;
  }

  context.textAlign = "left";
  context.textBaseline = "middle";
  let cursorX = x + 12;
  let rowY = y + 24;
  context.fillStyle = "#6c756f";
  context.font = "700 13px sans-serif";
  context.fillText(title, cursorX, rowY);
  const itemStartX = cursorX + context.measureText(title).width + 16;
  context.font = "700 12px sans-serif";
  const labels = rows.map((row) => `${row.group}: ${formatNumber(row.percent)}% ${money(row.value)}`);
  const widestItem = Math.max(...labels.map((label) => 12 + context.measureText(label).width + 18));
  const availableWidth = x + panelWidth - 12 - itemStartX;
  const columnCount = Math.max(1, Math.floor(availableWidth / widestItem));
  const columnWidth = availableWidth / columnCount;

  rows.forEach((row, index) => {
    const column = index % columnCount;
    const line = Math.floor(index / columnCount);
    cursorX = itemStartX + column * columnWidth;
    rowY = y + 24 + line * 24;
    const label = labels[index];

    context.fillStyle = row.color;
    context.fillRect(cursorX, rowY - 4, 8, 8);
    context.strokeStyle = "rgba(23, 33, 28, 0.25)";
    context.strokeRect(cursorX, rowY - 4, 8, 8);

    context.fillStyle = "#17211c";
    context.fillText(label, cursorX + 12, rowY);
  });
}

function drawMobilePieGroupSummary(context, rows, x, y, width, title = "中文股名小計") {
  const padding = 11;
  const rowGap = 20;
  let rowY = y + 18;

  context.fillStyle = "#6c756f";
  context.font = "700 11.5px sans-serif";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(title, x + padding, rowY);

  context.font = "700 10.5px sans-serif";
  rowY += 20;

  for (const row of rows) {
    const label = `${row.group}: ${formatNumber(row.percent)}% ${money(row.value)}`;
    context.fillStyle = row.color;
    context.fillRect(x + padding, rowY - 4, 8, 8);
    context.strokeStyle = "rgba(23, 33, 28, 0.25)";
    context.strokeRect(x + padding, rowY - 4, 8, 8);

    context.fillStyle = "#17211c";
    context.fillText(trimCanvasText(context, label, width - padding * 2 - 14), x + padding + 13, rowY);
    rowY += rowGap;
  }
}

function getPieGroupSummaryHeight(rows, width, compactPie) {
  if (compactPie) return Math.max(174, 48 + rows.length * 20);

  const itemStartX = 12 + 86 + 16;
  const panelWidth = width - 36;
  const availableWidth = panelWidth - 12 - itemStartX;
  const widestItem = Math.max(...rows.map((row) =>
    26 + row.group.length * 14 + `${formatNumber(row.percent)}% ${money(row.value)}`.length * 7
  ));
  const columnCount = Math.max(1, Math.floor(availableWidth / widestItem));
  const lineCount = Math.max(1, Math.ceil(rows.length / columnCount));
  return Math.max(64, 28 + lineCount * 24);
}

function drawPieLabelLines(context, lines, x, y, lineHeight) {
  const offset = ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => context.fillText(line, x, y - offset + index * lineHeight));
}

function drawCompactPieLegend(context, slices, total, x, y, width, columns = 1) {
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.font = "700 10px sans-serif";
  const gap = columns > 1 ? 24 : 0;
  const columnWidth = (width - gap * (columns - 1)) / columns;

  slices.forEach((slice, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const rowX = x + column * (columnWidth + gap);
    const rowY = y + row * 24;
    const percent = (slice.value / total) * 100;
    const valueText = money(slice.value);
    const label = `${slice.label} ${formatNumber(percent)}% ${valueText}`;

    context.fillStyle = slice.color;
    context.fillRect(rowX, rowY - 6, 10, 10);
    context.strokeStyle = "rgba(23, 33, 28, 0.35)";
    context.lineWidth = 0.8;
    context.strokeRect(rowX, rowY - 6, 10, 10);

    context.fillStyle = "#17211c";
    context.fillText(trimCanvasText(context, label, columnWidth - 18), rowX + 16, rowY);
  });
}

function trimCanvasText(context, text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 3 && context.measureText(`${clipped}...`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}...`;
}

function drawGrid(context, padding, chartWidth, chartHeight, max, step = 500000, showRightAxis = false) {
  context.lineWidth = 1;
  for (let value = 0; value <= max; value += step) {
    const y = padding.top + chartHeight - (value / max) * chartHeight;
    context.strokeStyle = value === 0 ? "#17211c" : "rgba(108, 117, 111, 0.28)";
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(padding.left + chartWidth, y);
    context.stroke();
  }

  context.strokeStyle = "#17211c";
  context.beginPath();
  context.moveTo(padding.left, padding.top);
  context.lineTo(padding.left, padding.top + chartHeight);
  context.lineTo(padding.left + chartWidth, padding.top + chartHeight);
  if (showRightAxis) {
    context.moveTo(padding.left + chartWidth, padding.top);
    context.lineTo(padding.left + chartWidth, padding.top + chartHeight);
  }
  context.stroke();

  context.fillStyle = "#6c756f";
  context.font = "12px sans-serif";
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (let value = 0; value <= max; value += step) {
    const y = padding.top + chartHeight - (value / max) * chartHeight;
    const labelY = value === max ? y + 6 : y;
    context.fillText(formatMillionTick(value), padding.left - 12, labelY);
  }

  if (showRightAxis) {
    context.textAlign = "left";
    for (let value = 0; value <= max; value += step) {
      const y = padding.top + chartHeight - (value / max) * chartHeight;
      const labelY = value === max ? y + 6 : y;
      context.fillText(formatMillionTick(value), padding.left + chartWidth + 12, labelY);
    }
  }
}

function formatMillionTick(value) {
  if (!value) return "0";
  return `${formatNumber(value / 1000000, 1)}M`;
}

function calculateCryptoPosition(contract) {
  const marginUsdt = Math.max(0, toNumber(contract.marginUsdt));
  const leverage = Math.max(1, toNumber(contract.leverage));
  const quantity = Math.max(0, toNumber(contract.quantity));
  const entryPrice = Math.max(0, toNumber(contract.entryPrice));
  const currentPrice = Math.max(0, toNumber(contract.currentPrice));
  const fxRate = Math.max(0, toNumber(contract.fxRate));
  const notionalUsdt = quantity * entryPrice;
  const direction = contract.side === "short" ? -1 : 1;
  const rawPnlUsdt = quantity * (currentPrice - entryPrice) * direction;
  const equityUsdt = Math.max(0, marginUsdt + rawPnlUsdt);
  const pnlUsdt = equityUsdt - marginUsdt;
  const costTwd = marginUsdt * fxRate;
  const currentValueTwd = equityUsdt * fxRate;
  const pnlTwd = currentValueTwd - costTwd;
  const pnlPct = costTwd ? (pnlTwd / costTwd) * 100 : 0;
  return { marginUsdt, leverage, entryPrice, currentPrice, fxRate, notionalUsdt, quantity, pnlUsdt, equityUsdt, costTwd, currentValueTwd, pnlTwd, pnlPct };
}

function getPortfolioTotals() {
  const stockCost = state.holdings.reduce((sum, item) => sum + item.shares * item.avgCost, 0);
  const stockTotal = state.holdings.reduce(
    (sum, item) => sum + item.shares * (item.currentPrice ?? item.avgCost),
    0,
  );
  const fundTotal = state.funds.reduce((sum, item) => sum + (item.currentValue || 0), 0);
  const fundCost = state.funds.reduce((sum, item) => sum + (item.cost || 0), 0);
  const cryptoPositions = state.cryptoContracts.map(calculateCryptoPosition);
  const cryptoTotal = cryptoPositions.reduce((sum, item) => sum + item.currentValueTwd, 0);
  const cryptoCost = cryptoPositions.reduce((sum, item) => sum + item.costTwd, 0);
  const cash = toNumber(state.cash);
  const cost = stockCost + fundCost + cryptoCost;
  const value = stockTotal + fundTotal + cryptoTotal + cash;
  const stockPnl = stockTotal - stockCost;
  const fundPnl = fundTotal - fundCost;
  const cryptoPnl = cryptoTotal - cryptoCost;
  const pnl = stockPnl + fundPnl + cryptoPnl;
  const stockPnlPct = stockCost ? (stockPnl / stockCost) * 100 : 0;
  const fundPnlPct = fundCost ? (fundPnl / fundCost) * 100 : 0;
  const cryptoPnlPct = cryptoCost ? (cryptoPnl / cryptoCost) * 100 : 0;
  const pnlPct = cost ? (pnl / cost) * 100 : 0;
  return { cost, value, cash, stockTotal, fundTotal, cryptoTotal, stockCost, fundCost, cryptoCost, stockPnl, fundPnl, cryptoPnl, stockPnlPct, fundPnlPct, cryptoPnlPct, pnl, pnlPct };
}

function backfillHistoryCosts() {
  const totals = getPortfolioTotals();
  let changed = false;

  for (const item of state.history) {
    if (!item.stockCost && item.stockTotal) {
      item.stockCost = totals.stockCost;
      changed = true;
    }
    if (!item.fundCost && item.fundTotal) {
      item.fundCost = totals.fundCost;
      changed = true;
    }
    if (!Number.isFinite(Number(item.cash))) {
      item.cash = 0;
      changed = true;
    }
    if (!hasRecordedCash(item) && toNumber(item.cash) !== 0) {
      item.cash = 0;
      item.cashRecorded = false;
      changed = true;
    }
    if (hasRecordedCash(item) && item.cashRecorded !== true) {
      item.cashRecorded = true;
      changed = true;
    }
    const nextCost = toNumber(item.stockCost) + toNumber(item.fundCost) + toNumber(item.cryptoCost);
    const nextTotal = toNumber(item.stockTotal) + toNumber(item.fundTotal) + toNumber(item.cryptoTotal) + getRecordedCash(item);
    if (nextTotal && item.total !== nextTotal) {
      item.total = nextTotal;
      changed = true;
    }
    if (nextCost && item.cost !== nextCost) {
      item.cost = nextCost;
      changed = true;
    }
    const nextPnl = toNumber(item.stockTotal) + toNumber(item.fundTotal) + toNumber(item.cryptoTotal) - nextCost;
    if (nextCost && item.pnl !== nextPnl) {
      item.pnl = nextPnl;
      changed = true;
    }
  }

  if (changed) persistLocalState();
}

function saveAndRender(message = "") {
  persistLocalState();
  queueCloudSave();
  render();
  if (message) setStatus(message);
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function loadState() {
  const fallback = { holdings: [], funds: [], cryptoContracts: [], history: [], currentFundTotal: 0, cash: 0 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? migrateState(JSON.parse(raw)) : fallback;
  } catch {
    return fallback;
  }
}

function persistLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function initCloudSync() {
  if (!CLOUD_CONFIG.url || !CLOUD_CONFIG.anonKey) {
    setStatus("目前是本機暫存模式；設定 Supabase 後會自動同步雲端。");
    return;
  }

  try {
    setStatus("正在連接雲端資料...");
    await loadSupabaseClient();
    cloudClient = window.supabase.createClient(CLOUD_CONFIG.url, CLOUD_CONFIG.anonKey);

    const { data, error } = await cloudClient
      .from(CLOUD_TABLE)
      .select("data")
      .eq("id", CLOUD_ROW_ID)
      .maybeSingle();

    if (error) throw error;

    if (data?.data) {
      replaceState(migrateState(data.data));
      persistLocalState();
      render();
      setStatus("已載入雲端資料。");
      return;
    }

    await syncStateToCloud();
    setStatus("已建立第一份雲端資料。");
  } catch (error) {
    console.error(error);
    setStatus("雲端連線失敗，目前先保留本機資料。請檢查 Supabase 設定。");
  }
}

function replaceState(nextState) {
  state.holdings = nextState.holdings;
  state.funds = nextState.funds;
  state.cryptoContracts = nextState.cryptoContracts;
  state.history = nextState.history;
  state.currentFundTotal = nextState.currentFundTotal;
  state.cash = nextState.cash;
  els.cash.value = state.cash ? String(state.cash) : "";
}

function loadSupabaseClient() {
  if (window.supabase?.createClient) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Supabase library failed to load"));
    document.head.append(script);
  });
}

function queueCloudSave() {
  if (!cloudClient) return;
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(syncStateToCloud, 600);
}

async function syncStateToCloud() {
  if (!cloudClient) return;

  try {
    const payload = JSON.parse(JSON.stringify(state));
    const { error } = await cloudClient.from(CLOUD_TABLE).upsert(
      {
        id: CLOUD_ROW_ID,
        data: payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) throw error;
    setStatus("已同步到雲端。");
  } catch (error) {
    console.error(error);
    setStatus("雲端同步失敗，目前先存在本機。");
  }
}

function migrateState(value) {
  if (!value || !Array.isArray(value.holdings) || !Array.isArray(value.history)) {
    throw new Error("Invalid data");
  }

  const holdings = value.holdings.map((holding) => ({
    id: holding.id || crypto.randomUUID(),
    symbol: normalizeSymbol(holding.symbol || ""),
    name: String(holding.name || ""),
    shares: toNumber(holding.shares),
    avgCost: toNumber(holding.avgCost),
    currentPrice: toOptionalNumber(holding.currentPrice),
    lastUpdated: String(holding.lastUpdated || ""),
  }));

  let funds = Array.isArray(value.funds)
    ? value.funds.map((fund) => ({
        id: fund.id || crypto.randomUUID(),
        name: String(fund.name || "未命名基金"),
        cost: Number.isFinite(Number(fund.cost)) ? toNumber(fund.cost) : toNumber(fund.currentValue),
        currentValue: toNumber(fund.currentValue),
        lastUpdated: String(fund.lastUpdated || ""),
      }))
    : [];

  const cryptoContracts = Array.isArray(value.cryptoContracts)
    ? value.cryptoContracts.map((contract) => {
        const leverage = Math.max(1, toNumber(contract.leverage));
        if (Number.isFinite(Number(contract.marginUsdt))) {
          const entryPrice = toNumber(contract.entryPrice);
          const marginUsdt = toNumber(contract.marginUsdt);
          return {
            id: contract.id || crypto.randomUUID(),
            name: normalizeSymbol(contract.name || "BTCUSDT"),
            side: contract.side === "short" ? "short" : "long",
            leverage,
            marginUsdt,
            quantity: Number.isFinite(Number(contract.quantity))
              ? toNumber(contract.quantity)
              : (entryPrice ? (marginUsdt * leverage) / entryPrice : 0),
            entryPrice,
            currentPrice: toNumber(contract.currentPrice),
            fxRate: toNumber(contract.fxRate) || 1,
          };
        }

        const legacyCost = toNumber(contract.cost);
        const legacyValue = toNumber(contract.currentValue);
        const legacyMove = legacyCost ? (legacyValue - legacyCost) / (legacyCost * leverage) : 0;
        return {
          id: contract.id || crypto.randomUUID(),
          name: normalizeSymbol(contract.name || "BTCUSDT"),
          side: "long",
          leverage,
          marginUsdt: legacyCost,
          quantity: legacyCost * leverage,
          entryPrice: 1,
          currentPrice: Math.max(0, 1 + legacyMove),
          fxRate: 1,
        };
      })
    : [];

  const latestHistoryFundTotal = [...value.history]
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .at(-1)?.fundTotal;
  const legacyFundTotal = toNumber(value.currentFundTotal) || toNumber(latestHistoryFundTotal);
  if (!funds.length && legacyFundTotal > 0) {
    funds = [
      {
        id: "legacy-fund-total",
        name: "基金總額",
        cost: legacyFundTotal,
        currentValue: legacyFundTotal,
        lastUpdated: "舊資料",
      },
    ];
  }

  const history = value.history
    .map((item) => {
      const fundTotal = toNumber(item.fundTotal);
      const cryptoTotal = toNumber(item.cryptoTotal);
      const stockTotal = Number.isFinite(Number(item.stockTotal))
        ? toNumber(item.stockTotal)
        : Math.max(toNumber(item.total) - fundTotal, 0);
      const stockCost = Number.isFinite(Number(item.stockCost)) ? toNumber(item.stockCost) : 0;
      const fundCost = Number.isFinite(Number(item.fundCost)) ? toNumber(item.fundCost) : 0;
      const cryptoCost = Number.isFinite(Number(item.cryptoCost)) ? toNumber(item.cryptoCost) : 0;
      const rawCash = Number.isFinite(Number(item.cash)) ? toNumber(item.cash) : 0;
      const cashRecorded = Boolean(item.cashRecorded) || (String(item.date || "") >= "2026-07-15" && rawCash > 0);
      const cash = cashRecorded ? rawCash : 0;
      const cost = Number.isFinite(Number(item.cost)) ? toNumber(item.cost) : stockCost + fundCost + cryptoCost;
      return {
        date: String(item.date || todayISO()),
        total: stockTotal + fundTotal + cryptoTotal + cash,
        stockTotal,
        fundTotal,
        cryptoTotal,
        cash,
        cashRecorded,
        stockCost,
        fundCost,
        cryptoCost,
        cost,
        pnl: Number.isFinite(Number(item.pnl)) ? toNumber(item.pnl) : stockTotal + fundTotal + cryptoTotal - cost,
        prices: item.prices && typeof item.prices === "object" ? item.prices : {},
        fundValues: item.fundValues && typeof item.fundValues === "object" ? item.fundValues : {},
        cryptoValues: item.cryptoValues && typeof item.cryptoValues === "object" ? item.cryptoValues : {},
        note: String(item.note || ""),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    holdings,
    funds,
    cryptoContracts,
    history,
    currentFundTotal: funds.reduce((sum, fund) => sum + fund.currentValue, 0),
    cash: toNumber(value.cash),
  };
}

function findHolding(id) {
  return state.holdings.find((item) => item.id === id);
}

function findFund(id) {
  return state.funds.find((item) => item.id === id);
}

function findCryptoContract(id) {
  return state.cryptoContracts.find((item) => item.id === id);
}

function keyIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="3"></circle>
      <path d="M8 12h12"></path>
      <path d="M16 12v3"></path>
      <path d="M20 12v4"></path>
    </svg>
  `;
}

function starIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8l2.7 5.6 6.2.9-4.5 4.4 1.1 6.2-5.5-2.9-5.5 2.9 1.1-6.2-4.5-4.4 6.2-.9L12 2.8z"></path>
    </svg>
  `;
}

function editIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" width="15" height="15">
      <path d="M4 20h4.5L19 9.5 14.5 5 4 15.5V20Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      <path d="M13 6.5 17.5 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;
}

function normalizeSymbol(value) {
  return value.trim().toUpperCase();
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function money(value) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value || 0);
}

function unitMoney(value) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value || 0);
}

function signedMoney(value) {
  return `${value >= 0 ? "+" : "-"}${money(Math.abs(value))}`;
}

function signedNumber(value, digits = 2) {
  return `${value >= 0 ? "+" : "-"}${formatNumber(Math.abs(value), digits)}`;
}

function signedPercent(value) {
  return `${value >= 0 ? "+" : "-"}${formatNumber(Math.abs(value))}%`;
}

function shortMoney(value) {
  if (Math.abs(value) >= 100000000) return `${formatNumber(value / 100000000, 0)}億`;
  if (Math.abs(value) >= 10000) return `${formatNumber(value / 10000, 0)}萬`;
  return formatNumber(value, 0);
}

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat("zh-TW", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value || 0);
}

function todayISO() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateForInput(value) {
  const iso = parseDateInput(value);
  return iso ? iso.replaceAll("-", "/") : "";
}

function parseDateInput(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

backfillHistoryCosts();
render();
initCloudSync();
