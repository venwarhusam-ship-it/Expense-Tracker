// ═══════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════
const DB_NAME = 'ExpenseDB';
const DB_VERSION = 4;
const STORE_NAME = 'expenses';
const INCOME_STORE = 'income';   // kept so upgrade path doesn't error
const PERIODS_STORE = 'periods';
const SAVINGS_STORE = 'savings';

const CATEGORIES = [
  { name: 'Food',          icon: '🍔', color: '#c0622a' },
  { name: 'Transport',     icon: '🚗', color: '#5a8a6a' },
  { name: 'Shopping',      icon: '🛍️', color: '#a06030' },
  { name: 'Health',        icon: '💊', color: '#7a5a8a' },
  { name: 'Entertainment', icon: '🎬', color: '#4a7a8a' },
  { name: 'Bills',         icon: '📄', color: '#8a6a4a' },
  { name: 'Skincare',      icon: '✨', color: '#a05060' },
  { name: 'Other',         icon: '📦', color: '#606060' },
];

// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
let db = null;
let currentView = 'home';
let selectedCurrency = 'IQD';
let selectedCategory = null;
let summaryMode = 'monthly';
let summaryMonth = new Date();
let summaryWeekStart = getWeekStart(new Date());
let pieChartInst = null;
let monthlyBarInst = null;
let weeklyBarInst = null;

// ═══════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  // Read URL params BEFORE rendering anything
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('action') === 'add') currentView = 'add';

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Open IndexedDB — show visible error on failure
  try {
    await openDB();
  } catch (err) {
    showDBError(err);
    return;
  }

  // Build category grid
  buildCategoryGrid();

  // Set today's date in add form
  document.getElementById('expense-date').value = todayStr();

  // Wire up navigation and form
  setupNav();
  setupAddForm();
  setupSummaryControls();

  // Show initial view
  switchView(currentView);
});

// ═══════════════════════════════════════════════════
//  INDEXEDDB
// ═══════════════════════════════════════════════════
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onerror = () => reject(req.error || new Error('IndexedDB failed to open'));

    req.onsuccess = () => {
      db = req.result;
      db.onerror = (e) => console.error('DB error:', e.target.error);
      resolve(db);
    };

    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      // v1 – expenses
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
      // v2 – legacy income store (keep so existing DBs upgrade cleanly)
      if (!database.objectStoreNames.contains(INCOME_STORE)) {
        database.createObjectStore(INCOME_STORE, { keyPath: 'month' });
      }
      // v3 – periods
      if (!database.objectStoreNames.contains(PERIODS_STORE)) {
        database.createObjectStore(PERIODS_STORE, { keyPath: 'id', autoIncrement: true });
      }
      // v4 – savings (single record, id=1)
      if (!database.objectStoreNames.contains(SAVINGS_STORE)) {
        database.createObjectStore(SAVINGS_STORE, { keyPath: 'id' });
      }
    };
  });
}

function getAllExpenses() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function addExpenseToDB(expense) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(expense);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

function deleteExpenseFromDB(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

// ── Periods CRUD ──────────────────────────────────
function getAllPeriods() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PERIODS_STORE, 'readonly');
    const store = tx.objectStore(PERIODS_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function savePeriod(period) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PERIODS_STORE, 'readwrite');
    const store = tx.objectStore(PERIODS_STORE);
    const req = period.id ? store.put(period) : store.add(period);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

async function getActivePeriod() {
  const all = await getAllPeriods();
  return all.find((p) => !p.endDate) || null;
}

// ── Savings CRUD ─────────────────────────────────
function getSavings() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SAVINGS_STORE, 'readonly');
    const store = tx.objectStore(SAVINGS_STORE);
    const req = store.get(1);
    req.onsuccess = () => resolve(req.result || { id: 1, iqd: 0, usd: 0 });
    req.onerror = () => reject(req.error);
  });
}

function saveSavings(iqd, usd) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SAVINGS_STORE, 'readwrite');
    const store = tx.objectStore(SAVINGS_STORE);
    const req = store.put({ id: 1, iqd, usd });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

// Cumulative = sum of (income − spent) for every CLOSED period.
async function getCumulativeBalance() {
  const [periods, expenses] = await Promise.all([getAllPeriods(), getAllExpenses()]);
  const closed = periods.filter((p) => p.endDate);
  let cumIQD = 0, cumUSD = 0;
  closed.forEach((p) => {
    const exp = expenses.filter((e) => e.date >= p.startDate && e.date <= p.endDate);
    cumIQD += (p.incomeIQD || 0) - sumBy(exp, 'IQD');
    cumUSD += (p.incomeUSD || 0) - sumBy(exp, 'USD');
  });
  return { iqd: cumIQD, usd: cumUSD };
}

function showDBError(err) {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed;inset:0;background:#0d0d0d;',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'padding:32px;text-align:center;font-family:system-ui;z-index:9999;gap:12px;'
  ].join('');
  el.innerHTML = `
    <div style="font-size:40px">⚠️</div>
    <h2 style="color:#f0f0f0;font-size:20px">Database Error</h2>
    <p style="color:#e05050;font-size:15px">${escHtml(String(err?.message || err))}</p>
    <p style="color:#888;font-size:13px">
      IndexedDB could not be opened.<br>
      Try reloading, or check that you are not in Private Browsing mode.
    </p>
    <button onclick="location.reload()"
      style="margin-top:8px;padding:12px 24px;background:#d4a030;border:none;
             border-radius:8px;color:#0d0d0d;font-weight:700;font-size:15px;cursor:pointer;">
      Reload
    </button>`;
  document.body.appendChild(el);
}

// ═══════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════
function setupNav() {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

function switchView(view) {
  currentView = view;

  document.querySelectorAll('.nav-item').forEach((btn) =>
    btn.classList.toggle('active', btn.dataset.view === view)
  );
  document.querySelectorAll('.view').forEach((v) =>
    v.classList.toggle('active', v.id === `view-${view}`)
  );

  if (view === 'home') renderHome();
  else if (view === 'history') renderHistory();
  else if (view === 'summary') renderSummary();
  else if (view === 'add') resetAddForm();
}

// ── Clear all data ────────────────────────────────
document.addEventListener('click', (e) => {
  if (e.target.id !== 'clear-data-btn') return;
  if (!confirm('Delete ALL expenses, periods, and income? This cannot be undone.')) return;
  clearAllData();
});

function clearAllData() {
  const stores = [STORE_NAME, INCOME_STORE, PERIODS_STORE, SAVINGS_STORE];
  let done = 0;
  stores.forEach((storeName) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => { done++; if (done === stores.length) switchView('home'); };
    tx.onerror  = () => { done++; if (done === stores.length) switchView('home'); };
  });
}

// Clears all stores and resolves when done (no navigation)
function clearAllStores() {
  const stores = [STORE_NAME, INCOME_STORE, PERIODS_STORE, SAVINGS_STORE];
  return Promise.all(stores.map((name) =>
    new Promise((resolve) => {
      const tx = db.transaction(name, 'readwrite');
      tx.objectStore(name).clear();
      tx.oncomplete = resolve;
      tx.onerror = resolve; // resolve anyway so restore can continue
    })
  ));
}

// ── Backup ────────────────────────────────────────
async function backupData() {
  const [expenses, periods, savings] = await Promise.all([getAllExpenses(), getAllPeriods(), getSavings()]);
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    expenses,
    periods,
    savings,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `expenses-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

// ── Restore ───────────────────────────────────────
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'restore-file-input') return;
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ''; // reset so same file can be picked again

  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    alert('Could not read file — make sure it is a valid backup.');
    return;
  }

  if (!Array.isArray(payload.expenses)) {
    alert('Invalid backup file.');
    return;
  }

  const expCount    = payload.expenses.length;
  const periodCount = (payload.periods || []).length;
  const exportedAt  = payload.exportedAt
    ? new Date(payload.exportedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'unknown date';

  if (!confirm(
    `Restore backup from ${exportedAt}?\n\n` +
    `• ${expCount} expense${expCount !== 1 ? 's' : ''}\n` +
    `• ${periodCount} period${periodCount !== 1 ? 's' : ''}\n\n` +
    `This will replace ALL current data.`
  )) return;

  try {
    await clearAllStores();

    // Restore expenses (strip old IDs so DB auto-assigns new ones)
    for (const { id, ...rest } of payload.expenses) {
      await addExpenseToDB(rest);
    }

    // Restore periods
    for (const { id, ...rest } of (payload.periods || [])) {
      await savePeriod(rest);
    }

    // Restore savings
    if (payload.savings) {
      await saveSavings(payload.savings.iqd || 0, payload.savings.usd || 0);
    }

    switchView('home');
  } catch (err) {
    alert('Restore failed: ' + (err?.message || err));
  }
});

// Wire up backup/restore buttons (delegated)
document.addEventListener('click', (e) => {
  if (e.target.closest('#backup-btn'))  backupData();
  if (e.target.closest('#restore-btn')) document.getElementById('restore-file-input').click();
});

// Savings toggle (delegated — savings section re-renders with home)
document.addEventListener('click', (e) => {
  if (e.target.id !== 'savings-toggle-btn') return;
  const ed = document.getElementById('savings-editor');
  if (ed) ed.style.display = ed.style.display === 'none' ? 'block' : 'none';
});

// Save savings (delegated)
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'save-savings-btn') return;
  const iqd = parseFloat(document.getElementById('sav-iqd').value) || 0;
  const usd = parseFloat(document.getElementById('sav-usd').value) || 0;
  await saveSavings(iqd, usd);
  renderHome();
});

// ═══════════════════════════════════════════════════
//  HOME VIEW
// ═══════════════════════════════════════════════════
async function renderHome() {
  const [allPeriods, expenses, savings] = await Promise.all([getAllPeriods(), getAllExpenses(), getSavings()]);

  const period = allPeriods.find((p) => !p.endDate) || null;
  const closed = allPeriods
    .filter((p) => p.endDate)
    .sort((a, b) => b.endDate.localeCompare(a.endDate));

  // Compute cumulative + per-period history in one pass
  let cumIQD = 0, cumUSD = 0;
  const history = closed.map((p) => {
    const exp = expenses.filter((e) => e.date >= p.startDate && e.date <= p.endDate);
    const spentIQD = sumBy(exp, 'IQD');
    const spentUSD = sumBy(exp, 'USD');
    const remIQD = (p.incomeIQD || 0) - spentIQD;
    const remUSD = (p.incomeUSD || 0) - spentUSD;
    cumIQD += remIQD;
    cumUSD += remUSD;
    return { ...p, spentIQD, spentUSD, remIQD, remUSD };
  });
  const cumulative = { iqd: cumIQD, usd: cumUSD };

  const statsEl = document.getElementById('home-stats');
  statsEl.innerHTML = '';

  const hasCumulative = cumulative.iqd !== 0 || cumulative.usd !== 0;

  if (!period) {
    // ── No active period ─────────────────────────────
    document.getElementById('home-month').textContent = 'No Active Period';

    statsEl.innerHTML = `
      ${savingsHtml(savings)}
      ${hasCumulative ? cumulativeHtml(cumulative) : ''}
      ${periodHistoryHtml(history)}
      <div class="no-period-wrap">
        <p class="no-period-msg">Start a new month to track income &amp; remaining balance.</p>
        <button class="start-period-btn" id="start-period-btn">+ Start New Month</button>
      </div>
      <div class="period-form" id="period-form" style="display:none">
        <div class="income-editor" style="display:block;margin:0">
          <div class="income-inputs">
            <div class="income-input-group">
              <span class="income-input-label">IQD Income</span>
              <input type="text" inputmode="decimal" id="new-inc-iqd" placeholder="0" autocomplete="off">
            </div>
            <div class="income-input-group">
              <span class="income-input-label">USD Income</span>
              <input type="text" inputmode="decimal" id="new-inc-usd" placeholder="0" autocomplete="off">
            </div>
          </div>
          <div class="income-input-group" style="margin-bottom:12px">
            <span class="income-input-label">Start Date</span>
            <input type="date" id="new-start-date" value="${todayStr()}" autocomplete="off"
              style="height:46px;background:var(--elevated);border:1px solid var(--border);
                     border-radius:var(--radius-btn);color:var(--text);font-size:15px;
                     font-family:inherit;padding:0 12px;outline:none;width:100%;">
          </div>
          <button class="save-income-btn" id="create-period-btn">Start Month</button>
        </div>
      </div>`;

    document.getElementById('start-period-btn').addEventListener('click', () => {
      document.getElementById('period-form').style.display = 'block';
      document.getElementById('start-period-btn').style.display = 'none';
    });

    document.getElementById('create-period-btn').addEventListener('click', async () => {
      const iqdVal = parseFloat(document.getElementById('new-inc-iqd').value) || 0;
      const usdVal = parseFloat(document.getElementById('new-inc-usd').value) || 0;
      const startDate = document.getElementById('new-start-date').value || todayStr();
      await savePeriod({ startDate, endDate: null, incomeIQD: iqdVal, incomeUSD: usdVal });
      renderHome();
    });

    document.getElementById('home-expense-list').innerHTML = '';
    document.getElementById('home-empty').style.display = 'flex';
    return;
  }

  // ── Active period ─────────────────────────────────
  document.getElementById('home-month').textContent =
    `${fmtDate(period.startDate)} – ongoing`;

  const periodExp = expenses.filter((e) => e.date >= period.startDate);
  const spentIQD  = sumBy(periodExp, 'IQD');
  const spentUSD  = sumBy(periodExp, 'USD');
  const remIQD    = (period.incomeIQD || 0) - spentIQD;
  const remUSD    = (period.incomeUSD || 0) - spentUSD;
  const incomeSet = period.incomeIQD > 0 || period.incomeUSD > 0;

  statsEl.innerHTML = `
    ${savingsHtml(savings)}
    <div class="home-section-header">
      <span class="home-section-title">Current Period</span>
      <button class="income-toggle-btn" id="income-toggle-btn">
        ${incomeSet ? '✎ Edit Income' : '+ Set Income'}
      </button>
    </div>

    <div class="income-editor" id="income-editor" style="display:none">
      <div class="income-inputs">
        <div class="income-input-group">
          <span class="income-input-label">IQD Income</span>
          <input type="text" inputmode="decimal" id="inc-iqd"
            placeholder="0" value="${period.incomeIQD || ''}" autocomplete="off">
        </div>
        <div class="income-input-group">
          <span class="income-input-label">USD Income</span>
          <input type="text" inputmode="decimal" id="inc-usd"
            placeholder="0" value="${period.incomeUSD || ''}" autocomplete="off">
        </div>
      </div>
      <button class="save-income-btn" id="save-income-btn">Save</button>
    </div>

    <div class="stats-grid">
      ${incomeSet ? `
      <div class="stat-row">
        <div class="stat-card income-card">
          <div class="stat-label">Income IQD</div>
          <div class="stat-value accent">${fmtAmount(period.incomeIQD, 'IQD')}</div>
        </div>
        <div class="stat-card income-card">
          <div class="stat-label">Income USD</div>
          <div class="stat-value accent">${fmtAmount(period.incomeUSD, 'USD')}</div>
        </div>
      </div>` : ''}
      <div class="stat-row">
        <div class="stat-card">
          <div class="stat-label">Spent IQD</div>
          <div class="stat-value">${fmtAmount(spentIQD, 'IQD')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Spent USD</div>
          <div class="stat-value">${fmtAmount(spentUSD, 'USD')}</div>
        </div>
      </div>
      ${incomeSet ? `
      <div class="stat-row">
        <div class="stat-card remaining-card">
          <div class="stat-label">Remaining IQD</div>
          <div class="stat-value ${remIQD >= 0 ? 'positive' : 'negative'}">${fmtAmount(remIQD, 'IQD')}</div>
        </div>
        <div class="stat-card remaining-card">
          <div class="stat-label">Remaining USD</div>
          <div class="stat-value ${remUSD >= 0 ? 'positive' : 'negative'}">${fmtAmount(remUSD, 'USD')}</div>
        </div>
      </div>` : ''}
    </div>

    ${hasCumulative ? cumulativeHtml(cumulative) : ''}
    ${periodHistoryHtml(history)}

    <div class="end-period-wrap" id="end-period-wrap">
      <button class="end-period-btn" id="end-period-btn">End This Month</button>
    </div>
    <div class="end-period-form" id="end-period-form" style="display:none">
      <div class="income-editor" style="display:block;margin:0">
        <div class="income-input-group" style="margin-bottom:12px">
          <span class="income-input-label">End Date</span>
          <input type="date" id="end-date-input" value="${todayStr()}"
            style="height:46px;background:var(--elevated);border:1px solid var(--border);
                   border-radius:var(--radius-btn);color:var(--text);font-size:15px;
                   font-family:inherit;padding:0 12px;outline:none;width:100%;">
        </div>
        <div style="display:flex;gap:10px">
          <button class="save-income-btn" id="cancel-end-btn"
            style="background:var(--elevated);color:var(--muted);border:1px solid var(--border)">Cancel</button>
          <button class="save-income-btn" id="confirm-end-btn">Confirm End Month</button>
        </div>
      </div>
    </div>`;

  // Wire up income edit
  document.getElementById('income-toggle-btn').addEventListener('click', () => {
    const ed = document.getElementById('income-editor');
    ed.style.display = ed.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('save-income-btn').addEventListener('click', async () => {
    period.incomeIQD = parseFloat(document.getElementById('inc-iqd').value) || 0;
    period.incomeUSD = parseFloat(document.getElementById('inc-usd').value) || 0;
    await savePeriod(period);
    renderHome();
  });

  // Wire up end period
  document.getElementById('end-period-btn').addEventListener('click', () => {
    document.getElementById('end-period-wrap').style.display = 'none';
    document.getElementById('end-period-form').style.display = 'block';
  });

  document.getElementById('cancel-end-btn').addEventListener('click', () => {
    document.getElementById('end-period-wrap').style.display = 'block';
    document.getElementById('end-period-form').style.display = 'none';
  });

  document.getElementById('confirm-end-btn').addEventListener('click', async () => {
    const endDate = document.getElementById('end-date-input').value || todayStr();
    if (endDate < period.startDate) {
      alert('End date cannot be before the start date.');
      return;
    }
    period.endDate = endDate;
    await savePeriod(period);
    renderHome();
  });

  // Expense list
  const sorted = periodExp.slice().sort((a, b) =>
    b.date.localeCompare(a.date) || b.id - a.id
  );
  renderExpenseList('home-expense-list', 'home-empty', sorted, renderHome);
}

// Shared cumulative balance block
function cumulativeHtml(cumulative) {
  return `
    <div class="cumulative-section">
      <div class="home-section-header">
        <span class="home-section-title">Cumulative Balance</span>
        <span class="cumulative-hint">all ended months</span>
      </div>
      <div class="stat-row" style="padding:0 20px 16px">
        <div class="stat-card cumulative-card">
          <div class="stat-label">Total IQD</div>
          <div class="stat-value ${cumulative.iqd >= 0 ? 'positive' : 'negative'}">
            ${cumulative.iqd < 0 ? '−' : ''}${fmtAmount(Math.abs(cumulative.iqd), 'IQD')}
          </div>
          ${cumulative.iqd < 0 ? '<div class="stat-sub">over budget</div>' : ''}
        </div>
        <div class="stat-card cumulative-card">
          <div class="stat-label">Total USD</div>
          <div class="stat-value ${cumulative.usd >= 0 ? 'positive' : 'negative'}">
            ${cumulative.usd < 0 ? '−' : ''}${fmtAmount(Math.abs(cumulative.usd), 'USD')}
          </div>
          ${cumulative.usd < 0 ? '<div class="stat-sub">over budget</div>' : ''}
        </div>
      </div>
    </div>`;
}

function periodHistoryHtml(history) {
  if (history.length === 0) return '';

  const items = history.map((p) => {
    const hasUSD = p.incomeUSD > 0 || p.spentUSD > 0;
    const remIQDSign = p.remIQD >= 0 ? '+' : '';
    const remUSDSign = p.remUSD >= 0 ? '+' : '';
    return `
      <div class="ph-item">
        <div class="ph-header">
          <span class="ph-dates">${fmtDate(p.startDate)} – ${fmtDate(p.endDate)}</span>
          <div class="ph-remainders">
            ${p.incomeIQD > 0 || p.spentIQD > 0
              ? `<span class="ph-rem ${p.remIQD >= 0 ? 'positive' : 'negative'}">${remIQDSign}${fmtAmount(p.remIQD, 'IQD')}</span>`
              : ''}
            ${hasUSD
              ? `<span class="ph-rem ${p.remUSD >= 0 ? 'positive' : 'negative'}">${remUSDSign}${fmtAmount(p.remUSD, 'USD')}</span>`
              : ''}
          </div>
        </div>
        <div class="ph-detail">
          ${p.incomeIQD > 0 ? `<span>Earned ${fmtAmount(p.incomeIQD, 'IQD')}</span>` : ''}
          ${p.incomeUSD > 0 ? `<span>Earned ${fmtAmount(p.incomeUSD, 'USD')}</span>` : ''}
          ${p.spentIQD > 0 ? `<span>Spent ${fmtAmount(p.spentIQD, 'IQD')}</span>` : ''}
          ${p.spentUSD > 0 ? `<span>Spent ${fmtAmount(p.spentUSD, 'USD')}</span>` : ''}
        </div>
      </div>`;
  }).join('');

  return `
    <div class="ph-section">
      <div class="home-section-header">
        <span class="home-section-title">Month History</span>
      </div>
      <div class="ph-list">${items}</div>
    </div>`;
}

function savingsHtml(savings) {
  const iqd = savings.iqd || 0;
  const usd = savings.usd || 0;
  const hasData = iqd !== 0 || usd !== 0;
  return `
    <div class="savings-section">
      <div class="home-section-header">
        <span class="home-section-title">Savings</span>
        <button class="savings-toggle-btn" id="savings-toggle-btn">
          ${hasData ? '✎ Edit' : '+ Set Amount'}
        </button>
      </div>
      <div class="income-editor savings-editor" id="savings-editor" style="display:none">
        <div class="income-inputs">
          <div class="income-input-group">
            <span class="income-input-label">IQD Savings</span>
            <input type="text" inputmode="decimal" id="sav-iqd"
              placeholder="0" value="${iqd || ''}" autocomplete="off">
          </div>
          <div class="income-input-group">
            <span class="income-input-label">USD Savings</span>
            <input type="text" inputmode="decimal" id="sav-usd"
              placeholder="0" value="${usd || ''}" autocomplete="off">
          </div>
        </div>
        <button class="save-savings-btn" id="save-savings-btn">Save Savings</button>
      </div>
      <div class="stat-row" style="padding:0 20px 16px">
        <div class="stat-card savings-card">
          <div class="stat-label">IQD Savings</div>
          <div class="stat-value savings-value">${fmtAmount(iqd, 'IQD')}</div>
        </div>
        <div class="stat-card savings-card">
          <div class="stat-label">USD Savings</div>
          <div class="stat-value savings-value">${fmtAmount(usd, 'USD')}</div>
        </div>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════
//  HISTORY VIEW
// ═══════════════════════════════════════════════════
async function renderHistory() {
  const expenses = await getAllExpenses();
  const listEl = document.getElementById('history-list');
  const emptyEl = document.getElementById('history-empty');

  if (expenses.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'flex';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.innerHTML = '';

  // Group by month
  const groups = {};
  expenses.forEach((e) => {
    const key = e.date.substring(0, 7);
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  });

  Object.keys(groups)
    .sort((a, b) => b.localeCompare(a))
    .forEach((key) => {
      const items = groups[key].slice().sort(
        (a, b) => b.date.localeCompare(a.date) || b.id - a.id
      );
      const [yr, mo] = key.split('-');
      const dt = new Date(+yr, +mo - 1, 1);
      const iqdTotal = sumBy(items, 'IQD');
      const usdTotal = sumBy(items, 'USD');

      const totalsHtml = [
        iqdTotal > 0 ? `<span>${fmtAmount(iqdTotal, 'IQD')}</span>` : '',
        usdTotal > 0 ? `<span>${fmtAmount(usdTotal, 'USD')}</span>` : '',
      ].join('');

      const section = document.createElement('div');
      section.className = 'month-section';
      section.innerHTML = `
        <div class="month-header">
          <span class="month-title">${fmtMonthYear(dt)}</span>
          <div class="month-totals">${totalsHtml}</div>
        </div>
        <div class="expense-list" id="grp-${key}"></div>`;
      listEl.appendChild(section);

      renderExpenseItems(`grp-${key}`, items, renderHistory);
    });
}

// ═══════════════════════════════════════════════════
//  EXPENSE LIST HELPERS
// ═══════════════════════════════════════════════════
function renderExpenseList(containerId, emptyId, expenses, onDelete) {
  const emptyEl = document.getElementById(emptyId);
  if (expenses.length === 0) {
    document.getElementById(containerId).innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  renderExpenseItems(containerId, expenses, onDelete);
}

function renderExpenseItems(containerId, expenses, onDelete) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  expenses.forEach((expense) => {
    const cat = CATEGORIES.find((c) => c.name === expense.category) || CATEGORIES[7];
    const displayName = expense.category === 'Other' && expense.customCategory
      ? escHtml(expense.customCategory)
      : escHtml(expense.category);
    const item = document.createElement('div');
    item.className = 'expense-item';
    item.style.setProperty('--dot-color', cat.color);
    item.innerHTML = `
      <div class="expense-dot" style="background:${cat.color}"></div>
      <div class="expense-info">
        <div class="expense-category">${displayName}</div>
        ${expense.note ? `<div class="expense-note">${escHtml(expense.note)}</div>` : ''}
        <div class="expense-date">${fmtDate(expense.date)}</div>
      </div>
      <div class="expense-right">
        <div class="expense-amount">${fmtAmount(expense.amount, expense.currency)}</div>
        <button class="delete-btn" aria-label="Delete expense" title="Delete">&#215;</button>
      </div>`;

    // Swipe-to-delete
    let startX = 0, startY = 0, dragging = false;
    item.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dragging = false;
    }, { passive: true });
    item.addEventListener('touchmove', (e) => {
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!dragging && Math.abs(dx) > Math.abs(dy) && dx < -10) dragging = true;
      if (dragging) {
        item.style.transform = `translateX(${Math.max(dx, -80)}px)`;
      }
    }, { passive: true });
    item.addEventListener('touchend', () => {
      const offset = parseFloat(item.style.transform.replace(/[^-\d.]/g, '') || '0');
      item.style.transform = '';
      if (dragging && offset < -50) doDelete(expense.id, onDelete);
      dragging = false;
    });

    item.querySelector('.delete-btn').addEventListener('click', () =>
      doDelete(expense.id, onDelete)
    );
    container.appendChild(item);
  });
}

async function doDelete(id, onDelete) {
  if (!confirm('Delete this expense?')) return;
  try {
    await deleteExpenseFromDB(id);
    if (typeof onDelete === 'function') onDelete();
  } catch (err) {
    alert('Failed to delete: ' + (err?.message || err));
  }
}

// ═══════════════════════════════════════════════════
//  ADD VIEW
// ═══════════════════════════════════════════════════
function buildCategoryGrid() {
  const grid = document.getElementById('category-grid');
  CATEGORIES.forEach((cat) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'category-btn';
    btn.dataset.category = cat.name;
    btn.innerHTML = `
      <span class="category-icon">${cat.icon}</span>
      <span class="category-label">${cat.name}</span>`;
    grid.appendChild(btn);
  });
}

function setupAddForm() {
  // Currency toggle
  document.querySelectorAll('.currency-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedCurrency = btn.dataset.currency;
      document.querySelectorAll('.currency-btn').forEach((b) =>
        b.classList.toggle('active', b.dataset.currency === selectedCurrency)
      );
    });
  });

  // Category selection
  document.getElementById('category-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('.category-btn');
    if (!btn) return;
    selectedCategory = btn.dataset.category;
    document.querySelectorAll('.category-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.category === selectedCategory)
    );
    // Show "What is it?" only for Other
    const otherGroup = document.getElementById('other-label-group');
    otherGroup.style.display = selectedCategory === 'Other' ? 'block' : 'none';
    if (selectedCategory === 'Other') {
      document.getElementById('other-label').focus();
    }
  });

  // Amount: strip non-numeric characters (allow one decimal point)
  document.getElementById('expense-amount').addEventListener('input', (e) => {
    const raw = e.target.value.replace(/[^0-9.]/g, '');
    const parts = raw.split('.');
    e.target.value = parts.length > 2
      ? parts[0] + '.' + parts.slice(1).join('')
      : raw;
  });

  // Submit
  document.getElementById('add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleAddSubmit();
  });
}

function resetAddForm() {
  document.getElementById('expense-amount').value = '';
  document.getElementById('expense-note').value = '';
  document.getElementById('expense-date').value = todayStr();
  selectedCurrency = 'IQD';
  selectedCategory = null;
  document.querySelectorAll('.currency-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.currency === 'IQD')
  );
  document.querySelectorAll('.category-btn').forEach((b) =>
    b.classList.remove('active')
  );
  document.getElementById('other-label').value = '';
  document.getElementById('other-label-group').style.display = 'none';
  const fb = document.getElementById('add-feedback');
  fb.textContent = '';
  fb.className = 'feedback';
}

async function handleAddSubmit() {
  const fb = document.getElementById('add-feedback');
  const amountRaw = document.getElementById('expense-amount').value.trim();
  const amount = parseFloat(amountRaw);

  if (!amountRaw || isNaN(amount) || amount <= 0) {
    fb.textContent = 'Please enter a valid amount greater than 0.';
    fb.className = 'feedback error';
    return;
  }
  if (!selectedCategory) {
    fb.textContent = 'Please select a category.';
    fb.className = 'feedback error';
    return;
  }

  const note = document.getElementById('expense-note').value.trim();
  const date = document.getElementById('expense-date').value || todayStr();
  const customCategory = selectedCategory === 'Other'
    ? document.getElementById('other-label').value.trim()
    : '';

  try {
    await addExpenseToDB({ amount, currency: selectedCurrency, category: selectedCategory, customCategory, note, date });
    fb.textContent = 'Expense added!';
    fb.className = 'feedback success';
    resetAddForm();
    setTimeout(() => { fb.textContent = ''; fb.className = 'feedback'; }, 2000);
  } catch (err) {
    fb.textContent = 'Failed to save: ' + (err?.message || err);
    fb.className = 'feedback error';
  }
}

// ═══════════════════════════════════════════════════
//  SUMMARY VIEW
// ═══════════════════════════════════════════════════
function setupSummaryControls() {
  // Mode toggle (Monthly / Weekly)
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      summaryMode = btn.dataset.mode;
      document.querySelectorAll('.mode-btn').forEach((b) =>
        b.classList.toggle('active', b.dataset.mode === summaryMode)
      );
      document.getElementById('monthly-section').style.display =
        summaryMode === 'monthly' ? '' : 'none';
      document.getElementById('weekly-section').style.display =
        summaryMode === 'weekly' ? '' : 'none';
      renderSummary();
    });
  });

  // Month nav
  document.getElementById('prev-month').addEventListener('click', () => {
    summaryMonth = new Date(summaryMonth.getFullYear(), summaryMonth.getMonth() - 1, 1);
    renderMonthlySummary();
  });
  document.getElementById('next-month').addEventListener('click', () => {
    summaryMonth = new Date(summaryMonth.getFullYear(), summaryMonth.getMonth() + 1, 1);
    renderMonthlySummary();
  });

  // Week nav
  document.getElementById('prev-week').addEventListener('click', () => {
    summaryWeekStart = new Date(summaryWeekStart);
    summaryWeekStart.setDate(summaryWeekStart.getDate() - 7);
    renderWeeklySummary();
  });
  document.getElementById('next-week').addEventListener('click', () => {
    summaryWeekStart = new Date(summaryWeekStart);
    summaryWeekStart.setDate(summaryWeekStart.getDate() + 7);
    renderWeeklySummary();
  });
}

function renderSummary() {
  if (summaryMode === 'monthly') {
    document.getElementById('monthly-section').style.display = '';
    document.getElementById('weekly-section').style.display = 'none';
    renderMonthlySummary();
  } else {
    document.getElementById('monthly-section').style.display = 'none';
    document.getElementById('weekly-section').style.display = '';
    renderWeeklySummary();
  }
}

async function renderMonthlySummary() {
  const expenses = await getAllExpenses();
  const prefix = monthPrefix(summaryMonth);
  const month = expenses.filter((e) => e.date.startsWith(prefix));

  document.getElementById('summary-month-label').textContent = fmtMonthYear(summaryMonth);

  if (month.length === 0) {
    document.getElementById('monthly-empty').style.display = 'flex';
    document.getElementById('monthly-charts').style.display = 'none';
    destroyChart('pie');
    destroyChart('monthlyBar');
    return;
  }
  document.getElementById('monthly-empty').style.display = 'none';
  document.getElementById('monthly-charts').style.display = '';

  // ── Pie chart: amount spent per category ──
  // Key = display name (uses customCategory for "Other" items)
  const catIQD = {}, catUSD = {}, catColor = {};
  month.forEach((e) => {
    const key = e.category === 'Other' && e.customCategory
      ? e.customCategory : e.category;
    const color = (CATEGORIES.find((c) => c.name === e.category) || { color: '#606060' }).color;
    catColor[key] = color;
    if (e.currency === 'IQD') catIQD[key] = (catIQD[key] || 0) + e.amount;
    else                       catUSD[key] = (catUSD[key] || 0) + e.amount;
  });

  // Use IQD if any IQD data exists; otherwise fall back to USD
  const hasIQDPie = Object.values(catIQD).some((v) => v > 0);
  const pieSource   = hasIQDPie ? catIQD : catUSD;
  const pieCurrency = hasIQDPie ? 'IQD'  : 'USD';

  const activeCategories = Object.keys(pieSource).filter((k) => pieSource[k] > 0);
  const pieValues  = activeCategories.map((k) => pieSource[k]);
  const pieColors  = activeCategories.map((k) => catColor[k] || '#606060');
  buildPieChart(activeCategories, pieValues, pieColors, pieCurrency);

  // ── Monthly bar chart: daily IQD + USD ──
  const daysInMonth = new Date(
    summaryMonth.getFullYear(), summaryMonth.getMonth() + 1, 0
  ).getDate();
  const dailyIQD = Array(daysInMonth).fill(0);
  const dailyUSD = Array(daysInMonth).fill(0);
  month.forEach((e) => {
    const day = parseInt(e.date.split('-')[2], 10) - 1;
    if (e.currency === 'IQD') dailyIQD[day] += e.amount;
    else dailyUSD[day] += e.amount;
  });

  const dayLabels = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  buildBarChart(
    'monthly-bar-chart', 'monthlyBar',
    dayLabels,
    dailyIQD.some((v) => v > 0) ? dailyIQD : null,
    dailyUSD.some((v) => v > 0) ? dailyUSD : null
  );

  // ── Breakdown table ──
  buildBreakdownTable('monthly-breakdown', month);
}

async function renderWeeklySummary() {
  const expenses = await getAllExpenses();
  const weekEnd = new Date(summaryWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const startS = dateToStr(summaryWeekStart);
  const endS = dateToStr(weekEnd);
  const week = expenses.filter((e) => e.date >= startS && e.date <= endS);

  document.getElementById('summary-week-label').textContent =
    fmtWeekRange(summaryWeekStart, weekEnd);
  document.getElementById('week-total-iqd').textContent =
    fmtAmount(sumBy(week, 'IQD'), 'IQD');
  document.getElementById('week-total-usd').textContent =
    fmtAmount(sumBy(week, 'USD'), 'USD');

  if (week.length === 0) {
    document.getElementById('weekly-empty').style.display = 'flex';
    document.getElementById('weekly-charts').style.display = 'none';
    destroyChart('weeklyBar');
    return;
  }
  document.getElementById('weekly-empty').style.display = 'none';
  document.getElementById('weekly-charts').style.display = '';

  // ── Weekly bar chart: daily totals Sat–Fri ──
  const DAY_LABELS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const dailyIQD = Array(7).fill(0);
  const dailyUSD = Array(7).fill(0);
  week.forEach((e) => {
    // Parse date without timezone shift
    const [yr, mo, dy] = e.date.split('-').map(Number);
    const d = new Date(yr, mo - 1, dy);
    // 0=Sun,1=Mon,...,6=Sat → Sat=0,Sun=1,...,Fri=6
    const idx = (d.getDay() + 1) % 7;
    if (e.currency === 'IQD') dailyIQD[idx] += e.amount;
    else dailyUSD[idx] += e.amount;
  });

  buildBarChart(
    'weekly-bar-chart', 'weeklyBar',
    DAY_LABELS,
    dailyIQD.some((v) => v > 0) ? dailyIQD : null,
    dailyUSD.some((v) => v > 0) ? dailyUSD : null
  );

  buildBreakdownTable('weekly-breakdown', week);
}

// ═══════════════════════════════════════════════════
//  CHARTS
// ═══════════════════════════════════════════════════
const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: true,
};

function buildPieChart(labels, data, colors, currency) {
  destroyChart('pie');
  const ctx = document.getElementById('pie-chart');
  if (!ctx) return;
  pieChartInst = new Chart(ctx, {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor: '#1a1a1a',
        borderWidth: 2,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#f0f0f0',
            padding: 14,
            font: { family: 'system-ui', size: 12 },
            boxWidth: 12,
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${fmtAmount(ctx.parsed, currency || 'IQD')}`,
          },
        },
      },
    },
  });
}

function buildBarChart(canvasId, instKey, labels, iqdData, usdData) {
  destroyChart(instKey);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  // Use separate Y-axes when both currencies present so USD bars
  // don't become invisible beside large IQD values
  const bothCurrencies = iqdData && usdData;

  const datasets = [];
  if (iqdData) datasets.push({
    label: 'IQD',
    data: iqdData,
    backgroundColor: '#d4a030',
    borderRadius: 4,
    borderSkipped: false,
    yAxisID: bothCurrencies ? 'yIQD' : 'y',
  });
  if (usdData) datasets.push({
    label: 'USD',
    data: usdData,
    backgroundColor: '#5a8a6a',
    borderRadius: 4,
    borderSkipped: false,
    yAxisID: bothCurrencies ? 'yUSD' : 'y',
  });

  const sharedAxis = {
    ticks: { color: '#888', font: { size: 11, family: 'system-ui' } },
    grid: { color: '#2e2e2e' },
    beginAtZero: true,
  };

  const scales = bothCurrencies
    ? {
        x: { ticks: { color: '#888', font: { size: 11, family: 'system-ui' } }, grid: { color: '#2e2e2e' } },
        yIQD: { ...sharedAxis, position: 'left',  ticks: { ...sharedAxis.ticks, color: '#d4a030' }, grid: { color: '#2e2e2e' } },
        yUSD: { ...sharedAxis, position: 'right', ticks: { ...sharedAxis.ticks, color: '#5a8a6a' }, grid: { drawOnChartArea: false } },
      }
    : { x: sharedAxis, y: sharedAxis };

  const inst = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        legend: {
          labels: { color: '#f0f0f0', font: { family: 'system-ui', size: 12 }, boxWidth: 12 },
        },
      },
      scales,
    },
  });

  if (instKey === 'monthlyBar') monthlyBarInst = inst;
  else if (instKey === 'weeklyBar') weeklyBarInst = inst;
}

function destroyChart(key) {
  if (key === 'pie'        && pieChartInst)  { pieChartInst.destroy();  pieChartInst  = null; }
  if (key === 'monthlyBar' && monthlyBarInst){ monthlyBarInst.destroy(); monthlyBarInst = null; }
  if (key === 'weeklyBar'  && weeklyBarInst) { weeklyBarInst.destroy();  weeklyBarInst  = null; }
}

// ═══════════════════════════════════════════════════
//  BREAKDOWN TABLE
// ═══════════════════════════════════════════════════
function buildBreakdownTable(containerId, expenses) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const data = {};
  expenses.forEach((e) => {
    const key = e.category === 'Other' && e.customCategory
      ? `Other: ${e.customCategory}`
      : e.category;
    if (!data[key]) data[key] = { IQD: 0, USD: 0, count: 0, color: (CATEGORIES.find((c) => c.name === e.category) || { color: '#606060' }).color };
    data[key][e.currency] += e.amount;
    data[key].count++;
  });

  const rows = Object.entries(data)
    .sort((a, b) => (b[1].IQD + b[1].USD) - (a[1].IQD + a[1].USD))
    .map(([cat, d]) => {
      return `<tr>
        <td><span class="cat-dot" style="background:${d.color}"></span>${escHtml(cat)}</td>
        <td>${d.IQD > 0 ? fmtAmount(d.IQD, 'IQD') : '—'}</td>
        <td>${d.USD > 0 ? fmtAmount(d.USD, 'USD') : '—'}</td>
        <td>${d.count}</td>
      </tr>`;
    }).join('');

  container.innerHTML = `
    <table class="breakdown-table">
      <thead><tr><th>Category</th><th>IQD</th><th>USD</th><th>#</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ═══════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════
function todayStr() {
  return dateToStr(new Date());
}

function dateToStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function monthPrefix(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function fmtMonthYear(d) {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function fmtDate(str) {
  const [yr, mo, dy] = str.split('-').map(Number);
  return new Date(yr, mo - 1, dy).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtAmount(amount, currency) {
  if (currency === 'IQD') return `${Math.round(amount).toLocaleString('en-US')} IQD`;
  return `$${amount.toFixed(2)}`;
}

function sumBy(expenses, currency) {
  return expenses.filter((e) => e.currency === currency).reduce((s, e) => s + e.amount, 0);
}

function getWeekStart(date) {
  const d = new Date(date);
  // getDay(): 0=Sun … 6=Sat → Sat=0 offset
  const offset = (d.getDay() + 1) % 7;
  d.setDate(d.getDate() - offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtWeekRange(start, end) {
  const sDay = start.getDate();
  const eDay = end.getDate();
  const sMo = start.toLocaleDateString('en-US', { month: 'short' });
  const eMo = end.toLocaleDateString('en-US', { month: 'short' });
  const yr = end.getFullYear();
  if (start.getMonth() === end.getMonth()) return `${sDay}–${eDay} ${sMo} ${yr}`;
  return `${sDay} ${sMo} – ${eDay} ${eMo} ${yr}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
