// Splash
(function hideSplash() {
  const run = () => {
    const el = document.getElementById('splashScreen');
    if (!el) return;
    setTimeout(() => el.classList.add('hide'), 1400);
    setTimeout(() => { try { el.remove(); } catch(e) {} }, 2000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

// ==================== FIREBASE CONFIG ====================
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

// ==================== STATE ====================
let currentUser = null;
let currentCompanyId = null;   // multi-tenant scope — every data read/write goes through col()
let currentUserRole = null;    // 'admin' | 'collector'
let allCustomers = [];
let selectedBillCustomer = null;
let currentLedgerCustomerId = null;

// Returns a Firestore collection reference scoped to the logged-in admin's
// own company. This is how every operator's data stays completely separate
// from every other operator's data, even though they all share one Firebase
// project.
function col(name) {
  if (!currentCompanyId) throw new Error('No company context — please log in again');
  return db.collection('companies').doc(currentCompanyId).collection(name);
}

// Looks up which company (if any) this email belongs to, and their role
// within it. Returns null for a brand-new user who hasn't set up a company
// yet (triggers the onboarding screen).
async function resolveUserCompany(user) {
  const emailKey = (user.email || '').toLowerCase().trim();
  const doc = await db.collection('users').doc(emailKey).get();
  if (!doc.exists) return null;
  const d = doc.data();
  return {
    companyId: d.companyId,
    role: String(d.role || 'collector').toLowerCase(),
    companyName: d.companyName || ''
  };
}

async function handleCreateCompany() {
  const nameEl = document.getElementById('onboardCompanyName');
  const errBox = document.getElementById('onboardError');
  const btn = document.getElementById('onboardCreateBtn');
  const name = (nameEl?.value || '').trim();
  if (errBox) errBox.classList.add('hidden');
  if (!name) {
    if (errBox) { errBox.textContent = 'Company பெயர் போடுங்கள்'; errBox.classList.remove('hidden'); }
    return;
  }
  const user = auth.currentUser;
  if (!user) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }
  try {
    const emailKey = (user.email || '').toLowerCase().trim();
    const companyRef = db.collection('companies').doc();
    await companyRef.set({
      name,
      ownerEmail: emailKey,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('users').doc(emailKey).set({
      companyId: companyRef.id,
      role: 'admin',
      email: emailKey,
      companyName: name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // Seed this company's own settings/company doc so Company Info,
    // receipts, and the sidebar all show the name right away.
    try {
      await db.collection('companies').doc(companyRef.id).collection('settings').doc('company').set({
        name,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (se) { console.error('seed settings/company failed', se); }
    // re-run the login flow now that a company exists
    await enterAdminApp({ companyId: companyRef.id, role: 'admin', companyName: name }, user);
  } catch (e) {
    if (errBox) { errBox.textContent = 'Error: ' + e.message; errBox.classList.remove('hidden'); }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Create My Company'; }
  }
}

async function enterAdminApp(info, user) {
  currentCompanyId = info.companyId;
  currentUserRole = 'admin';
  currentUser = user;
  document.getElementById('companyOnboardingScreen')?.classList.add('hidden');
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
  document.getElementById('userEmailDisplay').textContent = user.email;
  const sidebarNameEl = document.getElementById('sidebarCompanyName');
  if (sidebarNameEl && info.companyName) sidebarNameEl.textContent = info.companyName;
  try { await loadCompanyInfo(); } catch (e) {}
  if (sidebarNameEl && companyInfo.name) sidebarNameEl.textContent = companyInfo.name;
  try { await loadWaTemplate(); } catch (e) {}
  try { flushOfflineQueue(); } catch (e) {}
  loadDashboard();
  loadCustomers();
  if (typeof loadEmployees === 'function') loadEmployees();
  if (typeof loadPlacesMaster === 'function') loadPlacesMaster();
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
  });

  const today = new Date().toISOString().split('T')[0];
  const conDateEl = document.getElementById('custConDate');
  const billDateEl = document.getElementById('billDate');
  if (conDateEl) conDateEl.value = today;
  if (billDateEl) billDateEl.value = today;

  auth.onAuthStateChanged(async user => {
    if (user) {
      let info;
      try { info = await resolveUserCompany(user); }
      catch (e) { info = null; }

      if (!info) {
        // Brand-new login with no company yet → self-serve onboarding
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.add('hidden');
        document.getElementById('companyOnboardingScreen')?.classList.remove('hidden');
        return;
      }
      if (info.role !== 'admin') {
        await auth.signOut();
        currentUser = null;
        currentCompanyId = null;
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('appScreen').classList.add('hidden');
        document.getElementById('companyOnboardingScreen')?.classList.add('hidden');
        const errBox = document.getElementById('loginError');
        if (errBox) {
          errBox.innerHTML = 'Collector login. Admin app அல்ல.<br><a class="underline text-blue-600" href="collector.html">Collector App திறக்க →</a>';
          errBox.classList.remove('hidden');
        }
        showToast('Collectors must use Collector App', true);
        return;
      }
      await enterAdminApp(info, user);
    } else {
      currentUser = null;
      currentCompanyId = null;
      document.getElementById('loginScreen').classList.remove('hidden');
      document.getElementById('appScreen').classList.add('hidden');
      document.getElementById('companyOnboardingScreen')?.classList.add('hidden');
    }
  });

  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('customerForm').addEventListener('submit', handleSaveCustomer);
  document.getElementById('billForm').addEventListener('submit', handleSaveBill);
  const createUserForm = document.getElementById('createUserForm');
  if (createUserForm) createUserForm.addEventListener('submit', handleCreateUser);
});

// ==================== AUTH ====================
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  const errBox = document.getElementById('loginError');

  btn.disabled = true;
  btn.textContent = 'Logging in...';
  errBox.classList.add('hidden');

  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    errBox.textContent = err.message.includes('user-not-found') || err.message.includes('wrong-password') || err.message.includes('invalid-credential')
      ? 'Invalid email or password'
      : err.message;
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
  }
}

function logout() {
  if (confirm('Logout செய்ய வேண்டுமா?')) {
    auth.signOut();
  }
}

async function handleCreateUser(e) {
  e.preventDefault();
  const email = document.getElementById('newUserEmail').value.trim();
  const password = document.getElementById('newUserPassword').value;
  try {
    const secondaryApp = firebase.initializeApp(firebaseConfig, 'Secondary' + Date.now());
    await secondaryApp.auth().createUserWithEmailAndPassword(email, password);
    await secondaryApp.auth().signOut();
    secondaryApp.delete();
    showToast('User created successfully!');
    document.getElementById('createUserForm').reset();
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

// ==================== NAVIGATION ====================
let pageHistory = ['dashboard'];
let currentPageId = 'dashboard';

function goBackPage() {
  // Report sub-panel open? close it first
  const openPanel = document.querySelector('.report-panel:not(.hidden)');
  if (openPanel && currentPageId === 'reports') {
    if (typeof closeReportPanels === 'function') closeReportPanels();
    return;
  }
  if (pageHistory.length > 1) {
    // Remove the page we're leaving, then PEEK (not pop) at the new top —
    // popping twice here used to skip a level on every single Back press,
    // which over a few navigations left stale pages (like the Setup/Masters
    // hub) stuck in the history and made them resurface unexpectedly later.
    pageHistory.pop();
    const prev = pageHistory[pageHistory.length - 1] || 'dashboard';
    showPage(prev, true);
  } else {
    showPage('dashboard', true);
  }
}

function showPage(pageId, isBack) {
  if (!isBack && pageId !== currentPageId) {
    if (pageHistory[pageHistory.length - 1] !== pageId) {
      pageHistory.push(pageId);
      if (pageHistory.length > 30) pageHistory.shift();
    }
  }
  currentPageId = pageId;

  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  const page = document.getElementById('page-' + pageId);
  if (page) page.classList.remove('hidden');

  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === pageId);
  });

  const titles = {
    dashboard: 'Dashboard',
    customers: 'Customers',
    newCustomer: 'New Customer',
    billing: 'Billing / Collection',
    ledger: 'Customer Ledger',
    pending: 'Pending / Due Report',
    boxes: 'Box Management',
    reports: 'Reports',
    masters: 'Masters',
    settings: 'Settings',
    monthBill: 'Month End',
    expenses: 'Expenses',
    cancelled: 'Cancelled Bills'
  };
  const pt = document.getElementById('pageTitle');
  if (pt) pt.textContent = titles[pageId] || pageId;
  const backBtn = document.getElementById('globalBackBtn');
  if (backBtn) {
    if (pageId === 'dashboard') backBtn.classList.add('hidden');
    else backBtn.classList.remove('hidden');
  }
  if (pageId === 'billing') {
    const bd = document.getElementById('billDate');
    if (bd) { bd.value = new Date().toISOString().slice(0, 10); bd.readOnly = true; }
  }
  if (pageId === 'settings') { loadWaTemplate(); }
  if (pageId === 'monthBill') { refreshMonthBillLockUI(); }
  if (pageId === 'expenses') { const d=document.getElementById('expDate'); if(d){ d.value=new Date().toISOString().slice(0,10); d.readOnly=true; } loadExpenses(); }
  if (pageId === 'reports') closeReportPanels();

  if (pageId === 'newCustomer' && !window._skipNewCustomerReset) {
    document.getElementById('customerForm').reset();
    document.getElementById('editCustomerId').value = '';
    document.getElementById('customerFormTitle').textContent = 'New Customer';
    currentAddons = [];
    if (typeof renderAddonChips === 'function') renderAddonChips();
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('custConDate').value = today;
  }
  window._skipNewCustomerReset = false;

  if (pageId === 'pending') {
    renderPendingReport();
  }
  if (pageId === 'cancelled') {
    loadCancelledBills();
  }

  if (window.innerWidth < 1024) {
    document.getElementById('sidebar').classList.add('-translate-x-full');
    document.getElementById('sidebarOverlay').classList.add('hidden');
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  sidebar.classList.toggle('-translate-x-full');
  overlay.classList.toggle('hidden');
}

// ==================== CUSTOMERS ====================

// Refreshes just ONE customer document (1 Firestore read) and patches it
// into the already-loaded allCustomers array, instead of re-downloading the
// entire customers collection after every single edit/status change. Use
// this after any action that only touches one customer.
async function refreshOneCustomer(id) {
  if (!id) return;
  try {
    const doc = await col('customers').doc(id).get();
    if (!doc.exists) {
      allCustomers = allCustomers.filter(c => c.id !== id);
    } else {
      const updated = { id: doc.id, ...doc.data() };
      const idx = allCustomers.findIndex(c => c.id === id);
      if (idx >= 0) allCustomers[idx] = updated;
      else allCustomers.push(updated);
    }
    allCustomers.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ta'));
    if (typeof renderCustomerTable === 'function') renderCustomerTable(allCustomers);
    if (typeof updateDashboardStats === 'function') updateDashboardStats();
  } catch (e) {
    console.error('refreshOneCustomer', e);
  }
}

async function loadCustomers() {
  try {
    const snap = await col('customers').get();
    allCustomers = [];
    snap.forEach(doc => {
      allCustomers.push({ id: doc.id, ...doc.data() });
    });
    allCustomers.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ta'));
    renderCustomerTable(allCustomers);
    updateDashboardStats();
    loadStreetMaster();
    loadPackageMaster();
    loadMsoMaster();
  } catch (err) {
    console.error(err);
    document.getElementById('customerTableBody').innerHTML =
      `<tr><td colspan="7" class="text-center py-8 text-red-500">Error: ${err.message}</td></tr>`;
  }
}

function renderCustomerTable(list) {
  const tbody = document.getElementById('customerTableBody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400">No customers found</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(c => {
    const due = Number(c.dueAmt || c.due || 0);
    const status = c.status || 'ACT';
    const street = c.street || '';
    return `
    <tr class="border-t border-slate-100 hover:bg-blue-50 cursor-pointer" onclick="viewLedger('${c.id}')">
      <td class="px-3 py-2.5 font-mono text-xs">${c.custId || c.id.slice(0,6)}</td>
      <td class="px-3 py-2.5">
        <div class="font-medium text-sm">${c.name || '-'}</div>
        <div class="text-[10px] text-slate-500 truncate max-w-[140px]">${street}</div>
      </td>
      <td class="px-3 py-2.5 text-sm">${c.mobile || '-'}</td>
      <td class="px-3 py-2.5 font-mono text-xs">${c.boxNo || '-'}</td>
      <td class="px-3 py-2.5 text-sm font-semibold ${due > 0 ? 'text-red-600' : 'text-slate-500'}">₹${due}</td>
      <td class="px-3 py-2.5">
        <span class="px-2 py-0.5 rounded-full text-xs font-medium ${status === 'ACT' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
          ${status}
        </span>
      </td>
      <td class="px-3 py-2.5 whitespace-nowrap" onclick="event.stopPropagation()">
        <button onclick="editCustomer('${c.id}')" class="text-blue-600 hover:underline text-xs mr-1">Edit</button>
        <button onclick="toggleDC('${c.id}', '${status}')" class="text-xs mr-1 ${status === 'ACT' ? 'text-red-600' : 'text-green-600'} hover:underline">
          ${status === 'ACT' ? 'DC' : 'RC'}
        </button>
        <button onclick="deleteCustomer('${c.id}')" class="text-red-700 hover:underline text-xs font-medium">Del</button>
        <button onclick="openWhatsApp('${c.mobile || ''}', '${(c.name || '').replace(/'/g, '')}', ${Number(c.dueAmt||c.due||0)})" class="text-green-600 hover:underline text-xs">WA</button>
      </td>
    </tr>`;
  }).join('');
}

function searchCustomers() {
  const q = document.getElementById('searchInput').value.toLowerCase().trim();
  const status = document.getElementById('statusFilter').value;

  let filtered = allCustomers;
  if (status) filtered = filtered.filter(c => (c.status || 'ACT') === status);
  if (q) {
    filtered = filtered.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.mobile || '').includes(q) ||
      (c.boxNo || '').toLowerCase().includes(q) ||
      (c.custId || '').toLowerCase().includes(q) ||
      (c.scNo || '').toLowerCase().includes(q) ||
      (c.smartCard || '').toLowerCase().includes(q)
    );
  }
  renderCustomerTable(filtered);
}


function checkBoxDuplicate() {
  const tip = document.getElementById('boxDupTip');
  const boxEl = document.getElementById('custBox');
  if (!tip || !boxEl) return;
  const boxNo = (boxEl.value || '').trim().toUpperCase();
  const editId = (document.getElementById('editCustomerId') || {}).value || '';
  if (!boxNo || boxNo.length < 4) {
    tip.className = 'text-xs mt-1 hidden';
    tip.textContent = '';
    boxEl.classList.remove('border-red-500', 'border-amber-500', 'border-green-500');
    return;
  }
  // same box on another customer?
  const other = allCustomers.find(c =>
    String(c.boxNo || '').trim().toUpperCase() === boxNo && c.id !== editId
  );
  if (other) {
    tip.className = 'text-xs mt-1 text-red-600 font-medium';
    tip.textContent = '⚠ இந்த Box ஏற்கனவே: ' + (other.name || '-') +
      ' (ID: ' + (other.custId || other.id.slice(0,6)) +
      ', ' + (other.street || '') + ', ' + (other.status || 'ACT') + ')';
    boxEl.classList.add('border-red-500');
    boxEl.classList.remove('border-green-500', 'border-amber-500');
    return;
  }
  // in stock?
  const stock = (typeof allBoxes !== 'undefined' ? allBoxes : []).find(
    b => String(b.boxNo || '').trim().toUpperCase() === boxNo
  );
  if (stock && stock.status === 'available') {
    tip.className = 'text-xs mt-1 text-green-600';
    tip.textContent = '✓ Store-ல் available — assign ஆகும்';
    boxEl.classList.add('border-green-500');
    boxEl.classList.remove('border-red-500', 'border-amber-500');
  } else if (stock && stock.status === 'assigned') {
    tip.className = 'text-xs mt-1 text-amber-600';
    tip.textContent = 'Store-ல் assigned என்று இருக்கு — customer match பாருங்கள்';
    boxEl.classList.add('border-amber-500');
    boxEl.classList.remove('border-red-500', 'border-green-500');
  } else {
    tip.className = 'text-xs mt-1 text-slate-500';
    tip.textContent = 'புதிய Box — save ஆனால் stock-ல் Assigned ஆகும்';
    boxEl.classList.remove('border-red-500', 'border-green-500', 'border-amber-500');
  }
}

async function handleSaveCustomer(e) {
  e.preventDefault();
  const editId = document.getElementById('editCustomerId').value;

  const data = {
    name: document.getElementById('custName').value.trim(),
    fatherName: document.getElementById('custFather').value.trim(),
    mobile: document.getElementById('custMobile').value.trim(),
    doorNo: document.getElementById('custDoor').value.trim(),
    place: document.getElementById('custPlace').value.trim(),
    street: document.getElementById('custStreet').value.trim(),
    custId: (document.getElementById('custCustId')?.value || '').trim(),
    landmark: document.getElementById('custLandmark')?.value.trim() || '',
    ebNo: document.getElementById('custEB')?.value.trim() || '',
    boxNo: document.getElementById('custBox').value.trim(),
    scNo: document.getElementById('custSC').value.trim(),
    smartCard: document.getElementById('custSC').value.trim(),
    package: document.getElementById('custPackage').value,
    packageAmt: (Number(document.getElementById('custPkgAmt').value) || 0) + (Number(document.getElementById('custAddonAmt')?.value) || 0),
    packageBase: Number(document.getElementById('custPkgAmt').value) || 0,
    addons: (() => { try { return JSON.parse(document.getElementById('custAddons')?.value || '[]'); } catch(e) { return []; } })(),
    addonAmt: Number(document.getElementById('custAddonAmt')?.value) || 0,
    dueAmt: Number(document.getElementById('custDueAmt')?.value) || 0,
    otherCharges: Number(document.getElementById('custOtherCharges')?.value) || 0,
    discount: Number(document.getElementById('custDiscount')?.value) || 0,
    disReason: document.getElementById('custDisReason')?.value.trim() || '',
    conDate: document.getElementById('custConDate').value,
    status: document.getElementById('custStatus').value,
    sms: document.getElementById('custSMS')?.value || 'Yes',
    signal: document.getElementById('custSignal')?.value || 'Digital',
    mso: document.getElementById('custMSO')?.value.trim() || '',
    boxType: document.getElementById('custBoxType')?.value || 'SD',
    aadhar: document.getElementById('custAadhar')?.value.trim() || '',
    caf: document.getElementById('custCAF')?.value.trim() || '',
    regDate: document.getElementById('custRegDate')?.value || '',
    boxAmt: Number(document.getElementById('custBoxAmt')?.value) || 0,
    billing: document.getElementById('custBilling')?.value || 'Yes',
    billingStart: document.getElementById('custBillingStart')?.value || '',
    remarks: document.getElementById('custRemarks').value.trim(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  // duplicate box warning
  const boxCheck = (data.boxNo || '').trim().toUpperCase();
  if (boxCheck) {
    const other = allCustomers.find(c =>
      String(c.boxNo || '').trim().toUpperCase() === boxCheck && c.id !== editId
    );
    if (other) {
      const ok = confirm(
        'இந்த Box ஏற்கனவே இவருக்கு உள்ளது:\n' +
        (other.name || '') + ' · ID ' + (other.custId || '') + '\n' +
        (other.street || '') + '\n\n' +
        'இருந்தாலும் இந்த customer-க்கு assign செய்யவா?'
      );
      if (!ok) return;
    }
  }

  try {
    let savedId = editId;
    if (editId) {
      const prev = allCustomers.find(c => c.id === editId) || {};
      const oldPlace = String(prev.place || '').trim();
      const oldStreet = String(prev.street || '').trim();
      const newPlace = String(data.place || '').trim();
      const newStreet = String(data.street || '').trim();
      const transferred = (oldPlace !== newPlace || oldStreet !== newStreet);
      await col('customers').doc(editId).update(data);
      if (transferred) {
        try {
          await col('transfers').add({
            customerId: editId,
            custId: data.custId || prev.custId || '',
            customerName: data.name || prev.name || '',
            fromPlace: oldPlace,
            fromStreet: oldStreet,
            toPlace: newPlace,
            toStreet: newStreet,
            date: new Date().toISOString().slice(0, 10),
            changedBy: (currentUser && currentUser.email) || 'admin',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        } catch (te) { console.error('transfer log', te); }
        showToast('Customer updated · Transfer saved');
      } else {
        showToast('Customer updated!');
      }
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      const manualId = (document.getElementById('custCustId')?.value || '').trim();
      data.custId = manualId || ('C' + Date.now().toString().slice(-6));
      data.streetId = getStreetId(data.place, data.street);
      const ref = await col('customers').add(data);
      savedId = ref.id;
      showToast('Customer added!');
    }
    // Scheme A: Box No → auto stock as Assigned (if Active)
    const boxNo = (data.boxNo || '').trim();
    if (boxNo && (data.status || 'ACT') === 'ACT') {
      try {
        await upsertBoxStock(boxNo, {
          status: 'assigned',
          customerId: savedId,
          customerName: data.name || '',
          mso: data.mso || '',
          scNo: data.scNo || data.smartCard || '',
          boxType: data.boxType || 'HD',
          source: 'new-line'
        });
      } catch (be) {
        console.error('box stock', be);
      }
    }
    await refreshOneCustomer(savedId);
    if (typeof loadBoxes === 'function') {
      try { await loadBoxes(); } catch (e) {}
    }
    showPage('customers');
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

function editCustomer(id) {
  const c = allCustomers.find(x => x.id === id);
  if (!c) {
    showToast('Customer not found', true);
    return;
  }
  // show page WITHOUT clearing form, then fill all fields
  window._skipNewCustomerReset = true;
  showPage('newCustomer');

  document.getElementById('editCustomerId').value = id;
  document.getElementById('customerFormTitle').textContent = 'Edit Customer';
  const set = (eid, val) => {
    const el = document.getElementById(eid);
    if (el) el.value = val != null ? val : '';
  };
  set('custName', c.name || '');
  set('custFather', c.fatherName || '');
  set('custMobile', c.mobile || '');
  set('custDoor', c.doorNo || '');
  set('custPlace', c.place || '');
  if (typeof onPlaceSelect === 'function') onPlaceSelect();
  set('custStreet', c.street || '');
  set('custCustId', c.custId || '');
  set('custIdSuffix', '');
  set('custLandmark', c.landmark || '');
  set('custEB', c.ebNo || '');
  set('custBox', c.boxNo || '');
  set('custSC', c.scNo || c.smartCard || '');
  set('custPackage', c.package || '');
  set('custPkgAmt', c.packageBase != null ? c.packageBase : (c.packageAmt || ''));
  if (typeof setAddonsFromCustomer === 'function') setAddonsFromCustomer(c);
  set('custDueAmt', c.dueAmt != null ? c.dueAmt : (c.due || 0));
  set('custOtherCharges', c.otherCharges || 0);
  set('custDiscount', c.discount || 0);
  set('custDisReason', c.disReason || '');
  set('custConDate', c.conDate || '');
  set('custStatus', c.status || 'ACT');
  set('custSMS', c.sms || 'Yes');
  set('custSignal', c.signal || 'Digital');
  set('custMSO', c.mso || '');
  set('custBoxType', c.boxType || 'SD');
  set('custAadhar', c.aadhar || '');
  set('custCAF', c.caf || '');
  set('custRegDate', c.regDate || '');
  set('custBoxAmt', c.boxAmt || 0);
  set('custBilling', c.billing || 'Yes');
  set('custRemarks', c.remarks || '');
  // scroll top of form
  const form = document.getElementById('customerForm');
  if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


function ledgerToggleDC() {
  const id = currentLedgerCustomerId;
  if (!id) return;
  const c = allCustomers.find(x => x.id === id);
  if (!c) return;
  toggleDC(id, c.status || 'ACT');
}

async function ledgerQuickTransfer() {
  const id = currentLedgerCustomerId;
  if (!id) return;
  const c = allCustomers.find(x => x.id === id);
  if (!c) return;
  window._transferCustId = id;
  document.getElementById('transferCustLabel').textContent =
    (c.name || '') + ' · ID: ' + (c.custId || '-') + ' · Due ₹' + Number(c.dueAmt || c.due || 0);
  document.getElementById('transferFromStreet').textContent =
    (c.place || '-') + ' · ' + (c.street || '-');
  const place = c.place || '';
  document.getElementById('transferPlace').value = place;
  document.getElementById('transferDoor').value = c.doorNo || '';
  document.getElementById('transferMso').value = c.mso || '';
  document.getElementById('transferBox').value = c.boxNo || '';
  document.getElementById('transferSc').value = c.scNo || c.smartCard || '';
  // MSO datalist
  const dl = document.getElementById('transferMsoList');
  if (dl) {
    const msos = [...new Set((allCustomers || []).map(x => x.mso).filter(Boolean))].sort();
    dl.innerHTML = msos.map(m => `<option value="${m}">`).join('');
  }
  onTransferPlaceChange(c.street || '');
  document.getElementById('transferModal').classList.remove('hidden');
}

function onTransferPlaceChange(keepStreet) {
  const place = document.getElementById('transferPlace')?.value || '';
  const sel = document.getElementById('transferStreet');
  if (!sel) return;
  const list = (typeof getStreetsForPlace === 'function')
    ? getStreetsForPlace(place)
    : [];
  sel.innerHTML = '<option value="">- Select Street -</option>' +
    list.map(s => `<option value="${String(s.street).replace(/"/g, '&quot;')}" data-sid="${s.streetId || ''}">${s.street} (${s.streetId || ''})</option>`).join('');
  if (keepStreet) {
    const found = list.find(s => s.street === keepStreet);
    if (found) sel.value = keepStreet;
  }
  onTransferStreetChange();
}

function onTransferStreetChange() {
  const place = document.getElementById('transferPlace')?.value || '';
  const street = document.getElementById('transferStreet')?.value || '';
  const idEl = document.getElementById('transferCustId');
  if (!idEl) return;
  if (!place || !street) { idEl.value = ''; return; }
  const streetId = (typeof getStreetId === 'function')
    ? getStreetId(place, street)
    : street.replace(/\s+/g, '').slice(0, 3).toUpperCase();
  let nextNum = 1;
  if (typeof getNextNumberForStreet === 'function') {
    nextNum = getNextNumberForStreet(streetId, street);
  }
  idEl.value = streetId + nextNum;
}

function fillTransferStreets(selectName) {
  onTransferPlaceChange(selectName);
}

function closeTransferModal() {
  document.getElementById('transferModal')?.classList.add('hidden');
  window._transferCustId = null;
}

async function saveTransferModal() {
  const id = window._transferCustId;
  if (!id) return;
  const c = allCustomers.find(x => x.id === id);
  if (!c) return;
  const street = (document.getElementById('transferStreet')?.value || '').trim();
  const place = (document.getElementById('transferPlace')?.value || '').trim();
  const newCustId = (document.getElementById('transferCustId')?.value || '').trim();
  const doorNo = (document.getElementById('transferDoor')?.value || '').trim();
  const mso = (document.getElementById('transferMso')?.value || '').trim();
  const boxNo = (document.getElementById('transferBox')?.value || '').trim();
  const scNo = (document.getElementById('transferSc')?.value || '').trim();
  if (!street) { showToast('Street தேர்வு செய்யுங்கள்', true); return; }
  if (!newCustId) { showToast('Customer ID தேவை', true); return; }
  // duplicate ID check (other customers)
  const dup = (allCustomers || []).find(x =>
    x.id !== id && String(x.custId || '').toUpperCase() === newCustId.toUpperCase()
  );
  if (dup) {
    if (!confirm('ID ' + newCustId + ' already used by ' + (dup.name || '') + '.\nContinue anyway?')) return;
  }
  try {
    const oldStreet = c.street || '';
    const oldPlace = c.place || '';
    const oldCustId = c.custId || '';
    const updates = {
      street,
      place,
      custId: newCustId,
      doorNo: doorNo || (c.doorNo || ''),
      mso: mso || (c.mso || ''),
      boxNo: boxNo || '',
      scNo: scNo || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await col('customers').doc(id).update(updates);
    // box stock update if box changed
    if (boxNo && boxNo !== (c.boxNo || '')) {
      try {
        if (typeof upsertBoxStock === 'function') {
          await upsertBoxStock(boxNo, {
            status: 'assigned',
            customerId: id,
            customerName: c.name || '',
            mso: mso || c.mso || '',
            scNo: scNo
          });
        }
      } catch (_) {}
    }
    try {
      await col('transfers').add({
        customerId: id,
        customerName: c.name || '',
        fromCustId: oldCustId,
        toCustId: newCustId,
        fromStreet: oldStreet,
        toStreet: street,
        fromPlace: oldPlace,
        toPlace: place,
        mso: mso || c.mso || '',
        boxNo: boxNo || c.boxNo || '',
        date: new Date().toISOString().slice(0, 10),
        createdBy: currentUser?.email || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (_) {}
    const idx = allCustomers.findIndex(x => x.id === id);
    if (idx >= 0) Object.assign(allCustomers[idx], updates);
    closeTransferModal();
    await logActivity(id, 'Transfer', (oldPlace || '') + ' ' + (oldStreet || '') + ' → ' + place + ' ' + street + ' · ID ' + newCustId);
    showToast('Transfer OK · ' + place + ' · ' + street + ' · ' + newCustId);
    await viewLedger(id);
  } catch (e) {
    showToast('Transfer error: ' + e.message, true);
  }
}

let pkgModalAddons = [];

async function ledgerQuickPackage() {
  const id = currentLedgerCustomerId;
  if (!id) return;
  const c = allCustomers.find(x => x.id === id);
  if (!c) return;
  window._pkgModalCustId = id;
  if (!packageMasterCache.length && typeof loadPackageMaster === 'function') {
    try { await loadPackageMaster(); } catch (_) {}
  }
  document.getElementById('pkgModalCust').textContent = (c.name || '') + ' · ' + (c.custId || '');
  const curAmt = Number(c.packageAmt || c.packAmt || 0);
  const curAddon = Number(c.addonAmt || 0);
  document.getElementById('pkgModalCurrent').textContent =
    (c.package || '-') + ' · ₹' + curAmt + (curAddon ? (' + addon ₹' + curAddon) : '');
  const sel = document.getElementById('pkgModalSelect');
  const pkgs = packageMasterCache.length ? packageMasterCache : [
    { name: 'PLAN 250', amount: 250 }, { name: 'PLAN 280', amount: 280 },
    { name: 'PLAN 290', amount: 290 }, { name: 'PLAN 300', amount: 300 },
    { name: 'PLAN 350', amount: 350 }, { name: 'PLAN 400', amount: 400 }
  ];
  sel.innerHTML = '<option value="">Select package</option>' +
    pkgs.map(p => `<option value="${p.name}" data-amt="${p.amount}">${p.name} — ₹${p.amount}</option>`).join('');
  if (c.package) {
    sel.value = c.package;
    if (!sel.value) {
      sel.innerHTML += `<option value="${c.package}" data-amt="${curAmt}" selected>${c.package}</option>`;
    }
  }
  document.getElementById('pkgModalAmt').value = curAmt || (sel.selectedOptions[0]?.dataset?.amt || '');
  // addons
  pkgModalAddons = [];
  try {
    if (Array.isArray(c.addons)) pkgModalAddons = c.addons.map(a => ({ ...a }));
    else if (c.addons && typeof c.addons === 'string') pkgModalAddons = JSON.parse(c.addons);
  } catch (_) {}
  renderPkgModalAddons();
  recalcPkgModalTotal();
  document.getElementById('packageModal').classList.remove('hidden');
}

function onPkgModalSelect() {
  const sel = document.getElementById('pkgModalSelect');
  const opt = sel?.selectedOptions?.[0];
  if (opt && opt.dataset.amt) document.getElementById('pkgModalAmt').value = opt.dataset.amt;
  recalcPkgModalTotal();
}

function renderPkgModalAddons() {
  const box = document.getElementById('pkgModalAddonChips');
  if (!box) return;
  if (!pkgModalAddons.length) {
    box.innerHTML = '<span class="text-xs text-slate-400">No add-ons</span>';
  } else {
    box.innerHTML = pkgModalAddons.map((a, i) =>
      `<span class="inline-flex items-center gap-1 bg-blue-50 text-blue-800 text-xs px-2 py-1 rounded-full border border-blue-200">
        ${a.name} ₹${a.amount}
        <button type="button" onclick="pkgModalAddons.splice(${i},1);renderPkgModalAddons();recalcPkgModalTotal();" class="text-red-500 font-bold">&times;</button>
      </span>`
    ).join('');
  }
}

function addPkgModalAddon() {
  const name = (document.getElementById('pkgModalAddonName')?.value || '').trim();
  const amount = Number(document.getElementById('pkgModalAddonAmt')?.value || 0);
  if (!name) { showToast('Channel name', true); return; }
  if (!amount) { showToast('Amount', true); return; }
  pkgModalAddons.push({ name, amount });
  document.getElementById('pkgModalAddonName').value = '';
  document.getElementById('pkgModalAddonAmt').value = '';
  renderPkgModalAddons();
  recalcPkgModalTotal();
}

function recalcPkgModalTotal() {
  const base = Number(document.getElementById('pkgModalAmt')?.value || 0);
  const add = pkgModalAddons.reduce((s, a) => s + Number(a.amount || 0), 0);
  const el = document.getElementById('pkgModalTotal');
  if (el) el.textContent = '₹' + (base + add).toLocaleString('en-IN');
}

function closePackageModal() {
  document.getElementById('packageModal')?.classList.add('hidden');
  window._pkgModalCustId = null;
}

async function savePackageModal() {
  const id = window._pkgModalCustId;
  if (!id) return;
  const c = allCustomers.find(x => x.id === id);
  const pkg = (document.getElementById('pkgModalSelect')?.value || '').trim();
  const packageBase = Number(document.getElementById('pkgModalAmt')?.value || 0);
  const addonAmt = pkgModalAddons.reduce((s, a) => s + Number(a.amount || 0), 0);
  const packageAmt = packageBase + addonAmt;
  if (!pkg) { showToast('Package select பண்ணுங்கள்', true); return; }
  try {
    await col('customers').doc(id).update({
      package: pkg,
      packageBase,
      packageAmt,
      addonAmt,
      addons: pkgModalAddons,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const idx = allCustomers.findIndex(x => x.id === id);
    if (idx >= 0) {
      Object.assign(allCustomers[idx], { package: pkg, packageBase, packageAmt, addonAmt, addons: pkgModalAddons });
    }
    closePackageModal();
    await logActivity(id, 'Package changed', (c && c.package ? c.package + ' → ' : '') + pkg + ' · ₹' + packageAmt);
    showToast('Package updated · ₹' + packageAmt);
    await viewLedger(id);
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}


// ==================== DC / RC ====================

async function deleteCustomer(id) {
  const c = allCustomers.find(x => x.id === id);
  if (!c) return;
  if (!isAdminUser(currentUser)) {
    showToast('Admin only', true);
    return;
  }
  const label = (c.name || '') + ' / ' + (c.custId || id);
  if (!confirm('DELETE customer?\n\n' + label + '\n\n1/2 — Are you sure?')) return;
  if (!confirm('FINAL confirm.\n\n' + label + '\n\nLedger history will remain but customer will be removed from list.\n\n2/2 — Delete permanently?')) return;
  try {
    await col('customers').doc(id).delete();
    allCustomers = allCustomers.filter(x => x.id !== id);
    renderCustomerTable(allCustomers);
    updateDashboardStats();
    showToast('Customer deleted: ' + (c.name || ''));
  } catch (err) {
    showToast('Delete failed: ' + err.message, true);
  }
}

async function toggleDC(id, currentStatus) {
  const c = allCustomers.find(x => x.id === id);
  if (!c) return;

  const newStatus = currentStatus === 'ACT' ? 'DC' : 'ACT';
  const action = newStatus === 'DC' ? 'Disconnect (DC)' : 'Reconnect (RC)';

  if (!confirm(`${c.name} - ${action} செய்யவா?`)) return;

  let returnBox = false;
  const boxNo = (c.boxNo || '').trim();
  if (newStatus === 'DC' && boxNo) {
    returnBox = confirm(`Box ${boxNo} return ஆனதா?\n\nOK = Store stock-க்கு சேர்க்கும்\nCancel = Box customer-ல் வைக்கும்`);
  }

  try {
    const updates = {
      status: newStatus,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (returnBox) {
      updates.boxNo = '';
      updates.previousBoxNo = boxNo;
    }
    if (newStatus === 'DC') {
      updates.dcDate = new Date().toISOString().slice(0, 10);
      let reason = prompt('DC Reason:\n1. Payment Pending\n2. Customer Request\n3. Temporary DC\n4. Shifted\n5. Service Issue\n6. Other\n\nType number or text:', '1');
      if (reason === null || reason === '1') reason = 'Payment Pending';
      else if (reason === '2') reason = 'Customer Request';
      else if (reason === '3') reason = 'Temporary DC';
      else if (reason === '4') reason = 'Shifted';
      else if (reason === '5') reason = 'Service Issue';
      else if (reason === '6') reason = 'Other';
      updates.dcReason = reason || 'Payment Pending';
    } else {
      updates.dcDate = firebase.firestore.FieldValue.delete();
      updates.dcReason = firebase.firestore.FieldValue.delete();
      updates.rcDate = new Date().toISOString().slice(0, 10);
    }
    await col('customers').doc(id).update(updates);

    if (returnBox && boxNo) {
      await upsertBoxStock(boxNo, {
        status: 'available',
        customerId: null,
        customerName: null,
        mso: c.mso || '',
        returnedAt: new Date().toISOString().split('T')[0],
        returnedFrom: c.name || ''
      });
    }

    // RC with no box - optional assign from stock later via Edit
    await col('statusLogs').add({
      customerId: id,
      customerName: c.name,
      fromStatus: currentStatus,
      toStatus: newStatus,
      boxReturned: returnBox,
      boxNo: returnBox ? boxNo : (c.boxNo || ''),
      date: new Date().toISOString().split('T')[0],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: currentUser.email
    });

    await logActivity(id, action, returnBox ? ('Box ' + boxNo + ' → Store') : '');
    showToast(returnBox ? `${action} + Box ${boxNo} → Store` : `${action} successful!`);
    await refreshOneCustomer(id);
    if (typeof currentLedgerCustomerId !== 'undefined' && currentLedgerCustomerId === id) await viewLedger(id);
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}


// ==================== DYNAMIC AGENT INDEX ====================
// Built from `employees` collection (allEmployees). No hardcoded person names.
// Every employee gets a stable key = slugified name. Employees with role
// 'office' or 'online' map to the fixed 'office' / 'online' payment-channel
// buckets; everyone else (role 'collector' / 'admin' / blank) is a field
// collector tracked under their own key.
let AGENT_INDEX = {};   // lowercase token (email / email-prefix / name / name-no-space) -> {key, name}
let AGENT_LIST = [];    // ordered [{key, name, role}] for rendering

function slugifyAgentName(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'agent';
}

function buildAgentIndex() {
  AGENT_INDEX = {};
  const list = [];
  const seenKeys = new Set();
  (allEmployees || []).forEach(e => {
    const role = String(e.role || '').toLowerCase().trim();
    const name = String(e.name || '').trim();
    if (!name) return;
    const isOffice = role === 'office';
    const isOnline = role === 'online';
    const key = isOffice ? 'office' : (isOnline ? 'online' : slugifyAgentName(name));
    const email = String(e.email || '').toLowerCase().trim();
    const emailPrefix = email.split('@')[0];
    const nameLower = name.toLowerCase();
    const nameNoSpace = nameLower.replace(/\s+/g, '');
    [email, emailPrefix, nameLower, nameNoSpace].forEach(tok => {
      if (tok) AGENT_INDEX[tok] = { key, name: isOffice ? 'OFFICE' : (isOnline ? 'ONLINE' : name.toUpperCase()) };
    });
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      list.push({ key, name: isOffice ? 'OFFICE' : (isOnline ? 'ONLINE' : name.toUpperCase()), role: isOffice ? 'office' : (isOnline ? 'online' : 'collector') });
    }
  });
  // Always guarantee Office / Online buckets exist even with no employee doc
  if (!seenKeys.has('office')) list.push({ key: 'office', name: 'OFFICE', role: 'office' });
  if (!seenKeys.has('online')) list.push({ key: 'online', name: 'ONLINE', role: 'online' });
  // Collectors first, then Office, then Online
  list.sort((a, b) => {
    const rank = r => (r === 'collector' ? 0 : r === 'office' ? 1 : 2);
    return rank(a.role) - rank(b.role) || a.name.localeCompare(b.name);
  });
  AGENT_LIST = list;
}

function classifyAgent(d) {
  if (typeof d === 'string') d = { collectedBy: d };
  const cb = String(d.collectedBy || '').toLowerCase().trim();
  const mode = String(d.mode || '').toLowerCase().trim();
  const email = String(d.createdBy || '').toLowerCase().trim();
  const emp = String(d.employee || '').toLowerCase().trim();
  const remarks = String(d.remarks || '').toLowerCase();

  const lookup = (tok) => {
    if (!tok) return null;
    if (AGENT_INDEX[tok]) return AGENT_INDEX[tok].key;
    const prefix = tok.split('@')[0];
    if (AGENT_INDEX[prefix]) return AGENT_INDEX[prefix].key;
    return null;
  };

  // 1) collectedBy — highest priority, match against known employees first
  let k = lookup(cb);
  if (k) return k;
  if (cb.includes('gpay') || cb === 'online' || cb.includes('online')) return 'online';
  if (cb.includes('local') || cb === 'office' || cb.includes('office')) return 'office';

  // 2) remarks from CableSoft-style import
  if (/collected\s*=\s*gpay/.test(remarks) || remarks.includes('gpay')) return 'online';
  if (/collected\s*=\s*local/.test(remarks)) return 'office';

  // 3) payment mode
  if (mode === 'upi' || mode.includes('gpay')) return 'online';

  // 4) createdBy email
  k = lookup(email);
  if (k) return k;
  if (email.startsWith('online@')) return 'online';
  if (email.startsWith('office@')) return 'office';

  // 5) employee field (do NOT override GPAY/LOCAL signals above)
  k = lookup(emp);
  if (k) return k;
  if (emp.includes('gpay') || emp.includes('online')) return 'online';
  if (emp.includes('local') || emp.includes('office')) return 'office';

  return 'other';
}

function displayAgentName(d) {
  if (typeof d === 'string') d = { collectedBy: d, createdBy: d, employee: d };
  const k = classifyAgent(d);
  const found = AGENT_LIST.find(a => a.key === k);
  if (found) return found.name;
  const s = String((d && (d.collectedBy || d.employee || d.createdBy)) || '');
  if (s.includes('@')) return s.split('@')[0].toUpperCase();
  if (s && s.length < 20) return s.toUpperCase();
  return s || '-';
}


// ==================== LEDGER ====================

function copyLedgerField(kind) {
  const btn = document.getElementById(kind === 'vc' ? 'ledgerVcBtn' : 'ledgerBoxBtn');
  const val = (btn && (btn.dataset.val || btn.textContent)) || '';
  if (!val || val === '-') { showToast((kind === 'vc' ? 'VC' : 'Box') + ' இல்லை', true); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(val).then(() => showToast('Copied: ' + val)).catch(() => fallbackCopy(val));
  } else {
    fallbackCopy(val);
  }
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showToast('Copied: ' + text); } catch(e) { showToast(text); }
  document.body.removeChild(ta);
}
function startBillForLedger() {
  if (!currentLedgerCustomerId) return;
  selectCustomerForBill(currentLedgerCustomerId);
  showPage('billing');
}


async function logActivity(customerId, action, detail, extra) {
  try {
    let customerName = (extra && extra.customerName) || '';
    let custId = (extra && extra.custId) || '';
    if (customerId && allCustomers) {
      const c = allCustomers.find(x => x.id === customerId);
      if (c) {
        if (!customerName) customerName = c.name || '';
        if (!custId) custId = c.custId || '';
      }
    }
    const cat = (extra && extra.category) || classifyActivityAction(action);
    await col('activityLogs').add({
      customerId: customerId || '',
      customerName: customerName || '',
      custId: custId || '',
      action: action || '',
      detail: detail || '',
      category: cat,
      ...(extra || {}),
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      createdBy: (currentUser && currentUser.email) || (window.currentUserEmail) || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) { console.warn('activity log', e); }
}

function classifyActivityAction(action) {
  const a = String(action || '').toLowerCase();
  if (a.includes('payment') || a.includes('collect') || a.includes('bill') || a.includes('cancel')) return 'payment';
  if (a.includes('package') || a.includes('addon') || a.includes('add-on')) return 'package';
  if (a.includes('dc') || a.includes('disconnect') || a.includes('reconnect') || a.includes('rc ') || a.includes('transfer') || a.includes('connection')) return 'service';
  if (a.includes('customer') || a.includes('edit') || a.includes('mobile') || a.includes('created') || a.includes('delete')) return 'customer';
  if (a.includes('whatsapp') || a.includes('sms') || a.includes('warning')) return 'comm';
  return 'other';
}

async function viewLedger(id) {
  currentLedgerCustomerId = id;
  const c = allCustomers.find(x => x.id === id);
  if (!c) { showToast('Customer not found', true); return; }

  document.getElementById('ledgerCustName').textContent = c.name || '-';
  const streetLine = [c.street, c.place].filter(Boolean).join(' · ');
  const sl = document.getElementById('ledgerStreetLine');
  if (sl) sl.textContent = streetLine || '-';

  const mobile = String(c.mobile || '').replace(/\D/g, '');
  const info = document.getElementById('ledgerCustInfo');
  if (info) {
    info.innerHTML = (mobile ? '📞 ' + c.mobile + ' <button type="button" onclick="copyText(\'' + mobile + '\')" class="text-blue-500 text-[10px]">copy</button>' : '') +
      ' · ID: <span class="font-mono">' + (c.custId || id) + '</span>';
  }
  const callBtn = document.getElementById('ledgerCallBtn');
  const waBtn = document.getElementById('ledgerWaBtn');
  if (callBtn) callBtn.href = mobile ? ('tel:' + mobile) : '#';
  if (waBtn) {
    const due = Number(c.dueAmt || c.due || 0);
    let msg = 'வணக்கம் ' + (c.name || '') + ', Smart Cable Manager.';
    if (due > 0) msg += ' உங்கள் pending amount ₹' + due + '.';
    waBtn.href = mobile ? ('https://wa.me/91' + mobile.slice(-10) + '?text=' + encodeURIComponent(msg)) : '#';
  }

  const msoEl = document.getElementById('ledgerMso');
  if (msoEl) msoEl.textContent = c.mso || '-';

  const pkgEl = document.getElementById('ledgerPkg');
  if (pkgEl) {
    let addonList = [];
    try {
      const arr = typeof c.addons === 'string' ? JSON.parse(c.addons || '[]') : (c.addons || []);
      if (Array.isArray(arr)) addonList = arr;
    } catch (e) {}
    const addonSum = addonList.reduce((s, a) => s + Number(a.amount || 0), 0) || Number(c.addonAmt || 0);
    const base = c.packageBase != null ? Number(c.packageBase) : (Number(c.packageAmt || 0) - addonSum);
    const total = Number(c.packageAmt != null ? c.packageAmt : (base + addonSum));
    const pkgName = c.package || '-';
    let html = '<div>' + pkgName + ' · ₹' + (base > 0 ? base : total) + '/mo</div>';
    if (addonList.length) {
      html += addonList.map(a =>
        '<div class="text-[11px] text-indigo-600">+ ' + (a.name || 'Add-on') + (a.amount ? ' ₹' + a.amount : '') + '</div>'
      ).join('');
    } else if (addonSum > 0) {
      html += '<div class="text-[11px] text-indigo-600">+ Add-on ₹' + addonSum + '</div>';
    }
    pkgEl.innerHTML = html;
  }

  const vcBtn = document.getElementById('ledgerVcBtn');
  const vc = c.scNo || c.smartCard || '';
  if (vcBtn) { vcBtn.textContent = (vc || '-') + (vc ? ' 📋' : ''); vcBtn.dataset.val = vc; }
  const boxBtn = document.getElementById('ledgerBoxBtn');
  if (boxBtn) { boxBtn.textContent = (c.boxNo || '-') + (c.boxNo ? ' 📋' : ''); boxBtn.dataset.val = c.boxNo || ''; }
  const cd = document.getElementById('ledgerConDate');
  if (cd) cd.textContent = c.conDate || c.connectionDate || '-';
  const ca = document.getElementById('ledgerCafAddon');
  if (ca) {
    let addons = '';
    try {
      const arr = typeof c.addons === 'string' ? JSON.parse(c.addons || '[]') : (c.addons || []);
      if (Array.isArray(arr) && arr.length) addons = arr.map(a => a.name + (a.amount ? ' ₹' + a.amount : '')).join(', ');
    } catch (e) {}
    ca.textContent = addons || (c.caf || '-') || '-';
  }

  const dueAmt = Number(c.dueAmt || c.due || 0);
  const dueEl = document.getElementById('ledgerDue');
  const dueCard = document.getElementById('ledgerDueCard');
  const dueHint = document.getElementById('ledgerDueHint');
  if (dueEl) dueEl.textContent = '₹' + dueAmt.toLocaleString('en-IN');
  if (dueCard) {
    if (dueAmt > 0) {
      dueCard.className = 'rounded-2xl p-4 mb-3 border border-red-100 bg-gradient-to-br from-red-50 to-white';
      dueEl.className = 'text-3xl font-bold text-red-600 mt-0.5';
      const months = Math.max(1, Math.round(dueAmt / Math.max(1, Number(c.packageAmt || c.packageBase || 280))));
      if (dueHint) dueHint.textContent = '🔴 ' + months + ' month' + (months > 1 ? 's' : '') + ' pending';
    } else {
      dueCard.className = 'rounded-2xl p-4 mb-3 border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white';
      dueEl.className = 'text-3xl font-bold text-emerald-700 mt-0.5';
      if (dueHint) dueHint.textContent = '✓ Paid up · no pending';
    }
  }

  const st = (c.status || 'ACT').toUpperCase();
  const stEl = document.getElementById('ledgerStatus');
  if (stEl) {
    if (st === 'DC') {
      stEl.textContent = 'DISCONNECTED';
      stEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700';
    } else {
      stEl.textContent = 'ACTIVE';
      stEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700';
    }
  }
  const dcBtn = document.getElementById('ledgerDcBtn');
  if (dcBtn) {
    if (st === 'DC') {
      dcBtn.textContent = '🟢 RC';
      dcBtn.className = 'bg-white border border-emerald-100 py-2.5 rounded-xl text-sm font-medium text-emerald-700';
    } else {
      dcBtn.textContent = '🔴 DC';
      dcBtn.className = 'bg-white border border-red-100 py-2.5 rounded-xl text-sm font-medium text-red-600';
    }
  }

  const timeline = document.getElementById('ledgerTimeline');
  if (timeline) timeline.innerHTML = '<div class="p-6 text-center text-slate-400 text-sm">Loading...</div>';

  try {
    const snap = await col('collections').where('customerId', '==', id).get();
    const rows = [];
    snap.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
    rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    const tbody = document.getElementById('ledgerTableBody');
    let total = 0;
    if (!rows.length) {
      if (timeline) timeline.innerHTML = '<div class="p-8 text-center text-slate-400 text-sm">No payments yet</div>';
      if (tbody) tbody.innerHTML = '';
      const pt = document.getElementById('ledgerPayTotal');
      if (pt) pt.textContent = '';
    } else {
      if (timeline) {
        // Cancel only for latest active payment within 7 days
        let cancelableId = null;
        try {
          const active = rows.filter(function (x) { return x.status !== 'cancelled'; })
            .slice().sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
          if (active.length) {
            const latest = active[0];
            const d0 = String(latest.date || '').slice(0, 10);
            const t0 = new Date(d0 + 'T12:00:00').getTime();
            const now = Date.now();
            if (!isNaN(t0) && (now - t0) <= 7 * 24 * 60 * 60 * 1000) {
              cancelableId = latest.id;
            }
          }
        } catch (e) {}
        timeline.innerHTML = rows.map(r => {
          const cancelled = r.status === 'cancelled';
          if (!cancelled) total += Number(r.amount || 0);
          const agent = (typeof displayAgentName === 'function') ? displayAgentName(r) : (r.collectedBy || '-');
          const d = r.date || '';
          let dLabel = d;
          try {
            const dt = new Date(d + 'T12:00:00');
            if (!isNaN(dt)) dLabel = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
          } catch (e) {}
          const cancelBtn = (!cancelled && r.id === cancelableId) ? `<button type="button" onclick="event.stopPropagation();cancelCollection('${r.id}','${r.customerId || id}',${Number(r.amount||0)})" class="text-[10px] text-red-500 border border-red-200 px-1.5 py-0.5 rounded shrink-0">Cancel</button>` : '';
          return `<div class="px-4 py-3 flex gap-3 ${cancelled ? 'opacity-40' : ''}">
            <div class="flex flex-col items-center pt-1">
              <div class="w-2.5 h-2.5 rounded-full ${cancelled ? 'bg-slate-300' : 'bg-emerald-500'}"></div>
              <div class="w-px flex-1 bg-slate-100 mt-1"></div>
            </div>
            <div class="flex-1 min-w-0 pb-1">
              <div class="flex justify-between gap-2 items-start">
                <div>
                  <div class="text-xs text-slate-400">${dLabel}</div>
                  <div class="font-semibold text-slate-800">₹${Number(r.amount || 0).toLocaleString('en-IN')} ${cancelled ? '<span class="text-red-500 text-[10px]">Cancelled</span>' : 'Paid'}</div>
                  <div class="text-[11px] text-slate-500 mt-0.5">${r.mode || '-'} · ${agent}${r.billNo ? ' · #' + r.billNo : ''}</div>
                </div>
                ${cancelBtn}
              </div>
            </div>
          </div>`;
        }).join('');
      }
      const pt = document.getElementById('ledgerPayTotal');
      if (pt) pt.textContent = '';
      if (tbody) tbody.innerHTML = rows.map(r => `<tr><td>${r.billNo||''}</td></tr>`).join('');
    }
  } catch (err) {
    console.error(err);
    if (timeline) timeline.innerHTML = '<div class="p-4 text-red-500 text-sm">Error loading history</div>';
  }

  await loadLedgerActivity(id, c);
  showPage('ledger');
}

async function loadLedgerActivity(id, c) {
  const box = document.getElementById('ledgerActivity');
  if (!box) return;
  box.innerHTML = '<div class="p-4 text-center text-slate-400 text-sm">Loading activity...</div>';
  const events = [];
  try {
    // unified activityLogs
    try {
      const a = await col('activityLogs').where('customerId', '==', id).limit(100).get();
      a.forEach(doc => {
        const d = doc.data();
        events.push({
          ts: d.createdAt?.toMillis?.() || Date.parse(d.date || '') || 0,
          date: d.date || '',
          time: d.time || '',
          text: (d.action || '') + (d.detail ? ' — ' + d.detail : ''),
          by: d.createdBy || ''
        });
      });
    } catch (e) {}
    // statusLogs
    try {
      const s = await col('statusLogs').where('customerId', '==', id).limit(50).get();
      s.forEach(doc => {
        const d = doc.data();
        events.push({
          ts: d.createdAt?.toMillis?.() || Date.parse(d.date || '') || 0,
          date: d.date || '',
          time: '',
          text: (d.fromStatus || '') + ' → ' + (d.toStatus || '') + (d.boxReturned ? ' (box returned)' : ''),
          by: d.createdBy || ''
        });
      });
    } catch (e) {}
    // transfers
    try {
      const t = await col('transfers').where('customerId', '==', id).limit(50).get();
      t.forEach(doc => {
        const d = doc.data();
        events.push({
          ts: d.createdAt?.toMillis?.() || Date.parse(d.date || '') || 0,
          date: d.date || '',
          time: '',
          text: 'Transfer: ' + (d.fromStreet || '') + ' → ' + (d.toStreet || '') +
            (d.toCustId ? ' · ID ' + (d.fromCustId || '') + ' → ' + d.toCustId : ''),
          by: d.createdBy || ''
        });
      });
    } catch (e) {}
    // connection created (synthetic)
    if (c && (c.conDate || c.connectionDate || c.createdAt)) {
      const cd = c.conDate || c.connectionDate || '';
      events.push({
        ts: Date.parse(cd) || 0,
        date: cd,
        time: '',
        text: 'Connection / customer record',
        by: ''
      });
    }
    events.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if (!events.length) {
      box.innerHTML = '<div class="p-6 text-center text-slate-400 text-sm">No activity yet</div>';
      return;
    }
    box.innerHTML = events.slice(0, 40).map(e => {
      let dLabel = e.date || '';
      try {
        const dt = new Date((e.date || '') + 'T12:00:00');
        if (!isNaN(dt)) dLabel = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      } catch (err) {}
      return `<div class="px-4 py-2.5">
        <div class="text-[10px] text-slate-400">${dLabel}${e.time ? ' · ' + e.time : ''}${e.by ? ' · ' + e.by.split('@')[0] : ''}</div>
        <div class="text-sm text-slate-800">${e.text}</div>
      </div>`;
    }).join('');
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="p-4 text-slate-400 text-sm">Activity unavailable</div>';
  }
}

function copyText(t) {
  if (!t) return;
  navigator.clipboard.writeText(String(t)).then(() => showToast('Copied ✓')).catch(() => showToast(String(t)));
}

// ==================== PENDING / DUE REPORT ====================
function getPendingFiltered() {
  const area = (document.getElementById('pendFilterArea') || {}).value || '';
  const street = (document.getElementById('pendFilterStreet') || {}).value || '';
  const mso = (document.getElementById('pendFilterMso') || {}).value || '';
  let list = allCustomers.filter(c => Number(c.dueAmt || c.due || 0) > 0);
  if (area) list = list.filter(c => (c.place || '') === area);
  if (street) list = list.filter(c => (c.street || '') === street);
  if (mso) list = list.filter(c => String(c.mso || '').trim().toUpperCase() === String(mso).trim().toUpperCase());
  list.sort((a, b) => {
    const s = (a.street || '').localeCompare(b.street || '', 'ta');
    if (s) return s;
    return Number(b.dueAmt || b.due || 0) - Number(a.dueAmt || a.due || 0);
  });
  return list;
}

function onPendingFilterChange() {
  const area = (document.getElementById('pendFilterArea') || {}).value || '';
  const streetSel = document.getElementById('pendFilterStreet');
  if (streetSel) {
    const streets = new Set();
    allCustomers.filter(c => Number(c.dueAmt || c.due || 0) > 0)
      .filter(c => !area || (c.place || '') === area)
      .forEach(c => { if (c.street) streets.add(c.street); });
    const cur = streetSel.value;
    streetSel.innerHTML = '<option value="">All Streets</option>' +
      Array.from(streets).sort((a,b) => a.localeCompare(b, 'ta'))
        .map(s => `<option value="${s.replace(/"/g, '&quot;')}">${s}</option>`).join('');
    if (cur && streets.has(cur)) streetSel.value = cur;
  }
  const msoSel = document.getElementById('pendFilterMso');
  if (msoSel && msoSel.options.length <= 1) {
    const msos = new Set();
    allCustomers.forEach(c => { if (c.mso) msos.add(c.mso); });
    msoSel.innerHTML = '<option value="">All MSO</option>' +
      Array.from(msos).sort().map(m => `<option value="${m}">${m}</option>`).join('');
  }
  renderPendingReport();
}

function renderPendingReport() {
  // populate MSO options once
  const msoSel = document.getElementById('pendFilterMso');
  if (msoSel && msoSel.options.length <= 1) {
    const msos = new Set();
    allCustomers.forEach(c => { if (c.mso) msos.add(c.mso); });
    const cur = msoSel.value;
    msoSel.innerHTML = '<option value="">All MSO</option>' +
      Array.from(msos).sort().map(m => `<option value="${m}">${m}</option>`).join('');
    if (cur) msoSel.value = cur;
  }
  // street options for current area
  const area = (document.getElementById('pendFilterArea') || {}).value || '';
  const streetSel = document.getElementById('pendFilterStreet');
  if (streetSel) {
    const streets = new Set();
    allCustomers.filter(c => Number(c.dueAmt || c.due || 0) > 0)
      .filter(c => !area || (c.place || '') === area)
      .forEach(c => { if (c.street) streets.add(c.street); });
    const cur = streetSel.value;
    streetSel.innerHTML = '<option value="">All Streets</option>' +
      Array.from(streets).sort((a,b) => a.localeCompare(b, 'ta'))
        .map(s => `<option value="${s.replace(/"/g, '&quot;')}">${s}</option>`).join('');
    if (cur && [...streets].includes(cur)) streetSel.value = cur;
  }

  const list = getPendingFiltered();
  const tbody = document.getElementById('pendingTableBody');
  const totalDue = list.reduce((s, c) => s + Number(c.dueAmt || c.due || 0), 0);
  document.getElementById('pendingCount').textContent = list.length;
  document.getElementById('pendingTotal').textContent = '₹' + totalDue.toLocaleString('en-IN');

  const cards = document.getElementById('pendingCards');
  try {
    if (!list.length) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-400">No pending in this filter</td></tr>';
      if (cards) cards.innerHTML = '<div class="p-8 text-center text-slate-400 text-sm bg-white rounded-xl border">No pending in this filter</div>';
      return;
    }

    if (cards) {
      cards.innerHTML = list.map(function (c) {
        var due = Number(c.dueAmt || c.due || 0);
        var mobile = String(c.mobile || '').trim();
        var cid = c.custId || (c.id ? String(c.id).slice(0, 8) : '');
        var nm = String(c.name || '—').replace(/</g, '&lt;');
        var st = String(c.street || '—').replace(/</g, '&lt;');
        var box = String(c.boxNo || '—');
        var mso = String(c.mso || '—');
        var id = c.id || '';
        var tel = mobile.replace(/\D/g, '');
        var html = '<div class="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">';
        html += '<div class="flex justify-between items-start gap-2">';
        html += '<div class="min-w-0"><div class="font-semibold text-slate-900 truncate">' + nm + '</div>';
        html += '<div class="text-[11px] text-slate-500 mt-0.5">ID: ' + cid + ' · ' + st + '</div></div>';
        html += '<div class="text-base font-bold text-red-600 shrink-0">₹' + due.toLocaleString('en-IN') + '</div></div>';
        html += '<div class="mt-1.5 text-xs text-slate-600">';
        html += mobile ? ('📞 ' + mobile) : '<span class="text-slate-400">📞 No mobile</span>';
        html += '</div>';
        html += '<div class="font-mono text-[11px] text-slate-500 mt-0.5">📦 ' + box + ' · ' + mso + '</div>';
        html += '<div class="flex gap-2 mt-2.5 pt-2 border-t border-slate-50">';
        html += '<button type="button" data-id="' + id + '" class="pend-ledger flex-1 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-medium">Ledger</button>';
        if (mobile) {
          html += '<button type="button" data-m="' + mobile + '" data-n="' + nm.replace(/"/g, '&quot;') + '" data-d="' + due + '" class="pend-wa flex-1 py-1.5 rounded-lg bg-green-50 text-green-700 text-xs font-medium">WhatsApp</button>';
          html += '<a href="tel:' + tel + '" class="px-3 py-1.5 rounded-lg bg-slate-50 text-slate-700 text-xs font-medium">Call</a>';
        }
        html += '</div></div>';
        return html;
      }).join('');
      cards.querySelectorAll('.pend-ledger').forEach(function (btn) {
        btn.addEventListener('click', function () { viewLedger(btn.getAttribute('data-id')); });
      });
      cards.querySelectorAll('.pend-wa').forEach(function (btn) {
        btn.addEventListener('click', function () {
          openWhatsApp(btn.getAttribute('data-m'), btn.getAttribute('data-n'), Number(btn.getAttribute('data-d') || 0));
        });
      });
    }

    if (tbody) {
      tbody.innerHTML = list.map(function (c) {
        var due = Number(c.dueAmt || c.due || 0);
        var cid = c.custId || (c.id ? String(c.id).slice(0, 6) : '');
        return '<tr class="border-t border-slate-100 hover:bg-slate-50">' +
          '<td class="px-3 py-2 font-mono text-xs">' + cid + '</td>' +
          '<td class="px-3 py-2"><div class="font-medium text-sm">' + (c.name || '-') + '</div>' +
          '<div class="text-[10px] text-slate-500">' + (c.street || '') + (c.place ? ' · ' + c.place : '') + '</div></td>' +
          '<td class="px-3 py-2 text-sm">' + (c.mobile || '-') + '</td>' +
          '<td class="px-3 py-2 font-mono text-xs">' + (c.boxNo || '-') + '</td>' +
          '<td class="px-3 py-2 text-xs">' + (c.mso || '-') + '</td>' +
          '<td class="px-3 py-2 text-sm font-bold text-red-600">₹' + due.toLocaleString('en-IN') + '</td>' +
          '<td class="px-3 py-2"><button type="button" onclick="viewLedger(\'' + c.id + '\')" class="text-purple-600 text-xs">Ledger</button></td></tr>';
      }).join('');
    }
  } catch (err) {
    console.error(err);
    if (cards) cards.innerHTML = '<div class="p-4 text-red-500 text-sm">' + (err.message || err) + '</div>';
    showToast('Pending list error: ' + (err.message || err), true);
  }
}

function exportPendingBoxes() {
  const list = getPendingFiltered().filter(c => (c.boxNo || '').trim());
  if (!list.length) { showToast('Box numbers இல்லை', true); return; }
  const text = list.map(c => String(c.boxNo).trim()).join(', ');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(list.length + ' Box Nos copied (comma) — MSO paste / OFF');
    }).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
  // also show in prompt for easy copy on some phones
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.left = '0'; ta.style.top = '0';
    ta.style.width = '90%'; ta.style.height = '40%';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    setTimeout(() => { try { document.body.removeChild(ta); } catch(e) {} }, 8000);
  } catch (e) {}
}


// ==================== BILLING ====================
function searchForBill() {
  const q = document.getElementById('billSearch').value.toLowerCase().trim();
  const resultsDiv = document.getElementById('billSearchResults');

  if (q.length < 2) {
    resultsDiv.classList.add('hidden');
    return;
  }

  const matches = allCustomers.filter(c =>
    (c.name || '').toLowerCase().includes(q) ||
    (c.mobile || '').includes(q) ||
    (c.boxNo || '').toLowerCase().includes(q) ||
    (c.custId || '').toLowerCase().includes(q)
  ).slice(0, 10);

  if (matches.length === 0) {
    resultsDiv.innerHTML = '<div class="p-3 text-slate-400 text-sm">No match</div>';
  } else {
    resultsDiv.innerHTML = matches.map(c => `
      <div class="p-3 hover:bg-blue-50 cursor-pointer border-b text-sm" onclick="selectBillCustomer('${c.id}')">
        <div class="font-medium">${c.name}</div>
        <div class="text-xs text-slate-500">${c.mobile || '-'} • Box: ${c.boxNo || '-'} • Due: ₹${c.dueAmt || c.due || 0} • ${c.status || 'ACT'}</div>
      </div>
    `).join('');
  }
  resultsDiv.classList.remove('hidden');
}

function selectCustomerForBill(id) { selectBillCustomer(id); }
function selectBillCustomer(id) {
  const c = allCustomers.find(x => x.id === id);
  if (!c) return;
  selectedBillCustomer = c;
  document.getElementById('billCustomerId').value = id;
  document.getElementById('billCustName').textContent = c.name;
  document.getElementById('billCustDetails').textContent =
    `${c.mobile || '-'} | Box: ${c.boxNo || '-'} | ${c.package || ''} | Due: ₹${c.dueAmt || c.due || 0}`;
  document.getElementById('selectedCustomerInfo').classList.remove('hidden');
  document.getElementById('billSearchResults').classList.add('hidden');
  document.getElementById('billSearch').value = c.name;
  const due = Number(c.dueAmt || c.due || 0);
  document.getElementById('billAmount').value = due > 0 ? due : (c.packageAmt || '');
  const hint = document.getElementById('billDueHint');
  if (hint) {
    hint.classList.remove('hidden');
    hint.textContent = 'Current Due: ₹' + due.toLocaleString('en-IN') + ' · Partial / Full / Advance எல்லாம் OK';
  }
  updateBillPayHint();
}

function updateBillPayHint() {
  const c = selectedBillCustomer;
  const el = document.getElementById('billPayType');
  if (!el) return;
  if (!c) { el.textContent = ''; return; }
  const due = Number(c.dueAmt || c.due || 0);
  const amt = Number(document.getElementById('billAmount')?.value || 0);
  if (!amt) { el.textContent = ''; return; }
  if (amt < due) el.textContent = 'Partial · Balance ₹' + (due - amt).toLocaleString('en-IN');
  else if (amt === due) el.textContent = 'Full payment · Due clear';
  else el.textContent = 'Advance · Extra ₹' + (amt - due).toLocaleString('en-IN') + ' (credit)';
}

async function nextDailyBillNo(billDate) {
  // Format: YYYY-MM-DD-001 (resets every day)
  const ref = col('counters').doc('bills_' + billDate);
  const billNo = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let n = 1;
    if (snap.exists) n = (Number(snap.data().seq) || 0) + 1;
    tx.set(ref, { seq: n, date: billDate }, { merge: true });
    // Display only 001, 002... (resets daily via counters doc)
    return String(n).padStart(3, '0');
  });
  return billNo;
}

async function handleSaveBill(e) {
  e.preventDefault();
  const customerId = document.getElementById('billCustomerId').value;
  if (!customerId) {
    showToast('Please select a customer', true);
    return;
  }

  const amount = Number(document.getElementById('billAmount').value);
  if (!amount || amount <= 0) {
    showToast('Enter valid amount', true);
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  // Only today allowed — block backdated bills
  let billDate = document.getElementById('billDate')?.value || today;
  if (billDate !== today) {
    showToast('இன்றைய தேதி மட்டும் bill போடலாம்', true);
    const el = document.getElementById('billDate');
    if (el) el.value = today;
    return;
  }
  billDate = today;
  let billNo = '';
  try {
    billNo = await nextDailyBillNo(billDate);
  } catch (err) {
    billNo = String(Date.now()).slice(-3);
  }

  const data = {
    customerId,
    customerName: selectedBillCustomer?.name || '',
    amount,
    date: billDate,
    billDate,
    billNo,
    mode: document.getElementById('billMode').value,
    remarks: document.getElementById('billRemarks').value.trim(),
    status: 'active',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    createdBy: currentUser.email,
    collectedBy: displayAgentName(currentUser.email)
  };

  // Partial / Full / Advance: due decreases by amount (floor 0); overpay stays 0 due
  const c0 = allCustomers.find(x => x.id === customerId);
  const currentDue = c0 ? Number(c0.dueAmt || c0.due || 0) : 0;
  const newDue = Math.max(0, currentDue - amount);
  data.payType = amount < currentDue ? 'partial' : (amount > currentDue ? 'advance' : 'full');
  data.prevDue = currentDue;
  data.balanceAfter = newDue;

  try {
    if (!navigator.onLine) throw new Error('OFFLINE');
    await col('collections').add(data);
    if (c0) {
      await col('customers').doc(customerId).update({
        dueAmt: newDue,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    await logActivity(customerId, 'Payment collected', '₹' + amount + ' · ' + (data.mode || '') + ' · Bill #' + billNo, { amount, billNo });

    showToast('Bill ' + billNo + ' · ₹' + amount + (data.payType === 'partial' ? ' (partial)' : ''));
    finishBillSave(data, newDue);
  } catch (err) {
    if (!navigator.onLine || String(err.message).includes('OFFLINE') || err.code === 'unavailable') {
      queueOfflineOp({ type: 'collection', data, customerId, newDue });
      showToast('Offline · saved locally · will sync', false);
      finishBillSave(data, newDue, true);
    } else {
      showToast('Error: ' + err.message, true);
    }
  }
}

function finishBillSave(data, newDue, offline) {
  const printOn = document.getElementById('billPrintReceipt')?.checked;
  if (printOn) showReceipt(data, newDue);
  document.getElementById('billForm').reset();
  document.getElementById('selectedCustomerInfo')?.classList.add('hidden');
  const bd = document.getElementById('billDate');
  if (bd) bd.value = new Date().toISOString().split('T')[0];
  if (document.getElementById('billPrintReceipt')) document.getElementById('billPrintReceipt').checked = true;
  selectedBillCustomer = null;
  // optimistic local update — no need to re-download all customers just to
  // reflect one due-amount change. This alone was the single biggest source
  // of wasted Firestore reads (every bill collected re-fetched the entire
  // customer list).
  const c = allCustomers.find(x => x.id === data.customerId);
  if (c) c.dueAmt = newDue;
  if (typeof renderCustomerTable === 'function') renderCustomerTable(allCustomers);
  if (typeof loadDashboard === 'function') loadDashboard();
  else if (typeof updateDashboardStats === 'function') updateDashboardStats();
}

function showReceipt(data, balanceAfter) {
  const co = companyInfo || {};
  const html = `
    <div style="text-align:center;font-weight:700;font-size:14px">SMART CABLE MANAGER</div>
    <div style="text-align:center;font-size:10px;margin-bottom:6px">${co.address || 'My Cable Network'}</div>
    <div style="border-top:1px dashed #000;margin:6px 0"></div>
    <div>Bill No: <b>${data.billNo || '-'}</b></div>
    <div>Date: ${data.date || ''}</div>
    <div>Customer: ${data.customerName || ''}</div>
    <div style="border-top:1px dashed #000;margin:6px 0"></div>
    <div style="display:flex;justify-content:space-between"><span>Paid</span><b>₹${Number(data.amount).toLocaleString('en-IN')}</b></div>
    <div style="display:flex;justify-content:space-between"><span>Mode</span><span>${data.mode || ''}</span></div>
    <div style="display:flex;justify-content:space-between"><span>Type</span><span>${data.payType || 'full'}</span></div>
    <div style="display:flex;justify-content:space-between"><span>Balance Due</span><b>₹${Number(balanceAfter||0).toLocaleString('en-IN')}</b></div>
    <div style="border-top:1px dashed #000;margin:6px 0"></div>
    <div style="font-size:10px">GPay: ${co.gpay || '9442527545'}</div>
    <div style="font-size:10px">Office: ${co.phone || ''} ${co.phone2 || ''}</div>
    <div style="text-align:center;margin-top:8px;font-size:10px">நன்றி · by JMR Apps</div>
  `;
  const el = document.getElementById('receiptContent');
  if (el) el.innerHTML = html;
  document.getElementById('receiptModal')?.classList.remove('hidden');
}
function closeReceipt() {
  document.getElementById('receiptModal')?.classList.add('hidden');
}
function printReceiptNow() {
  document.body.classList.add('printing-receipt');
  window.print();
  setTimeout(() => document.body.classList.remove('printing-receipt'), 500);
}

async function cancelCollection(colId, customerId, amount) {
  const reasons = ['Wrong amount', 'Wrong customer', 'Duplicate bill', 'Payment entered by mistake', 'Other'];
  let reason = prompt('Cancel Bill?\\nAmount will restore to customer due.\\n\\nReason:\\n1. Wrong amount\\n2. Wrong customer\\n3. Duplicate bill\\n4. Payment entered by mistake\\n5. Other\\n\\nType number or text:', '1');
  if (reason === null) return;
  if (reason === '1') reason = 'Wrong amount';
  else if (reason === '2') reason = 'Wrong customer';
  else if (reason === '3') reason = 'Duplicate bill';
  else if (reason === '4') reason = 'Payment entered by mistake';
  else if (reason === '5') reason = 'Other';
  reason = (reason || 'Other').trim();
  if (!confirm('Confirm cancel ₹' + Number(amount || 0) + '?\\nReason: ' + reason)) return;
  try {
    await col('collections').doc(colId).update({
      status: 'cancelled',
      cancelReason: reason,
      cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
      cancelledBy: (currentUser && currentUser.email) || ''
    });
    const cRef = col('customers').doc(customerId);
    const cSnap = await cRef.get();
    if (cSnap.exists) {
      const due = Number(cSnap.data().dueAmt || cSnap.data().due || 0);
      await cRef.update({
        dueAmt: due + Number(amount || 0),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    if (typeof logActivity === 'function') {
      await logActivity(customerId, 'Bill Cancelled', '₹' + Number(amount || 0) + ' · ' + reason, { category: 'payment', amount: Number(amount || 0) });
    }
    showToast('Bill cancelled · Due restored');
    if (currentLedgerCustomerId) await viewLedger(currentLedgerCustomerId);
    await refreshOneCustomer(customerId);
    if (typeof loadCancelledBills === 'function') loadCancelledBills();
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

async function loadCancelledBills() {
  const tbody = document.getElementById('cancelledBillsBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-slate-400">Loading...</td></tr>';
  try {
    let rows = [];
    try {
      const snap = await col('collections').where('status', '==', 'cancelled').get();
      snap.forEach(function (doc) { rows.push({ id: doc.id, ...doc.data() }); });
    } catch (e1) {
      // fallback: scan recent collections
      const snap = await col('collections').limit(500).get();
      snap.forEach(function (doc) {
        const d = doc.data();
        if (String(d.status || '') === 'cancelled') rows.push({ id: doc.id, ...d });
      });
    }
    rows.sort(function (a, b) {
      const ta = (a.cancelledAt && a.cancelledAt.toMillis) ? a.cancelledAt.toMillis() : 0;
      const tb = (b.cancelledAt && b.cancelledAt.toMillis) ? b.cancelledAt.toMillis() : 0;
      if (tb !== ta) return tb - ta;
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-400">No cancelled bills yet<br><span class="text-[11px]">Ledger → payment → Cancel</span></td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (r) {
      const agent = (typeof displayAgentName === 'function') ? displayAgentName(r) : (r.collectedBy || '-');
      const by = String(r.cancelledBy || '').split('@')[0] || '-';
      const reason = r.cancelReason || r.reason || '—';
      return '<tr class="border-t">' +
        '<td class="px-3 py-2 font-mono text-xs">' + (r.billNo || '-') + '</td>' +
        '<td class="px-3 py-2 text-sm">' + (r.date || '-') + '</td>' +
        '<td class="px-3 py-2 text-sm">' + (r.customerName || r.customerId || '-') + '</td>' +
        '<td class="px-3 py-2 font-semibold">₹' + Number(r.amount || 0).toLocaleString('en-IN') + '</td>' +
        '<td class="px-3 py-2 text-xs">' + agent + '</td>' +
        '<td class="px-3 py-2 text-xs text-slate-500">' + by + '</td>' +
        '<td class="px-3 py-2 text-xs text-slate-500">' + reason + '</td></tr>';
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-red-500 py-4">' + (e.message || e) + '</td></tr>';
  }
}

// ==================== DASHBOARD ====================
async function loadDashboard() {
  if (typeof loadBoxes === 'function') {
    try { await loadBoxes(); } catch (e) { console.log(e); }
  }
  updateDashboardStats();

  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.slice(0, 8) + '01';
  try {
    if (!AGENT_LIST.length) buildAgentIndex();
    const emptyBucket = () => ({ amt: 0, cnt: 0 });
    const agentsToday = { other: emptyBucket() };
    const agentsMonth = { other: emptyBucket() };
    AGENT_LIST.forEach(a => { agentsToday[a.key] = emptyBucket(); agentsMonth[a.key] = emptyBucket(); });

    const todaySnap = await col('collections').where('date', '==', today).get();
    let todayTotal = 0;
    todaySnap.forEach(doc => {
      const d = doc.data();
      const amt = Number(d.amount || 0);
      todayTotal += amt;
      const key = classifyAgent(d);
      if (!agentsToday[key]) agentsToday[key] = emptyBucket();
      agentsToday[key].amt += amt;
      agentsToday[key].cnt += 1;
    });
    const st = document.getElementById('statTodayCol');
    if (st) st.textContent = '₹ ' + todayTotal.toLocaleString('en-IN');

    const monthSnap = await col('collections').where('date', '>=', monthStart).get();
    let monthTotal = 0;
    monthSnap.forEach(doc => {
      const d = doc.data();
      const amt = Number(d.amount || 0);
      monthTotal += amt;
      const key = classifyAgent(d);
      if (!agentsMonth[key]) agentsMonth[key] = emptyBucket();
      agentsMonth[key].amt += amt;
      agentsMonth[key].cnt += 1;
    });
    const sm = document.getElementById('statMonthCol');
    if (sm) sm.textContent = '₹ ' + monthTotal.toLocaleString('en-IN');

    const rowsBody = document.getElementById('agentRowsBody');
    if (rowsBody) {
      const colors = ['text-blue-600','text-emerald-600','text-violet-600','text-amber-600','text-pink-600','text-cyan-600'];
      if (!AGENT_LIST.length) {
        rowsBody.innerHTML = '<tr><td colspan="3" class="py-4 text-center text-slate-400 text-xs">Setup → Collectors-ல் collector add பண்ணுங்கள்</td></tr>';
      } else {
        rowsBody.innerHTML = AGENT_LIST.map((a, i) => {
          const t = agentsToday[a.key] || emptyBucket();
          const m = agentsMonth[a.key] || emptyBucket();
          const color = colors[i % colors.length];
          return `<tr>
            <td class="py-2.5 font-medium text-slate-700">${a.name}<br><span class="text-[10px] text-slate-400 font-normal">${t.cnt} today · ${m.cnt} month</span></td>
            <td class="py-2.5 text-right font-bold ${color}">₹${t.amt.toLocaleString('en-IN')}</td>
            <td class="py-2.5 text-right font-bold text-slate-900">₹${m.amt.toLocaleString('en-IN')}</td>
          </tr>`;
        }).join('');
      }
    }
    const otherWrap = document.getElementById('agentOtherWrap');
    const otherEl = document.getElementById('agentOther');
    if (otherEl) otherEl.textContent = '₹' + agentsMonth.other.amt.toLocaleString('en-IN') + ' (' + agentsMonth.other.cnt + ')';
    if (otherWrap) otherWrap.classList.toggle('hidden', agentsMonth.other.cnt === 0);
  } catch (e) {
    console.log('Collection stats error', e);
  }
}





function updateDashboardStats() {
  const total = allCustomers.length;
  const active = allCustomers.filter(c => String(c.status || 'ACT').toUpperCase() === 'ACT').length;
  const dc = allCustomers.filter(c => String(c.status || '').toUpperCase() === 'DC').length;
  const totalDue = allCustomers.reduce((s, c) => s + Number(c.dueAmt || c.due || 0), 0);

  // Customers
  const sc = document.getElementById('statCustomers');
  if (sc) sc.textContent = total;
  const split = document.getElementById('statCustSplit');
  if (split) split.textContent = 'A: ' + active + ' · DC: ' + dc;
  const sa = document.getElementById('statActive');
  if (sa) sa.textContent = active;
  const sp = document.getElementById('statPending');
  if (sp) sp.textContent = dc;

  // Boxes: prefer boxes collection; else customers with boxNo = distributed
  let totalBox = 0, assigned = 0, balance = 0;
  if (typeof allBoxes !== 'undefined' && allBoxes.length > 0) {
    totalBox = allBoxes.length;
    assigned = allBoxes.filter(b => b.status === 'assigned').length;
    balance = allBoxes.filter(b => b.status === 'available').length;
  } else {
    // fallback until stock imported
    assigned = allCustomers.filter(c => c.boxNo && String(c.boxNo).trim()).length;
    totalBox = assigned; // unknown stock
    balance = 0;
  }
  const sb = document.getElementById('statBoxes');
  if (sb) sb.textContent = totalBox;
  const sba = document.getElementById('statBoxAssigned');
  if (sba) sba.textContent = assigned;
  const sbb = document.getElementById('statBoxBalance');
  if (sbb) sbb.textContent = balance;

  const pendingN = allCustomers.filter(c => Number(c.dueAmt || c.due || 0) > 0).length;
  const sdc = document.getElementById('statDueCnt');
  if (sdc) sdc.textContent = pendingN.toLocaleString('en-IN');
  const activeN = allCustomers.filter(c => String(c.status || 'ACT').toUpperCase() === 'ACT').length;
  const totalN = allCustomers.length || 1;
  const ap = Math.round((activeN / totalN) * 100);
  const apEl = document.getElementById('statActivePct');
  if (apEl) apEl.textContent = ap + '% active';
  const ab = document.getElementById('statActiveBar');
  if (ab) ab.style.width = ap + '%';
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const now = new Date();
  const ms = document.getElementById('statMonthSub');
  if (ms) ms.textContent = monthNames[now.getMonth()] + ' ' + now.getFullYear();
  const sd = document.getElementById('statDue');
  if (sd) sd.textContent = '₹ ' + totalDue.toLocaleString('en-IN');
  const boxDisplay = document.getElementById('boxCountDisplay');
  if (boxDisplay) boxDisplay.textContent = totalBox;
}

// ==================== WHATSAPP ====================
const TAMIL_MONTHS = ['ஜனவரி','பிப்ரவரி','மார்ச்','ஏப்ரல்','மே','ஜூன்','ஜூலை','ஆகஸ்ட்','செப்டம்பர்','அக்டோபர்','நவம்பர்','டிசம்பர்'];

function getMonthNameTa() {
  return TAMIL_MONTHS[new Date().getMonth()];
}



let waTemplates = null; // { id: { name, text } }
let waDefaultTplId = 'due';
let waActiveTplId = 'due';

const DEFAULT_WA_TEMPLATES = {
  "due": "வணக்கம் {name},\n\nSmart Cable Manager - {month} மாதத்திற்கு இன்னும் நீங்கள் பணம் கட்டவில்லை.\nநிலுவை: ₹{due}\n\nதயவுசெய்து உடனே செலுத்தி இணைப்பு துண்டிப்பை தவிர்க்கவும்.\n\nGPay: {gpay} (பணம் மட்டும் — புகார் வேண்டாம்)\nOffice / புகார்: {office}\n\nநன்றி.\nSmart Cable Manager · My Cable Network",
  "diwali": "வணக்கம் {name},\n\n✨ இனிய தீபாவளி நல்வாழ்த்துக்கள்! ✨\n\nSmart Cable Manager குடும்பம் உங்களுக்கும் உங்கள் குடும்பத்தினருக்கும் இனிய தீபாவளி வாழ்த்துக்களை தெரிவித்துக் கொள்கிறது.\n\nநன்றி.\nSmart Cable Manager · My Cable Network",
  "christmas": "வணக்கம் {name},\n\n🎄 இனிய கிறிஸ்துமஸ் நல்வாழ்த்துக்கள்! 🎄\n\nSmart Cable Manager உங்களுக்கும் குடும்பத்தினருக்கும் மகிழ்ச்சியான கிறிஸ்துமஸ் வாழ்த்துக்களைத் தெரிவிக்கிறது.\n\nநன்றி.\nSmart Cable Manager · My Cable Network",
  "newyear": "வணக்கம் {name},\n\n🎉 இனிய புத்தாண்டு நல்வாழ்த்துக்கள்! 🎉\n\nபுதிய ஆண்டு உங்களுக்கு ஆரோக்கியமும் செழிப்பும் தரட்டும்.\n\nநன்றி.\nSmart Cable Manager · My Cable Network",
  "ramadan": "வணக்கம் {name},\n\n🌙 ரம்ஜான் நல்வாழ்த்துக்கள்! 🌙\n\nஇந்த புனித மாதம் உங்களுக்கு அமைதியும் ஆசியும் தரட்டும்.\n\nநன்றி.\nSmart Cable Manager · My Cable Network",
  "pongal": "வணக்கம் {name},\n\n🌾 இனிய பொங்கல் நல்வாழ்த்துக்கள்! 🌾\n\nSmart Cable Manager குடும்பம் உங்களுக்கு இனிய தைப்பொங்கல் வாழ்த்துக்களைத் தெரிவிக்கிறது.\n\nநன்றி.\nSmart Cable Manager · My Cable Network",
};

const DEFAULT_WA_NAMES = {"due": "Due Reminder", "diwali": "தீபாவளி வாழ்த்து", "christmas": "கிறிஸ்துமஸ் வாழ்த்து", "newyear": "புத்தாண்டு வாழ்த்து", "ramadan": "ரம்ஜான் வாழ்த்து", "pongal": "பொங்கல் வாழ்த்து"};

function ensureWaTemplates() {
  if (waTemplates && Object.keys(waTemplates).length) return;
  waTemplates = {};
  Object.keys(DEFAULT_WA_TEMPLATES).forEach(id => {
    waTemplates[id] = { name: DEFAULT_WA_NAMES[id] || id, text: DEFAULT_WA_TEMPLATES[id] };
  });
}

async function loadWaTemplate() {
  ensureWaTemplates();
  try {
    const doc = await col('settings').doc('waTemplates').get();
    if (doc.exists) {
      const d = doc.data();
      if (d.templates && typeof d.templates === 'object') {
        waTemplates = { ...waTemplates, ...d.templates };
      }
      if (d.defaultId) waDefaultTplId = d.defaultId;
      // migrate old single template
    } else {
      const old = await col('settings').doc('waTemplate').get();
      if (old.exists && old.data().text) {
        waTemplates.due = { name: 'Due Reminder', text: old.data().text };
      }
    }
  } catch (e) {}
  waActiveTplId = waDefaultTplId;
  fillWaTplSelects();
  onWaTplSelect();
}

function fillWaTplSelects() {
  ensureWaTemplates();
  const opts = Object.keys(waTemplates).map(id => {
    const n = waTemplates[id].name || id;
    return `<option value="${id}">${n}</option>`;
  }).join('');
  ['waTplSelect', 'waDefaultTpl', 'waQueueTpl'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = opts;
    if (id === 'waDefaultTpl') el.value = waDefaultTplId;
    else if (id === 'waTplSelect') el.value = waActiveTplId;
    else if (cur && waTemplates[cur]) el.value = cur;
    else el.value = waDefaultTplId;
  });
}

function onWaTplSelect() {
  const id = document.getElementById('waTplSelect')?.value || 'due';
  waActiveTplId = id;
  ensureWaTemplates();
  const t = waTemplates[id] || { name: id, text: '' };
  const nameEl = document.getElementById('waTplName');
  const ta = document.getElementById('waTemplate');
  if (nameEl) nameEl.value = t.name || '';
  if (ta) ta.value = t.text || '';
}

async function persistWaTemplates() {
  await col('settings').doc('waTemplates').set({
    templates: waTemplates,
    defaultId: waDefaultTplId,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function saveWaTemplate() {
  ensureWaTemplates();
  const id = document.getElementById('waTplSelect')?.value || waActiveTplId || 'due';
  const name = (document.getElementById('waTplName')?.value || '').trim() || id;
  const text = (document.getElementById('waTemplate')?.value || '').trim();
  if (!text) { showToast('Template empty', true); return; }
  waTemplates[id] = { name, text };
  await persistWaTemplates();
  fillWaTplSelects();
  document.getElementById('waTplSelect').value = id;
  const st = document.getElementById('waTemplateStatus');
  if (st) st.textContent = '✓ Saved: ' + name;
  showToast('Template saved');
}

async function addWaTemplate() {
  const name = prompt('புதிய template பெயர் (எ.கா. Deepavali offer)');
  if (!name) return;
  const id = 'custom_' + Date.now().toString(36);
  ensureWaTemplates();
  waTemplates[id] = { name, text: 'வணக்கம் {name},\n\n' + name + '\n\nநன்றி.\nSmart Cable Manager' };
  await persistWaTemplates();
  fillWaTplSelects();
  document.getElementById('waTplSelect').value = id;
  onWaTplSelect();
  showToast('New template added');
}

async function deleteWaTemplate() {
  const id = document.getElementById('waTplSelect')?.value;
  if (!id) return;
  if (id === 'due') { showToast('Due template delete செய்ய முடியாது', true); return; }
  if (!confirm('இந்த template நீக்கவா?')) return;
  delete waTemplates[id];
  if (waDefaultTplId === id) waDefaultTplId = 'due';
  await persistWaTemplates();
  fillWaTplSelects();
  onWaTplSelect();
  showToast('Deleted');
}

async function saveWaDefaultTpl() {
  waDefaultTplId = document.getElementById('waDefaultTpl')?.value || 'due';
  await persistWaTemplates();
  showToast('Default send template set');
}

async function resetWaTemplate() {
  ensureWaTemplates();
  Object.keys(DEFAULT_WA_TEMPLATES).forEach(id => {
    waTemplates[id] = { name: DEFAULT_WA_NAMES[id], text: DEFAULT_WA_TEMPLATES[id] };
  });
  await persistWaTemplates();
  fillWaTplSelects();
  onWaTplSelect();
  showToast('Festival templates restored');
}

function getWaTemplateText(tplId) {
  ensureWaTemplates();
  const id = tplId || waDefaultTplId || 'due';
  return (waTemplates[id] && waTemplates[id].text) || DEFAULT_WA_TEMPLATES.due;
}

function buildDueMessage(name, due, tplId) {
  const month = getMonthNameTa();
  const dueStr = Number(due || 0).toLocaleString('en-IN');
  const co = companyInfo || {};
  const office = [co.phone, co.phone2].filter(Boolean).join(' / ') || '0452-2527545 / 8678953333';
  const gpay = co.gpay || '9442527545';
  let tpl = getWaTemplateText(tplId);
  return tpl
    .replace(/\{name\}/g, name || 'Customer')
    .replace(/\{month\}/g, month)
    .replace(/\{due\}/g, dueStr)
    .replace(/\{gpay\}/g, gpay)
    .replace(/\{office\}/g, office);
}

function openWhatsApp(mobile, name, due, tplId) {
  if (!mobile || mobile === '-' || mobile === '0') {
    showToast('No mobile number', true);
    return;
  }
  let num = String(mobile).replace(/\D/g, '');
  if (num.length === 10) num = '91' + num;
  if (num.length < 10) {
    showToast('Invalid mobile', true);
    return;
  }
  const useTpl = tplId || document.getElementById('waQueueTpl')?.value || waDefaultTplId || 'due';
  const text = encodeURIComponent(buildDueMessage(name || 'Customer', due, useTpl));
  window.open(`https://wa.me/${num}?text=${text}`, '_blank');
}


// WhatsApp queue for pending
let waQueue = [];
let waQueueIndex = 0;

function startWaQueue() {
  waQueue = (typeof getPendingFiltered === "function" ? getPendingFiltered() : allCustomers.filter(c => Number(c.dueAmt || c.due || 0) > 0))
    .filter(c => c.mobile && String(c.mobile).replace(/\D/g, '').length >= 10)
    .sort((a, b) => Number(b.dueAmt || b.due || 0) - Number(a.dueAmt || a.due || 0));
  waQueueIndex = 0;
  if (waQueue.length === 0) {
    showToast('Pending + valid mobile இல்லை', true);
    return;
  }
  const bar = document.getElementById('waQueueBar');
  if (bar) bar.classList.remove('hidden');
  sendNextWa(false);
}

function sendNextWa(advance) {
  if (advance) waQueueIndex++;
  if (waQueueIndex >= waQueue.length) {
    showToast('Queue முடிந்தது!');
    const bar = document.getElementById('waQueueBar');
    if (bar) bar.classList.add('hidden');
    return;
  }
  const c = waQueue[waQueueIndex];
  const due = Number(c.dueAmt || c.due || 0);
  const info = document.getElementById('waQueueInfo');
  if (info) info.textContent = `${waQueueIndex + 1} / ${waQueue.length} — ${c.name} — ₹${due}`;
  openWhatsApp(c.mobile, c.name, due, document.getElementById('waQueueTpl')?.value);
}

function skipWa() {
  sendNextWa(true);
}

// ==================== TOAST ====================

// ==================== STREET MASTER + AUTO CUST ID ====================
// Street ID codes from CableSoft Street Report (JSV S.Alangulam)
// No hardcoded street list — operators add their own streets via
// Setup → Streets. This starts empty for every new deployment.
const STREET_MASTER = [
];

function getStreetsForPlace(place) {
  // Prefer Firestore street master (streetMasterCache); fallback STREET_MASTER code list
  const src = (streetMasterCache && streetMasterCache.length)
    ? streetMasterCache
    : STREET_MASTER;
  const list = src.filter(s => s.place === place)
    .map(s => ({ place: s.place, street: s.street, streetId: s.streetId, id: s.id }));
  list.sort((a, b) => a.street.localeCompare(b.street, 'ta'));
  return list;
}

function guessStreetId(c) {
  // try extract letter prefix from existing custId on same street
  const same = allCustomers.filter(x => x.street === c.street && x.custId);
  for (const x of same) {
    const m = String(x.custId).match(/^([A-Z0-9]+?)(\d+[A-D]?)$/i);
    if (m) return m[1].toUpperCase();
  }
  return (c.street || 'X').replace(/\s+/g, '').slice(0, 3).toUpperCase();
}

function getStreetId(place, street) {
  // 1) Firestore-backed street master (streetMasterCache) — the real source
  //    of truth now that operators add their own streets via Setup → Streets.
  if (typeof streetMasterCache !== 'undefined' && streetMasterCache.length) {
    const m1 = streetMasterCache.find(s => s.place === place && s.street === street);
    if (m1 && m1.streetId) return m1.streetId;
  }
  // 2) legacy hardcoded list (empty by default, kept for backward compatibility)
  const m = STREET_MASTER.find(s => s.place === place && s.street === street);
  if (m) return m.streetId;
  const same = allCustomers.find(c => c.street === street && c.custId);
  if (same) return guessStreetId(same);
  return (street || 'X').replace(/\s+/g, '').slice(0, 3).toUpperCase();
}

function onPlaceSelect() {
  const place = document.getElementById('custPlace').value;
  const sel = document.getElementById('custStreet');
  if (!sel) return;
  sel.innerHTML = '<option value="">- Select Street -</option>';
  if (!place) return;
  getStreetsForPlace(place).forEach(s => {
    sel.innerHTML += `<option value="${s.street}" data-sid="${s.streetId}">${s.street} (${s.streetId})</option>`;
  });
  const idEl = document.getElementById('custCustId');
  if (idEl && !document.getElementById('editCustomerId').value) idEl.value = '';
}

function onStreetSelect() {
  const editId = document.getElementById('editCustomerId').value;
  // only auto-generate for NEW customers
  if (editId) return;
  const place = document.getElementById('custPlace').value;
  const street = document.getElementById('custStreet').value;
  if (!place || !street) return;
  const streetId = getStreetId(place, street);
  const suffix = (document.getElementById('custIdSuffix') || {}).value || '';
  const nextNum = getNextNumberForStreet(streetId, street);
  const newId = streetId + nextNum + suffix;
  const idEl = document.getElementById('custCustId');
  if (idEl) idEl.value = newId;
}

function getNextNumberForStreet(streetId, street) {
  let maxN = 0;
  const re = new RegExp('^' + streetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)', 'i');
  allCustomers.forEach(c => {
    const id = String(c.custId || '');
    // match same streetId prefix
    const m = id.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxN) maxN = n;
    } else if (c.street === street && id) {
      // fallback: trailing digits
      const m2 = id.match(/(\d+)/);
      if (m2) {
        const n = parseInt(m2[1], 10);
        if (n > maxN) maxN = n;
      }
    }
  });
  return maxN + 1;
}


// ==================== NEW CONNECTION BILLING SLAB ====================
// 1-10: full package now, auto due from next month
// 11-20: half package now, auto due from next month
// 21-31: full package now, auto due from month+2
function addMonths(ym, n) {
  // ym = 'YYYY-MM'
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function calcNewConnectionBilling() {
  // Scheme A: full package now, auto Month Due always from next month
  const conDate = (document.getElementById('custConDate') || {}).value || '';
  const pkgAmt = Number((document.getElementById('custPkgAmt') || {}).value || 0);
  const addonAmt = Number((document.getElementById('custAddonAmt') || {}).value || 0);
  const monthly = pkgAmt + addonAmt;
  const editId = (document.getElementById('editCustomerId') || {}).value || '';
  if (editId) return;
  if (!conDate) return;

  const ym = conDate.slice(0, 7);
  const billingStart = addMonths(ym, 1);
  const dueEl = document.getElementById('custDueAmt');
  if (dueEl && monthly > 0) dueEl.value = monthly;

  let hidden = document.getElementById('custBillingStart');
  if (!hidden) {
    hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.id = 'custBillingStart';
    document.getElementById('customerForm')?.appendChild(hidden);
  }
  hidden.value = billingStart;

  let tip = document.getElementById('billingSlabTip');
  if (!tip) {
    tip = document.createElement('p');
    tip.id = 'billingSlabTip';
    tip.className = 'text-xs text-blue-700 mt-1 sm:col-span-2';
    const dueWrap = dueEl?.parentElement;
    if (dueWrap) dueWrap.appendChild(tip);
  }
  tip.textContent = 'Scheme A: Full package now · Auto bill from next month (' + billingStart + ')';
}


function onPackageChange() {
  const sel = document.getElementById('custPackage');
  if (!sel) return;
  const opt = sel.options[sel.selectedIndex];
  const amt = opt && opt.dataset ? opt.dataset.amt : '';
  const pkgAmt = document.getElementById('custPkgAmt');
  if (pkgAmt && amt) pkgAmt.value = amt;
  recalcPackageTotal();
  calcNewConnectionBilling();
}

let currentAddons = [];

function renderAddonChips() {
  const box = document.getElementById('addonChips');
  if (!box) return;
  if (!currentAddons.length) {
    box.innerHTML = '<span class="text-xs text-slate-400">No add-ons</span>';
  } else {
    box.innerHTML = currentAddons.map((a, i) =>
      `<span class="inline-flex items-center gap-1 bg-blue-50 text-blue-800 text-xs px-2 py-1 rounded-full border border-blue-200">
        ${a.name} ₹${a.amount}
        <button type="button" onclick="removeAddon(${i})" class="text-red-500 font-bold ml-1">&times;</button>
      </span>`
    ).join('');
  }
  recalcPackageTotal();
}

function addCustomAddon() {
  const name = (document.getElementById('addonNameInput').value || '').trim();
  const amount = Number(document.getElementById('addonAmtInput').value || 0);
  if (!name) { showToast('Channel name type பண்ணுங்கள்', true); return; }
  if (!amount || amount <= 0) { showToast('Amount enter பண்ணுங்கள்', true); return; }
  currentAddons.push({ name, amount });
  document.getElementById('addonNameInput').value = '';
  document.getElementById('addonAmtInput').value = '';
  renderAddonChips();
}

function removeAddon(i) {
  currentAddons.splice(i, 1);
  renderAddonChips();
}

function getSelectedAddons() {
  const list = currentAddons.slice();
  const total = list.reduce((s, a) => s + Number(a.amount || 0), 0);
  return { list, total };
}

function recalcPackageTotal() {
  const pkgAmt = Number((document.getElementById('custPkgAmt') || {}).value || 0);
  const { list, total: addonAmt } = getSelectedAddons();
  const grand = pkgAmt + addonAmt;
  const ad = document.getElementById('addonTotalDisp');
  const pd = document.getElementById('pkgTotalDisp');
  const ha = document.getElementById('custAddons');
  const ham = document.getElementById('custAddonAmt');
  if (ad) ad.textContent = '₹' + addonAmt;
  if (pd) pd.textContent = '₹' + grand;
  if (ha) ha.value = JSON.stringify(list);
  if (ham) ham.value = String(addonAmt);

  const due = document.getElementById('custDueAmt');
  const editId = document.getElementById('editCustomerId');
  if (due && (!editId || !editId.value)) {
    due.value = grand > 0 ? grand : '';
  }
  calcNewConnectionBilling();
}

function setAddonsFromCustomer(c) {
  let addons = c.addons || [];
  if (typeof addons === 'string') {
    try { addons = JSON.parse(addons); } catch(e) { addons = []; }
  }
  if (!Array.isArray(addons)) addons = [];
  currentAddons = addons.map(a => ({
    name: a.name || String(a),
    amount: Number(a.amount != null ? a.amount : a.amt || 0)
  }));
  renderAddonChips();
}

async function bulkAddAddon() {
  const name = (document.getElementById('bulkAddonName').value || '').trim();
  const amount = Number(document.getElementById('bulkAddonAmt').value || 0);
  const area = document.getElementById('bulkAddonArea').value;
  if (!name || !amount) { showToast('Name + Amount தேவை', true); return; }
  if (!confirm((area === 'ALL' ? 'All Active' : area) + ' customers-க்கு\n' + name + ' ₹' + amount + ' சேர்க்கவா?')) return;

  const status = document.getElementById('bulkAddonStatus');
  if (status) { status.classList.remove('hidden'); status.textContent = 'Processing...'; }

  try {
    let targets = allCustomers.filter(c => (c.status || 'ACT') === 'ACT');
    if (area !== 'ALL') targets = targets.filter(c => (c.place || '') === area);
    let updated = 0;
    const BATCH = 400;
    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = db.batch();
      const chunk = targets.slice(i, i + BATCH);
      chunk.forEach(c => {
        let addons = c.addons || [];
        if (typeof addons === 'string') { try { addons = JSON.parse(addons); } catch(e) { addons = []; } }
        if (!Array.isArray(addons)) addons = [];
        // skip if already has same name
        if (addons.some(a => (a.name || '') === name)) return;
        addons.push({ name, amount });
        const addonAmt = addons.reduce((s, a) => s + Number(a.amount || 0), 0);
        const base = c.packageBase != null ? Number(c.packageBase) : Math.max(0, Number(c.packageAmt || 0) - Number(c.addonAmt || 0));
        batch.update(col('customers').doc(c.id), {
          addons,
          addonAmt,
          packageBase: base,
          packageAmt: base + addonAmt,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        updated++;
      });
      await batch.commit();
      if (status) status.textContent = updated + ' updated...';
    }
    await loadCustomers();
    showToast(updated + ' customers-க்கு ' + name + ' சேர்ந்தது');
    if (status) status.textContent = '✅ ' + updated + ' customers updated';
  } catch (e) {
    showToast('Error: ' + e.message, true);
    if (status) status.textContent = e.message;
  }
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden', 'bg-red-600', 'bg-slate-800');
  toast.classList.add(isError ? 'bg-red-600' : 'bg-slate-800');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ==================== GENERATE MONTH DUE ====================
async function generateMonthDue() {
  const btn = document.getElementById('genDueBtn');
  const status = document.getElementById('genDueStatus');
  const hint = document.getElementById('genDueHint');
  const ym = new Date().toISOString().slice(0, 7); // YYYY-MM
  const monthLabel = new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  try {
    const lockRef = col('settings').doc('monthBill');
    const lockSnap = await lockRef.get();
    const last = lockSnap.exists ? (lockSnap.data().lastGeneratedYM || '') : '';
    if (last === ym) {
      const when = lockSnap.data().generatedAt || '';
      showToast('இந்த மாதம் ஏற்கனவே generate ஆனது (' + monthLabel + ')', true);
      if (status) status.textContent = '✅ Already done for ' + monthLabel + (when ? ' · ' + when : '');
      if (btn) { btn.disabled = true; btn.textContent = 'Already Generated · ' + monthLabel; btn.classList.add('opacity-60'); }
      if (hint) hint.innerHTML = 'அடுத்த மாசம் 1ம் தேதிக்குப் பிறகு மீண்டும் press செய்யலாம்.';
      return;
    }

    if (!confirm('Next Month Bill generate?\n\n' + monthLabel + '\nActive customers-க்கு Package Amount Due-ல் சேரும்.\nமாதத்திற்கு ஒரு முறை மட்டும்.\n\nதொடரவா?')) return;

    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
    if (status) { status.classList.remove('hidden'); status.textContent = 'Loading customers...'; }

    // Fresh read
    const snap = await col('customers').get();
    const updates = [];
    snap.forEach(doc => {
      const d = doc.data();
      if ((d.status || 'ACT') !== 'ACT') return;
      const pkg = Number(d.packageAmt || d.package || 0);
      if (!pkg || pkg <= 0) return;
      const bs = d.billingStart || '';
      if (bs) {
        const nowYM = new Date().toISOString().slice(0, 7);
        if (nowYM < bs) return;
      }
      const currentDue = Number(d.dueAmt || d.due || 0);
      updates.push({ id: doc.id, newDue: currentDue + pkg, pkg, name: d.name });
    });

    if (updates.length === 0) {
      showToast('Update செய்ய Active + Package Amount customers இல்லை', true);
      if (btn) { btn.disabled = false; btn.textContent = 'Generate Next Month Bill'; }
      return;
    }

    if (status) status.textContent = updates.length + ' customers update ஆகிறது...';

    const BATCH_SIZE = 400;
    let done = 0;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = db.batch();
      updates.slice(i, i + BATCH_SIZE).forEach(u => {
        batch.update(col('customers').doc(u.id), {
          dueAmt: u.newDue,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      await batch.commit();
      done += updates.slice(i, i + BATCH_SIZE).length;
      if (status) status.textContent = done + ' / ' + updates.length + ' done...';
    }

    // Lock this month
    const nowStr = new Date().toLocaleString('en-IN');
    await lockRef.set({
      lastGeneratedYM: ym,
      generatedAt: nowStr,
      count: updates.length,
      generatedBy: (currentUser && currentUser.email) || ''
    }, { merge: true });

    await loadCustomers();
    showToast('Next Month Bill · ' + updates.length + ' customers');
    if (status) status.textContent = '✅ ' + updates.length + ' customers · Locked for ' + monthLabel;
    if (btn) { btn.disabled = true; btn.textContent = 'Already Generated · ' + monthLabel; btn.classList.add('opacity-60'); }
    if (hint) hint.innerHTML = 'அடுத்த மாசம் வரை மீண்டும் generate செய்ய முடியாது.';
  } catch (err) {
    console.error(err);
    showToast('Error: ' + err.message, true);
    if (status) status.textContent = 'Error: ' + err.message;
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Next Month Bill'; }
  }
}

async function refreshMonthBillLockUI() {
  const btn = document.getElementById('genDueBtn');
  const status = document.getElementById('genDueStatus');
  const hint = document.getElementById('genDueHint');
  if (!btn) return;
  try {
    const ym = new Date().toISOString().slice(0, 7);
    const monthLabel = new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' });
    const snap = await col('settings').doc('monthBill').get();
    if (snap.exists && snap.data().lastGeneratedYM === ym) {
      btn.disabled = true;
      btn.textContent = 'Already Generated · ' + monthLabel;
      btn.classList.add('opacity-60');
      if (status) status.textContent = '✅ Done for ' + monthLabel + (snap.data().generatedAt ? ' · ' + snap.data().generatedAt : '');
      if (hint) hint.innerHTML = 'அடுத்த மாசம் வரை மீண்டும் generate செய்ய முடியாது.';
    }
  } catch (e) {}
}


// ==================== BOX STOCK ====================
let allBoxes = [];
let boxListFilter = 'available';

async function upsertBoxStock(boxNo, data) {
  const q = await col('boxes').where('boxNo', '==', boxNo).limit(1).get();
  if (q.empty) {
    await col('boxes').add({
      boxNo,
      status: data.status || 'available',
      customerId: data.customerId || null,
      customerName: data.customerName || null,
      mso: data.mso || '',
      returnedAt: data.returnedAt || null,
      returnedFrom: data.returnedFrom || null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } else {
    await q.docs[0].ref.update({
      ...data,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
}

async function loadBoxes() {
  try {
    const snap = await col('boxes').get();
    allBoxes = [];
    snap.forEach(doc => allBoxes.push({ id: doc.id, ...doc.data() }));
    allBoxes.sort((a, b) => (a.boxNo || '').localeCompare(b.boxNo || '', undefined, { numeric: true }));
    updateBoxStats();
    renderBoxList(boxListFilter);
  } catch (e) {
    console.error(e);
    showToast('Boxes load error: ' + e.message, true);
  }
}

function updateBoxStats() {
  let avail = 0, assigned = 0, total = 0;
  if (allBoxes.length > 0) {
    avail = allBoxes.filter(b => b.status === 'available').length;
    assigned = allBoxes.filter(b => b.status === 'assigned').length;
    total = allBoxes.length;
  } else {
    // boxes not synced yet — show from customer list
    assigned = allCustomers.filter(c => c.boxNo && String(c.boxNo).trim()).length;
    avail = 0;
    total = assigned;
  }
  const el1 = document.getElementById('boxStockCount');
  const el2 = document.getElementById('boxAssignedCount');
  const el3 = document.getElementById('boxCountDisplay');
  if (el1) el1.textContent = avail;
  if (el2) el2.textContent = assigned;
  if (el3) el3.textContent = total;
}

function renderBoxList(filter) {
  boxListFilter = filter || boxListFilter;
  ['Avail', 'Assign', 'All'].forEach((t, i) => {
    const id = ['boxTabAvail', 'boxTabAssign', 'boxTabAll'][i];
    const el = document.getElementById(id);
    if (!el) return;
    const active = (filter === 'available' && i === 0) || (filter === 'assigned' && i === 1) || (filter === 'all' && i === 2);
    el.className = active ? 'px-3 py-1 rounded-lg bg-green-100 text-green-800 font-medium' : 'px-3 py-1 rounded-lg hover:bg-slate-100';
  });
  let list = allBoxes;
  if (filter === 'available') list = allBoxes.filter(b => b.status === 'available');
  if (filter === 'assigned') list = allBoxes.filter(b => b.status === 'assigned');
  const tbody = document.getElementById('boxTableBody');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-slate-400">No boxes</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(b => `
    <tr class="border-t border-slate-100">
      <td class="px-2 py-2 font-mono text-xs">${b.boxNo || '-'}</td>
      <td class="px-2 py-2 font-mono text-xs">${b.scNo || '-'}</td>
      <td class="px-2 py-2 text-xs">${b.mso || '-'}</td>
      <td class="px-2 py-2 text-xs">${b.boxType || '-'}</td>
      <td class="px-2 py-2"><span class="text-xs px-2 py-0.5 rounded ${b.status === 'available' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}">${b.status === 'available' ? 'In Stock' : (b.status || '-')}</span></td>
      <td class="px-2 py-2 text-xs">${b.customerName || '—'}</td>
    </tr>
  `).join('');
}

function clearBoxForm() {
  ['newBoxInvNo','newBoxName','newBoxScNo','newBoxNo'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const mso = document.getElementById('newBoxMso'); if (mso) mso.value = '';
  const pt = document.getElementById('newBoxPurType'); if (pt) pt.value = 'New';
  const bt = document.getElementById('newBoxType'); if (bt) bt.value = 'HD';
  const idate = document.getElementById('newBoxInvDate');
  if (idate) idate.value = new Date().toISOString().split('T')[0];
}

async function addBoxToStock() {
  const boxNo = (document.getElementById('newBoxNo').value || '').trim();
  const scNo = (document.getElementById('newBoxScNo').value || '').trim();
  const mso = (document.getElementById('newBoxMso').value || '').trim();
  const boxType = (document.getElementById('newBoxType') || {}).value || 'HD';
  const purType = (document.getElementById('newBoxPurType') || {}).value || 'New';
  const invNo = (document.getElementById('newBoxInvNo') || {}).value || '';
  const invDate = (document.getElementById('newBoxInvDate') || {}).value || '';
  const boxName = (document.getElementById('newBoxName') || {}).value || '';
  if (!boxNo) { showToast('Box Number enter பண்ணுங்கள்', true); return; }
  if (!scNo) { showToast('SC No enter பண்ணுங்கள்', true); return; }
  if (!mso) { showToast('MSO select பண்ணுங்கள்', true); return; }
  try {
    await upsertBoxStock(boxNo, {
      status: 'available',
      customerId: null,
      customerName: null,
      mso,
      boxType,
      scNo,
      boxName: boxName.trim(),
      purType,
      invNo: invNo.trim(),
      invDate,
      source: 'purchase'
    });
    clearBoxForm();
    showToast('Box ' + boxNo + ' (' + mso + ') saved → Store');
    await loadBoxes();
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

async function syncBoxesFromCustomers() {
  if (!confirm('Customer list-ல் box numbers-ஐ stock-ல் sync செய்யவா?\nWith Customers count update ஆகும்.')) return;
  try {
    showToast('Syncing... wait');
    // map existing boxNo -> docId
    const existing = new Map();
    allBoxes.forEach(b => { if (b.boxNo) existing.set(String(b.boxNo).trim().toUpperCase(), b.id); });
    let n = 0;
    const list = allCustomers.filter(c => (c.boxNo || '').trim());
    for (let i = 0; i < list.length; i += 400) {
      const chunk = list.slice(i, i + 400);
      const batch = db.batch();
      chunk.forEach(c => {
        const boxNo = String(c.boxNo).trim();
        const key = boxNo.toUpperCase();
        const st = (c.status || 'ACT') === 'ACT' ? 'assigned' : 'available';
        const data = {
          boxNo,
          status: st,
          customerId: st === 'assigned' ? c.id : null,
          customerName: st === 'assigned' ? (c.name || '') : null,
          mso: c.mso || '',
          scNo: c.scNo || c.smartCard || '',
          boxType: c.boxType || '',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (existing.has(key)) {
          batch.update(col('boxes').doc(existing.get(key)), data);
        } else {
          const ref = col('boxes').doc();
          data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
          data.source = 'customer-sync';
          batch.set(ref, data);
          existing.set(key, ref.id);
        }
        n++;
      });
      await batch.commit();
    }
    showToast('Synced ' + n + ' boxes → With Customers');
    await loadBoxes();
    updateDashboardStats();
  } catch (e) {
    showToast('Sync error: ' + e.message, true);
  }
}

async function importMsoBoxList() {
  const mso = (document.getElementById('importBoxMso') || {}).value || '';
  const boxType = (document.getElementById('importBoxType') || {}).value || 'HD';
  const text = (document.getElementById('importBoxText') || {}).value || '';
  const statusEl = document.getElementById('importBoxStatus');
  if (!mso) { showToast('MSO select பண்ணுங்கள்', true); return; }
  if (!text.trim()) { showToast('Box list paste பண்ணுங்கள்', true); return; }

  // parse lines: boxNo OR boxNo,scNo OR tab-separated
  const rows = [];
  text.split(/\r?\n/).forEach(line => {
    line = line.trim();
    if (!line) return;
    // skip headers
    if (/^(box|stb|serial|s\.?no|sc\s*no|smart)/i.test(line)) return;
    let boxNo = '', scNo = '';
    if (line.includes('\t')) {
      const p = line.split('\t').map(x => x.trim()).filter(Boolean);
      boxNo = p[0] || '';
      scNo = p[1] || '';
    } else if (line.includes(',')) {
      const p = line.split(',').map(x => x.trim()).filter(Boolean);
      boxNo = p[0] || '';
      scNo = p[1] || '';
    } else {
      // spaces: last token might be sc - prefer single token as box
      const p = line.split(/\s+/).filter(Boolean);
      boxNo = p[0] || '';
      if (p.length >= 2) scNo = p[p.length - 1];
    }
    boxNo = boxNo.replace(/[^a-zA-Z0-9]/g, '');
    if (boxNo.length >= 4) rows.push({ boxNo, scNo });
  });

  if (!rows.length) { showToast('Valid box numbers கிடைக்கவில்லை', true); return; }

  // customer map by boxNo
  const custByBox = new Map();
  allCustomers.forEach(c => {
    const b = String(c.boxNo || '').trim().toUpperCase();
    if (b) custByBox.set(b, c);
  });

  await loadBoxes();
  const existing = new Map();
  allBoxes.forEach(b => {
    if (b.boxNo) existing.set(String(b.boxNo).trim().toUpperCase(), b.id);
  });

  let assigned = 0, stock = 0, updated = 0;
  if (statusEl) statusEl.textContent = 'Importing ' + rows.length + ' boxes...';

  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    const batch = db.batch();
    chunk.forEach(({ boxNo, scNo }) => {
      const key = boxNo.toUpperCase();
      const cust = custByBox.get(key);
      const isAssigned = !!cust && (cust.status || 'ACT') === 'ACT';
      const data = {
        boxNo,
        mso,
        boxType,
        scNo: scNo || (cust && (cust.scNo || cust.smartCard)) || '',
        status: isAssigned ? 'assigned' : 'available',
        customerId: isAssigned ? cust.id : null,
        customerName: isAssigned ? (cust.name || '') : null,
        source: 'mso-import',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (isAssigned) assigned++; else stock++;
      if (existing.has(key)) {
        batch.update(col('boxes').doc(existing.get(key)), data);
        updated++;
      } else {
        const ref = col('boxes').doc();
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        batch.set(ref, data);
        existing.set(key, ref.id);
      }
    });
    await batch.commit();
  }

  const msg = 'Import OK · Match(Customers): ' + assigned + ' · Store: ' + stock + ' · Total lines: ' + rows.length;
  showToast(msg);
  if (statusEl) statusEl.textContent = msg;
  document.getElementById('importBoxText').value = '';
  await loadBoxes();
  updateDashboardStats();
}



// ==================== STREET MASTER (Firestore) ====================
let streetMasterCache = [];
let streetMasterFilter = 'ALL';

async function loadStreetMaster() {
  try {
    const snap = await col('streets').get();
    streetMasterCache = [];
    snap.forEach(doc => streetMasterCache.push({ id: doc.id, ...doc.data() }));
    streetMasterCache.sort((a, b) => {
      const p = (a.place || '').localeCompare(b.place || '');
      if (p) return p;
      return (a.street || '').localeCompare(b.street || '', 'ta');
    });
    renderStreetMasterTable();
  } catch (e) {
    console.error(e);
    showToast('Street load error: ' + e.message, true);
  }
}

function filterStreetMaster(f) {
  streetMasterFilter = f || 'ALL';
  const bar = document.getElementById('stFilterBar');
  if (bar) {
    Array.from(bar.querySelectorAll('button')).forEach(btn => {
      const on = btn.dataset.filterVal === streetMasterFilter;
      btn.className = on ? 'px-3 py-1 rounded-lg bg-slate-200 font-medium' : 'px-3 py-1 rounded-lg hover:bg-slate-100';
    });
  }
  // sync form place dropdown when filtering by a specific area
  const placeSel = document.getElementById('mstPlace');
  if (placeSel && streetMasterFilter !== 'ALL') {
    placeSel.value = streetMasterFilter;
  }
  renderStreetMasterTable();
}

function renderStreetMasterTable() {
  const tbody = document.getElementById('streetMasterBody');
  if (!tbody) return;
  let list = streetMasterCache;
  if (streetMasterFilter !== 'ALL') list = list.filter(s => s.place === streetMasterFilter);
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-slate-400">No streets — add your streets below</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(s => `
    <tr class="border-t">
      <td class="px-3 py-2 text-xs">${s.place || ''}</td>
      <td class="px-3 py-2 text-sm">${s.street || ''}</td>
      <td class="px-3 py-2 font-mono text-xs">${s.streetId || ''}</td>
      <td class="px-3 py-2">
        <button type="button" onclick="editStreetMaster('${s.id}')" class="text-blue-600 text-xs mr-2">Edit</button>
        <button type="button" onclick="deleteStreetMaster('${s.id}')" class="text-red-600 text-xs">Del</button>
      </td>
    </tr>
  `).join('');
}

function clearStreetForm() {
  document.getElementById('editStreetDocId').value = '';
  document.getElementById('mstStreet').value = '';
  document.getElementById('mstStreetId').value = '';
}

function editStreetMaster(id) {
  const s = streetMasterCache.find(x => x.id === id);
  if (!s) return;
  document.getElementById('editStreetDocId').value = id;
  document.getElementById('mstPlace').value = s.place || '';
  document.getElementById('mstStreet').value = s.street || '';
  document.getElementById('mstStreetId').value = s.streetId || '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveStreetMaster() {
  const place = document.getElementById('mstPlace').value;
  const street = (document.getElementById('mstStreet').value || '').trim();
  const streetId = (document.getElementById('mstStreetId').value || '').trim().toUpperCase();
  const editId = document.getElementById('editStreetDocId').value;
  if (!street || !streetId) { showToast('Street + Street ID தேவை', true); return; }
  try {
    const data = { place, street, streetId, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    if (editId) {
      await col('streets').doc(editId).update(data);
      showToast('Street updated');
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await col('streets').add(data);
      showToast('Street added');
    }
    clearStreetForm();
    await loadStreetMaster();
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

async function deleteStreetMaster(id) {
  if (!confirm('Delete this street?')) return;
  try {
    await col('streets').doc(id).delete();
    showToast('Deleted');
    await loadStreetMaster();
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

async function seedStreetsFromCode() {
  if (!confirm('CableSoft official street list import?\n\nOLD streets in Firestore DELETE ஆகும்.\nExact 90 streets மட்டும் சேரும்.')) return;
  try {
    await loadStreetMaster();
    // delete all existing
    let del = 0;
    for (let i = 0; i < streetMasterCache.length; i += 400) {
      const batch = db.batch();
      streetMasterCache.slice(i, i + 400).forEach(s => {
        if (s.id) { batch.delete(col('streets').doc(s.id)); del++; }
      });
      await batch.commit();
    }
    let n = 0;
    for (let i = 0; i < STREET_MASTER.length; i += 400) {
      const batch = db.batch();
      STREET_MASTER.slice(i, i + 400).forEach(s => {
        const ref = col('streets').doc();
        batch.set(ref, {
          place: s.place,
          street: s.street,
          streetId: s.streetId,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        n++;
      });
      await batch.commit();
    }
    showToast('Deleted ' + del + ' · Imported ' + n + ' official streets');
    await loadStreetMaster();
  } catch (e) {
    showToast('Import error: ' + e.message, true);
  }
}

// preload streets after login customers load

function openMastersPanel(panel) {
  showPage('masters');
  setTimeout(function() {
    if (typeof showMasterPanel === 'function') showMasterPanel(panel);
  }, 50);
  try { if (window.innerWidth < 1024) toggleSidebar(); } catch(e) {}
}

function showMasterPanel(name) {
  const hub = document.getElementById('mastersHub');
  document.querySelectorAll('.master-panel').forEach(p => p.classList.add('hidden'));
  if (!name) {
    if (hub) hub.classList.remove('hidden');
    return;
  }
  if (hub) hub.classList.add('hidden');
  const panel = document.getElementById('masterPanel-' + name);
  if (panel) panel.classList.remove('hidden');
  if (name === 'street') loadStreetMaster();
  if (name === 'package') loadPackageMaster();
  if (name === 'mso') loadMsoMaster();
  if (name === 'company') loadCompanyInfo();
  if (name === 'place') loadPlacesMaster();
  if (name === 'employee') loadEmployees();
  if (name === 'importcust') resetImportUI();
}

let placesMasterCache = [];

async function loadPlacesMaster() {
  const list = document.getElementById('placeMasterList');
  if (list) list.innerHTML = '<li class="px-3 py-3 text-slate-400 text-center">Loading...</li>';
  try {
    const snap = await col('places').get();
    placesMasterCache = [];
    snap.forEach(doc => placesMasterCache.push({ id: doc.id, ...doc.data() }));
    placesMasterCache.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } catch (e) {
    console.error('loadPlacesMaster', e);
    placesMasterCache = [];
  }
  renderPlaceMasterList();
  populateAreaSelects();
}

function renderPlaceMasterList() {
  const list = document.getElementById('placeMasterList');
  if (!list) return;
  if (!placesMasterCache.length) {
    list.innerHTML = '<li class="px-3 py-6 text-slate-400 text-center text-xs">இன்னும் area எதுவும் add பண்ணவில்லை. மேலே பெயர் போட்டு Save பண்ணுங்கள்.</li>';
    return;
  }
  list.innerHTML = placesMasterCache.map(p => `
    <li class="px-3 py-2.5 flex items-center justify-between">
      <span>${p.name}</span>
      <button type="button" onclick="deletePlaceMaster('${p.id}')" class="text-xs text-red-600">Delete</button>
    </li>`).join('');
}

async function savePlaceMaster() {
  const nameEl = document.getElementById('mstPlaceName');
  const name = (nameEl?.value || '').trim();
  if (!name) { showToast('Area பெயர் போடுங்கள்', true); return; }
  if (placesMasterCache.some(p => (p.name || '').toUpperCase() === name.toUpperCase())) {
    showToast('இந்த area ஏற்கனவே இருக்கு', true);
    return;
  }
  try {
    await col('places').add({ name, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    if (nameEl) nameEl.value = '';
    showToast('Area added');
    await loadPlacesMaster();
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

async function deletePlaceMaster(id) {
  if (!confirm('இந்த area-ஐ delete பண்ணவா? (இந்த area-வுல இருக்கும் customers/streets பாதிக்கப்படாது, ஆனா dropdown-ல் இனி தெரியாது)')) return;
  try {
    await col('places').doc(id).delete();
    showToast('Deleted');
    await loadPlacesMaster();
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

// Populate every area/place <select data-area-select> from placesMasterCache,
// preserving each select's own leading placeholder/"All" option(s).
function populateAreaSelects() {
  document.querySelectorAll('select[data-area-select]').forEach(sel => {
    const keep = Array.from(sel.options).filter(o => !o.dataset || !o.dataset.dynamicArea);
    // Remove any previously-added dynamic options, keep the original leading option(s)
    const leading = Array.from(sel.options).filter(o => o.dataset && o.dataset.dynamicArea ? false : true);
    sel.innerHTML = '';
    leading.forEach(o => sel.appendChild(o));
    placesMasterCache.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      opt.dataset.dynamicArea = '1';
      sel.appendChild(opt);
    });
  });

  // Rebuild the Street Master area-filter button bar to match configured areas
  const bar = document.getElementById('stFilterBar');
  if (bar) {
    const allBtn = bar.querySelector('#stFilterAll');
    bar.innerHTML = '';
    if (allBtn) bar.appendChild(allBtn);
    placesMasterCache.forEach(p => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'px-3 py-1 rounded-lg hover:bg-slate-100';
      btn.dataset.filterVal = p.name;
      btn.textContent = p.name;
      btn.onclick = () => filterStreetMaster(p.name);
      bar.appendChild(btn);
    });
  }
}

// ==================== IMPORT CUSTOMERS (EXCEL / CSV) ====================
const IMPORT_TEMPLATE_HEADERS = [
  'Name', 'Mobile', 'Area', 'Street', 'Customer ID', 'MSO',
  'Box No', 'Smart Card No', 'Box Type', 'Package Name',
  'Package Amount', 'Due Amount', 'Connection Date', 'Remarks'
];

// Flexible header aliases so real-world exports (different wording/case)
// still map correctly onto our fields.
const IMPORT_FIELD_ALIASES = {
  name: ['name', 'customer name', 'customername', 'cust name'],
  mobile: ['mobile', 'phone', 'mobile no', 'mobileno', 'contact', 'phone no', 'mobile number', 'ph no', 'mob'],
  place: ['area', 'place', 'place / area', 'zone'],
  street: ['street', 'street name', 'address', 'road'],
  custId: ['customer id', 'custid', 'cust id', 'id', 'subscriber id', 's.no', 'sno', 's no', 'sl no', 'sl.no', 'serial no', 'account no', 'accountno', 'account number', 'customer no', 'customerno', 'cust no', 'reg no', 'regno', 'code', 'ref no', 'c id no', 'cid no', 'c id', 'cid'],
  mso: ['mso', 'mso code', 'operator code'],
  boxNo: ['box no', 'boxno', 'stb no', 'stb number', 'box number', 'stb', 'settop box no', 'set top box'],
  scNo: ['smart card no', 'sc no', 'scno', 'smart card', 'sc'],
  boxType: ['box type', 'boxtype', 'hd/sd', 'type'],
  package: ['package name', 'package', 'plan', 'plan name'],
  packageAmt: ['package amount', 'amount', 'plan amount', 'monthly amount'],
  dueAmt: ['due amount', 'due', 'balance', 'outstanding'],
  conDate: ['connection date', 'condate', 'joining date', 'install date'],
  remarks: ['remarks', 'notes', 'comment', 'comments', 'cut date']
};

let importParsedRows = [];   // raw objects straight from the sheet
let importMappedRows = [];   // normalized to our field names

function resetImportUI() {
  importParsedRows = [];
  importMappedRows = [];
  const fileEl = document.getElementById('importCustFile');
  if (fileEl) fileEl.value = '';
  document.getElementById('importPreviewWrap')?.classList.add('hidden');
  document.getElementById('importResultWrap')?.classList.add('hidden');
}

function downloadImportTemplate() {
  const sample = [
    IMPORT_TEMPLATE_HEADERS,
    ['Ravi Kumar', '9876543210', 'AREA 1', 'Main Street', '', 'MSO001', 'BOX1001', 'SC1001', 'HD', 'PLAN 300', '300', '0', '2026-01-15', '']
  ];
  const ws = XLSX.utils.aoa_to_sheet(sample);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Customers');
  XLSX.writeFile(wb, 'customer_import_template.xlsx');
}

function normalizeHeaderKey(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function mapRowToFields(row) {
  // row: object keyed by original sheet headers
  const out = {};
  const lowerKeyMap = {};
  Object.keys(row).forEach(k => { lowerKeyMap[normalizeHeaderKey(k)] = row[k]; });
  Object.keys(IMPORT_FIELD_ALIASES).forEach(field => {
    const aliases = IMPORT_FIELD_ALIASES[field];
    for (const a of aliases) {
      if (lowerKeyMap[a] !== undefined && String(lowerKeyMap[a]).trim() !== '') {
        out[field] = String(lowerKeyMap[a]).trim();
        return;
      }
    }
    out[field] = '';
  });
  return out;
}

function handleImportFile(evt) {
  const file = evt.target.files && evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array', cellStyles: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      importParsedRows = rows;
      importMappedRows = rows.map(mapRowToFields);
      detectStreetColumnColors(sheet);
      renderImportPreview();
    } catch (err) {
      showToast('File படிக்க முடியவில்லை: ' + err.message, true);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ---- Color-coded collector/area detection ----
// Some operators mark which field-collector handles a street by coloring
// that cell in Excel (instead of a text column). We read each row's Street
// cell background color, group rows by color, and let the admin type a
// name (collector/area) for each color group before import.
let importRowColors = [];      // parallel array to importMappedRows: '#rrggbb' or null
let importColorGroups = {};    // '#rrggbb' -> { count, sampleStreet }
let importColorLabels = {};    // '#rrggbb' -> area/collector name typed by admin

function detectStreetColumnColors(sheet) {
  importRowColors = [];
  importColorGroups = {};
  importColorLabels = {};
  const ref = sheet['!ref'];
  if (!ref || typeof XLSX === 'undefined') return;
  const range = XLSX.utils.decode_range(ref);
  let streetColIdx = -1;
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
    const cell = sheet[addr];
    if (cell && cell.v) {
      const key = normalizeHeaderKey(cell.v);
      if (IMPORT_FIELD_ALIASES.street.includes(key)) { streetColIdx = c; break; }
    }
  }
  if (streetColIdx === -1) return;
  for (let i = 0; i < importMappedRows.length; i++) {
    const r = range.s.r + 1 + i;
    const addr = XLSX.utils.encode_cell({ r, c: streetColIdx });
    const cell = sheet[addr];
    let color = null;
    try {
      const rgb = cell && cell.s && cell.s.fgColor && cell.s.fgColor.rgb;
      // ignore white / no-fill so "uncoloured" rows stay ungrouped
      if (rgb && !/^(00)?FFFFFF$/i.test(rgb.slice(-6)) && rgb !== '00000000') {
        color = '#' + rgb.slice(-6).toUpperCase();
      }
    } catch (e) {}
    importRowColors.push(color);
    if (color) {
      if (!importColorGroups[color]) importColorGroups[color] = { count: 0, sampleStreet: importMappedRows[i].street || '' };
      importColorGroups[color].count++;
    }
  }
}

function renderColorGroupUI() {
  const wrap = document.getElementById('importColorWrap');
  const body = document.getElementById('importColorBody');
  if (!wrap || !body) return;
  const colors = Object.keys(importColorGroups).filter(c => importColorGroups[c].count >= 3);
  if (!colors.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  body.innerHTML = colors.map(c => `
    <div class="flex items-center gap-2 mb-2">
      <span class="w-6 h-6 rounded border flex-shrink-0" style="background:${c}"></span>
      <span class="text-xs text-slate-500 w-20 flex-shrink-0">${importColorGroups[c].count} rows</span>
      <input type="text" placeholder="Area/Collector name (எ.கா PREM)" data-color="${c}" class="import-color-label flex-1 px-2 py-1.5 border rounded-lg text-sm" oninput="importColorLabels['${c}']=this.value">
    </div>`).join('') +
    `<div class="flex items-center gap-2 mb-1">
      <span class="w-6 h-6 rounded border flex-shrink-0 bg-white"></span>
      <span class="text-xs text-slate-500 w-20 flex-shrink-0">colour இல்லாதவை</span>
      <input type="text" placeholder="எ.கா GPAY (optional)" data-color="none" class="import-color-label flex-1 px-2 py-1.5 border rounded-lg text-sm" oninput="importColorLabels['none']=this.value">
    </div>`;
}

function renderImportPreview() {
  const wrap = document.getElementById('importPreviewWrap');
  const head = document.getElementById('importPreviewHead');
  const body = document.getElementById('importPreviewBody');
  const cntEl = document.getElementById('importRowCount');
  if (!wrap || !head || !body) return;
  if (!importMappedRows.length) {
    wrap.classList.add('hidden');
    showToast('File-ல் data எதுவும் இல்லை', true);
    return;
  }
  wrap.classList.remove('hidden');
  document.getElementById('importResultWrap')?.classList.add('hidden');
  if (cntEl) cntEl.textContent = importMappedRows.length + ' rows';
  renderColorGroupUI();
  const cols = ['name', 'mobile', 'custId', 'place', 'street', 'boxNo', 'package', 'dueAmt'];
  head.innerHTML = '<tr>' + cols.map(c => `<th class="px-2 py-1.5 text-left font-medium">${c}</th>`).join('') + '</tr>';
  body.innerHTML = importMappedRows.slice(0, 8).map(r => {
    const missing = !r.name || !r.mobile;
    return `<tr class="border-t ${missing ? 'bg-red-50' : ''}">` +
      cols.map(c => {
        const val = c === 'boxNo' ? (r.boxNo || r.scNo || '') : r[c];
        return `<td class="px-2 py-1.5">${val || '-'}</td>`;
      }).join('') + '</tr>';
  }).join('') + (importMappedRows.length > 8 ? `<tr><td colspan="${cols.length}" class="px-2 py-1.5 text-center text-slate-400">+ ${importMappedRows.length - 8} more rows</td></tr>` : '');
}

async function runCustomerImport() {
  if (!importMappedRows.length) return;
  const btn = document.getElementById('importRunBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Importing...'; }
  let added = 0, skipped = 0, errors = 0;
  let placesCreated = 0, streetsCreated = 0;
  const skipReasons = [];

  // Apply the color→area/collector labels (if the admin typed any) onto
  // each row's place, BEFORE the place/street auto-create step below runs.
  if (importRowColors && importRowColors.length === importMappedRows.length) {
    importMappedRows.forEach((r, i) => {
      const color = importRowColors[i];
      const label = color ? (importColorLabels[color] || '') : (importColorLabels['none'] || '');
      if (label && label.trim()) r.place = label.trim();
    });
  }

  // Make sure we have the latest Place/Street masters before checking
  // what's missing.
  try { if (typeof loadPlacesMaster === 'function') await loadPlacesMaster(); } catch (e) {}
  try { if (typeof loadStreetMaster === 'function') await loadStreetMaster(); } catch (e) {}

  const existingPlaceNames = new Set((placesMasterCache || []).map(p => String(p.name || '').toUpperCase().trim()));
  const existingStreetKeys = new Set((streetMasterCache || []).map(s => (s.place || '').toUpperCase().trim() + '||' + (s.street || '').toUpperCase().trim()));
  const usedStreetIds = new Set((streetMasterCache || []).map(s => String(s.streetId || '').toUpperCase().trim()).filter(Boolean));

  function makeStreetIdCode(streetName) {
    let base = String(streetName || 'ST').replace(/\s+/g, '').replace(/[^A-Za-z0-9அ-ஹ]/g, '').slice(0, 3).toUpperCase() || 'STR';
    let code = base, n = 1;
    while (usedStreetIds.has(code)) { n++; code = base + n; }
    usedStreetIds.add(code);
    return code;
  }

  // Auto-create any Area / Street combinations from the file that don't
  // exist yet in the masters, so the operator doesn't have to pre-type
  // every street by hand before importing.
  for (const r of importMappedRows) {
    const place = (r.place || '').trim();
    const street = (r.street || '').trim();
    if (!place && !street) continue;

    if (place) {
      const placeKey = place.toUpperCase();
      if (!existingPlaceNames.has(placeKey)) {
        try {
          await col('places').add({ name: place, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
          existingPlaceNames.add(placeKey);
          placesCreated++;
        } catch (e) { console.error('auto-create place failed', e); }
      }
    }
    if (place && street) {
      const streetKey = place.toUpperCase() + '||' + street.toUpperCase();
      if (!existingStreetKeys.has(streetKey)) {
        const streetId = makeStreetIdCode(street);
        try {
          await col('streets').add({
            place, street, streetId,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          streetMasterCache.push({ place, street, streetId });
          existingStreetKeys.add(streetKey);
          streetsCreated++;
        } catch (e) { console.error('auto-create street failed', e); }
      }
    }
  }
  // Refresh caches + dropdowns now that new places/streets may exist
  try { if (typeof loadPlacesMaster === 'function') await loadPlacesMaster(); } catch (e) {}
  try { if (typeof loadStreetMaster === 'function') await loadStreetMaster(); } catch (e) {}

  for (const r of importMappedRows) {
    if (!r.name || !r.mobile) {
      skipped++;
      skipReasons.push((r.name || '(no name)') + ' — Name/Mobile missing');
      continue;
    }
    try {
      const place = r.place || '';
      const street = r.street || '';
      let custId = r.custId || '';
      if (!custId && place && street) {
        try {
          const streetId = getStreetId(place, street);
          const nextNum = getNextNumberForStreet(streetId, street);
          custId = streetId + nextNum;
        } catch (ge) { /* leave custId blank if generation fails */ }
      }
      // Some operators only track one identifier (Smart Card No) and use it
      // as their effective Box/STB number too — if the file has no separate
      // Box No column, fall back to Smart Card No so nothing gets lost.
      const boxNoVal = r.boxNo || r.scNo || '';
      const data = {
        name: r.name,
        mobile: r.mobile,
        place,
        street,
        custId,
        mso: r.mso || '',
        boxNo: boxNoVal,
        scNo: r.scNo || '',
        smartCard: r.scNo || '',
        boxType: r.boxType || 'SD',
        package: r.package || '',
        packageAmt: Number(r.packageAmt) || 0,
        packageBase: Number(r.packageAmt) || 0,
        dueAmt: Number(r.dueAmt) || 0,
        conDate: r.conDate || '',
        status: 'ACT',
        sms: 'Yes',
        signal: 'Digital',
        remarks: r.remarks || '',
        importedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await col('customers').add(data);
      added++;
    } catch (e) {
      errors++;
      skipReasons.push((r.name || '') + ' — Error: ' + e.message);
    }
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Import Now'; }
  const resultWrap = document.getElementById('importResultWrap');
  const resultText = document.getElementById('importResultText');
  if (resultWrap && resultText) {
    resultWrap.classList.remove('hidden');
    resultText.innerHTML =
      `<div class="text-emerald-700 font-medium">✓ Added: ${added}</div>` +
      (placesCreated ? `<div class="text-blue-700">புது Areas created: ${placesCreated}</div>` : '') +
      (streetsCreated ? `<div class="text-blue-700">புது Streets created: ${streetsCreated}</div>` : '') +
      `<div class="text-amber-700">Skipped: ${skipped}</div>` +
      (errors ? `<div class="text-red-600">Errors: ${errors}</div>` : '') +
      (skipReasons.length ? `<div class="mt-2 text-xs text-slate-500 max-h-32 overflow-y-auto">${skipReasons.slice(0, 20).map(s => '• ' + s).join('<br>')}</div>` : '');
  }
  showToast('Import முடிந்தது · Added: ' + added);
  await loadCustomers();
  if (typeof loadDashboard === 'function') loadDashboard();
}

async function loadPackageMaster() {
  const snap = await col('packages').orderBy('amount').get().catch(() => col('packages').get());
  packageMasterCache = [];
  (snap.forEach ? snap : { forEach: () => {} });
  snap.forEach(doc => packageMasterCache.push({ id: doc.id, ...doc.data() }));
  packageMasterCache.sort((a,b) => Number(a.amount||0) - Number(b.amount||0));
  const tbody = document.getElementById('packageMasterBody');
  if (!tbody) return;
  tbody.innerHTML = packageMasterCache.map(p => `
    <tr class="border-t">
      <td class="px-3 py-2">${p.name||''}</td>
      <td class="px-3 py-2">₹${p.amount||0}</td>
      <td class="px-3 py-2">
        <button type="button" class="text-blue-600 text-xs mr-2" onclick="editPackageMaster('${p.id}')">Edit</button>
        <button type="button" class="text-red-600 text-xs" onclick="deletePackageMaster('${p.id}')">Del</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="3" class="text-center py-4 text-slate-400">Empty — Import 100–600</td></tr>';
  refreshCustomerPackageDropdown();
}

function editPackageMaster(id) {
  const p = packageMasterCache.find(x => x.id === id);
  if (!p) return;
  document.getElementById('editPkgDocId').value = id;
  document.getElementById('mstPkgName').value = p.name || '';
  document.getElementById('mstPkgAmt').value = p.amount || '';
}

async function savePackageMaster() {
  const name = (document.getElementById('mstPkgName').value||'').trim();
  const amount = Number(document.getElementById('mstPkgAmt').value||0);
  const editId = document.getElementById('editPkgDocId').value;
  if (!name || !amount) { showToast('Name + Amount', true); return; }
  if (editId) await col('packages').doc(editId).update({ name, amount });
  else await col('packages').add({ name, amount, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  document.getElementById('editPkgDocId').value = '';
  document.getElementById('mstPkgName').value = '';
  document.getElementById('mstPkgAmt').value = '';
  showToast('Package saved');
  await loadPackageMaster();
}

async function deletePackageMaster(id) {
  if (!confirm('Delete package?')) return;
  await col('packages').doc(id).delete();
  await loadPackageMaster();
}

async function seedPackages() {
  if (!confirm('PLAN 100–600 import?')) return;
  const amts = [100,150,180,200,220,230,250,260,275,280,290,300,305,310,315,325,350,380,400,450,500,550,600];
  await loadPackageMaster();
  const have = new Set(packageMasterCache.map(p => p.name));
  for (const a of amts) {
    const name = 'PLAN ' + a;
    if (have.has(name)) continue;
    await col('packages').add({ name, amount: a });
  }
  showToast('Packages imported');
  await loadPackageMaster();
}

function refreshCustomerPackageDropdown() {
  const sel = document.getElementById('custPackage');
  if (!sel || !packageMasterCache.length) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Select Package</option>' +
    packageMasterCache.map(p => `<option value="${p.name}" data-amt="${p.amount}">${p.name}</option>`).join('');
  if (cur) sel.value = cur;
}

async function loadMsoMaster() {
  const snap = await col('msos').get();
  msoMasterCache = [];
  snap.forEach(doc => msoMasterCache.push({ id: doc.id, ...doc.data() }));
  msoMasterCache.sort((a,b) => (a.name||'').localeCompare(b.name||''));
  const tbody = document.getElementById('msoMasterBody');
  if (!tbody) return;
  tbody.innerHTML = msoMasterCache.map(m => `
    <tr class="border-t">
      <td class="px-3 py-2 font-mono text-sm">${m.name||''}</td>
      <td class="px-3 py-2">
        <button type="button" class="text-blue-600 text-xs mr-2" onclick="editMsoMaster('${m.id}')">Edit</button>
        <button type="button" class="text-red-600 text-xs" onclick="deleteMsoMaster('${m.id}')">Del</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="2" class="text-center py-4 text-slate-400">Empty — add your MSOs above</td></tr>';
  refreshCustomerMsoDropdown();
}

function editMsoMaster(id) {
  const m = msoMasterCache.find(x => x.id === id);
  if (!m) return;
  document.getElementById('editMsoDocId').value = id;
  document.getElementById('mstMsoName').value = m.name || '';
}

async function saveMsoMaster() {
  const name = (document.getElementById('mstMsoName').value||'').trim();
  const editId = document.getElementById('editMsoDocId').value;
  if (!name) { showToast('MSO name', true); return; }
  if (editId) await col('msos').doc(editId).update({ name });
  else await col('msos').add({ name });
  document.getElementById('editMsoDocId').value = '';
  document.getElementById('mstMsoName').value = '';
  showToast('MSO saved');
  await loadMsoMaster();
}

async function deleteMsoMaster(id) {
  if (!confirm('Delete MSO?')) return;
  await col('msos').doc(id).delete();
  await loadMsoMaster();
}

async function seedMso() {
  // No hardcoded MSO codes — this button now just refreshes the list.
  // Add your own MSOs via the form above.
  await loadMsoMaster();
  showToast('Add your MSO codes using the form above');
}

function refreshCustomerMsoDropdown() {
  const sel = document.getElementById('custMSO');
  if (!sel || !msoMasterCache.length) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">- Select MSO -</option>' +
    msoMasterCache.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
  if (cur) sel.value = cur;
}

let companyInfo = {
  name: 'My Cable Network',
  address: '',
  phone: '',
  phone2: '',
  gpay: ''
};


function setCompanyEditMode(on) {
  document.querySelectorAll('.co-field').forEach(el => {
    el.readOnly = !on;
    el.classList.toggle('bg-slate-50', !on);
    el.classList.toggle('bg-white', on);
  });
  const edit = document.getElementById('coEditBtn');
  const save = document.getElementById('coSaveBtn');
  const cancel = document.getElementById('coCancelBtn');
  if (edit) edit.classList.toggle('hidden', on);
  if (save) save.classList.toggle('hidden', !on);
  if (cancel) cancel.classList.toggle('hidden', !on);
  if (!on) loadCompanyInfo(); // reload values on cancel
}

async function loadCompanyInfo() {
  try {
    const doc = await col('settings').doc('company').get();
    if (doc.exists) {
      const d = doc.data();
      companyInfo = {
        name: d.name || companyInfo.name,
        address: d.address || companyInfo.address,
        phone: d.phone || companyInfo.phone,
        phone2: d.phone2 || companyInfo.phone2,
        gpay: d.gpay || companyInfo.gpay
      };
    }
  } catch (e) {}
  if (document.getElementById('coName')) document.getElementById('coName').value = companyInfo.name || '';
  if (document.getElementById('coPhone')) document.getElementById('coPhone').value = companyInfo.phone || '';
  if (document.getElementById('coPhone2')) document.getElementById('coPhone2').value = companyInfo.phone2 || '';
  if (document.getElementById('coGpay')) document.getElementById('coGpay').value = companyInfo.gpay || '';
  if (document.getElementById('coAddress')) document.getElementById('coAddress').value = companyInfo.address || '';
  // stay view-only unless editing
  const saveBtn = document.getElementById('coSaveBtn');
  if (!saveBtn || saveBtn.classList.contains('hidden')) {
    document.querySelectorAll('.co-field').forEach(el => {
      el.readOnly = true;
      el.classList.add('bg-slate-50');
      el.classList.remove('bg-white');
    });
    const edit = document.getElementById('coEditBtn');
    const cancel = document.getElementById('coCancelBtn');
    if (edit) edit.classList.remove('hidden');
    if (saveBtn) saveBtn.classList.add('hidden');
    if (cancel) cancel.classList.add('hidden');
  }
}

async function saveCompanyInfo() {
  companyInfo = {
    name: document.getElementById('coName').value.trim() || 'My Cable Network',
    phone: document.getElementById('coPhone').value.trim(),
    phone2: (document.getElementById('coPhone2') || {}).value || '',
    gpay: (document.getElementById('coGpay') || {}).value || '',
    address: document.getElementById('coAddress').value.trim()
  };
  companyInfo.phone2 = String(companyInfo.phone2).trim();
  companyInfo.gpay = String(companyInfo.gpay).trim();
  await col('settings').doc('company').set({
    ...companyInfo,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  const sidebarNameEl = document.getElementById('sidebarCompanyName');
  if (sidebarNameEl) sidebarNameEl.textContent = companyInfo.name;
  showToast('Company saved ✓');
  const msg = document.getElementById('coSavedMsg');
  if (msg) {
    msg.classList.remove('hidden');
    setTimeout(() => msg.classList.add('hidden'), 2500);
  }
  setCompanyEditMode(false);
}


async function fixGpayLocalAgents() {
  if (!confirm('GPAY → ONLINE · LOCAL → Office\n\nஏற்கனவே உள்ள collections update செய்யவா?\n(Dashboard Office/Online amount சரியாகும்)')) return;
  try {
    showToast('Updating agents...');
    const snap = await col('collections').get();
    let gpay = 0, local = 0;
    const updates = [];
    snap.forEach(doc => {
      const d = doc.data();
      const cb = String(d.collectedBy || '').toUpperCase().trim();
      const remarks = String(d.remarks || '').toUpperCase();
      // CableSoft import remarks: Import CableSoft · COLLECTED=GPAY
      const fromRemarks = /COLLECTED\s*=\s*GPAY/.test(remarks) || remarks.includes('GPAY');
      const fromRemarksLocal = /COLLECTED\s*=\s*LOCAL/.test(remarks) || (remarks.includes('LOCAL') && !remarks.includes('MUTHUMARI'));
      if (cb === 'GPAY' || cb.includes('GPAY') || (fromRemarks && cb !== 'ONLINE' && !cb.includes('UMA') && !cb.includes('MUTHUMARI'))) {
        if (cb !== 'ONLINE') {
          updates.push({ id: doc.id, collectedBy: 'ONLINE', mode: 'UPI', createdBy: 'online@jsvcable.com', employee: 'ONLINE' });
          gpay++;
        }
      } else if (cb === 'LOCAL' || cb.includes('LOCAL') || (fromRemarksLocal && cb !== 'OFFICE')) {
        if (cb !== 'OFFICE') {
          updates.push({ id: doc.id, collectedBy: 'OFFICE', mode: d.mode || 'Cash', createdBy: 'office@jsvcable.com', employee: 'OFFICE' });
          local++;
        }
      } else if (cb === 'ONLINE' && d.employee && String(d.employee).toUpperCase() !== 'ONLINE') {
        updates.push({ id: doc.id, employee: 'ONLINE', createdBy: 'online@jsvcable.com' });
        gpay++;
      } else if (cb === 'OFFICE' && d.employee && String(d.employee).toUpperCase() !== 'OFFICE') {
        updates.push({ id: doc.id, employee: 'OFFICE', createdBy: 'office@jsvcable.com' });
        local++;
      }
    });
    for (let i = 0; i < updates.length; i += 400) {
      const batch = db.batch();
      updates.slice(i, i + 400).forEach(u => {
        const payload = { agentFixedAt: firebase.firestore.FieldValue.serverTimestamp() };
        if (u.collectedBy) payload.collectedBy = u.collectedBy;
        if (u.mode) payload.mode = u.mode;
        if (u.createdBy) payload.createdBy = u.createdBy;
        if (u.employee) payload.employee = u.employee;
        batch.update(col('collections').doc(u.id), payload);
      });
      await batch.commit();
    }
    showToast('Fixed · ONLINE: ' + gpay + ' · OFFICE: ' + local + ' · Refresh dashboard');
    if (typeof loadDashboard === 'function') loadDashboard();
  } catch (e) {
    console.error(e);
    showToast('Error: ' + e.message, true);
  }
}

async function importAugustCollections() {
  return importCollectionsFromJson('collections_aug2026.json', 'ஆகஸ்ட் full list');
}

async function importTodayCollections() {
  return importCollectionsFromJson('collections_2026-08-16.json', '16 Aug 2026 collection');
}

async function importCollectionsFromJson(fileName, label) {
  if (!confirm((label || fileName) + ' import?\n\n• same BillNo+Date+Customer → SKIP\n• புதியவை ADD\n• Paid customers Due = 0')) return;
  try {
    showToast('Loading file...');
    const res = await fetch(fileName + '?t=' + Date.now());
    if (!res.ok) throw new Error(fileName + ' not found — upload to GitHub root');
    const list = await res.json();
    if (!Array.isArray(list) || !list.length) throw new Error('Empty list');

    // map custId -> customer doc
    const byCustId = new Map();
    allCustomers.forEach(c => {
      const id = String(c.custId || '').trim().toUpperCase();
      if (id) byCustId.set(id, c);
    });

    // existing collections key: custDocId|billNo|date
    showToast('Checking existing bills...');
    const existingKeys = new Set();
    const colSnap = await col('collections').get();
    colSnap.forEach(doc => {
      const d = doc.data();
      const k = (d.customerId || '') + '|' + String(d.billNo || '') + '|' + (d.date || d.billDate || '');
      existingKeys.add(k);
      // also by imported custId
      if (d.importCustId) {
        existingKeys.add(String(d.importCustId).toUpperCase() + '|' + String(d.billNo || '') + '|' + (d.date || ''));
      }
    });

    let added = 0, skipped = 0, noMatch = 0;
    const paidCustDocIds = new Set();

    for (let i = 0; i < list.length; i += 400) {
      const chunk = list.slice(i, i + 400);
      const batch = db.batch();
      let batchOps = 0;
      for (const r of chunk) {
        const cid = String(r.custId || '').trim().toUpperCase();
        const cust = byCustId.get(cid);
        const date = r.colDate || r.billDate || '';
        const billNo = String(r.billNo || '');
        const skipKey1 = cid + '|' + billNo + '|' + date;
        const skipKey2 = cust ? (cust.id + '|' + billNo + '|' + date) : '';
        if (existingKeys.has(skipKey1) || (skipKey2 && existingKeys.has(skipKey2))) {
          skipped++;
          if (cust) paidCustDocIds.add(cust.id);
          continue;
        }
        if (!cust) { noMatch++; continue; }

        const ref = col('collections').doc();
        const agent = (r.collected || r.employee || '').toUpperCase().trim();
        // Map Cable Soft COLLECTED → our agents
        // GPAY → ONLINE, LOCAL → OFFICE
        let collectedBy = agent;
        let mode = 'Cash';
        let createdBy = 'import@jsvcable.com';
        if (/GPAY|UPI|ONLINE/.test(agent)) {
          collectedBy = 'ONLINE';
          mode = 'UPI';
          createdBy = 'online@jsvcable.com';
        } else if (/LOCAL|OFFICE|BANK/.test(agent)) {
          collectedBy = 'OFFICE';
          mode = 'Cash';
          createdBy = 'office@jsvcable.com';
        } else if (/MUTHUMARI/.test(agent)) {
          collectedBy = 'MUTHUMARI';
          createdBy = 'muthumari@jsvcable.com';
        } else if (/UMA/.test(agent)) {
          collectedBy = 'UMA';
          createdBy = 'uma@jsvcable.com';
        }
        batch.set(ref, {
          customerId: cust.id,
          customerName: cust.name || r.name || '',
          amount: Number(r.amount) || 0,
          date: date,
          billDate: r.billDate || date,
          billNo: billNo,
          mode,
          remarks: 'Import CableSoft · COLLECTED=' + (r.collected || ''),
          status: 'active',
          importCustId: cid,
          collectedBy,
          employee: r.employee || '',
          createdBy,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        existingKeys.add(skipKey1);
        existingKeys.add(cust.id + '|' + billNo + '|' + date);
        paidCustDocIds.add(cust.id);
        added++;
        batchOps++;
      }
      if (batchOps > 0) await batch.commit();
    }

    // set due = 0 for paid customers this month
    showToast('Updating dues...');
    const paidArr = Array.from(paidCustDocIds);
    for (let i = 0; i < paidArr.length; i += 400) {
      const batch = db.batch();
      paidArr.slice(i, i + 400).forEach(id => {
        batch.update(col('customers').doc(id), {
          dueAmt: 0,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      await batch.commit();
    }

    showToast('Import done · Added: ' + added + ' · Skipped: ' + skipped + ' · No customer: ' + noMatch + ' · Due cleared: ' + paidArr.length);
    await loadCustomers();
    loadDashboard();
  } catch (e) {
    console.error(e);
    showToast('Import error: ' + e.message, true);
  }
}

function globalCustomerSearch(openFirst) {
  const inp = document.getElementById('globalSearch');
  const box = document.getElementById('globalSearchResults');
  if (!inp || !box) return;
  const q = (inp.value || '').toLowerCase().trim();
  if (q.length < 2) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const matches = allCustomers.filter(c =>
    (c.name || '').toLowerCase().includes(q) ||
    (c.mobile || '').includes(q) ||
    (c.boxNo || '').toLowerCase().includes(q) ||
    (c.custId || '').toLowerCase().includes(q) ||
    (c.street || '').toLowerCase().includes(q)
  ).slice(0, 15);
  if (!matches.length) {
    box.innerHTML = '<div class="p-3 text-sm text-slate-400">No match</div>';
    box.classList.remove('hidden');
    return;
  }
  if (openFirst && matches.length === 1) {
    box.classList.add('hidden');
    viewLedger(matches[0].id);
    return;
  }
  box.innerHTML = matches.map(c => `
    <div class="p-3 hover:bg-slate-700 cursor-pointer border-b border-slate-700 text-sm" onclick="globalPickCustomer('${c.id}')">
      <div class="font-medium text-white">${c.name || '-'}</div>
      <div class="text-xs text-slate-400">${c.custId || ''} · ${c.mobile || '-'} · Box ${c.boxNo || '-'} · Due ₹${Number(c.dueAmt||c.due||0)} · ${c.street || ''}</div>
    </div>`).join('');
  box.classList.remove('hidden');
}
function globalPickCustomer(id) {
  const box = document.getElementById('globalSearchResults');
  if (box) box.classList.add('hidden');
  const inp = document.getElementById('globalSearch');
  if (inp) inp.value = '';
  viewLedger(id);
}
document.addEventListener('click', (e) => {
  const box = document.getElementById('globalSearchResults');
  const inp = document.getElementById('globalSearch');
  if (!box || !inp) return;
  if (!box.contains(e.target) && e.target !== inp) box.classList.add('hidden');
});

async function importDcList() {
  if (!confirm('DC full import?\n• இருந்தால் update\n• இல்லையென்றால் ADD (name, mobile, box, street, area, SC, date)')) return;
  try {
    showToast('Loading DC...');
    const res = await fetch('dc_list.json?t=' + Date.now());
    if (!res.ok) throw new Error('dc_list.json missing');
    const list = await res.json();
    await loadCustomers();
    const byId = new Map(), byBox = new Map();
    allCustomers.forEach(c => {
      const id = String(c.custId || '').trim().toUpperCase();
      if (id) byId.set(id, c);
      const b = String(c.boxNo || '').trim().toUpperCase();
      if (b) byBox.set(b, c);
    });
    let updated = 0, added = 0;
    for (let i = 0; i < list.length; i += 200) {
      const batch = db.batch();
      for (const r of list.slice(i, i + 200)) {
        const cid = String(r.custId || '').trim();
        const box = String(r.box || '').trim();
        let cust = byId.get(cid.toUpperCase()) || (box ? byBox.get(box.toUpperCase()) : null);
        const bal = Number(r.balance || 0);
        const mobile = r.mobile || '';
        if (cust) {
          const up = { status: 'DC', dcDate: r.dcDate || '', updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
          if (bal > 0) up.dueAmt = bal;
          if (mobile && !cust.mobile) up.mobile = mobile;
          if (box && !cust.boxNo) up.boxNo = box;
          if (r.sc && !cust.scNo) { up.scNo = r.sc; up.smartCard = r.sc; }
          if (r.place) up.place = r.place;
          if (r.street) up.street = r.street;
          if (r.reason) up.dcReason = r.reason;
          if (r.signal) up.signal = r.signal;
          batch.update(col('customers').doc(cust.id), up);
          updated++;
        } else {
          const ref = col('customers').doc();
          batch.set(ref, {
            custId: cid, name: r.name || '', mobile: mobile, doorNo: r.doorNo || '',
            place: r.place || '', street: r.street || '', boxNo: box, scNo: r.sc || '', smartCard: r.sc || '',
            status: 'DC', dcDate: r.dcDate || '', dcReason: r.reason || '', dueAmt: bal,
            packageAmt: 0, package: '', mso: '', signal: r.signal || 'Digital', billing: 'No',
            remarks: 'DC import', source: 'dc-import',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          added++;
          if (cid) byId.set(cid.toUpperCase(), { id: ref.id });
          if (box) byBox.set(box.toUpperCase(), { id: ref.id });
        }
      }
      await batch.commit();
    }
    await loadCustomers();
    updateDashboardStats();
    showToast('DC Updated: ' + updated + ' · Added: ' + added);
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

// ==================== EMPLOYEES (Area Allotment) ====================
let allEmployees = [];

async function loadEmployees() {
  const el = document.getElementById('empList');
  if (el) el.innerHTML = '<div class="p-3 text-slate-400 text-center text-sm">Loading...</div>';
  const defaults = [
    { name: 'Office', email: 'office@example.com', area: 'ALL', role: 'office' },
    { name: 'Online', email: 'online@example.com', area: 'ALL', role: 'online' }
  ];
  try {
    const snap = await col('employees').get();
    allEmployees = [];
    snap.forEach(doc => allEmployees.push({ id: doc.id, ...doc.data() }));
    allEmployees.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (allEmployees.length === 0) {
      // seed once — no recursive hang
      for (const d of defaults) {
        try {
          await col('employees').add({
            ...d,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        } catch (se) {
          console.warn('seed employee failed', se);
        }
      }
      try {
        const snap2 = await col('employees').get();
        allEmployees = [];
        snap2.forEach(doc => allEmployees.push({ id: doc.id, ...doc.data() }));
      } catch (e2) {}
      // if still empty (permission), show local defaults for display only
      if (!allEmployees.length) {
        allEmployees = defaults.map((d, i) => ({ id: 'local_' + i, ...d, _local: true }));
        if (el) {
          renderEmployeeList();
          el.insertAdjacentHTML('afterbegin',
            '<div class="p-2 text-xs text-amber-700 bg-amber-50 border-b">Firestore employees write fail — local list. Firebase Rules-ல் employees allow check பண்ணுங்கள்.</div>');
          return;
        }
      }
    }
    renderEmployeeList();
  } catch (e) {
    console.error(e);
    // permission / network — still show usable list
    allEmployees = defaults.map((d, i) => ({ id: 'local_' + i, ...d, _local: true }));
    if (el) {
      el.innerHTML = '<div class="p-2 text-xs text-red-600 bg-red-50 border-b">Error: ' + (e.message || e) +
        '<br>Firebase Console → Firestore → Rules: employees read/write allow authenticated.</div>';
      renderEmployeeList();
    }
  }
}

function renderEmployeeList() {
  buildAgentIndex();
  if (typeof loadDashboard === 'function' && document.getElementById('agentRowsBody')) {
    try { loadDashboard(); } catch (e) {}
  }
  const el = document.getElementById('empList');
  if (!el) return;
  if (!allEmployees.length) {
    el.innerHTML = '<div class="p-3 text-slate-400 text-center">No employees</div>';
    return;
  }
  el.innerHTML = allEmployees.map(e => `
    <div class="flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 gap-2">
      <div class="min-w-0">
        <div class="font-medium truncate">${e.name || '-'}</div>
        <div class="text-[10px] text-slate-500 truncate">${e.email || ''} · ${e.role || 'collector'}</div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-xs font-semibold px-2 py-0.5 rounded-full ${e.area === 'AREA 1' ? 'bg-blue-100 text-blue-700' : e.area === 'AREA 2' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}">${e.area || '-'}</span>
        <button type="button" onclick="editEmployee('${e.id}')" class="text-blue-600 text-xs">Edit</button>
        <button type="button" onclick="deleteEmployee('${e.id}')" class="text-red-600 text-xs">Del</button>
      </div>
    </div>
  `).join('');
}

function clearEmpForm() {
  document.getElementById('editEmpId').value = '';
  document.getElementById('empName').value = '';
  document.getElementById('empEmail').value = '';
  const pw = document.getElementById('empPassword');
  if (pw) pw.value = '';
  document.getElementById('empArea').value = 'ALL';
  document.getElementById('empRole').value = 'collector';
}

function editEmployee(id) {
  const e = allEmployees.find(x => x.id === id);
  if (!e) return;
  document.getElementById('editEmpId').value = id;
  document.getElementById('empName').value = e.name || '';
  document.getElementById('empEmail').value = e.email || '';
  const pw = document.getElementById('empPassword');
  if (pw) pw.value = '';
  document.getElementById('empArea').value = e.area || 'ALL';
  document.getElementById('empRole').value = e.role || 'collector';
}

async function saveEmployee() {
  const id = document.getElementById('editEmpId').value;
  const name = (document.getElementById('empName').value || '').trim();
  const email = (document.getElementById('empEmail').value || '').trim().toLowerCase();
  const password = (document.getElementById('empPassword')?.value || '').trim();
  const area = document.getElementById('empArea').value;
  const role = document.getElementById('empRole').value;
  if (!name || !email) { showToast('Name + Email required', true); return; }
  if (!id && password.length < 6) {
    showToast('புதிய collector-க்கு Password குறைந்தது 6 எழுத்து', true);
    return;
  }
  try {
    // New user → create Firebase Auth login (admin stays logged in)
    if (!id) {
      const secondaryApp = firebase.initializeApp(firebaseConfig, 'Secondary' + Date.now());
      try {
        await secondaryApp.auth().createUserWithEmailAndPassword(email, password);
        await secondaryApp.auth().signOut();
      } catch (ae) {
        const code = ae.code || '';
        if (code === 'auth/email-already-in-use') {
          // Auth already exists — just map area
          showToast('Login ஏற்கனவே உள்ளது · Area map மட்டும் save');
        } else {
          throw ae;
        }
      } finally {
        try { await secondaryApp.delete(); } catch (_) {}
      }
    }
    const data = {
      name, email, area, role,
      active: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (id) {
      await col('employees').doc(id).update(data);
      showToast('Collector updated');
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await col('employees').add(data);
      showToast('Collector created · Login ready');
    }
    // Map this login email to the current company + role, so they land in
    // the right company's data when they sign in (admin app or collector app).
    try {
      await db.collection('users').doc(email).set({
        companyId: currentCompanyId,
        role: role === 'admin' ? 'admin' : 'collector',
        email,
        name,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (ue) {
      console.error('users map save failed', ue);
    }
    clearEmpForm();
    await loadEmployees();
  } catch (e) {
    console.error(e);
    showToast('Error: ' + (e.message || e), true);
  }
}

async function deleteEmployee(id) {
  if (String(id).startsWith('local_')) { showToast('Local only — Firestore-ல் save முதலில்', true); return; }
  if (!confirm('Delete this employee mapping?')) return;
  try {
    await col('employees').doc(id).delete();
    showToast('Deleted');
    await loadEmployees();
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

// ==================== COLLECTION REPORT (Street-wise Print) ====================
function getCollectionReportData(area) {
  const list = allCustomers.filter(c => {
    if (Number(c.dueAmt || c.due || 0) <= 0) return false;
    if ((c.status || 'ACT').toUpperCase() === 'DC') return false; // optional: skip DC
    if (area && (c.place || '') !== area) return false;
    return true;
  });
  // group by street
  const map = new Map();
  list.forEach(c => {
    const st = (c.street || '— No Street —').trim();
    if (!map.has(st)) map.set(st, []);
    map.get(st).push(c);
  });
  // sort streets Tamil-friendly, customers by custId
  const streets = Array.from(map.keys()).sort((a, b) => a.localeCompare(b, 'ta'));
  streets.forEach(st => {
    map.get(st).sort((a, b) => String(a.custId || '').localeCompare(String(b.custId || ''), 'en', { numeric: true }));
  });
  return { streets, map, list };
}

function renderCollectionReport() {
  const area = (document.getElementById('colRepArea') || {}).value || '';
  const box = document.getElementById('colRepPrint');
  const sum = document.getElementById('colRepSummary');
  if (!box) return;
  const { streets, map, list } = getCollectionReportData(area);
  const totalDue = list.reduce((s, c) => s + Number(c.dueAmt || c.due || 0), 0);
  if (sum) {
    sum.textContent = area + ' · ' + list.length + ' customers · ' + streets.length + ' streets · Total ₹' + totalDue.toLocaleString('en-IN');
  }
  const month = new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  if (!list.length) {
    box.innerHTML = '<div class="text-center text-slate-400 text-sm py-8">No pending in ' + area + '</div>';
    return;
  }
  let html = `
    <div class="col-rep-head">
      <h2>SMART CABLE MANAGER — Collectors Print Out</h2>
      <p>${area} · ${month} · Pending Due · ${list.length} customers</p>
      <p>Total Due: ₹${totalDue.toLocaleString('en-IN')}</p>
    </div>`;
  // Continuous 3-column flow (no table row clipping on mobile print)
  let bodyHtml = '';
  let printed = 0;
  streets.forEach(st => {
    const rows = map.get(st);
    const stTotal = rows.reduce((s, c) => s + Number(c.dueAmt || c.due || 0), 0);
    bodyHtml += `<div class="st-h">${st}<span>₹${stTotal.toLocaleString('en-IN')} · ${rows.length}</span></div>`;
    rows.forEach((c, idx) => {
      const amt = Number(c.dueAmt || c.due || 0);
      // Door no from: doorNo (if real) → custId suffix number → serial
      let no = String(c.doorNo || c.door || '').trim();
      if (!no || no === '-' || no === '—' || no === '0') no = '';
      if (!no) {
        const id = String(c.custId || '').trim().toUpperCase();
        // AGA4→4, DES10→10, 1PN13→13, 2AM15A→15A, 5BH3A→3A
        let mm = id.match(/(\d+[A-D]?)$/i);
        if (mm) no = mm[1].toUpperCase();
        else {
          mm = id.match(/(\d+)/);
          if (mm) no = mm[1];
        }
      }
      if (!no) no = String(idx + 1);
      const nm = String(c.name || '-').substring(0, 18);
      bodyHtml += `<div class="st-row"><b class="n">${no}</b><span class="a">${amt}</span><span class="nm">${nm}</span></div>`;
      printed++;
    });
  });
  html += `<div class="flow3">${bodyHtml}</div>`;
  html += `<div class="col-rep-foot">Smart Cable Manager · ${area} · ${printed}/${list.length} customers · by JMR Apps</div>`;
  box.innerHTML = html;
}



function fillAgentRepMsoOptions() {
  const sel = document.getElementById('agentRepMso');
  if (!sel) return;
  const set = new Set();
  (allCustomers || []).forEach(c => {
    const m = String(c.mso || '').trim();
    if (m) set.add(m);
  });
  const cur = sel.value || 'ALL';
  sel.innerHTML = '<option value="ALL">All MSO</option>' +
    Array.from(set).sort().map(m => `<option value="${m}">${m}</option>`).join('');
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

async function renderAgentDayReport() {
  const from = document.getElementById('agentRepFrom')?.value;
  const to = document.getElementById('agentRepTo')?.value;
  const who = document.getElementById('agentRepWho')?.value || 'ALL';
  const areaFilter = document.getElementById('agentRepArea')?.value || 'ALL';
  const msoFilter = document.getElementById('agentRepMso')?.value || 'ALL';
  const groupBy = document.getElementById('agentRepGroup')?.value || 'date';
  const body = document.getElementById('agentRepBody');
  if (!body) return;
  if (!from || !to) { showToast('From / To date தேர்வு செய்யுங்கள்', true); return; }
  body.innerHTML = '<div class="p-6 text-center text-slate-400">Loading...</div>';
  try {
    const byId = new Map();
    const byCustId = new Map();
    (allCustomers || []).forEach(c => {
      byId.set(c.id, c);
      const cid = String(c.custId || '').trim().toUpperCase();
      if (cid) byCustId.set(cid, c);
    });
    // street name → area from street master
    const streetArea = new Map();
    (typeof allStreets !== 'undefined' && allStreets ? allStreets : []).forEach(s => {
      const n = String(s.name || s.street || '').trim();
      const p = String(s.place || s.area || '').trim().toUpperCase();
      if (n) streetArea.set(n, p);
    });
    function normArea(p, street) {
      let s = String(p || '').trim().toUpperCase().replace(/\s+/g, ' ');
      if (!s && street) s = String(streetArea.get(street) || '').toUpperCase();
      if (s === 'AREA1' || s === '1' || s === 'AREA 1') return 'AREA 1';
      if (s === 'AREA2' || s === '2' || s === 'AREA 2') return 'AREA 2';
      if (s.includes('AREA 1')) return 'AREA 1';
      if (s.includes('AREA 2')) return 'AREA 2';
      return s;
    }
    const snap = await col('collections').where('date', '>=', from).where('date', '<=', to).get();
    const rows = [];
    // boxNo → customer for fallback MSO
    const byBox = new Map();
    (allCustomers || []).forEach(c => {
      const b = String(c.boxNo || '').trim();
      if (b) byBox.set(b, c);
    });
    const msoNorm = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const msoWant = msoNorm(msoFilter);

    snap.forEach(doc => {
      const d = { id: doc.id, ...doc.data() };
      if (d.status === 'cancelled') return;
      const key = classifyAgent(d);
      if (who !== 'ALL' && key !== who) return;
      let cust = byId.get(d.customerId);
      if (!cust && d.importCustId) cust = byCustId.get(String(d.importCustId).toUpperCase());
      if (!cust && d.custId) cust = byCustId.get(String(d.custId).toUpperCase());
      if (!cust && d.boxNo) cust = byBox.get(String(d.boxNo).trim());
      const area = normArea(cust?.place || d.place, cust?.street || d.street);
      if (areaFilter !== 'ALL' && area !== areaFilter) return;
      const mso = (d.mso || cust?.mso || '').toString().trim();
      // MSO filter: case-insensitive exact, or startsWith for short codes
      if (msoFilter !== 'ALL') {
        const mn = msoNorm(mso);
        if (!mn || (mn !== msoWant && !mn.startsWith(msoWant) && !msoWant.startsWith(mn))) return;
      }
      rows.push({
        ...d,
        customerName: d.customerName || cust?.name || '',
        importCustId: d.importCustId || cust?.custId || '',
        _agent: key,
        _mso: mso || '-',
        _area: area || '-'
      });
    });
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.customerName||'').localeCompare(String(b.customerName||'')));
    const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const cntEl = document.getElementById('agentRepCnt');
    const amtEl = document.getElementById('agentRepAmt');
    if (cntEl) cntEl.textContent = String(rows.length);
    if (amtEl) amtEl.textContent = '₹' + total.toLocaleString('en-IN');
    // Agent-wise split — dynamic, built from AGENT_LIST (Setup → Collectors)
    if (!AGENT_LIST.length) buildAgentIndex();
    const split = { other: 0 };
    const splitCnt = { other: 0 };
    AGENT_LIST.forEach(a => { split[a.key] = 0; splitCnt[a.key] = 0; });
    rows.forEach(r => {
      const k = r._agent || 'other';
      if (split[k] == null) { split.other += Number(r.amount||0); splitCnt.other++; }
      else { split[k] += Number(r.amount||0); splitCnt[k]++; }
    });
    const splitEl = document.getElementById('agentRepSplit');
    if (splitEl) {
      splitEl.innerHTML = AGENT_LIST.map(a => [a.name, split[a.key] || 0, splitCnt[a.key] || 0])
      .map(([n,a,c]) => `<div class="text-center p-1.5 bg-slate-50 rounded-lg">
          <div class="text-[9px] text-slate-400">${n}</div>
          <div class="text-xs font-bold">₹${a.toLocaleString('en-IN')}</div>
          <div class="text-[9px] text-slate-400">${c} bills</div>
        </div>`).join('');
    }
    if (!rows.length) {
      body.innerHTML = '<div class="p-8 text-center text-slate-400">No collections in this range</div>';
      return;
    }
    const groups = {};
    rows.forEach(r => {
      let gk = r.date || '-';
      if (groupBy === 'mso') gk = r._mso || '-';
      else if (groupBy === 'area') gk = r._area || '-';
      if (!groups[gk]) groups[gk] = [];
      groups[gk].push(r);
    });
    const keys = Object.keys(groups).sort((a, b) => {
      if (groupBy === 'date') return b.localeCompare(a);
      return a.localeCompare(b);
    });
    let html = '';
    keys.forEach(gk => {
      const list = groups[gk];
      const dayTot = list.reduce((s, r) => s + Number(r.amount || 0), 0);
      html += `<div class="bg-slate-800 text-white px-3 py-1.5 text-xs font-semibold flex justify-between">
        <span>${gk}</span><span>${list.length} bills · ₹${dayTot.toLocaleString('en-IN')}</span></div>`;
      html += `<table class="w-full text-xs table-fixed">
        <thead class="bg-slate-50"><tr>
          <th class="text-left p-1.5 w-6">#</th>
          <th class="text-left p-1.5">Customer</th>
          <th class="text-left p-1.5 w-16">Agent</th>
          <th class="text-left p-1.5 w-20">MSO</th>
          <th class="text-right p-1.5 w-14">Amt</th>
        </tr></thead><tbody>`;
      list.forEach((r, i) => {
        html += `<tr class="border-t">
          <td class="p-1.5 text-slate-400 align-top">${i+1}</td>
          <td class="p-1.5">
            <div class="font-medium leading-tight break-words">${r.customerName || '-'}</div>
            <div class="text-[10px] text-slate-400 leading-tight">${r.importCustId || r.custId || '-'} · ${r._mso || '-'}</div>
          </td>
          <td class="p-1.5 text-[11px] align-top">${displayAgentName(r)}</td>
          <td class="p-1.5 text-[10px] align-top text-slate-600 break-words">${r._mso || '-'}</td>
          <td class="p-1.5 text-right font-semibold align-top whitespace-nowrap">₹${Number(r.amount||0).toLocaleString('en-IN')}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    });
    body.innerHTML = html;
  } catch (e) {
    console.error(e);
    body.innerHTML = '<div class="p-4 text-red-500 text-sm">' + e.message + '</div>';
  }
}


function printDiv(id) {
  const src = document.getElementById(id);
  if (!src) { showToast('Print area not found', true); return; }
  let root = document.getElementById('printRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'printRoot';
    document.body.appendChild(root);
  }
  const title = document.getElementById('pageTitle');
  const head = '<div style="text-align:center;margin-bottom:8px"><b>Smart Cable Manager</b><br><span style="font-size:12px">' +
    (title ? title.textContent : 'Report') + ' · ' + new Date().toLocaleDateString('en-IN') + '</span></div>';
  root.innerHTML = head + src.innerHTML;
  root.style.display = 'block';
  setTimeout(() => {
    window.print();
    setTimeout(() => { root.innerHTML = ''; root.style.display = 'none'; }, 500);
  }, 150);
}

function printPendingReport() {
  const cnt = document.getElementById('pendingCount')?.textContent || '0';
  const tot = document.getElementById('pendingTotal')?.textContent || '₹0';
  const t = document.getElementById('pendingPrintTitle');
  if (t) t.textContent = 'Smart Cable Manager — Pending · ' + cnt + ' · ' + tot;
  printDiv('pendingPrintArea');
}

function printCollectionReport() {
  renderCollectionReport();
  setTimeout(() => {
    const src = document.getElementById('colRepPrint');
    if (!src) { showToast('Report empty', true); return; }
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>Smart Cable Manager Collectors Print Out</title>
<style>
  @page { size: A4; margin: 5mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 2mm; font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 9.5px; }
  .col-rep-head { text-align: center; margin-bottom: 3px; }
  .col-rep-head h2 { font-size: 13px; margin: 0; }
  .col-rep-head p { font-size: 8px; margin: 0; }
  .flow3 {
    column-count: 3;
    column-gap: 1px;
    column-rule: 0.4px solid #ccc;
    column-fill: auto;
  }
  .st-h {
    break-inside: avoid;
    color: #9a3412;
    border-bottom: 1px solid #9a3412;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 1px 1px;
    margin: 3px 0 1px;
    display: flex;
    justify-content: space-between;
  }
  .st-row {
    break-inside: avoid;
    display: flex;
    gap: 2px;
    line-height: 1.3;
    border-bottom: 0.3px solid #bbb;
    padding: 0.5px 1px;
    font-size: 10.5px;
  }
  .st-row .n, .st-row b.n { width: 26px; flex-shrink: 0; font-weight: 700; text-align: left; color: #000; }
  .st-row .a { width: 30px; flex-shrink: 0; text-align: right; font-weight: 600; }
  .st-row .nm { flex: 1; overflow: hidden; white-space: nowrap; }
  .col-rep-foot { margin-top: 6px; text-align: center; font-size: 9px; color: #444; }
  body { font-size: 10.5px; }
</style></head><body>${src.innerHTML}
<script>
window.onload = function() {
  setTimeout(function() { window.focus(); window.print(); }, 300);
};
</script></body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast('Open ஆன page-ல் Print அழுத்தவும்');
    }
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }, 80);
}

// ==================== FULL MONTHLY BACKUP ====================
function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}

function toCSV(rows, headers) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(headers.map(h => esc(r[h])).join(',')));
  return '\uFEFF' + lines.join('\n'); // BOM for Excel Tamil
}

async function runFullBackup() {
  const btn = document.getElementById('backupBtn');
  const st = document.getElementById('backupStatus');
  if (btn) { btn.disabled = true; btn.textContent = 'Backing up...'; }
  if (st) st.textContent = 'Loading data from Firebase...';

  try {
    // Ensure fresh data
    await loadCustomers();
    let boxes = [];
    try {
      const bs = await col('boxes').get();
      bs.forEach(d => boxes.push({ id: d.id, ...d.data() }));
    } catch (e) {}
    let collections = [];
    try {
      const cs = await col('collections').get();
      cs.forEach(d => collections.push({ id: d.id, ...d.data() }));
    } catch (e) {}
    let streets = [];
    try {
      const ss = await col('streets').get();
      ss.forEach(d => streets.push({ id: d.id, ...d.data() }));
    } catch (e) {}
    let employees = [];
    try {
      const es = await col('employees').get();
      es.forEach(d => employees.push({ id: d.id, ...d.data() }));
    } catch (e) {}
    let company = {};
    try {
      const cd = await col('settings').doc('company').get();
      if (cd.exists) company = cd.data();
    } catch (e) {}
    let monthBill = {};
    try {
      const md = await col('settings').doc('monthBill').get();
      if (md.exists) monthBill = md.data();
    } catch (e) {}

    const stamp = new Date().toISOString().slice(0, 10);
    const ym = new Date().toISOString().slice(0, 7);

    // 1) Full JSON backup
    if (st) st.textContent = '1/3 JSON full backup...';
    const full = {
      meta: {
        app: 'Smart Cable Manager',
        place: 'My Cable Network',
        exportedAt: new Date().toISOString(),
        month: ym
      },
      company,
      monthBill,
      customers: allCustomers.map(({ id, ...r }) => ({ id, ...r })),
      boxes,
      collections: collections.map(c => {
        const o = { ...c };
        // stringify timestamps
        if (o.createdAt && o.createdAt.toDate) o.createdAt = o.createdAt.toDate().toISOString();
        if (o.updatedAt && o.updatedAt.toDate) o.updatedAt = o.updatedAt.toDate().toISOString();
        return o;
      }),
      streets,
      employees
    };
    downloadBlob(
      'SCM_Backup_FULL_' + stamp + '.json',
      JSON.stringify(full, null, 2),
      'application/json'
    );

    await new Promise(r => setTimeout(r, 400));

    // 2) Customers CSV (Excel-friendly)
    if (st) st.textContent = '2/3 Customers CSV...';
    const custRows = allCustomers.map(c => ({
      custId: c.custId || '',
      name: c.name || '',
      mobile: c.mobile || '',
      place: c.place || '',
      street: c.street || '',
      boxNo: c.boxNo || '',
      scNo: c.scNo || c.smartCard || '',
      mso: c.mso || '',
      package: c.package || '',
      packageAmt: c.packageAmt || c.package || '',
      dueAmt: c.dueAmt || c.due || 0,
      status: c.status || 'ACT',
      dcDate: c.dcDate || '',
      doorNo: c.doorNo || '',
      signal: c.signal || ''
    }));
    const custHeaders = ['custId','name','mobile','place','street','boxNo','scNo','mso','package','packageAmt','dueAmt','status','dcDate','doorNo','signal'];
    downloadBlob(
      'SCM_Customers_' + stamp + '.csv',
      toCSV(custRows, custHeaders),
      'text/csv;charset=utf-8'
    );

    await new Promise(r => setTimeout(r, 400));

    // 3) Collections CSV
    if (st) st.textContent = '3/3 Collections CSV...';
    const colRows = collections.map(c => ({
      billNo: c.billNo || '',
      date: c.date || c.billDate || '',
      customerId: c.customerId || '',
      customerName: c.customerName || '',
      amount: c.amount || 0,
      mode: c.mode || '',
      collectedBy: c.collectedBy || c.employee || '',
      createdBy: c.createdBy || '',
      remarks: c.remarks || '',
      status: c.status || ''
    }));
    const colHeaders = ['billNo','date','customerId','customerName','amount','mode','collectedBy','createdBy','remarks','status'];
    downloadBlob(
      'SCM_Collections_' + stamp + '.csv',
      toCSV(colRows, colHeaders),
      'text/csv;charset=utf-8'
    );

    const msg = 'Backup OK · Customers ' + allCustomers.length +
      ' · Boxes ' + boxes.length +
      ' · Collections ' + collections.length +
      ' · 3 files downloaded';
    if (st) st.textContent = '✅ ' + msg;
    showToast('Backup complete — 3 files');
  } catch (e) {
    console.error(e);
    if (st) st.textContent = 'Error: ' + e.message;
    showToast('Backup error: ' + e.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Backup Now'; }
  }
}


function getReportDateRange() {
  const preset = window._repDatePreset || 'month';
  const iso = (d) => {
    const x = new Date(d);
    return x.getFullYear() + '-' + String(x.getMonth()+1).padStart(2,'0') + '-' + String(x.getDate()).padStart(2,'0');
  };
  const t = new Date();
  if (preset === 'today') return { from: iso(t), to: iso(t) };
  if (preset === 'week') {
    const f = new Date(t); f.setDate(t.getDate() - 6);
    return { from: iso(f), to: iso(t) };
  }
  if (preset === 'custom') {
    const from = document.getElementById('repFrom')?.value;
    const to = document.getElementById('repTo')?.value;
    if (from && to) return { from, to };
  }
  // month default
  return { from: iso(t).slice(0, 8) + '01', to: iso(t) };
}

function setReportDatePreset(preset) {
  window._repDatePreset = preset;
  document.querySelectorAll('.rep-date-btn').forEach(b => {
    const on = b.dataset.preset === preset;
    b.className = on
      ? 'rep-date-btn px-3 py-1.5 rounded-full text-xs bg-indigo-600 text-white border border-indigo-600'
      : 'rep-date-btn px-3 py-1.5 rounded-full text-xs bg-white border border-slate-200 text-slate-600';
  });
  const custom = document.getElementById('repCustomDates');
  if (custom) custom.classList.toggle('hidden', preset !== 'custom');
  if (preset === 'custom') {
    const r = getReportDateRange();
    // if switching to custom with empty, fill month
    const f = document.getElementById('repFrom');
    const to = document.getElementById('repTo');
    const t = new Date();
    const iso = t.toISOString().slice(0, 10);
    if (f && !f.value) f.value = iso.slice(0, 8) + '01';
    if (to && !to.value) to.value = iso;
  }
}

async function fetchCollectionsInRange(from, to) {
  const snap = await col('collections').where('date', '>=', from).where('date', '<=', to).get();
  const rows = [];
  snap.forEach(doc => {
    const d = doc.data();
    if (d.status === 'cancelled') return;
    rows.push({ id: doc.id, ...d, _agent: (typeof classifyAgent === 'function') ? classifyAgent(d) : 'other' });
  });
  return rows;
}

async function renderColSummaryReport() {
  const body = document.getElementById('colSumBody');
  if (!body) return;
  const { from, to } = getReportDateRange();
  const rangeEl = document.getElementById('colSumRange');
  if (rangeEl) rangeEl.textContent = from + ' → ' + to;
  body.innerHTML = '<div class="p-6 text-center text-slate-400 text-sm">Loading...</div>';
  try {
    const rows = await fetchCollectionsInRange(from, to);
    const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const byAgent = {};
    const byMode = {};
    const byDate = {};
    rows.forEach(r => {
      const a = (typeof displayAgentName === 'function') ? displayAgentName(r) : (r._agent || '-');
      byAgent[a] = byAgent[a] || { amt: 0, n: 0 };
      byAgent[a].amt += Number(r.amount || 0); byAgent[a].n++;
      const m = (r.mode || 'Other').toString();
      byMode[m] = byMode[m] || { amt: 0, n: 0 };
      byMode[m].amt += Number(r.amount || 0); byMode[m].n++;
      const d = r.date || '-';
      byDate[d] = byDate[d] || { amt: 0, n: 0 };
      byDate[d].amt += Number(r.amount || 0); byDate[d].n++;
    });
    const card = (title, items) => `<div class="bg-white rounded-xl border p-3">
      <div class="text-xs font-semibold text-slate-500 uppercase mb-2">${title}</div>
      ${items.map(([k,v]) => `<div class="flex justify-between text-sm py-1 border-t border-slate-50">
        <span>${k} <span class="text-[10px] text-slate-400">${v.n} bills</span></span>
        <span class="font-semibold">₹${v.amt.toLocaleString('en-IN')}</span></div>`).join('') || '<div class="text-slate-400 text-sm">—</div>'}
    </div>`;
    body.innerHTML = `
      <div class="grid grid-cols-2 gap-2">
        <div class="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
          <div class="text-[10px] text-emerald-700 uppercase">Total Collection</div>
          <div class="text-xl font-bold text-emerald-800">₹${total.toLocaleString('en-IN')}</div>
        </div>
        <div class="bg-slate-50 border rounded-xl p-3 text-center">
          <div class="text-[10px] text-slate-500 uppercase">Bills</div>
          <div class="text-xl font-bold text-slate-800">${rows.length}</div>
        </div>
      </div>
      ${card('Collector-wise', Object.entries(byAgent).sort((a,b)=>b[1].amt-a[1].amt))}
      ${card('Payment Mode', Object.entries(byMode).sort((a,b)=>b[1].amt-a[1].amt))}
      ${card('Date-wise', Object.entries(byDate).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,31))}
    `;
  } catch (e) {
    body.innerHTML = '<div class="p-4 text-red-500 text-sm">' + e.message + '</div>';
  }
}

function parseConnDateISO(c) {
  // Only real connection fields — NOT createdAt (import day pollutes "new" list)
  let raw = (c.conDate || c.connectionDate || c.regDate || '').toString().trim();
  if (!raw) return '';
  // DD/MM/YYYY or DD-MM-YYYY
  let m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0');
  // DD-MM-YY
  m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (m) return '20' + m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0');
  // YYYY-MM-DD
  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  // try Date parse
  const t = Date.parse(raw);
  if (!isNaN(t)) {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  return '';
}

function renderNewConnReport() {
  const body = document.getElementById('newConnBody');
  const sum = document.getElementById('newConnSummary');
  if (!body) return;
  const t = new Date();
  const iso = t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0');
  const monthStart = iso.slice(0, 8) + '01';
  const fromEl = document.getElementById('newConnFrom');
  const toEl = document.getElementById('newConnTo');
  if (fromEl && !fromEl.value) fromEl.value = monthStart;
  if (toEl && !toEl.value) toEl.value = iso;
  const from = (fromEl && fromEl.value) || monthStart;
  const to = (toEl && toEl.value) || iso;
  const areaF = (document.getElementById('newConnArea') || {}).value || 'ALL';

  function normPlace(p) {
    let s = String(p || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (s === 'AREA1' || s === '1' || s.includes('AREA 1')) return 'AREA 1';
    if (s === 'AREA2' || s === '2' || s.includes('AREA 2')) return 'AREA 2';
    return s;
  }

  const list = (allCustomers || []).map(c => {
    const isoD = parseConnDateISO(c);
    return { c, isoD };
  }).filter(x => {
    if (!x.isoD || x.isoD < from || x.isoD > to) return false;
    if (String(x.c.status || 'ACT').toUpperCase() === 'DC') return false;
    if (areaF !== 'ALL' && normPlace(x.c.place) !== areaF) return false;
    return true;
  }).sort((a, b) => b.isoD.localeCompare(a.isoD));

  if (sum) sum.textContent = list.length + ' new · ' + from + ' → ' + to + (areaF !== 'ALL' ? ' · ' + areaF : '');
  if (!list.length) {
    body.innerHTML = '<div class="p-8 text-center text-slate-400 text-sm">No new connections in range<br><span class="text-[11px]">conDate உள்ள Active customers மட்டும்</span></div>';
    return;
  }

  // Mobile cards
  var cards = list.map(function (item) {
    var c = item.c, isoD = item.isoD;
    var due = Number(c.packageAmt || 0);
    var nm = String(c.name || '—');
    var id = c.id || '';
    return '<div class="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">' +
      '<div class="flex justify-between items-start gap-2">' +
      '<div class="min-w-0"><div class="font-semibold text-slate-900 truncate">' + nm + '</div>' +
      '<div class="text-[11px] text-slate-500 mt-0.5">ID: ' + (c.custId || '—') + ' · ' + isoD + '</div></div>' +
      '<div class="text-sm font-bold text-indigo-700 shrink-0">₹' + due.toLocaleString('en-IN') + '</div></div>' +
      '<div class="text-xs text-slate-600 mt-1.5">📍 ' + (c.street || '—') + (c.place ? ' · ' + c.place : '') + '</div>' +
      '<div class="text-[11px] text-slate-500 mt-0.5">📦 ' + (c.boxNo || '—') + ' · ' + (c.mso || '—') + '</div>' +
      '<div class="mt-2 pt-2 border-t border-slate-50">' +
      '<button type="button" onclick="viewLedger(\'' + id + '\')" class="w-full py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-medium">View Ledger →</button>' +
      '</div></div>';
  }).join('');

  // Desktop table
  var table = '<div class="overflow-x-auto max-h-[70vh]"><table class="w-full text-sm">' +
    '<thead class="bg-slate-50 sticky top-0"><tr>' +
    '<th class="text-left px-2 py-2">Date</th><th class="text-left px-2 py-2">ID</th>' +
    '<th class="text-left px-2 py-2">Name</th><th class="text-left px-2 py-2">Street</th>' +
    '<th class="text-left px-2 py-2">Area</th><th class="text-left px-2 py-2">Pkg</th>' +
    '</tr></thead><tbody>' +
    list.map(function (item) {
      var c = item.c, isoD = item.isoD;
      return '<tr class="border-t hover:bg-slate-50 cursor-pointer" onclick="viewLedger(\'' + (c.id || '') + '\')">' +
        '<td class="px-2 py-1.5 text-xs whitespace-nowrap">' + isoD + '</td>' +
        '<td class="px-2 py-1.5 font-mono text-xs">' + (c.custId || '') + '</td>' +
        '<td class="px-2 py-1.5">' + (c.name || '') + '</td>' +
        '<td class="px-2 py-1.5 text-xs">' + (c.street || '') + '</td>' +
        '<td class="px-2 py-1.5 text-xs">' + (c.place || '') + '</td>' +
        '<td class="px-2 py-1.5 text-xs">₹' + Number(c.packageAmt || 0).toLocaleString('en-IN') + '</td></tr>';
    }).join('') + '</tbody></table></div>';

  body.innerHTML = '<div class="md:hidden space-y-2">' + cards + '</div>' +
    '<div class="hidden md:block bg-white rounded-xl border overflow-hidden">' + table + '</div>';
}

function setPayModePreset(which) {
  const t = new Date();
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  const fromEl = document.getElementById('payModeFrom');
  const toEl = document.getElementById('payModeTo');
  if (!fromEl || !toEl) return;
  if (which === 'last') {
    const firstThis = new Date(t.getFullYear(), t.getMonth(), 1);
    const lastPrev = new Date(firstThis.getTime() - 86400000);
    const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
    fromEl.value = iso(firstPrev);
    toEl.value = iso(lastPrev);
  } else {
    fromEl.value = iso(t).slice(0, 8) + '01';
    toEl.value = iso(t);
  }
  renderPayModeReport();
}

function onPayModeAreaChange() {
  const area = (document.getElementById('payModeArea') || {}).value || 'ALL';
  const streetSel = document.getElementById('payModeStreet');
  if (!streetSel) return;
  const streets = new Set();
  if (typeof STREET_MASTER !== 'undefined') {
    STREET_MASTER.forEach(s => {
      if (area === 'ALL' || (typeof matchAreaPlace === 'function' ? matchAreaPlace(s.place, area) : String(s.place||'').toUpperCase() === area)) {
        if (s.street) streets.add(String(s.street).trim());
      }
    });
  }
  (allCustomers || []).forEach(c => {
    if (area === 'ALL' || (typeof matchAreaPlace === 'function' ? matchAreaPlace(c.place, area) : String(c.place||'').toUpperCase() === area)) {
      if (c.street) streets.add(String(c.street).trim());
    }
  });
  streetSel.innerHTML = '<option value="ALL">All Streets</option>' +
    Array.from(streets).filter(Boolean).sort((a,b) => a.localeCompare(b, 'ta'))
      .map(s => '<option value="' + s.replace(/"/g,'&quot;') + '">' + s + '</option>').join('');
}

async function renderPayModeReport() {
  const body = document.getElementById('payModeBody');
  const sum = document.getElementById('payModeSummary');
  if (!body) return;
  const t = new Date();
  const iso = t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0');
  const fromEl = document.getElementById('payModeFrom');
  const toEl = document.getElementById('payModeTo');
  if (fromEl && !fromEl.value) fromEl.value = iso.slice(0, 8) + '01';
  if (toEl && !toEl.value) toEl.value = iso;
  const from = (fromEl && fromEl.value) || iso.slice(0, 8) + '01';
  const to = (toEl && toEl.value) || iso;
  const areaF = (document.getElementById('payModeArea') || {}).value || 'ALL';
  const streetF = (document.getElementById('payModeStreet') || {}).value || 'ALL';
  if (sum) sum.textContent = from + ' → ' + to;
  body.innerHTML = '<div class="p-6 text-center text-slate-400 text-sm">Loading...</div>';
  try {
    let rows = await fetchCollectionsInRange(from, to);

    // Area / Street via customer lookup
    if (areaF !== 'ALL' || streetF !== 'ALL') {
      const byId = {};
      const byCustId = {};
      const byBox = {};
      (allCustomers || []).forEach(c => {
        byId[c.id] = c;
        if (c.custId) byCustId[String(c.custId).toUpperCase()] = c;
        if (c.boxNo) byBox[String(c.boxNo).trim()] = c;
      });
      rows = rows.filter(r => {
        let c = null;
        if (r.customerId && byId[r.customerId]) c = byId[r.customerId];
        else if (r.importCustId && byCustId[String(r.importCustId).toUpperCase()]) c = byCustId[String(r.importCustId).toUpperCase()];
        else if (r.custId && byCustId[String(r.custId).toUpperCase()]) c = byCustId[String(r.custId).toUpperCase()];
        else if (r.boxNo && byBox[String(r.boxNo).trim()]) c = byBox[String(r.boxNo).trim()];
        if (!c) return areaF === 'ALL' && streetF === 'ALL';
        if (areaF !== 'ALL') {
          const ok = (typeof matchAreaPlace === 'function') ? matchAreaPlace(c.place, areaF) : String(c.place||'').toUpperCase() === areaF;
          if (!ok) return false;
        }
        if (streetF !== 'ALL' && String(c.street || '').trim() !== streetF) return false;
        return true;
      });
    }

    // Mode: Cash / UPI / Online / Office — agent Online/Office count as mode too
    const byMode = {};
    const byAgent = {};
    rows.forEach(r => {
      const agent = (typeof displayAgentName === 'function') ? displayAgentName(r) : (r._agent || '-');
      byAgent[agent] = byAgent[agent] || { amt: 0, n: 0 };
      byAgent[agent].amt += Number(r.amount || 0);
      byAgent[agent].n++;

      let m = (r.mode || '').toString();
      const u = m.toUpperCase();
      const ag = agent.toUpperCase();
      if (ag === 'ONLINE' || u.includes('ONLINE') || u.includes('GPAY') || u.includes('G-PAY') || u.includes('UPI')) m = 'Online / UPI';
      else if (ag === 'OFFICE' || u.includes('OFFICE') || u.includes('LOCAL')) m = 'Office';
      else if (u.includes('CASH') || !u) m = 'Cash';
      else m = m || 'Other';
      byMode[m] = byMode[m] || { amt: 0, n: 0 };
      byMode[m].amt += Number(r.amount || 0);
      byMode[m].n++;
    });
    const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const n = rows.length;

    let html = '<div class="grid grid-cols-2 gap-2 mb-3">' +
      '<div class="bg-white rounded-xl border p-3 text-center"><div class="text-[10px] text-slate-400">Bills</div><div class="text-xl font-bold">' + n + '</div></div>' +
      '<div class="bg-white rounded-xl border p-3 text-center"><div class="text-[10px] text-slate-400">Total</div><div class="text-xl font-bold text-emerald-600">₹' + total.toLocaleString('en-IN') + '</div></div></div>';

    html += '<div class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5 px-1">By Mode</div>';
    html += Object.entries(byMode).sort((a,b)=>b[1].amt-a[1].amt).map(([k,v]) => {
      const pct = total ? Math.round(v.amt / total * 100) : 0;
      return '<div class="bg-white rounded-xl border p-3">' +
        '<div class="flex justify-between text-sm font-medium"><span>' + k + '</span><span>₹' + v.amt.toLocaleString('en-IN') + '</span></div>' +
        '<div class="text-[11px] text-slate-400 mt-0.5">' + v.n + ' bills · ' + pct + '%</div>' +
        '<div class="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div class="h-full bg-indigo-500 rounded-full" style="width:' + pct + '%"></div></div></div>';
    }).join('') || '<div class="p-4 text-center text-slate-400 text-sm">No data</div>';

    html += '<div class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5 mt-4 px-1">By Collector</div>';
    html += Object.entries(byAgent).sort((a,b)=>b[1].amt-a[1].amt).map(([k,v]) => {
      const pct = total ? Math.round(v.amt / total * 100) : 0;
      return '<div class="bg-white rounded-xl border p-3">' +
        '<div class="flex justify-between text-sm font-medium"><span>' + k + '</span><span>₹' + v.amt.toLocaleString('en-IN') + '</span></div>' +
        '<div class="text-[11px] text-slate-400 mt-0.5">' + v.n + ' bills · ' + pct + '%</div>' +
        '<div class="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div class="h-full bg-emerald-500 rounded-full" style="width:' + pct + '%"></div></div></div>';
    }).join('');

    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = '<div class="p-4 text-red-500 text-sm">' + (e.message || e) + '</div>';
  }
}

function setActFilter(v, btn) {
  const hid = document.getElementById('actFilter');
  if (hid) hid.value = v;
  document.querySelectorAll('.act-chip').forEach(b => {
    const on = b === btn;
    b.className = on
      ? 'act-chip px-2.5 py-1 rounded-full text-xs bg-indigo-600 text-white'
      : 'act-chip px-2.5 py-1 rounded-full text-xs bg-white border border-slate-200';
  });
  renderActivityReport();
}

async function renderActivityReport() {
  const body = document.getElementById('activityRepBody');
  if (!body) return;
  body.innerHTML = '<div class="p-6 text-center text-slate-400 text-sm">Loading...</div>';
  const filter = (document.getElementById('actFilter') || {}).value || 'ALL';
  const q = ((document.getElementById('actSearch') || {}).value || '').trim().toLowerCase();
  const events = [];

  function pushEv(e) {
    if (!e.date) e.date = '';
    if (!e.category) e.category = classifyActivityAction(e.action || e.text || '');
    events.push(e);
  }

  try {
    // 1) activityLogs
    try {
      let snap;
      try {
        snap = await col('activityLogs').orderBy('createdAt', 'desc').limit(200).get();
      } catch (e1) {
        snap = await col('activityLogs').limit(200).get();
      }
      snap.forEach(doc => {
        const d = doc.data();
        pushEv({
          id: doc.id,
          date: d.date || (d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString().slice(0,10) : ''),
          time: d.time || '',
          action: d.action || '',
          detail: d.detail || '',
          by: d.createdBy || '',
          name: d.customerName || '',
          custId: d.custId || '',
          customerId: d.customerId || '',
          category: d.category || classifyActivityAction(d.action),
          amount: d.amount,
          ts: d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0
        });
      });
    } catch (e) { console.warn(e); }

    // 2) Recent collections as payment activity (backfill if logs empty)
    try {
      const t = new Date();
      const from = new Date(t); from.setDate(t.getDate() - 45);
      const fromS = from.toISOString().slice(0, 10);
      const toS = t.toISOString().slice(0, 10);
      const cols = await fetchCollectionsInRange(fromS, toS);
      const byId = {};
      (allCustomers || []).forEach(c => { byId[c.id] = c; });
      cols.forEach(r => {
        const c = r.customerId ? byId[r.customerId] : null;
        const name = (c && c.name) || r.customerName || r.name || '';
        const agent = (typeof displayAgentName === 'function') ? displayAgentName(r) : (r.collectedBy || '');
        pushEv({
          date: r.date || '',
          time: r.time || '',
          action: 'Payment Collected',
          detail: '₹' + Number(r.amount || 0).toLocaleString('en-IN') + ' · ' + (r.mode || 'Cash') + (r.billNo ? ' · Bill #' + r.billNo : ''),
          by: agent,
          name: name,
          custId: (c && c.custId) || r.custId || '',
          customerId: r.customerId || '',
          category: 'payment',
          amount: Number(r.amount || 0),
          ts: r.date ? Date.parse(r.date) : 0,
          synthetic: true
        });
      });
    } catch (e) { console.warn(e); }

    // 3) Transfers collection
    try {
      const t = await col('transfers').limit(50).get();
      t.forEach(doc => {
        const d = doc.data();
        pushEv({
          date: d.date || '',
          time: d.time || '',
          action: 'Transfer',
          detail: (d.fromStreet || '') + ' → ' + (d.toStreet || '') + (d.newCustId ? ' · ID ' + d.newCustId : ''),
          by: d.createdBy || '',
          name: d.customerName || '',
          category: 'service',
          ts: d.date ? Date.parse(d.date) : 0
        });
      });
    } catch (e) {}

    // Dedupe synthetic payments if real log exists
    const seen = new Set();
    const deduped = [];
    events.sort((a, b) => (b.ts || 0) - (a.ts || 0) || String(b.date).localeCompare(String(a.date)) || String(b.time).localeCompare(String(a.time)));
    events.forEach(e => {
      const key = (e.synthetic ? 'syn|' : 'log|') + e.date + '|' + e.action + '|' + e.name + '|' + (e.detail || '');
      if (e.synthetic) {
        const realKey = 'log|' + e.date + '|Payment' + '|' + e.name;
        // keep synthetic for history visibility
      }
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(e);
    });

    let list = deduped;
    if (filter !== 'ALL') list = list.filter(e => e.category === filter);
    if (q) {
      list = list.filter(e =>
        String(e.name || '').toLowerCase().includes(q) ||
        String(e.action || '').toLowerCase().includes(q) ||
        String(e.detail || '').toLowerCase().includes(q) ||
        String(e.by || '').toLowerCase().includes(q) ||
        String(e.custId || '').toLowerCase().includes(q)
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const nToday = list.filter(e => e.date === today).length;
    const nPay = list.filter(e => e.category === 'payment').length;
    const nCust = list.filter(e => e.category === 'customer').length;
    const nSvc = list.filter(e => e.category === 'service').length;

    const icon = (cat, action) => {
      const a = String(action || '').toLowerCase();
      if (cat === 'payment' || a.includes('payment') || a.includes('collect')) return { bg: 'bg-emerald-100', t: 'text-emerald-700', s: '₹' };
      if (a.includes('disconnect') || a.includes('dc')) return { bg: 'bg-red-100', t: 'text-red-700', s: '⏻' };
      if (a.includes('package')) return { bg: 'bg-blue-100', t: 'text-blue-700', s: '📦' };
      if (a.includes('transfer')) return { bg: 'bg-amber-100', t: 'text-amber-700', s: '↔' };
      if (a.includes('whatsapp') || a.includes('sms')) return { bg: 'bg-green-100', t: 'text-green-700', s: '💬' };
      return { bg: 'bg-slate-100', t: 'text-slate-600', s: '•' };
    };

    // Group by date
    const groups = {};
    list.forEach(e => {
      const d = e.date || 'Unknown';
      if (!groups[d]) groups[d] = [];
      groups[d].push(e);
    });
    const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

    let html = '<div class="grid grid-cols-4 gap-1.5 mb-3">';
    html += '<div class="bg-white rounded-xl border p-2 text-center"><div class="text-base font-bold">' + nToday + '</div><div class="text-[9px] text-slate-400">Today</div></div>';
    html += '<div class="bg-white rounded-xl border p-2 text-center"><div class="text-base font-bold text-emerald-600">' + nPay + '</div><div class="text-[9px] text-slate-400">Payments</div></div>';
    html += '<div class="bg-white rounded-xl border p-2 text-center"><div class="text-base font-bold text-blue-600">' + nCust + '</div><div class="text-[9px] text-slate-400">Customer</div></div>';
    html += '<div class="bg-white rounded-xl border p-2 text-center"><div class="text-base font-bold text-amber-600">' + nSvc + '</div><div class="text-[9px] text-slate-400">Service</div></div></div>';

    if (!list.length) {
      html += '<div class="p-8 text-center text-slate-400 text-sm bg-white rounded-xl border">No activity yet<br><span class="text-[11px]">Payments / edits / DC இனிமேல் இங்கே வரும்</span></div>';
      body.innerHTML = html;
      return;
    }

    dates.forEach(d => {
      let label = d;
      if (d === today) label = 'Today · ' + d;
      else {
        const y = new Date(); y.setDate(y.getDate() - 1);
        if (d === y.toISOString().slice(0, 10)) label = 'Yesterday · ' + d;
      }
      html += '<div class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mt-3 mb-1.5 px-1">' + label + '</div>';
      html += '<div class="bg-white rounded-xl border divide-y overflow-hidden">';
      groups[d].forEach(e => {
        const ic = icon(e.category, e.action);
        const by = e.by ? String(e.by).split('@')[0].toUpperCase() : '';
        html += '<div class="px-3 py-2.5 flex gap-2.5 items-start">';
        html += '<div class="w-8 h-8 rounded-full ' + ic.bg + ' ' + ic.t + ' flex items-center justify-center text-xs shrink-0">' + ic.s + '</div>';
        html += '<div class="min-w-0 flex-1">';
        html += '<div class="text-sm font-medium text-slate-800">' + (e.action || 'Activity') + '</div>';
        if (e.name) html += '<div class="text-xs text-slate-700 mt-0.5">' + e.name + (e.custId ? ' · ' + e.custId : '') + '</div>';
        if (e.detail) html += '<div class="text-[11px] text-slate-500 mt-0.5">' + e.detail + '</div>';
        html += '<div class="text-[10px] text-slate-400 mt-1">' + (e.time || '') + (by ? ' · ' + by : '') + '</div>';
        html += '</div></div>';
      });
      html += '</div>';
    });

    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = '<div class="p-4 text-red-500 text-sm">' + (e.message || e) + '</div>';
  }
}


function setColAuditPreset(which) {
  const t = new Date();
  const iso = function (d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const fromEl = document.getElementById('colAuditFrom');
  const toEl = document.getElementById('colAuditTo');
  if (!fromEl || !toEl) return;
  if (which === 'today') {
    fromEl.value = iso(t);
    toEl.value = iso(t);
  } else if (which === 'week') {
    const f = new Date(t); f.setDate(t.getDate() - 6);
    fromEl.value = iso(f);
    toEl.value = iso(t);
  } else {
    fromEl.value = iso(t).slice(0, 8) + '01';
    toEl.value = iso(t);
  }
  renderColAuditReport();
}

window._colAuditRows = [];
window._colAuditByAgent = {};

async function renderColAuditReport() {
  const body = document.getElementById('colAuditBody');
  const sum = document.getElementById('colAuditSummary');
  if (!body) return;
  const t = new Date();
  const iso = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  const fromEl = document.getElementById('colAuditFrom');
  const toEl = document.getElementById('colAuditTo');
  if (fromEl && !fromEl.value) fromEl.value = iso.slice(0, 8) + '01';
  if (toEl && !toEl.value) toEl.value = iso;
  const from = (fromEl && fromEl.value) || iso.slice(0, 8) + '01';
  const to = (toEl && toEl.value) || iso;
  if (sum) sum.textContent = from + ' → ' + to;
  body.innerHTML = '<div class="p-6 text-center text-slate-400 text-sm">Loading...</div>';
  try {
    const rows = await fetchCollectionsInRange(from, to);
    window._colAuditRows = rows;
    const byAgent = {};
    let totalCash = 0, totalUpi = 0, totalOther = 0, total = 0;
    rows.forEach(function (r) {
      const a = (typeof displayAgentName === 'function') ? displayAgentName(r) : (r._agent || '-');
      byAgent[a] = byAgent[a] || { amt: 0, n: 0, cash: 0, upi: 0, other: 0, rows: [] };
      const amt = Number(r.amount || 0);
      byAgent[a].amt += amt;
      byAgent[a].n++;
      byAgent[a].rows.push(r);
      total += amt;
      const m = String(r.mode || '').toUpperCase();
      const ag = String(a).toUpperCase();
      // Online collector often stored as UPI/GPAY mode
      if (ag === 'ONLINE' || m.includes('UPI') || m.includes('GPAY') || m.includes('ONLINE')) {
        byAgent[a].upi += amt;
        totalUpi += amt;
      } else if (m.includes('CASH') || !m || ag !== 'ONLINE') {
        byAgent[a].cash += amt;
        totalCash += amt;
      } else {
        byAgent[a].other += amt;
        totalOther += amt;
      }
    });
    // Fix mode attribution: prefer mode field, fall back agent for ONLINE
    totalCash = 0; totalUpi = 0; totalOther = 0;
    Object.keys(byAgent).forEach(function (k) {
      byAgent[k].cash = 0; byAgent[k].upi = 0; byAgent[k].other = 0;
      byAgent[k].rows.forEach(function (r) {
        const amt = Number(r.amount || 0);
        const m = String(r.mode || '').toUpperCase();
        const ag = String(k).toUpperCase();
        if (m.includes('UPI') || m.includes('GPAY') || m.includes('ONLINE') || (ag === 'ONLINE' && !m.includes('CASH'))) {
          byAgent[k].upi += amt; totalUpi += amt;
        } else if (m.includes('CASH') || !m) {
          byAgent[k].cash += amt; totalCash += amt;
        } else {
          byAgent[k].other += amt; totalOther += amt;
        }
      });
    });
    window._colAuditByAgent = byAgent;

    // System total vs cash+upi+other should balance
    const modeSum = totalCash + totalUpi + totalOther;
    const diff = Math.round((total - modeSum) * 100) / 100;
    const balanced = Math.abs(diff) < 1;

    let html = '';
    html += '<div class="bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-2xl p-4 text-white shadow-sm">';
    html += '<div class="text-[11px] opacity-80 uppercase tracking-wide">Total Collection</div>';
    html += '<div class="text-2xl font-bold mt-0.5">₹' + total.toLocaleString('en-IN') + '</div>';
    html += '<div class="text-xs opacity-90 mt-1">' + rows.length + ' Transactions</div></div>';

    html += '<div class="bg-white rounded-xl border p-3">';
    html += '<div class="grid grid-cols-3 gap-2 text-center text-[11px] mb-2">';
    html += '<div><div class="text-slate-400">Cash</div><div class="font-semibold">₹' + totalCash.toLocaleString('en-IN') + '</div></div>';
    html += '<div><div class="text-slate-400">UPI</div><div class="font-semibold">₹' + totalUpi.toLocaleString('en-IN') + '</div></div>';
    html += '<div><div class="text-slate-400">Other</div><div class="font-semibold">₹' + totalOther.toLocaleString('en-IN') + '</div></div></div>';
    html += '<div class="text-xs ' + (balanced ? 'text-emerald-600' : 'text-red-600 font-semibold') + '">';
    html += balanced ? '✓ Audit Status: Balanced' : 'Difference: ₹' + Math.abs(diff).toLocaleString('en-IN') + ' ⚠';
    html += '</div></div>';

    const agents = Object.entries(byAgent).sort(function (a, b) { return b[1].amt - a[1].amt; });
    if (!agents.length) {
      html += '<div class="p-6 text-center text-slate-400">No data</div>';
      body.innerHTML = html;
      return;
    }

    agents.forEach(function (pair) {
      const k = pair[0];
      const v = pair[1];
      html += '<div class="bg-white rounded-xl border p-3">';
      html += '<div class="flex justify-between font-semibold text-sm"><span>' + k + '</span><span>₹' + v.amt.toLocaleString('en-IN') + '</span></div>';
      html += '<div class="text-[11px] text-slate-500 mt-1">' + v.n + ' Transactions</div>';
      html += '<div class="grid grid-cols-3 gap-1 mt-2 text-[11px] text-center">';
      html += '<div class="bg-slate-50 rounded p-1">Cash<br><b>₹' + v.cash.toLocaleString('en-IN') + '</b></div>';
      html += '<div class="bg-slate-50 rounded p-1">UPI<br><b>₹' + v.upi.toLocaleString('en-IN') + '</b></div>';
      html += '<div class="bg-slate-50 rounded p-1">Other<br><b>₹' + v.other.toLocaleString('en-IN') + '</b></div></div>';
      html += '<button type="button" onclick="showColAuditDetails(\'' + k.replace(/'/g, "\\'") + '\')" class="mt-2 w-full py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-medium">View Details →</button>';
      html += '</div>';
    });

    html += '<div id="colAuditDetail" class="hidden"></div>';
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = '<div class="p-4 text-red-500 text-sm">' + (e.message || e) + '</div>';
  }
}

function showColAuditDetails(agent) {
  const panel = document.getElementById('colAuditDetail');
  if (!panel) return;
  const data = (window._colAuditByAgent || {})[agent];
  if (!data) return;
  const byId = {};
  (allCustomers || []).forEach(function (c) { byId[c.id] = c; });
  const rows = (data.rows || []).slice().sort(function (a, b) {
    return String(b.date || '').localeCompare(String(a.date || ''));
  });
  let html = '<div class="bg-white rounded-xl border p-3 mt-2">';
  html += '<div class="flex justify-between items-center mb-2">';
  html += '<div><div class="font-semibold text-sm">' + agent + '</div>';
  html += '<div class="text-[11px] text-slate-500">' + rows.length + ' · ₹' + data.amt.toLocaleString('en-IN') + '</div></div>';
  html += '<button type="button" onclick="document.getElementById(\'colAuditDetail\').classList.add(\'hidden\')" class="text-xs text-slate-500 px-2">✕</button></div>';
  html += '<div class="max-h-[50vh] overflow-y-auto space-y-1">';
  rows.forEach(function (r) {
    const c = r.customerId ? byId[r.customerId] : null;
    const name = (c && c.name) || r.customerName || r.name || '—';
    const mode = r.mode || 'Cash';
    html += '<div class="flex justify-between gap-2 px-2 py-1.5 rounded-lg bg-slate-50 text-xs">';
    html += '<div class="min-w-0"><div class="font-medium truncate">' + name + '</div>';
    html += '<div class="text-slate-400">' + (r.date || '') + (r.billNo ? ' · #' + r.billNo : '') + ' · ' + mode + '</div></div>';
    html += '<div class="font-semibold shrink-0">₹' + Number(r.amount || 0).toLocaleString('en-IN') + '</div></div>';
  });
  html += '</div></div>';
  panel.innerHTML = html;
  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}


function setTrendPreset(which) {
  const t = new Date();
  const iso = function (d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const fromEl = document.getElementById('trendFrom');
  const toEl = document.getElementById('trendTo');
  if (!fromEl || !toEl) return;
  toEl.value = iso(t);
  if (which === 'month') {
    fromEl.value = iso(t).slice(0, 8) + '01';
  } else {
    const f = new Date(t);
    f.setDate(t.getDate() - (Number(which) - 1));
    fromEl.value = iso(f);
  }
  renderTrendReport();
}

function normalizeDateInput(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  let m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    // assume DD/MM/YYYY (India)
    return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  }
  const t = Date.parse(v);
  if (!isNaN(t)) {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  return v;
}

function eachDateInclusive(from, to) {
  const out = [];
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return out;
  if (a > b) return out;
  // safety: max 120 days
  let guard = 0;
  for (let d = new Date(a); d <= b && guard < 120; d.setDate(d.getDate() + 1), guard++) {
    out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
  }
  return out;
}

async function renderTrendReport() {
  const body = document.getElementById('trendBody');
  if (!body) return;
  const t = new Date();
  const isoNow = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  const fromEl = document.getElementById('trendFrom');
  const toEl = document.getElementById('trendTo');
  if (fromEl && !fromEl.value) fromEl.value = isoNow.slice(0, 8) + '01';
  if (toEl && !toEl.value) toEl.value = isoNow;
  let from = normalizeDateInput((fromEl && fromEl.value) || isoNow.slice(0, 8) + '01');
  let to = normalizeDateInput((toEl && toEl.value) || isoNow);
  if (from > to) { const tmp = from; from = to; to = tmp; }
  body.innerHTML = '<div class="p-6 text-center text-slate-400 text-sm">Loading...</div>';
  try {
    let rows = [];
    try {
      rows = await fetchCollectionsInRange(from, to);
    } catch (e1) {
      console.warn('trend fetch', e1);
      // fallback: load all collections limited client filter
      try {
        const snap = await col('collections').limit(2000).get();
        snap.forEach(function (doc) {
          const d = doc.data();
          if (d.status === 'cancelled') return;
          const dt = d.date || '';
          if (dt >= from && dt <= to) rows.push({ id: doc.id, ...d });
        });
      } catch (e2) {
        throw e1;
      }
    }

    const byDate = {};
    rows.forEach(function (r) {
      const d = r.date || '';
      if (!d) return;
      byDate[d] = (byDate[d] || 0) + Number(r.amount || 0);
    });
    const days = eachDateInclusive(from, to);
    const entries = days.length ? days.map(function (d) { return [d, byDate[d] || 0]; }) : Object.entries(byDate).sort(function (a, b) { return a[0].localeCompare(b[0]); });
    const total = entries.reduce(function (s, e) { return s + e[1]; }, 0);
    const nDays = Math.max(1, entries.length);
    const avg = Math.round(total / nDays);
    let bestD = '', bestA = -1, lowD = '', lowA = Infinity;
    entries.forEach(function (e) {
      if (e[1] > bestA) { bestA = e[1]; bestD = e[0]; }
      if (e[1] < lowA) { lowA = e[1]; lowD = e[0]; }
    });
    if (bestA < 0) bestA = 0;
    if (lowA === Infinity) lowA = 0;
    const max = Math.max(1, bestA);

    const W = 320, H = 120, pad = 8;
    const n = Math.max(1, entries.length);
    const barW = Math.max(2, (W - pad * 2) / n - 1);
    let bars = '';
    entries.forEach(function (e, i) {
      const h = Math.round((e[1] / max) * (H - pad * 2));
      const x = pad + i * ((W - pad * 2) / n);
      const y = H - pad - h;
      const isBest = e[0] === bestD && bestA > 0;
      bars += '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + barW.toFixed(1) + '" height="' + Math.max(h, e[1] > 0 ? 2 : 0) + '" rx="1" fill="' + (isBest ? '#10b981' : '#34d399') + '"/>';
    });
    const svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="w-full h-28">' + bars + '</svg>';

    let html = '';
    html += '<div class="text-xs text-slate-500 px-1">' + from + ' → ' + to + ' · ' + rows.length + ' bills</div>';
    html += '<div class="grid grid-cols-3 gap-2">';
    html += '<div class="bg-white rounded-xl border p-2.5 text-center"><div class="text-sm font-bold text-slate-800">₹' + total.toLocaleString('en-IN') + '</div><div class="text-[9px] text-slate-400">Total</div></div>';
    html += '<div class="bg-white rounded-xl border p-2.5 text-center"><div class="text-sm font-bold text-slate-800">₹' + avg.toLocaleString('en-IN') + '</div><div class="text-[9px] text-slate-400">Daily Avg</div></div>';
    html += '<div class="bg-white rounded-xl border p-2.5 text-center"><div class="text-sm font-bold text-emerald-600">₹' + bestA.toLocaleString('en-IN') + '</div><div class="text-[9px] text-slate-400">Best Day</div></div></div>';
    html += '<div class="bg-white rounded-xl border p-3">' + svg + '</div>';
    html += '<div class="grid grid-cols-2 gap-2">';
    html += '<div class="bg-white rounded-xl border p-3"><div class="text-[10px] text-emerald-600 font-medium">Best</div><div class="text-xs font-semibold mt-0.5">' + (bestD || '—') + '</div><div class="text-sm font-bold">₹' + bestA.toLocaleString('en-IN') + '</div></div>';
    html += '<div class="bg-white rounded-xl border p-3"><div class="text-[10px] text-slate-400 font-medium">Lowest</div><div class="text-xs font-semibold mt-0.5">' + (lowD || '—') + '</div><div class="text-sm font-bold">₹' + lowA.toLocaleString('en-IN') + '</div></div></div>';

    // Previous period — non-blocking after first paint
    html += '<div id="trendPrevBox" class="bg-white rounded-xl border p-3 text-xs text-slate-400">Comparing previous period…</div>';

    html += '<div class="bg-white rounded-xl border p-3">';
    html += '<div class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Daily Details</div>';
    if (!entries.length) {
      html += '<div class="text-slate-400 text-center py-4">No data</div>';
    } else {
      entries.forEach(function (e) {
        const pct = Math.round((e[1] / max) * 100);
        const zero = e[1] === 0;
        html += '<div class="mb-1.5"><div class="flex justify-between text-[11px] mb-0.5"><span class="' + (zero ? 'text-slate-400' : '') + '">' + e[0] + '</span><span class="font-medium ' + (zero ? 'text-slate-400' : '') + '">₹' + e[1].toLocaleString('en-IN') + '</span></div>';
        html += '<div class="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div class="h-full rounded-full ' + (zero ? 'bg-slate-200' : 'bg-emerald-500') + '" style="width:' + pct + '%"></div></div></div>';
      });
    }
    html += '</div>';

    body.innerHTML = html;

    // async previous comparison
    (async function () {
      const box = document.getElementById('trendPrevBox');
      if (!box) return;
      try {
        const fromDt = new Date(from + 'T00:00:00');
        const toDt = new Date(to + 'T00:00:00');
        const span = Math.round((toDt - fromDt) / 86400000) + 1;
        if (span < 1 || span > 120) {
          box.innerHTML = '<div class="text-slate-400">Previous period N/A</div>';
          return;
        }
        const prevTo = new Date(fromDt); prevTo.setDate(prevTo.getDate() - 1);
        const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (span - 1));
        const pIso = function (d) {
          return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        };
        const prevRows = await fetchCollectionsInRange(pIso(prevFrom), pIso(prevTo));
        const prevTotal = prevRows.reduce(function (s, r) { return s + Number(r.amount || 0); }, 0);
        const change = prevTotal ? Math.round(((total - prevTotal) / prevTotal) * 1000) / 10 : 0;
        box.innerHTML =
          '<div class="flex justify-between mb-1"><span class="text-slate-500">Previous ' + span + ' days</span><span>₹' + prevTotal.toLocaleString('en-IN') + '</span></div>' +
          '<div class="flex justify-between mb-1"><span class="text-slate-500">Current period</span><span class="font-semibold text-slate-800">₹' + total.toLocaleString('en-IN') + '</span></div>' +
          '<div class="text-sm font-bold ' + (change >= 0 ? 'text-emerald-600' : 'text-red-600') + '">' + (change >= 0 ? '↑' : '↓') + ' ' + Math.abs(change) + '%</div>';
      } catch (e) {
        box.innerHTML = '<div class="text-slate-400">Previous compare skipped</div>';
      }
    })();
  } catch (e) {
    console.error(e);
    body.innerHTML = '<div class="p-4 text-red-500 text-sm">Error: ' + (e.message || e) + '</div>';
  }
}

function openCollectorsPrintOut() {
  // Direct open — avoid showPage('reports') closing panels again
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  const page = document.getElementById('page-reports');
  if (page) page.classList.remove('hidden');
  currentPageId = 'reports';
  if (pageHistory[pageHistory.length - 1] !== 'reports') {
    pageHistory.push('reports');
    if (pageHistory.length > 30) pageHistory.shift();
  }
  const pt = document.getElementById('pageTitle');
  if (pt) pt.textContent = 'Collectors Print Out';
  const backBtn = document.getElementById('globalBackBtn');
  if (backBtn) backBtn.classList.remove('hidden');
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === 'reports' || item.dataset.page === 'monthBill');
  });
  document.getElementById('reportMenu')?.classList.add('hidden');
  document.querySelectorAll('.report-panel').forEach(p => p.classList.add('hidden'));
  const panel = document.getElementById('reportPanel-collection');
  if (panel) {
    panel.classList.remove('hidden');
  } else {
    showToast('Print panel not found', true);
    return;
  }
  if (typeof renderCollectionReport === 'function') renderCollectionReport();
  if (window.innerWidth < 1024) {
    document.getElementById('sidebar')?.classList.add('-translate-x-full');
    document.getElementById('sidebarOverlay')?.classList.add('hidden');
  }
}

function openReport(kind) {
  if (kind === 'transfer') {
    document.getElementById('reportMenu')?.classList.add('hidden');
    document.querySelectorAll('.report-panel').forEach(p => p.classList.add('hidden'));
    const p = document.getElementById('reportPanel-transfer');
    if (p) p.classList.remove('hidden');
    const t = new Date().toISOString().slice(0, 10);
    const f = document.getElementById('trRepFrom');
    const to = document.getElementById('trRepTo');
    if (f && !f.value) f.value = t.slice(0, 8) + '01';
    if (to && !to.value) to.value = t;
    renderTransferReport();
    return;
  }
  if (kind === 'agentDay') {
    document.getElementById('reportMenu')?.classList.add('hidden');
    document.querySelectorAll('.report-panel').forEach(p => p.classList.add('hidden'));
    const p = document.getElementById('reportPanel-agentDay');
    if (p) p.classList.remove('hidden');
    const t = new Date().toISOString().slice(0, 10);
    const f = document.getElementById('agentRepFrom');
    const to = document.getElementById('agentRepTo');
    if (f && !f.value) f.value = t.slice(0, 8) + '01';
    if (to && !to.value) to.value = t;
    const whoEl = document.getElementById('agentRepWho');
    if (whoEl) {
      if (!AGENT_LIST.length) buildAgentIndex();
      whoEl.innerHTML = '<option value="ALL">All</option>' +
        AGENT_LIST.map(a => `<option value="${a.key}">${a.name}</option>`).join('');
      whoEl.value = 'ALL'; // MSO view = all collectors
    }
    fillAgentRepMsoOptions();
    renderAgentDayReport();
    return;
  }
  const menu = document.getElementById('reportMenu');
  if (menu) menu.classList.add('hidden');
  document.querySelectorAll('.report-panel').forEach(p => p.classList.add('hidden'));
  const panel = document.getElementById('reportPanel-' + kind);
  if (panel) panel.classList.remove('hidden');
  if (kind === 'collection') renderCollectionReport();
  if (kind === 'colSummary') renderColSummaryReport();
  if (kind === 'customers') renderCustomerReport();
  if (kind === 'dc') renderDcReport();
  if (kind === 'package') renderPackageReport();
  if (kind === 'newConn') renderNewConnReport();
  if (kind === 'payMode') renderPayModeReport();
  if (kind === 'activity') renderActivityReport();
  if (kind === 'colAudit') renderColAuditReport();
  if (kind === 'trend') renderTrendReport();
}

async function renderTransferReport() {
  const from = document.getElementById('trRepFrom')?.value;
  const to = document.getElementById('trRepTo')?.value;
  const place = document.getElementById('trRepPlace')?.value || '';
  const typeF = (document.getElementById('trRepType') || {}).value || 'ALL';
  const body = document.getElementById('trRepBody');
  const sum = document.getElementById('trRepSummary');
  if (!body) return;
  body.innerHTML = '<div class="p-6 text-center text-slate-400">Loading...</div>';
  try {
    let snap;
    try {
      if (from && to) {
        snap = await col('transfers').where('date', '>=', from).where('date', '<=', to).get();
      } else {
        snap = await col('transfers').orderBy('date', 'desc').limit(500).get();
      }
    } catch (e1) {
      snap = await col('transfers').limit(500).get();
    }
    let rows = [];
    snap.forEach(function (doc) { rows.push({ id: doc.id, ...doc.data() }); });
    if (from && to) {
      rows = rows.filter(function (r) {
        const d = String(r.date || '');
        return d >= from && d <= to;
      });
    }
    if (place) {
      rows = rows.filter(function (r) {
        return String(r.fromPlace || '') === place || String(r.toPlace || '') === place;
      });
    }
    rows = rows.map(function (r) {
      const areaCh = String(r.fromPlace || '').trim() !== String(r.toPlace || '').trim();
      const streetCh = String(r.fromStreet || '').trim() !== String(r.toStreet || '').trim();
      return Object.assign({}, r, { _areaCh: areaCh, _streetCh: streetCh });
    });
    if (typeF === 'AREA') rows = rows.filter(function (r) { return r._areaCh; });
    if (typeF === 'STREET') rows = rows.filter(function (r) { return r._streetCh && !r._areaCh; });
    rows.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });

    const nArea = rows.filter(function (r) { return r._areaCh; }).length;
    const nStreet = rows.filter(function (r) { return r._streetCh && !r._areaCh; }).length;
    const latest = rows[0] ? (rows[0].date || '—') : '—';

    if (sum) sum.textContent = rows.length + ' transfers';

    let html = '';
    html += '<div class="grid grid-cols-4 gap-1.5 mb-3">';
    html += '<div class="bg-white rounded-xl border p-2 text-center"><div class="text-lg font-bold text-indigo-700">' + rows.length + '</div><div class="text-[9px] text-slate-400">Total</div></div>';
    html += '<div class="bg-white rounded-xl border p-2 text-center"><div class="text-lg font-bold text-amber-600">' + nArea + '</div><div class="text-[9px] text-slate-400">Area</div></div>';
    html += '<div class="bg-white rounded-xl border p-2 text-center"><div class="text-lg font-bold text-blue-600">' + nStreet + '</div><div class="text-[9px] text-slate-400">Street</div></div>';
    html += '<div class="bg-white rounded-xl border p-2 text-center"><div class="text-[11px] font-semibold text-slate-700 truncate">' + latest + '</div><div class="text-[9px] text-slate-400">Latest</div></div></div>';

    if (!rows.length) {
      html += '<div class="p-8 text-center text-slate-400 bg-white rounded-xl border">No customer transfers in selected period</div>';
      body.innerHTML = html;
      return;
    }

    const cards = rows.map(function (r) {
      const by = String(r.changedBy || r.createdBy || '').split('@')[0] || '—';
      const fromL = [r.fromPlace, r.fromStreet].filter(Boolean).join(' · ') || '—';
      const toL = [r.toPlace, r.toStreet].filter(Boolean).join(' · ') || '—';
      const idShow = r.toCustId || r.fromCustId || r.custId || '—';
      const cid = r.customerId || '';
      return '<div class="bg-white rounded-xl border p-3 shadow-sm">' +
        '<div class="font-semibold text-sm text-slate-900">' + (r.customerName || '—') + '</div>' +
        '<div class="text-[11px] text-slate-500">ID: ' + idShow + (r.fromCustId && r.toCustId && r.fromCustId !== r.toCustId ? ' · was ' + r.fromCustId : '') + '</div>' +
        '<div class="mt-2 text-xs text-slate-500">' + fromL + '</div>' +
        '<div class="text-center text-slate-300 text-xs my-0.5">↓</div>' +
        '<div class="text-xs font-medium text-emerald-700">' + toL + '</div>' +
        '<div class="flex justify-between items-center mt-2 pt-2 border-t border-slate-50">' +
        '<span class="text-[10px] text-slate-400">' + (r.date || '') + ' · ' + by + '</span>' +
        (cid ? '<button type="button" onclick="viewLedger(\'' + cid + '\')" class="text-xs text-indigo-600 font-medium">View →</button>' : '') +
        '</div></div>';
    }).join('');

    const table = '<div class="overflow-x-auto max-h-[70vh]"><table class="w-full text-xs">' +
      '<thead class="bg-slate-50 sticky top-0"><tr>' +
      '<th class="text-left p-2">Date</th><th class="text-left p-2">Name</th>' +
      '<th class="text-left p-2">From</th><th class="text-left p-2">To</th><th class="text-left p-2">By</th></tr></thead><tbody>' +
      rows.map(function (r) {
        const by = String(r.changedBy || r.createdBy || '').split('@')[0] || '—';
        return '<tr class="border-t">' +
          '<td class="p-2 whitespace-nowrap">' + (r.date || '-') + '</td>' +
          '<td class="p-2 font-medium">' + (r.customerName || '-') + '<div class="text-[10px] text-slate-400">' + (r.toCustId || r.custId || '') + '</div></td>' +
          '<td class="p-2 text-slate-500">' + (r.fromPlace || '') + ' / ' + (r.fromStreet || '') + '</td>' +
          '<td class="p-2 text-emerald-700">' + (r.toPlace || '') + ' / ' + (r.toStreet || '') + '</td>' +
          '<td class="p-2 text-slate-400">' + by + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    html += '<div class="md:hidden space-y-2">' + cards + '</div>';
    html += '<div class="hidden md:block bg-white rounded-xl border overflow-hidden">' + table + '</div>';
    body.innerHTML = html;
  } catch (e) {
    console.error(e);
    body.innerHTML = '<div class="p-4 text-red-500 text-sm">' + (e.message || e) +
      (String(e.message || '').includes('index') ? '<br>Firebase index create link console-ல் open செய்யுங்கள்' : '') + '</div>';
  }
}



function closeReportPanels() {
  document.querySelectorAll('.report-panel').forEach(p => p.classList.add('hidden'));
  const menu = document.getElementById('reportMenu');
  if (menu) menu.classList.remove('hidden');
}
function matchAreaPlace(place, area) {
  if (!area) return true;
  const p = String(place || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const a = String(area || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!p) return false;
  if (p === a) return true;
  if (p.includes(a) || a.includes(p)) return true;
  if (a === 'AREA 1' && (p === '1' || p === 'AREA1' || p.endsWith(' 1') || p.includes('AREA1'))) return true;
  if (a === 'AREA 2' && (p === '2' || p === 'AREA2' || p.endsWith(' 2') || p.includes('AREA2'))) return true;
  return false;
}

function onCustRepAreaChange() {
  const area = (document.getElementById('custRepArea') || {}).value || '';
  const streetSel = document.getElementById('custRepStreet');
  if (!streetSel) { renderCustomerReport(); return; }
  const streets = new Set();
  // 1) STREET_MASTER by area
  if (typeof STREET_MASTER !== 'undefined') {
    STREET_MASTER.forEach(function (s) {
      if (matchAreaPlace(s.place, area || s.place) && (!area || matchAreaPlace(s.place, area))) {
        if (s.street) streets.add(String(s.street).trim());
      }
    });
  }
  // 2) Firestore streets if loaded
  if (typeof allStreets !== 'undefined' && allStreets && allStreets.length) {
    allStreets.forEach(function (s) {
      const pl = s.place || s.area || '';
      const nm = s.name || s.street || '';
      if ((!area || matchAreaPlace(pl, area)) && nm) streets.add(String(nm).trim());
    });
  }
  // 3) Customer streets in that area
  (allCustomers || []).forEach(function (c) {
    if ((!area || matchAreaPlace(c.place, area)) && c.street) {
      streets.add(String(c.street).trim());
    }
  });
  const arr = Array.from(streets).filter(Boolean).sort(function (a, b) { return a.localeCompare(b, 'ta'); });
  streetSel.innerHTML = '<option value="">All Streets</option>' +
    arr.map(function (s) { return '<option value="' + s.replace(/"/g, '&quot;') + '">' + s + '</option>'; }).join('');
  renderCustomerReport();
}

function setCustRepChip(btn) {
  const v = btn.getAttribute('data-chip') || '';
  const hid = document.getElementById('custRepStatus');
  if (hid) hid.value = v;
  document.querySelectorAll('.cust-chip').forEach(b => {
    const on = b === btn;
    b.className = on
      ? 'cust-chip px-3 py-1.5 rounded-full text-xs bg-indigo-600 text-white'
      : 'cust-chip px-3 py-1.5 rounded-full text-xs bg-white border border-slate-200 text-slate-600';
  });
  renderCustomerReport();
}

function renderCustomerReport() {
  const st = (document.getElementById('custRepStatus') || {}).value || '';
  const area = (document.getElementById('custRepArea') || {}).value || '';
  const sort = (document.getElementById('custRepSort') || {}).value || 'id';
  const q = ((document.getElementById('custRepSearch') || {}).value || '').trim().toLowerCase();
  let list = (allCustomers || []).slice();

  // stats from full list
  const all = allCustomers || [];
  const nTotal = all.length;
  const nAct = all.filter(c => String(c.status || 'ACT').toUpperCase() !== 'DC').length;
  const nDc = all.filter(c => String(c.status || '').toUpperCase() === 'DC').length;
  const totalDue = all.reduce((s, c) => s + Number(c.dueAmt || c.due || 0), 0);
  const stats = document.getElementById('custRepStats');
  if (stats) {
    stats.innerHTML = `
      <div class="bg-white border rounded-xl p-2.5 text-center"><div class="text-lg font-bold text-slate-800">${nTotal.toLocaleString('en-IN')}</div><div class="text-[10px] text-slate-400">Total</div></div>
      <div class="bg-white border rounded-xl p-2.5 text-center"><div class="text-lg font-bold text-emerald-600">${nAct.toLocaleString('en-IN')}</div><div class="text-[10px] text-slate-400">Active</div></div>
      <div class="bg-white border rounded-xl p-2.5 text-center"><div class="text-lg font-bold text-red-500">${nDc}</div><div class="text-[10px] text-slate-400">DC</div></div>
      <div class="bg-white border rounded-xl p-2.5 text-center"><div class="text-lg font-bold text-amber-600">₹${totalDue.toLocaleString('en-IN')}</div><div class="text-[10px] text-slate-400">Total Due</div></div>`;
  }

  if (st === 'DC') list = list.filter(c => String(c.status || '').toUpperCase() === 'DC');
  else if (st === 'ACT') list = list.filter(c => String(c.status || 'ACT').toUpperCase() !== 'DC');
  else if (st === 'DUE') list = list.filter(c => Number(c.dueAmt || c.due || 0) > 0);
  if (area) {
    list = list.filter(c => matchAreaPlace(c.place, area));
  }
  const streetF = (document.getElementById('custRepStreet') || {}).value || '';
  if (streetF) list = list.filter(c => String(c.street || '').trim() === streetF);
  if (q) {
    list = list.filter(c => {
      const blob = [c.name, c.mobile, c.boxNo, c.custId, c.street].join(' ').toLowerCase();
      return blob.includes(q);
    });
  }
  if (sort === 'name') list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ta'));
  else if (sort === 'dueHigh') list.sort((a, b) => Number(b.dueAmt || b.due || 0) - Number(a.dueAmt || a.due || 0));
  else if (sort === 'dueLow') list.sort((a, b) => Number(a.dueAmt || a.due || 0) - Number(b.dueAmt || b.due || 0));
  else list.sort((a, b) => String(a.custId || '').localeCompare(String(b.custId || '')));

  const sum = document.getElementById('custRepSummary');
  if (sum) sum.textContent = list.length + ' showing';
  const body = document.getElementById('custRepBody');
  if (!body) return;
  if (!list.length) {
    body.innerHTML = '<div class="p-8 text-center text-slate-400 text-sm">No customers</div>';
    return;
  }
  const cards = list.map(c => {
    const due = Number(c.dueAmt || c.due || 0);
    const isDc = String(c.status || '').toUpperCase() === 'DC';
    const badge = isDc
      ? '<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">DC</span>'
      : '<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">ACTIVE</span>';
    const mobile = (c.mobile || '').toString().trim();
    const mobLine = mobile
      ? ('📞 ' + mobile)
      : '<span class="text-slate-400">📞 No mobile</span>';
    const dueLine = due > 0
      ? ('<span class="text-red-600 font-semibold">Due ₹' + due.toLocaleString('en-IN') + ' 🔴</span>')
      : '<span class="text-emerald-600 font-medium">Due ₹0 🟢</span>';
    const id = c.id;
    return `<div class="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">
      <div class="flex justify-between items-start gap-2">
        <div class="min-w-0">
          <div class="font-semibold text-slate-900 truncate">${c.name || '—'}</div>
          <div class="text-[11px] text-slate-500 mt-0.5">ID: ${c.custId || '—'} · ${badge}</div>
        </div>
        <div class="flex gap-1 shrink-0">
          ${mobile ? `<a href="tel:${mobile.replace(/\D/g,'')}" class="w-8 h-8 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center text-sm">📞</a>` : ''}
          ${mobile ? `<a href="https://wa.me/91${mobile.replace(/\D/g,'').slice(-10)}" target="_blank" class="w-8 h-8 rounded-full bg-green-50 text-green-700 flex items-center justify-center text-sm">💬</a>` : ''}
        </div>
      </div>
      <div class="text-sm text-slate-600 mt-1.5">${mobLine}</div>
      <div class="text-xs text-slate-500 mt-0.5">📍 ${c.street || '—'}${c.place ? ' · ' + c.place : ''}</div>
      <div class="flex justify-between items-center mt-2 pt-2 border-t border-slate-50">
        <div class="text-sm">${dueLine}</div>
        <button type="button" onclick="viewLedger('${id}')" class="text-xs text-indigo-600 font-medium">View →</button>
      </div>
    </div>`;
  }).join('');

  const tableRows = list.map(c => {
    const due = Number(c.dueAmt || c.due || 0);
    const st = String(c.status || 'ACT').toUpperCase();
    return `<tr class="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onclick="viewLedger('${c.id}')">
      <td class="px-3 py-2 font-mono text-xs text-slate-500">${c.custId || ''}</td>
      <td class="px-3 py-2 font-medium text-slate-800">${c.name || ''}</td>
      <td class="px-3 py-2 text-sm">${c.mobile || '<span class="text-slate-300">—</span>'}</td>
      <td class="px-3 py-2 text-xs text-slate-600">${c.street || ''}</td>
      <td class="px-3 py-2 text-xs text-slate-500">${c.place || ''}</td>
      <td class="px-3 py-2 text-right font-semibold ${due > 0 ? 'text-red-600' : 'text-slate-400'}">₹${due.toLocaleString('en-IN')}</td>
      <td class="px-3 py-2"><span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${st === 'DC' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}">${st === 'DC' ? 'DC' : 'ACT'}</span></td>
    </tr>`;
  }).join('');

  body.innerHTML = `
    <div class="md:hidden space-y-2">${cards}</div>
    <div class="hidden md:block bg-white rounded-xl border border-slate-100 overflow-hidden">
      <div class="overflow-x-auto max-h-[70vh]">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 sticky top-0 text-slate-500">
            <tr>
              <th class="text-left px-3 py-2.5 font-medium">ID</th>
              <th class="text-left px-3 py-2.5 font-medium">Name</th>
              <th class="text-left px-3 py-2.5 font-medium">Mobile</th>
              <th class="text-left px-3 py-2.5 font-medium">Street</th>
              <th class="text-left px-3 py-2.5 font-medium">Area</th>
              <th class="text-right px-3 py-2.5 font-medium">Due</th>
              <th class="text-left px-3 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>`;
}
function setDcChip(btn) {
  const v = btn.getAttribute('data-dcchip') || 'ALL';
  const hid = document.getElementById('dcRepChip');
  if (hid) hid.value = v;
  document.querySelectorAll('.dc-chip').forEach(function (b) {
    const on = b === btn;
    b.className = on
      ? 'dc-chip px-2.5 py-1 rounded-full text-xs bg-indigo-600 text-white'
      : 'dc-chip px-2.5 py-1 rounded-full text-xs bg-white border border-slate-200';
  });
  renderDcReport();
}

function parseDcDateISO(c) {
  const raw = String(c.dcDate || '').trim();
  if (!raw) return '';
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  const t = Date.parse(raw);
  if (!isNaN(t)) {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  return '';
}

function daysSinceDc(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  const ms = Date.now() - t;
  return Math.max(0, Math.floor(ms / 86400000));
}

function onDcRepAreaChange() {
  const area = (document.getElementById('dcRepArea') || {}).value || 'ALL';
  const streetSel = document.getElementById('dcRepStreet');
  if (!streetSel) return;
  const streets = new Set();
  (allCustomers || []).filter(function (c) { return String(c.status || '').toUpperCase() === 'DC'; }).forEach(function (c) {
    if (area === 'ALL' || (typeof matchAreaPlace === 'function' ? matchAreaPlace(c.place, area) : true)) {
      if (c.street) streets.add(String(c.street).trim());
    }
  });
  if (typeof STREET_MASTER !== 'undefined') {
    STREET_MASTER.forEach(function (s) {
      if (area === 'ALL' || (typeof matchAreaPlace === 'function' ? matchAreaPlace(s.place, area) : true)) {
        if (s.street) streets.add(String(s.street).trim());
      }
    });
  }
  streetSel.innerHTML = '<option value="ALL">All Streets</option>' +
    Array.from(streets).filter(Boolean).sort(function (a, b) { return a.localeCompare(b, 'ta'); })
      .map(function (s) { return '<option value="' + s.replace(/"/g, '&quot;') + '">' + s + '</option>'; }).join('');
  renderDcReport();
}

function renderDcReport() {
  const area = (document.getElementById('dcRepArea') || {}).value || 'ALL';
  const street = (document.getElementById('dcRepStreet') || {}).value || 'ALL';
  const reasonF = (document.getElementById('dcRepReason') || {}).value || 'ALL';
  const chip = (document.getElementById('dcRepChip') || {}).value || 'ALL';
  const q = ((document.getElementById('dcRepSearch') || {}).value || '').trim().toLowerCase();
  const monthStart = (function () {
    const t = new Date();
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-01';
  })();

  const allDc = (allCustomers || []).filter(function (c) {
    return String(c.status || '').toUpperCase() === 'DC';
  });

  const nTotal = allDc.length;
  const nMonth = allDc.filter(function (c) {
    const d = parseDcDateISO(c);
    return d && d >= monthStart;
  }).length;
  const nDue = allDc.filter(function (c) { return Number(c.dueAmt || c.due || 0) > 0; }).length;
  const nNoDue = nTotal - nDue;
  const kpi = document.getElementById('dcRepKpis');
  if (kpi) {
    kpi.innerHTML =
      '<div class="bg-white rounded-xl border p-2 text-center"><div class="text-lg font-bold text-red-600">' + nTotal + '</div><div class="text-[9px] text-slate-400">Total DC</div></div>' +
      '<div class="bg-white rounded-xl border p-2 text-center"><div class="text-lg font-bold text-amber-600">' + nMonth + '</div><div class="text-[9px] text-slate-400">This Month</div></div>' +
      '<div class="bg-white rounded-xl border p-2 text-center"><div class="text-lg font-bold text-red-500">' + nDue + '</div><div class="text-[9px] text-slate-400">With Due</div></div>' +
      '<div class="bg-white rounded-xl border p-2 text-center"><div class="text-lg font-bold text-emerald-600">' + nNoDue + '</div><div class="text-[9px] text-slate-400">No Due</div></div>';
  }

  let list = allDc.filter(function (c) {
    if (area !== 'ALL' && typeof matchAreaPlace === 'function' && !matchAreaPlace(c.place, area)) return false;
    if (street !== 'ALL' && String(c.street || '').trim() !== street) return false;
    const reason = String(c.dcReason || c.reason || '').trim() || '—';
    if (reasonF === '—') {
      if (reason !== '—') return false;
    } else if (reasonF !== 'ALL' && reason !== reasonF) return false;
    const due = Number(c.dueAmt || c.due || 0);
    const d = parseDcDateISO(c);
    if (chip === 'MONTH' && !(d && d >= monthStart)) return false;
    if (chip === 'DUE' && !(due > 0)) return false;
    if (chip === 'NODUE' && !(due <= 0)) return false;
    if (q) {
      const hay = [c.name, c.custId, c.boxNo, c.mobile, c.street, reason].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  list.sort(function (a, b) {
    const da = parseDcDateISO(a) || '';
    const db = parseDcDateISO(b) || '';
    if (da !== db) return db.localeCompare(da);
    return Number(b.dueAmt || b.due || 0) - Number(a.dueAmt || a.due || 0);
  });

  const totalDue = list.reduce(function (s, c) { return s + Number(c.dueAmt || c.due || 0); }, 0);
  const sum = document.getElementById('dcRepSummary');
  if (sum) sum.textContent = list.length + ' showing · Due ₹' + totalDue.toLocaleString('en-IN');

  const body = document.getElementById('dcRepBody');
  if (!body) return;
  if (!list.length) {
    body.innerHTML = '<div class="p-8 text-center text-slate-400 bg-white rounded-xl border">No DC customers in this filter</div>';
    return;
  }

  const cards = list.map(function (c) {
    const due = Number(c.dueAmt || c.due || 0);
    const iso = parseDcDateISO(c);
    const days = daysSinceDc(iso);
    const reason = String(c.dcReason || c.reason || '').trim() || '—';
    const mobile = String(c.mobile || '').replace(/\D/g, '');
    let daysTxt = '';
    if (days !== null) {
      if (days === 0) daysTxt = 'Today';
      else if (days === 1) daysTxt = '1 day ago';
      else daysTxt = days + ' days ago';
    }
    return '<div class="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">' +
      '<div class="flex justify-between items-start gap-2">' +
      '<div class="min-w-0"><div class="font-semibold text-slate-900 truncate">' + (c.name || '—') + '</div>' +
      '<div class="text-[11px] text-slate-500 mt-0.5">ID: ' + (c.custId || '—') + ' · <span class="text-red-600 font-medium">DC</span></div></div>' +
      '<div class="text-right shrink-0"><div class="text-sm font-bold ' + (due > 0 ? 'text-red-600' : 'text-emerald-600') + '">₹' + due.toLocaleString('en-IN') + '</div>' +
      (daysTxt ? '<div class="text-[10px] text-slate-400">' + daysTxt + '</div>' : '') + '</div></div>' +
      '<div class="text-xs text-slate-600 mt-1.5">📍 ' + (c.street || '—') + (c.place ? ' · ' + c.place : '') + '</div>' +
      '<div class="text-[11px] text-slate-500 mt-0.5">📦 ' + (c.boxNo || '—') + (iso ? ' · DC ' + iso : '') + '</div>' +
      '<div class="text-[11px] mt-0.5"><span class="text-slate-400">Reason:</span> ' + reason + '</div>' +
      '<div class="flex gap-2 mt-2.5 pt-2 border-t border-slate-50">' +
      '<button type="button" onclick="viewLedger(\'' + c.id + '\')" class="flex-1 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-medium">Ledger</button>' +
      '<button type="button" onclick="toggleDC(\'' + c.id + '\', \'DC\')" class="flex-1 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium">Reconnect</button>' +
      (mobile ? '<a href="tel:' + mobile + '" class="px-3 py-1.5 rounded-lg bg-slate-50 text-slate-700 text-xs font-medium">Call</a>' : '') +
      '</div></div>';
  }).join('');

  const table = '<div class="overflow-x-auto max-h-[70vh]"><table class="w-full text-sm">' +
    '<thead class="bg-slate-50 sticky top-0"><tr>' +
    '<th class="text-left px-2 py-2">ID</th><th class="text-left px-2 py-2">Name</th>' +
    '<th class="text-left px-2 py-2">DC Date</th><th class="text-left px-2 py-2">Reason</th>' +
    '<th class="text-left px-2 py-2">Box</th><th class="text-right px-2 py-2">Due</th><th class="text-left px-2 py-2">Action</th>' +
    '</tr></thead><tbody>' +
    list.map(function (c) {
      const due = Number(c.dueAmt || c.due || 0);
      const iso = parseDcDateISO(c);
      const reason = String(c.dcReason || c.reason || '').trim() || '—';
      return '<tr class="border-t hover:bg-slate-50">' +
        '<td class="px-2 py-1.5 font-mono text-xs">' + (c.custId || '') + '</td>' +
        '<td class="px-2 py-1.5 cursor-pointer" onclick="viewLedger(\'' + c.id + '\')">' + (c.name || '') + '</td>' +
        '<td class="px-2 py-1.5 text-xs whitespace-nowrap">' + (iso || '—') + '</td>' +
        '<td class="px-2 py-1.5 text-xs">' + reason + '</td>' +
        '<td class="px-2 py-1.5 text-xs font-mono">' + (c.boxNo || '') + '</td>' +
        '<td class="px-2 py-1.5 text-right font-medium ' + (due > 0 ? 'text-red-600' : 'text-emerald-600') + '">₹' + due.toLocaleString('en-IN') + '</td>' +
        '<td class="px-2 py-1.5 whitespace-nowrap">' +
        '<button type="button" onclick="viewLedger(\'' + c.id + '\')" class="text-indigo-600 text-xs mr-2">Ledger</button>' +
        '<button type="button" onclick="toggleDC(\'' + c.id + '\', \'DC\')" class="text-emerald-600 text-xs">RC</button></td></tr>';
    }).join('') + '</tbody></table></div>';

  body.innerHTML = '<div class="md:hidden space-y-2">' + cards + '</div>' +
    '<div class="hidden md:block bg-white rounded-xl border overflow-hidden">' + table + '</div>';
}

function onPkgRepAreaChange() {
  const area = (document.getElementById('pkgRepArea') || {}).value || 'ALL';
  const streetSel = document.getElementById('pkgRepStreet');
  if (!streetSel) return;
  const streets = new Set();
  if (typeof STREET_MASTER !== 'undefined') {
    STREET_MASTER.forEach(function (s) {
      if (area === 'ALL' || (typeof matchAreaPlace === 'function' ? matchAreaPlace(s.place, area) : true)) {
        if (s.street) streets.add(String(s.street).trim());
      }
    });
  }
  (allCustomers || []).forEach(function (c) {
    if (area === 'ALL' || (typeof matchAreaPlace === 'function' ? matchAreaPlace(c.place, area) : true)) {
      if (c.street) streets.add(String(c.street).trim());
    }
  });
  streetSel.innerHTML = '<option value="ALL">All Streets</option>' +
    Array.from(streets).filter(Boolean).sort(function (a, b) { return a.localeCompare(b, 'ta'); })
      .map(function (s) { return '<option value="' + s.replace(/"/g, '&quot;') + '">' + s + '</option>'; }).join('');
  renderPackageReport();
}

function getPkgRepCustomers() {
  const st = (document.getElementById('pkgRepStatus') || {}).value || 'ACT';
  const area = (document.getElementById('pkgRepArea') || {}).value || 'ALL';
  const street = (document.getElementById('pkgRepStreet') || {}).value || 'ALL';
  return (allCustomers || []).filter(function (c) {
    const status = String(c.status || 'ACT').toUpperCase();
    if (st === 'ACT' && status === 'DC') return false;
    if (st === 'DC' && status !== 'DC') return false;
    if (area !== 'ALL' && typeof matchAreaPlace === 'function' && !matchAreaPlace(c.place, area)) return false;
    if (area !== 'ALL' && typeof matchAreaPlace !== 'function' && String(c.place || '').toUpperCase() !== area) return false;
    if (street !== 'ALL' && String(c.street || '').trim() !== street) return false;
    return true;
  });
}

async function renderPackageReport() {
  const body = document.getElementById('pkgRepBody');
  if (!body) return;
  const list = getPkgRepCustomers();
  const map = new Map();
  let totalDue = 0;
  list.forEach(function (c) {
    const amt = Number(c.packageAmt || 0);
    if (!map.has(amt)) map.set(amt, { amt: amt, count: 0, due: 0 });
    const row = map.get(amt);
    row.count++;
    row.due += Number(c.dueAmt || c.due || 0);
    totalDue += Number(c.dueAmt || c.due || 0);
  });
  const rows = Array.from(map.values()).sort(function (a, b) { return b.count - a.count; });
  const rowsAsc = rows.slice().sort(function (a, b) { return a.amt - b.amt; });
  let expected = 0;
  rows.forEach(function (r) { expected += r.amt * r.count; });
  const nCust = list.length;
  const avg = nCust ? Math.round(expected / nCust) : 0;
  const highest = rows.length ? Math.max.apply(null, rows.map(function (r) { return r.amt; })) : 0;
  const maxCount = rows.length ? rows[0].count : 1;

  // Month collection (this month) for collection rate
  let collected = 0;
  try {
    const t = new Date();
    const from = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-01';
    const to = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    if (typeof fetchCollectionsInRange === 'function') {
      const colRows = await fetchCollectionsInRange(from, to);
      collected = colRows.reduce(function (s, r) { return s + Number(r.amount || 0); }, 0);
    }
  } catch (e) {}
  const rate = expected ? Math.round((collected / expected) * 1000) / 10 : 0;

  let html = '';

  // KPI
  html += '<div class="bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-2xl p-4 text-white shadow-sm">';
  html += '<div class="text-[11px] opacity-80 uppercase tracking-wide">Expected Monthly Billing</div>';
  html += '<div class="text-2xl font-bold mt-0.5">₹' + expected.toLocaleString('en-IN') + '</div></div>';

  html += '<div class="grid grid-cols-3 gap-2">';
  html += '<div class="bg-white rounded-xl border p-3 text-center"><div class="text-lg font-bold text-slate-800">' + nCust.toLocaleString('en-IN') + '</div><div class="text-[10px] text-slate-400">Customers</div></div>';
  html += '<div class="bg-white rounded-xl border p-3 text-center"><div class="text-lg font-bold text-slate-800">₹' + avg.toLocaleString('en-IN') + '</div><div class="text-[10px] text-slate-400">Avg Package</div></div>';
  html += '<div class="bg-white rounded-xl border p-3 text-center"><div class="text-lg font-bold text-slate-800">₹' + highest.toLocaleString('en-IN') + '</div><div class="text-[10px] text-slate-400">Highest</div></div></div>';

  // Collection performance
  html += '<div class="bg-white rounded-xl border p-3">';
  html += '<div class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Collection Performance (This Month)</div>';
  html += '<div class="flex justify-between text-sm mb-1"><span class="text-slate-500">Expected</span><span class="font-medium">₹' + expected.toLocaleString('en-IN') + '</span></div>';
  html += '<div class="flex justify-between text-sm mb-1"><span class="text-slate-500">Collected</span><span class="font-medium text-emerald-600">₹' + collected.toLocaleString('en-IN') + '</span></div>';
  html += '<div class="flex justify-between text-sm mb-2"><span class="text-slate-500">Rate</span><span class="font-bold ' + (rate >= 70 ? 'text-emerald-600' : rate >= 50 ? 'text-amber-600' : 'text-red-600') + '">' + rate + '%</span></div>';
  html += '<div class="h-2 bg-slate-100 rounded-full overflow-hidden"><div class="h-full rounded-full ' + (rate >= 70 ? 'bg-emerald-500' : rate >= 50 ? 'bg-amber-500' : 'bg-red-500') + '" style="width:' + Math.min(rate, 100) + '%"></div></div>';
  html += '<div class="text-[11px] text-slate-400 mt-2">Due outstanding (filtered): <span class="font-medium text-red-600">₹' + totalDue.toLocaleString('en-IN') + '</span></div></div>';

  // Top packages bars
  const top = rows.slice(0, 5);
  html += '<div class="bg-white rounded-xl border p-3">';
  html += '<div class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Top Packages</div>';
  top.forEach(function (r) {
    const pct = maxCount ? Math.round((r.count / maxCount) * 100) : 0;
    const sub = r.amt * r.count;
    html += '<button type="button" onclick="showPkgCustomers(' + r.amt + ')" class="w-full text-left mb-2.5 last:mb-0">';
    html += '<div class="flex justify-between text-xs mb-0.5"><span class="font-semibold">₹' + r.amt.toLocaleString('en-IN') + '</span>';
    html += '<span class="text-slate-500">' + r.count + ' · ₹' + sub.toLocaleString('en-IN') + '</span></div>';
    html += '<div class="h-2 bg-slate-100 rounded-full overflow-hidden"><div class="h-full bg-indigo-500 rounded-full" style="width:' + pct + '%"></div></div>';
    html += '</button>';
  });
  html += '</div>';

  // Full table
  html += '<div class="bg-white rounded-xl border overflow-hidden">';
  html += '<div class="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide border-b">Package Summary</div>';
  html += '<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="bg-slate-50 text-slate-500"><tr>';
  html += '<th class="text-left px-3 py-2 font-medium">Package</th>';
  html += '<th class="text-right px-3 py-2 font-medium">Cust</th>';
  html += '<th class="text-right px-3 py-2 font-medium">Monthly</th>';
  html += '<th class="text-right px-3 py-2 font-medium">Due</th>';
  html += '</tr></thead><tbody>';
  rowsAsc.forEach(function (r) {
    html += '<tr class="border-t hover:bg-indigo-50 cursor-pointer" onclick="showPkgCustomers(' + r.amt + ')">';
    html += '<td class="px-3 py-2 font-medium">₹' + r.amt.toLocaleString('en-IN') + '</td>';
    html += '<td class="px-3 py-2 text-right">' + r.count + '</td>';
    html += '<td class="px-3 py-2 text-right">₹' + (r.amt * r.count).toLocaleString('en-IN') + '</td>';
    html += '<td class="px-3 py-2 text-right text-red-600">₹' + r.due.toLocaleString('en-IN') + '</td></tr>';
  });
  html += '</tbody></table></div></div>';

  html += '<div id="pkgCustPanel" class="hidden"></div>';

  body.innerHTML = html;
}

function showPkgCustomers(amt) {
  const panel = document.getElementById('pkgCustPanel');
  const body = document.getElementById('pkgRepBody');
  if (!panel && !body) return;
  const list = getPkgRepCustomers().filter(function (c) { return Number(c.packageAmt || 0) === Number(amt); });
  const expected = list.length * Number(amt);
  let html = '<div class="bg-white rounded-xl border p-3 mt-3">';
  html += '<div class="flex items-center justify-between mb-2">';
  html += '<div><div class="font-semibold text-sm">₹' + Number(amt).toLocaleString('en-IN') + ' Package</div>';
  html += '<div class="text-[11px] text-slate-500">' + list.length + ' customers · Expected ₹' + expected.toLocaleString('en-IN') + '/mo</div></div>';
  html += '<button type="button" onclick="document.getElementById(\'pkgCustPanel\').classList.add(\'hidden\')" class="text-xs text-slate-500 px-2 py-1">✕ Close</button></div>';
  html += '<div class="max-h-[50vh] overflow-y-auto space-y-1.5">';
  list.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'ta'); });
  list.forEach(function (c) {
    const due = Number(c.dueAmt || c.due || 0);
    html += '<button type="button" onclick="viewLedger(\'' + (c.id || '') + '\')" class="w-full text-left bg-slate-50 hover:bg-indigo-50 rounded-lg px-3 py-2">';
    html += '<div class="flex justify-between gap-2"><span class="font-medium text-sm truncate">' + (c.name || '—') + '</span>';
    html += '<span class="text-xs ' + (due > 0 ? 'text-red-600 font-semibold' : 'text-emerald-600') + '">₹' + due.toLocaleString('en-IN') + '</span></div>';
    html += '<div class="text-[11px] text-slate-500">ID: ' + (c.custId || '—') + ' · ' + (c.street || '—') + '</div></button>';
  });
  html += '</div></div>';
  if (panel) {
    panel.innerHTML = html;
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else if (body) {
    const wrap = document.createElement('div');
    wrap.id = 'pkgCustPanel';
    wrap.innerHTML = html;
    body.appendChild(wrap);
  }
}

// ==================== OFFLINE QUEUE ====================
const OFFLINE_KEY = 'jsv_offline_queue';

function getOfflineQueue() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]'); } catch (e) { return []; }
}
function setOfflineQueue(q) {
  localStorage.setItem(OFFLINE_KEY, JSON.stringify(q));
  updateOfflineBadges();
}
function queueOfflineOp(op) {
  const q = getOfflineQueue();
  op.id = 'off_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  op.queuedAt = new Date().toISOString();
  q.push(op);
  setOfflineQueue(q);
}
function updateOfflineBadges() {
  const off = document.getElementById('offlineBadge');
  const sync = document.getElementById('syncBadge');
  const q = getOfflineQueue();
  if (off) {
    if (!navigator.onLine) off.classList.remove('hidden');
    else off.classList.add('hidden');
  }
  if (sync) {
    if (q.length) {
      sync.classList.remove('hidden');
      sync.textContent = 'Sync ' + q.length;
    } else sync.classList.add('hidden');
  }
}
async function flushOfflineQueue() {
  if (!navigator.onLine) return;
  let q = getOfflineQueue();
  if (!q.length) { updateOfflineBadges(); return; }
  const sync = document.getElementById('syncBadge');
  if (sync) { sync.classList.remove('hidden'); sync.textContent = 'Syncing…'; }
  const remain = [];
  for (const op of q) {
    try {
      if (op.type === 'collection') {
        await col('collections').add(op.data);
        if (op.customerId != null) {
          await col('customers').doc(op.customerId).update({
            dueAmt: op.newDue,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
      } else if (op.type === 'expense') {
        await col('expenses').add(op.data);
      }
    } catch (e) {
      remain.push(op);
    }
  }
  setOfflineQueue(remain);
  if (!remain.length) showToast('Offline data synced');
  await loadCustomers();
  if (typeof updateDashboardStats === 'function') updateDashboardStats();
  updateOfflineBadges();
}
window.addEventListener('online', () => { updateOfflineBadges(); flushOfflineQueue(); });
window.addEventListener('offline', updateOfflineBadges);
document.addEventListener('DOMContentLoaded', updateOfflineBadges);

// ==================== EXPENSES ====================
function onExpCategoryChange() {
  const cat = document.getElementById('expCategory')?.value || '';
  const wrap = document.getElementById('expNameWrap');
  if (!wrap) return;
  const need = (cat === 'Donation' || cat === 'Monthly Salary');
  wrap.classList.toggle('hidden', !need);
}

async function saveExpense() {
  const amount = Number(document.getElementById('expAmount')?.value || 0);
  if (!amount || amount <= 0) { showToast('Enter amount', true); return; }
  let category = document.getElementById('expCategory')?.value || 'Other';
  const person = (document.getElementById('expPersonName')?.value || '').trim();
  if ((category === 'Donation' || category === 'Monthly Salary') && !person) {
    showToast('Name உள்ளிடவும்', true);
    return;
  }
  if (person && (category === 'Donation' || category === 'Monthly Salary')) {
    category = category + ' · ' + person;
  }
  const data = {
    date: new Date().toISOString().slice(0, 10), // always today only
    category,
    amount,
    personName: person || '',
    note: (document.getElementById('expNote')?.value || '').trim(),
    createdBy: currentUser?.email || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  try {
    if (!navigator.onLine) throw new Error('OFFLINE');
    await col('expenses').add(data);
    showToast('Expense saved · ₹' + amount);
  } catch (e) {
    const plain = { ...data, createdAt: new Date().toISOString() };
    queueOfflineOp({ type: 'expense', data: plain });
    showToast('Offline · expense queued');
  }
  document.getElementById('expAmount').value = '';
  document.getElementById('expNote').value = '';
  if (document.getElementById('expPersonName')) document.getElementById('expPersonName').value = '';
  loadExpenses();
}

async function loadExpenses() {
  const listEl = document.getElementById('expList');
  const totEl = document.getElementById('expMonthTotal');
  const todayEl = document.getElementById('expTodayTotal');
  if (!listEl) return;
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';
  try {
    const snap = await col('expenses').where('date', '>=', monthStart).get();
    const rows = [];
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const monthTotal = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const todayTotal = rows.filter(r => r.date === today).reduce((s, r) => s + Number(r.amount || 0), 0);
    if (totEl) totEl.textContent = '₹' + monthTotal.toLocaleString('en-IN');
    if (todayEl) todayEl.textContent = '₹' + todayTotal.toLocaleString('en-IN');
    listEl.innerHTML = rows.length ? rows.map(r => {
      const isToday = (r.date === today);
      return `
      <div class="py-2.5 flex justify-between gap-2 items-start">
        <div class="min-w-0">
          <div class="font-medium">${r.category || ''}</div>
          <div class="text-[10px] text-slate-500">${r.date || ''} · ${r.note || ''}</div>
          ${isToday ? `<div class="mt-1 flex gap-2">
            <button type="button" onclick="editExpense('${r.id}')" class="text-xs text-blue-600">Edit</button>
            <button type="button" onclick="deleteExpense('${r.id}')" class="text-xs text-red-600">Delete</button>
          </div>` : `<div class="text-[10px] text-slate-400 mt-0.5">Locked (today only edit)</div>`}
        </div>
        <div class="font-bold text-rose-600 shrink-0">₹${Number(r.amount||0).toLocaleString('en-IN')}</div>
      </div>`;
    }).join('') : '<div class="py-4 text-center text-slate-400">No expenses this month</div>';
  } catch (e) {
    listEl.innerHTML = '<div class="text-red-500 text-xs">' + e.message + '</div>';
  }
}

async function editExpense(id) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const snap = await col('expenses').doc(id).get();
    if (!snap.exists) { showToast('Not found', true); return; }
    const r = snap.data();
    if (r.date !== today) {
      showToast('இன்றைய expense மட்டும் edit செய்யலாம்', true);
      return;
    }
    const amt = prompt('Amount ₹', String(r.amount || ''));
    if (amt === null) return;
    const amount = Number(amt);
    if (!amount || amount <= 0) { showToast('Invalid amount', true); return; }
    const note = prompt('Note', r.note || '') ;
    if (note === null) return;
    await col('expenses').doc(id).update({
      amount,
      note: String(note).trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('Expense updated');
    loadExpenses();
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

async function deleteExpense(id) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const snap = await col('expenses').doc(id).get();
    if (!snap.exists) { showToast('Not found', true); return; }
    if (snap.data().date !== today) {
      showToast('இன்றைய expense மட்டும் delete செய்யலாம்', true);
      return;
    }
    if (!confirm('Delete this expense?')) return;
    await col('expenses').doc(id).delete();
    showToast('Deleted');
    loadExpenses();
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}
