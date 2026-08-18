const firebaseConfig = {
  apiKey: "AIzaSyCvJnrGfusQuPC0aL8GgGd8SEP0SRjXeok",
  authDomain: "smart-cable-demo.firebaseapp.com",
  projectId: "smart-cable-demo",
  storageBucket: "smart-cable-demo.firebasestorage.app",
  messagingSenderId: "435322504183",
  appId: "1:435322504183:web:7df4f3a0e018e9e04ea4f2"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let allCustomers = [];
let allCustomersRaw = [];
let selectedCustomer = null;
let placesMap = {};

// Area allotment — loaded from Firestore `employees` (Admin Masters)
let AGENT_AREAS = {};   // email -> ['AREA 1'] or null for ALL
let AGENT_NAMES = {};   // email -> [display names]
let myEmployee = null;

async function loadEmployeeMap() {
  AGENT_AREAS = {};
  AGENT_NAMES = {};
  try {
    const snap = await db.collection('employees').get();
    snap.forEach(doc => {
      const d = doc.data();
      const email = String(d.email || '').toLowerCase().trim();
      if (!email) return;
      const area = (d.area || 'ALL').toUpperCase().trim();
      AGENT_AREAS[email] = (area === 'ALL') ? null : [d.area];
      const nm = (d.name || email.split('@')[0]).toUpperCase().trim();
      AGENT_NAMES[email] = [nm, nm.replace(/\s+/g, ''), email.split('@')[0].toUpperCase()];
    });
  } catch (e) {
    console.error('employees load', e);
  }
  // fallback if `employees` collection is empty — generic Office/Online only.
  // Field collectors are always added via Setup → Collectors, so no
  // hardcoded person names are seeded here.
  if (!Object.keys(AGENT_AREAS).length) {
    AGENT_AREAS = {
      'office@example.com': null,
      'online@example.com': null
    };
    AGENT_NAMES = {
      'office@example.com': ['LOCAL', 'OFFICE'],
      'online@example.com': ['ONLINE']
    };
  }
}

function getAgentNames() {
  if (!currentUser) return [];
  const email = (currentUser.email || '').toLowerCase();
  if (AGENT_NAMES[email]) return AGENT_NAMES[email];
  for (const [k, names] of Object.entries(AGENT_NAMES)) {
    if (email.startsWith(k.split('@')[0])) return names;
  }
  const local = email.split('@')[0].toUpperCase();
  return local ? [local] : [];
}

function isMyCollection(d) {
  if (!currentUser) return false;
  if (d.createdBy === currentUser.email) return true;
  const names = getAgentNames();
  const emp = (d.employee || d.collectedBy || d.createdBy || '').toUpperCase().trim();
  return names.some(n => emp === n || emp.includes(n));
}

function getAgentAreas() {
  if (!currentUser) return null;
  const email = (currentUser.email || '').toLowerCase();
  if (email in AGENT_AREAS) return AGENT_AREAS[email];
  for (const [k, v] of Object.entries(AGENT_AREAS)) {
    if (email.startsWith(k.split('@')[0])) return v;
  }
  // Owner / admin accounts → all areas
  if (email.includes('admin') || email.includes('muthuraj')) return null;
  // unknown collector with no employee record → no customers (safe)
  return [];
}

function filterByAgentArea(list) {
  const areas = getAgentAreas();
  if (!areas) return list; // all areas
  return list.filter(c => areas.includes((c.place || '').trim()));
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  const today = new Date().toISOString().split('T')[0]; // today only — no backdate
  const yest = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const fromEl = document.getElementById('colFrom');
  const toEl = document.getElementById('colTo');
  if (fromEl) fromEl.value = today;
  if (toEl) toEl.value = today;

  auth.onAuthStateChanged(async user => {
    if (user) {
      await loadEmployeeMap();
      try { updateColOfflineUI(); flushCollectorOffline(); } catch(e) {}
      currentUser = user;
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('appScreen').classList.remove('hidden');
      const al = document.getElementById('agentLabel');
      if (al) al.textContent = '';
      const se = document.getElementById('settingsEmail');
      if (se) se.textContent = displayAgentName(user.email);
      document.getElementById('dashAgentName').textContent = (user.email || '').split('@')[0].toUpperCase();
      await loadCustomers();
      goHome();
    } else {
      currentUser = null;
      document.getElementById('loginScreen').classList.remove('hidden');
      document.getElementById('appScreen').classList.add('hidden');
    }
  });
});

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginError');
  btn.disabled = true; btn.textContent = 'Logging in...'; err.classList.add('hidden');
  try { await auth.signInWithEmailAndPassword(email, password); }
  catch (ex) { err.textContent = 'Invalid email or password'; err.classList.remove('hidden'); }
  finally { btn.disabled = false; btn.textContent = 'Login'; }
}

function logout() { if (confirm('Logout?')) auth.signOut(); }

function setBottomNav(active) {
  const nav = document.getElementById('bottomNav');
  if (nav) nav.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(btn => {
    const on = btn.getAttribute('data-nav') === active;
    btn.classList.toggle('text-blue-600', on);
    btn.classList.toggle('text-slate-400', !on);
  });
}

function goHome() {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.getElementById('page-home').classList.remove('hidden');
  const back = document.getElementById('backBtn');
  if (back) back.classList.add('hidden');
  const ht = document.getElementById('headerTitle');
  if (ht) ht.textContent = 'Dashboard';
  setBottomNav('home');
  loadDashboard();
}

function showPage(id) {
  try {
    if (id === 'dashboard' || id === 'home') { goHome(); return; }
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    const page = document.getElementById('page-' + id);
    if (!page) { console.error('Page not found:', id); showToast('Page error: ' + id, true); return; }
    page.classList.remove('hidden');
    const back = document.getElementById('backBtn');
    if (back) back.classList.remove('hidden');
    const titles = { customers:'Customers', billing:'Collect', ledger:'Ledger', colReport:'Collection Report', pending:'Pending Due', settings:'More' };
    const ht = document.getElementById('headerTitle');
    if (ht) ht.textContent = titles[id] || id;
    const navMap = { customers:'customers', billing:'billing', pending:'pending', settings:'settings', ledger:'home', colReport:'home' };
    setBottomNav(navMap[id] || 'home');
    if (id === 'customers') { buildPlaceStreet(); filterCustomers(); }
    if (id === 'colReport') loadColReport();
    if (id === 'pending') loadPending();
  } catch (e) {
    console.error('showPage error', e);
    showToast('Error: ' + e.message, true);
  }
}

// Expose to window for onclick

let _colCustLoadedAt = 0;
const COL_CUST_CACHE_MS = 5 * 60 * 1000;

async function loadCustomers(force) {
  if (!force && allCustomersRaw.length && (Date.now() - _colCustLoadedAt) < COL_CUST_CACHE_MS) {
    allCustomers = filterByAgentArea(allCustomersRaw);
    return;
  }
  const snap = await db.collection('customers').get();
  allCustomersRaw = [];
  snap.forEach(doc => {
    allCustomersRaw.push({ id: doc.id, ...doc.data() });
  });
  allCustomersRaw.sort((a,b) => (a.name||'').localeCompare(b.name||'','ta'));
  _colCustLoadedAt = Date.now();
  allCustomers = filterByAgentArea(allCustomersRaw);
  placesMap = {};
  allCustomers.forEach(d => {
    const pl = d.place || 'Other';
    const st = d.street || 'Other';
    if (!placesMap[pl]) placesMap[pl] = new Set();
    placesMap[pl].add(st);
  });
  console.log('Agent areas:', getAgentAreas(), 'Customers:', allCustomers.length);
}

function buildPlaceStreet() {
  const placeSel = document.getElementById('filterPlace');
  const streetSel = document.getElementById('filterStreet');
  placeSel.innerHTML = '<option value="">- Select Place -</option>';
  Object.keys(placesMap).sort().forEach(p => {
    placeSel.innerHTML += `<option value="${p}">${p}</option>`;
  });
  streetSel.innerHTML = '<option value="">- Select Street -</option>';
}

function onPlaceChange() {
  const place = document.getElementById('filterPlace').value;
  const streetSel = document.getElementById('filterStreet');
  streetSel.innerHTML = '<option value="">- Select Street -</option>';
  if (place && placesMap[place]) {
    [...placesMap[place]].sort().forEach(s => {
      streetSel.innerHTML += `<option value="${s}">${s}</option>`;
    });
  }
  filterCustomers();
}

function filterCustomers() {
  const place = document.getElementById('filterPlace').value;
  const street = document.getElementById('filterStreet').value;
  const showDC = document.getElementById('filterDC').checked;
  const showACT = document.getElementById('filterACT').checked;
  const q = (document.getElementById('custSearch').value || '').toLowerCase().trim();
  const pendingOnly = window._pendingOnly || false;

  let list = allCustomers.filter(c => {
    const st = c.status || 'ACT';
    if (st === 'ACT' && !showACT) return false;
    if (st === 'DC' && !showDC) return false;
    if (place && (c.place || '') !== place) return false;
    if (street && (c.street || '') !== street) return false;
    if (pendingOnly && Number(c.dueAmt || c.due || 0) <= 0) return false;
    if (q) {
      return (c.name||'').toLowerCase().includes(q) || (c.mobile||'').includes(q) ||
        (c.boxNo||'').toLowerCase().includes(q) || (c.custId||'').toLowerCase().includes(q);
    }
    return true;
  });

  const box = document.getElementById('custList');
  if (list.length === 0) {
    box.innerHTML = '<div class="text-center text-slate-400 py-8 text-sm">No customers</div>';
    return;
  }
  box.innerHTML = list.slice(0, 100).map(c => {
    const due = Number(c.dueAmt || c.due || 0);
    return `<div class="bg-white rounded-lg p-2.5 border shadow-sm" onclick="openCollect('${c.id}')">
      <div class="flex justify-between">
        <div>
          <div class="font-medium text-sm">${c.name||'-'}</div>
          <div class="text-xs text-slate-500">${c.mobile||'-'} • ${c.boxNo||'-'}</div>
          <div class="text-xs text-slate-400">${c.custId||''} • ${c.street||c.place||''}</div>
        </div>
        <div class="text-right">
          <div class="text-sm font-bold ${due>0?'text-red-600':'text-slate-400'}">₹${due}</div>
          <div class="text-xs ${c.status==='DC'?'text-red-500':'text-green-600'}">${c.status||'ACT'}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function showPendingOnly() { window._pendingOnly = true; filterCustomers(); }
function showAllCust() { window._pendingOnly = false; document.getElementById('filterACT').checked = true; document.getElementById('filterDC').checked = true; filterCustomers(); }

function searchBill() {
  const q = document.getElementById('billSearch').value.toLowerCase().trim();
  const box = document.getElementById('billResults');
  if (q.length < 2) { box.innerHTML = '<div class="text-center text-slate-400 py-10 text-sm">குறைந்தது 2 எழுத்து</div>'; return; }
  const matches = allCustomers.filter(c => (c.status||'ACT')==='ACT' && (
    (c.name||'').toLowerCase().includes(q) || (c.mobile||'').includes(q) ||
    (c.boxNo||'').toLowerCase().includes(q) || (c.custId||'').toLowerCase().includes(q)
  )).slice(0, 25);
  if (!matches.length) { box.innerHTML = '<div class="text-center text-slate-400 py-10 text-sm">கிடைக்கவில்லை</div>'; return; }
  box.innerHTML = matches.map(c => {
    const due = Number(c.dueAmt||c.due||0);
    const street = [c.street, c.place].filter(Boolean).join(' · ');
    return `<div class="bg-white rounded-xl p-3.5 border shadow-sm active:bg-blue-50" onclick="openCollect('${c.id}')">
      <div class="flex justify-between gap-2">
        <div class="min-w-0">
          <div class="font-semibold text-base text-slate-900">${c.name||'-'}</div>
          <div class="text-xs text-blue-700 font-medium mt-0.5">ID: ${c.custId||'-'}</div>
          <div class="text-xs text-slate-500 mt-0.5">${c.mobile||'-'} · Box: ${c.boxNo||'-'}</div>
          <div class="text-[11px] text-slate-400 mt-0.5">📍 ${street||'-'}</div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-lg font-bold ${due>0?'text-red-600':'text-slate-400'}">₹${due.toLocaleString('en-IN')}</div>
          <div class="text-[10px] mt-1 ${c.status==='DC'?'text-red-500':'text-emerald-600'}">${c.status||'ACT'}</div>
        </div>
      </div></div>`;
  }).join('');
}

function openCollect(id) {
  const c = allCustomers.find(x => x.id === id);
  if (!c) return;
  selectedCustomer = c;
  const due = Number(c.dueAmt || c.due || 0);
  document.getElementById('modalName').textContent = c.name || '-';
  const streetLine = [c.street, c.place].filter(Boolean).join(' · ') || '-';
  document.getElementById('modalInfo').textContent =
    `ID: ${c.custId || '-'} · ${streetLine}\n${c.mobile || '-'} · Box: ${c.boxNo || '-'} · ${c.package || ''}`;
  const callBtn = document.getElementById('modalCallBtn');
  if (callBtn) {
    const m = String(c.mobile || '').replace(/\D/g, '');
    if (m.length >= 10) {
      callBtn.href = 'tel:' + m.slice(-10);
      callBtn.classList.remove('hidden');
    } else {
      callBtn.classList.add('hidden');
    }
  }
  document.getElementById('modalDue').textContent = '₹' + due.toLocaleString('en-IN');
  document.getElementById('colAmount').value = due > 0 ? due : (c.packageAmt || '');
  document.getElementById('colMode').value = 'Cash';
  document.getElementById('colRemarks').value = '';
  document.getElementById('collectModal').classList.remove('hidden');
}

function closeModal() { document.getElementById('collectModal').classList.add('hidden'); selectedCustomer = null; }

async function saveCollection() {
  if (!selectedCustomer) return;
  const amount = Number(document.getElementById('colAmount').value);
  if (!amount || amount <= 0) { showToast('Amount உள்ளிடவும்', true); return; }
  const btn = document.getElementById('saveColBtn');
  btn.disabled = true; btn.textContent = 'Saving...';
  const today = new Date().toISOString().split('T')[0]; // today only — no backdate
  const currentDue = Number(selectedCustomer.dueAmt || selectedCustomer.due || 0);
  const newDue = Math.max(0, currentDue - amount);
  const payType = amount < currentDue ? 'partial' : (amount > currentDue ? 'advance' : 'full');
  const data = {
    customerId: selectedCustomer.id,
    custId: selectedCustomer.custId || '',
    customerName: selectedCustomer.name || '',
    amount, date: today,
    mode: document.getElementById('colMode').value,
    remarks: document.getElementById('colRemarks').value.trim(),
    package: selectedCustomer.package || '',
    boxNo: selectedCustomer.boxNo || '',
    payType, prevDue: currentDue, balanceAfter: newDue,
    createdBy: currentUser.email,
    collectedBy: displayAgentName(currentUser.email),
    source: 'agent-app',
    status: 'active'
  };
  try {
    if (!navigator.onLine) throw new Error('OFFLINE');
    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('collections').add(data);
    await db.collection('customers').doc(selectedCustomer.id).update({
      dueAmt: newDue,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    applyLocalDue(selectedCustomer.id, newDue);
    showToast('₹' + amount + ' saved' + (payType === 'partial' ? ' (partial)' : '') + '!');
    closeModal();
    _colDashAt = 0;
    window._colDashDone = false;
    if (!document.getElementById('page-customers').classList.contains('hidden')) filterCustomers();
    if (!document.getElementById('page-pending').classList.contains('hidden')) loadPending();
    if (!document.getElementById('page-billing').classList.contains('hidden')) searchBill();
    if (typeof loadDashboard === 'function') loadDashboard(true);
  } catch (err) {
    if (!navigator.onLine || String(err.message).includes('OFFLINE') || err.code === 'unavailable') {
      data.createdAt = new Date().toISOString();
      queueCollectorOffline({ type: 'collection', data, customerId: selectedCustomer.id, newDue });
      applyLocalDue(selectedCustomer.id, newDue);
      showToast('Offline · saved · will sync');
      closeModal();
      _colDashAt = 0;
      window._colDashDone = false;
      if (!document.getElementById('page-customers').classList.contains('hidden')) filterCustomers();
      if (!document.getElementById('page-pending').classList.contains('hidden')) loadPending();
      if (typeof loadDashboard === 'function') loadDashboard(true);
    } else {
      showToast('Error: ' + err.message, true);
    }
  } finally {
    btn.disabled = false; btn.textContent = 'Save Collection';
  }
}

function applyLocalDue(id, newDue) {
  if (selectedCustomer && selectedCustomer.id === id) selectedCustomer.dueAmt = newDue;
  const idx = allCustomers.findIndex(x => x.id === id);
  if (idx >= 0) allCustomers[idx].dueAmt = newDue;
}

const COL_OFF_KEY = 'jsv_collector_offline_queue';
function getColQueue() {
  try { return JSON.parse(localStorage.getItem(COL_OFF_KEY) || '[]'); } catch (e) { return []; }
}
function setColQueue(q) {
  localStorage.setItem(COL_OFF_KEY, JSON.stringify(q));
  updateColOfflineUI();
}
function queueCollectorOffline(op) {
  const q = getColQueue();
  op.id = 'coff_' + Date.now();
  op.queuedAt = new Date().toISOString();
  q.push(op);
  setColQueue(q);
}
function updateColOfflineUI() {
  const off = document.getElementById('colOfflineBadge');
  const sync = document.getElementById('colSyncBadge');
  const q = getColQueue();
  if (off) off.classList.toggle('hidden', navigator.onLine);
  if (sync) {
    if (q.length) { sync.classList.remove('hidden'); sync.textContent = 'Sync ' + q.length; }
    else sync.classList.add('hidden');
  }
}
async function flushCollectorOffline() {
  if (!navigator.onLine) return;
  let q = getColQueue();
  if (!q.length) { updateColOfflineUI(); return; }
  const remain = [];
  for (const op of q) {
    try {
      if (op.type === 'collection') {
        const d = { ...op.data };
        d.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('collections').add(d);
        if (op.customerId) {
          await db.collection('customers').doc(op.customerId).update({
            dueAmt: op.newDue,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
      }
    } catch (e) { remain.push(op); }
  }
  setColQueue(remain);
  if (!remain.length) showToast('Offline collections synced');
  updateColOfflineUI();
}
window.addEventListener('online', () => { updateColOfflineUI(); flushCollectorOffline(); });
window.addEventListener('offline', updateColOfflineUI);


function searchLedger() {
  const q = document.getElementById('ledgerSearch').value.toLowerCase().trim();
  const box = document.getElementById('ledgerSearchResults');
  if (q.length < 1) { box.classList.add('hidden'); return; }
  const matches = allCustomers.filter(c =>
    (c.name||'').toLowerCase().includes(q) ||
    (c.mobile||'').includes(q) ||
    (c.boxNo||'').toLowerCase().includes(q) ||
    (c.custId||'').toLowerCase().includes(q) ||
    (c.street||'').toLowerCase().includes(q)
  ).slice(0, 10);
  box.classList.remove('hidden');
  box.innerHTML = matches.map(c =>
    `<div class="p-2 border-b text-sm cursor-pointer hover:bg-blue-50" onclick="viewLedger('${c.id}')">
      <div class="font-medium">${c.name||'-'} <span class="text-blue-600 text-xs">${c.custId||''}</span></div>
      <div class="text-[10px] text-slate-500">${c.street||'-'} · ${c.mobile||''} · Due ₹${c.dueAmt||0}</div>
    </div>`
  ).join('') || '<div class="p-2 text-slate-400 text-sm">No match</div>';
}

async function viewLedger(id) {
  document.getElementById('ledgerSearchResults').classList.add('hidden');
  const c = allCustomers.find(x => x.id === id);
  if (!c) return;
  const content = document.getElementById('ledgerContent');
  content.innerHTML = '<div class="text-center py-6 text-slate-400">Loading...</div>';
  try {
    const snap = await db.collection('collections').where('customerId', '==', id).get();
    const rows = [];
    snap.forEach(doc => rows.push(doc.data()));
    rows.sort((a,b) => (b.date||'').localeCompare(a.date||''));
    let total = 0;
    const streetLine = [c.street, c.place].filter(Boolean).join(' · ') || '-';
    let html = `<div class="bg-white rounded-xl p-3 mb-3 border">
      <div class="font-bold text-base">${c.name||'-'}</div>
      <div class="text-sm text-blue-700 font-semibold mt-0.5">ID: ${c.custId||'-'}</div>
      <div class="text-xs text-slate-600 mt-1">Street: ${streetLine}</div>
      <div class="text-xs text-slate-500 mt-0.5">${c.mobile||'-'} | Box: ${c.boxNo||'-'} | Due: ₹${Number(c.dueAmt||c.due||0).toLocaleString('en-IN')}</div>
    </div>`;
    if (!rows.length) html += '<div class="text-center text-slate-400 py-6">No records</div>';
    else {
      html += '<div class="bg-white rounded-xl border overflow-hidden"><table class="w-full text-xs"><thead class="bg-slate-100"><tr><th class="p-2 text-left">Date</th><th class="p-2 text-left">Amt</th><th class="p-2 text-left">Mode</th><th class="p-2 text-left">By</th></tr></thead><tbody>';
      rows.forEach(r => {
        total += Number(r.amount||0);
        html += `<tr class="border-t"><td class="p-2">${r.date||'-'}</td><td class="p-2 font-semibold">₹${r.amount||0}</td><td class="p-2">${r.mode||'-'}</td><td class="p-2">${displayAgentName(r)}</td></tr>`;
      });
      html += `</tbody></table><div class="p-2 bg-slate-50 font-bold text-sm">Total: ₹${total.toLocaleString('en-IN')}</div></div>`;
    }
    content.innerHTML = html;
  } catch (e) { content.innerHTML = '<div class="text-red-500 text-center py-6">Error loading</div>'; }
}

async function loadColReport() {
  const from = document.getElementById('colFrom').value;
  const to = document.getElementById('colTo').value;
  const list = document.getElementById('colReportList');
  list.innerHTML = '<div class="text-center py-6 text-slate-400">Loading...</div>';
  try {
    let snap;
    if (from && to) {
      snap = await db.collection('collections').where('date', '>=', from).where('date', '<=', to).get();
    } else {
      const today = new Date().toISOString().split('T')[0]; // today only — no backdate
      snap = await db.collection('collections').where('date', '==', today).get();
    }
    const rows = [];
    snap.forEach(doc => {
      const d = doc.data();
      // Only this collector's collections (not whole company)
      if (isMyCollection(d)) rows.push(d);
    });
    rows.sort((a,b) => (b.date||'').localeCompare(a.date||''));
    let total = 0;
    if (!rows.length) {
      list.innerHTML = '<div class="text-center py-8 text-slate-400">No collections</div>';
      const cnt = document.getElementById('colReportCount');
      const amtTop = document.getElementById('colReportAmtTop');
      if (cnt) cnt.textContent = '0';
      if (amtTop) amtTop.textContent = '₹0';
    } else {
      list.innerHTML = `<table class="w-full text-xs"><thead class="bg-green-700 text-white sticky top-0"><tr>
        <th class="p-2 text-left">SNo</th><th class="p-2 text-left">Name</th><th class="p-2 text-left">Date</th><th class="p-2 text-left">Amt</th></tr></thead><tbody>` +
        rows.map((r,i) => {
          total += Number(r.amount||0);
          return `<tr class="border-b bg-white"><td class="p-2">${i+1}</td><td class="p-2">${r.customerName||'-'}</td><td class="p-2">${r.date||'-'}</td><td class="p-2 font-semibold">₹${r.amount||0}</td></tr>`;
        }).join('') + '</tbody></table>';
    }
    const totalTxt = 'Total: ₹' + total.toLocaleString('en-IN') + ' (' + rows.length + ')';
    const totEl = document.getElementById('colReportTotal');
    if (totEl) totEl.textContent = totalTxt;
    const cnt = document.getElementById('colReportCount');
    const amtTop = document.getElementById('colReportAmtTop');
    if (cnt) cnt.textContent = String(rows.length);
    if (amtTop) amtTop.textContent = '₹' + total.toLocaleString('en-IN');
  } catch (e) {
    list.innerHTML = '<div class="text-red-500 text-center py-6">Error (may need index)</div>';
    console.error(e);
  }
}

window._pendingStreetFilter = '';
window._pendingAllList = [];

function loadPending() {
  window._pendingAllList = allCustomers.filter(c => Number(c.dueAmt || c.due || 0) > 0);
  // street chips
  const chipBox = document.getElementById('pendingStreetChips');
  if (chipBox) {
    const streets = [...new Set(window._pendingAllList.map(c => (c.street || c.place || 'Other').trim() || 'Other'))]
      .sort((a,b) => a.localeCompare(b, 'ta'));
    chipBox.innerHTML = `<button type="button" onclick="setPendingStreet('')" class="pend-chip shrink-0 px-2.5 py-1 rounded-full border ${!window._pendingStreetFilter ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600'}">All</button>` +
      streets.map(s => `<button type="button" onclick="setPendingStreet('${String(s).replace(/'/g, "\\'")}')" class="pend-chip shrink-0 px-2.5 py-1 rounded-full border ${window._pendingStreetFilter===s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600'}">${s}</button>`).join('');
  }
  renderPendingBody();
}

function setPendingStreet(s) {
  window._pendingStreetFilter = s || '';
  loadPending();
}

function filterPendingList() {
  renderPendingBody();
}

function renderPendingBody() {
  let list = window._pendingAllList || [];
  const q = (document.getElementById('pendingSearch')?.value || '').toLowerCase().trim();
  const sf = window._pendingStreetFilter || '';
  if (sf) list = list.filter(c => ((c.street || c.place || 'Other').trim() || 'Other') === sf);
  if (q) {
    list = list.filter(c =>
      (c.name||'').toLowerCase().includes(q) ||
      (c.mobile||'').includes(q) ||
      (c.custId||'').toLowerCase().includes(q) ||
      (c.boxNo||'').toLowerCase().includes(q)
    );
  }
  const total = list.reduce((s,c) => s + Number(c.dueAmt||c.due||0), 0);
  const box = document.getElementById('pendingList');
  const cntTop = document.getElementById('pendingCountTop');
  const amtTop = document.getElementById('pendingAmtTop');
  if (cntTop) cntTop.textContent = String(list.length);
  if (amtTop) amtTop.textContent = '₹' + total.toLocaleString('en-IN');
  const bar = document.getElementById('pendingTotalBar');
  if (bar) bar.textContent = `Total: ₹${total.toLocaleString('en-IN')} (${list.length})`;

  if (!list.length) {
    if (box) box.innerHTML = '<div class="text-center py-8 text-slate-400">No pending</div>';
    return;
  }

  const groups = {};
  list.forEach(c => {
    const key = (c.street || c.place || 'Other').trim() || 'Other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  });
  const streets = Object.keys(groups).sort((a,b) => a.localeCompare(b, 'ta'));

  let html = '';
  let sno = 0;
  streets.forEach(street => {
    const arr = groups[street].sort((a,b) => Number(b.dueAmt||b.due||0) - Number(a.dueAmt||a.due||0));
    const stTotal = arr.reduce((s,c) => s + Number(c.dueAmt||c.due||0), 0);
    html += `<div class="bg-slate-800 text-white px-3 py-1.5 text-xs font-semibold sticky top-0 flex justify-between z-[5]">
      <span>${street}</span>
      <span>${arr.length} · ₹${stTotal.toLocaleString('en-IN')}</span>
    </div>`;
    arr.forEach(c => {
      sno++;
      const mob = String(c.mobile || '').replace(/\D/g, '');
      const tel = mob.length >= 10 ? mob.slice(-10) : '';
      html += `<div class="bg-white border-b px-3 py-2.5 flex justify-between gap-2 items-center active:bg-blue-50">
        <div class="min-w-0 flex-1 cursor-pointer" onclick="openCollect('${c.id}')">
          <div class="text-sm font-medium">${sno}. ${c.name||'-'} <span class="text-blue-600 text-xs">${c.custId||''}</span></div>
          <div class="text-[11px] text-slate-500">${c.mobile||'No mobile'} · Box ${c.boxNo||'-'}</div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          ${tel ? `<a href="tel:${tel}" onclick="event.stopPropagation()" class="w-9 h-9 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-sm">📞</a>` : ''}
          <button type="button" onclick="openCollect('${c.id}')" class="bg-blue-600 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-lg">₹</button>
          <div class="text-sm font-bold text-red-600 min-w-[3.5rem] text-right">₹${Number(c.dueAmt||c.due||0).toLocaleString('en-IN')}</div>
        </div>
      </div>`;
    });
  });
  if (box) box.innerHTML = html;
}

let _colDashAt = 0;
const COL_DASH_MS = 2 * 60 * 1000;

async function loadDashboard(force) {
  const agentEl = document.getElementById('dashAgentName');
  if (agentEl) agentEl.textContent = displayAgentName(currentUser?.email || '') || 'Collector';
  const onlineEl = document.getElementById('dashOnline');
  if (onlineEl) {
    onlineEl.textContent = navigator.onLine ? '● Online' : '● Offline';
    onlineEl.className = 'text-[10px] font-medium ' + (navigator.onLine ? 'text-emerald-600' : 'text-amber-600');
  }
  const syncEl = document.getElementById('dashSync');
  if (syncEl) syncEl.textContent = navigator.onLine ? 'Cached · auto refresh 2 min' : 'Offline';

  const active = allCustomers.filter(c => (c.status||'ACT')==='ACT').length;
  const unpaidList = allCustomers.filter(c => Number(c.dueAmt || c.due || 0) > 0)
    .sort((a,b) => Number(b.dueAmt||b.due||0) - Number(a.dueAmt||a.due||0));
  const unpaidAmt = unpaidList.reduce((s,c) => s + Number(c.dueAmt||c.due||0), 0);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('dActive', active);
  const paidUp = allCustomers.filter(c => Number(c.dueAmt||c.due||0) <= 0 && (c.status||'ACT')==='ACT').length;
  set('dPaidCust', String(paidUp));
  set('dUnpaidCust', unpaidList.length);
  set('dUnpaidAmt', '₹' + unpaidAmt.toLocaleString('en-IN'));
  set('dPending', '₹' + unpaidAmt.toLocaleString('en-IN'));

  const prev = document.getElementById('dashPendingPreview');
  if (prev) {
    if (!unpaidList.length) prev.innerHTML = '<div class="p-3 text-xs text-slate-400 text-center">No pending</div>';
    else {
      prev.innerHTML = unpaidList.slice(0, 5).map(c => `
        <div class="px-4 py-2.5 flex items-center gap-2">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium truncate">${c.name||'-'}</div>
            <div class="text-[10px] text-slate-400 truncate">📍 ${c.street||c.place||'-'}</div>
          </div>
          <div class="text-sm font-bold text-red-600">₹${Number(c.dueAmt||c.due||0).toLocaleString('en-IN')}</div>
          <button type="button" onclick="openCollect('${c.id}')" class="text-[10px] bg-blue-600 text-white px-2 py-1 rounded-lg shrink-0">Collect</button>
        </div>`).join('');
    }
  }

  // Street route from local customers only (0 extra reads)
  const streetStats = {};
  allCustomers.filter(c => (c.status||'ACT')==='ACT').forEach(c => {
    const k = (c.street || c.place || 'Other').trim() || 'Other';
    if (!streetStats[k]) streetStats[k] = { total: 0, paid: 0, pendingAmt: 0, due: 0 };
    streetStats[k].total++;
    if (Number(c.dueAmt||c.due||0) > 0) {
      streetStats[k].due++;
      streetStats[k].pendingAmt += Number(c.dueAmt||c.due||0);
    }
  });
  const routeEl = document.getElementById('dashRouteList');
  if (routeEl) {
    const keys = Object.keys(streetStats).sort((a,b) => streetStats[b].due - streetStats[a].due || a.localeCompare(b,'ta'));
    if (!keys.length) routeEl.innerHTML = '<div class="p-3 text-xs text-slate-400 text-center">No streets</div>';
    else {
      routeEl.innerHTML = keys.slice(0, 8).map(k => {
        const s = streetStats[k];
        const done = Math.max(0, s.total - s.due);
        const pct = s.total ? Math.round((done / s.total) * 100) : 0;
        return `<div class="px-4 py-2.5">
          <div class="flex justify-between text-xs mb-1">
            <span class="font-medium text-slate-800 truncate">${k}</span>
            <span class="text-slate-500 shrink-0">${done}/${s.total}</span>
          </div>
          <div class="progress-bar mb-1"><span style="width:${pct}%"></span></div>
          <div class="flex justify-between text-[10px] text-slate-400">
            <span class="text-emerald-600">${done} paid-up</span>
            <span class="text-amber-600">${s.due} pending · ₹${s.pendingAmt.toLocaleString('en-IN')}</span>
          </div>
        </div>`;
      }).join('');
    }
  }

  // Today collections only (not full month) — big read savings
  if (!force && (Date.now() - _colDashAt) < COL_DASH_MS && window._colDashDone) return;
  const myCustIds = new Set(allCustomers.map(c => c.id));
  const myCustIdCodes = new Set(allCustomers.map(c => c.custId).filter(Boolean));
  const today = new Date().toISOString().split('T')[0];

  try {
    const todaySnap = await db.collection('collections').where('date', '==', today).get();
    let todayT = 0, todayN = 0;
    const paidTodayIds = new Set();
    const recent = [];
    todaySnap.forEach(doc => {
      const d = doc.data();
      const inArea = myCustIds.has(d.customerId) || myCustIdCodes.has(d.custId);
      if (!inArea) return;
      if (!isMyCollection(d) && d.createdBy !== currentUser?.email) {
        // still count area payments for route; only "my" for totals if needed
      }
      const amt = Number(d.amount || 0);
      if (isMyCollection(d)) {
        todayT += amt;
        todayN++;
        recent.push(d);
      }
      if (d.customerId) paidTodayIds.add(d.customerId);
      const cust = allCustomers.find(x => x.id === d.customerId);
      const st = cust ? ((cust.street||cust.place||'Other').trim()||'Other') : null;
      if (st && streetStats[st]) streetStats[st].paid++;
    });
    set('dToday', '₹' + todayT.toLocaleString('en-IN'));
    set('dTodayCount', String(todayN));
    set('dPaidCust', String(allCustomers.filter(c => Number(c.dueAmt||c.due||0) <= 0 && (c.status||'ACT')==='ACT').length));
    set('dPaidAmt', '₹' + todayT.toLocaleString('en-IN'));
    set('dMyTotal', '₹' + todayT.toLocaleString('en-IN'));

    const recentEl = document.getElementById('dashRecent');
    if (recentEl) {
      if (!recent.length) recentEl.innerHTML = '<div class="p-3 text-xs text-slate-400 text-center">No collections today</div>';
      else {
        recentEl.innerHTML = recent.slice(0, 8).map(r => `
          <div class="px-4 py-2.5 flex justify-between items-center">
            <div class="min-w-0">
              <div class="text-sm font-medium truncate">${r.customerName||'-'}</div>
              <div class="text-[10px] text-slate-400">${r.mode||'Cash'} · ${r.date||''}</div>
            </div>
            <div class="text-right shrink-0">
              <div class="text-sm font-bold text-slate-800">₹${Number(r.amount||0).toLocaleString('en-IN')}</div>
              <div class="text-[9px] text-emerald-600 font-medium">✓ Paid</div>
            </div>
          </div>`).join('');
      }
    }
    _colDashAt = Date.now();
    window._colDashDone = true;
  } catch (e) {
    console.error(e);
  }
}

function displayAgentName(d) {
  const s = (typeof d === 'string' ? d : (d && (d.collectedBy || d.employee || d.createdBy) || '')).toString();
  const lower = s.toLowerCase();
  if (lower.includes('office') || lower.includes('local')) return 'OFFICE';
  if (lower.includes('online')) return 'ONLINE';
  // Match against employees loaded from Firestore (Setup → Collectors)
  for (const email in AGENT_NAMES) {
    const names = AGENT_NAMES[email] || [];
    const emailPrefix = email.split('@')[0];
    if (lower === email || lower.includes(emailPrefix) || names.some(n => lower.includes(String(n).toLowerCase()))) {
      return names[0] || emailPrefix.toUpperCase();
    }
  }
  if (currentUser && currentUser.email && lower === String(currentUser.email).toLowerCase()) {
    return (currentUser.email.split('@')[0] || 'ME').toUpperCase();
  }
  if (s && !s.includes('@') && s.length < 20) return s.toUpperCase();
  if (s.includes('@')) return s.split('@')[0].toUpperCase();
  return s || '-';
}

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden', 'bg-red-600', 'bg-green-700');
  t.classList.add(isError ? 'bg-red-600' : 'bg-green-700');
  setTimeout(() => t.classList.add('hidden'), 2500);
}


/* ===== Collector Language + Theme ===== */
const COL_I18N = {
  en: {
    home: 'Home', customers: 'Customers', collect: 'Collect', due: 'Due', more: 'More',
    dashboard: 'Dashboard', ledger: '📒 Ledger', colReport: '📑 Collection Report', logout: 'Logout',
    loggedIn: 'Logged in as', language: 'Language', theme: 'Theme',
    todayColl: "Today's Collection", custCollected: 'customers collected',
    active: 'Active', paidUp: 'Paid Up', pending: 'Pending', dueAmt: 'Due Amount',
    todayRoute: "Today's Route", pendingCust: 'Pending Customers', recentColl: 'Recent Collections',
    online: '● Online', synced: 'Synced'
  },
  ta: {
    home: 'முகப்பு', customers: 'வாடிக்கையாளர்', collect: 'வசூல்', due: 'பாக்கி', more: 'மேலும்',
    dashboard: 'முகப்பு', ledger: '📒 கணக்கு', colReport: '📑 வசூல் அறிக்கை', logout: 'வெளியேறு',
    loggedIn: 'உள்நுழைந்துள்ளவர்', language: 'மொழி', theme: 'தோற்றம்',
    todayColl: 'இன்றைய வசூல்', custCollected: 'பேர் வசூல்',
    active: 'செயலில்', paidUp: 'பணம் செலுத்தியவர்', pending: 'பாக்கி உள்ளவர்', dueAmt: 'மொத்த பாக்கி',
    todayRoute: 'இன்றைய தெருக்கள்', pendingCust: 'பாக்கி வாடிக்கையாளர்', recentColl: 'சமீபத்திய வசூல்',
    online: '● இணைப்பு உள்ளது', synced: 'புதுப்பிக்கப்பட்டது'
  }
};

function getCollectorLang() {
  return localStorage.getItem('jsv_col_lang') || localStorage.getItem('jsv_lang') || 'en';
}
function getCollectorTheme() {
  return localStorage.getItem('jsv_col_theme') || localStorage.getItem('jsv_theme') || 'light';
}
function applyCollectorLang() {
  const lang = getCollectorLang();
  const dict = COL_I18N[lang] || COL_I18N.en;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.getAttribute('data-i18n');
    if (dict[k]) el.textContent = dict[k];
  });
  const sel = document.getElementById('colLangSelect');
  if (sel) sel.value = lang;
  document.documentElement.lang = lang === 'ta' ? 'ta' : 'en';
}
function setCollectorLang(lang) {
  localStorage.setItem('jsv_col_lang', lang);
  localStorage.setItem('jsv_lang', lang);
  applyCollectorLang();
}
function applyCollectorTheme() {
  const theme = getCollectorTheme();
  document.body.classList.toggle('dark', theme === 'dark');
  const sel = document.getElementById('colThemeSelect');
  if (sel) sel.value = theme;
}
function setCollectorTheme(theme) {
  localStorage.setItem('jsv_col_theme', theme);
  localStorage.setItem('jsv_theme', theme);
  applyCollectorTheme();
}
function initCollectorAppearance() {
  applyCollectorTheme();
  applyCollectorLang();
}
document.addEventListener('DOMContentLoaded', initCollectorAppearance);
setTimeout(initCollectorAppearance, 400);


window.showPage = showPage;
window.setCollectorLang = setCollectorLang;
window.setCollectorTheme = setCollectorTheme;

window.goHome = goHome;
window.logout = logout;
window.openCollect = openCollect;
window.closeModal = closeModal;
window.saveCollection = saveCollection;
window.filterCustomers = filterCustomers;
window.onPlaceChange = onPlaceChange;
window.showPendingOnly = showPendingOnly;
window.showAllCust = showAllCust;
window.searchBill = searchBill;
window.searchLedger = searchLedger;
window.viewLedger = viewLedger;
window.loadColReport = loadColReport;
window.loadPending = loadPending;
window.setPendingStreet = setPendingStreet;
window.filterPendingList = filterPendingList;
