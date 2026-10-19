(function () {
  let view = 'deposits';
  let deposits = [];
  let withdrawals = [];
  let settings = {};

  const usersBtn = document.getElementById('btn-users');
  const tabBtn = document.createElement('button');
  tabBtn.id = 'btn-payments';
  tabBtn.className = usersBtn.className.replace('tab-on', '').trim();
  tabBtn.innerHTML = '<i class="fa-solid fa-building-columns mr-2"></i>Payments <span id="pay-badge" class="hidden ml-1 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full"></span>';
  tabBtn.onclick = function () { showTab('payments'); };
  usersBtn.after(tabBtn);

  const sec = document.createElement('section');
  sec.id = 'tab-payments';
  sec.className = 'hidden';
  sec.innerHTML =
    '<div class="flex gap-2 mb-4 overflow-x-auto">' +
    '<button id="pv-deposits" onclick="payView(\'deposits\')" class="shrink-0 text-xs font-bold px-4 py-2 rounded-xl border border-gray-800 text-gray-300">Deposits</button>' +
    '<button id="pv-withdrawals" onclick="payView(\'withdrawals\')" class="shrink-0 text-xs font-bold px-4 py-2 rounded-xl border border-gray-800 text-gray-300">Withdrawals</button>' +
    '<button id="pv-settings" onclick="payView(\'settings\')" class="shrink-0 text-xs font-bold px-4 py-2 rounded-xl border border-gray-800 text-gray-300">Deposit Account</button>' +
    '</div><div id="pay-body"></div>';
  document.querySelector('main').appendChild(sec);

  const origShow = window.showTab;
  window.showTab = function (name) {
    origShow(name);
    sec.classList.toggle('hidden', name !== 'payments');
    tabBtn.classList.toggle('tab-on', name === 'payments');
    if (name === 'payments') loadPay();
  };

  function empty(text) {
    return '<div class="box p-6 text-center text-gray-400 text-sm">' + text + '</div>';
  }

  function badge(status) {
    const colors = {
      pending: 'bg-amber-500/15 text-amber-400',
      approved: 'bg-emerald-500/15 text-emerald-400',
      declined: 'bg-red-500/15 text-red-400'
    };
    return '<span class="text-[10px] uppercase font-bold px-2 py-1 rounded-lg ' + (colors[status] || '') + '">' + esc(status) + '</span>';
  }

  function buttons(kind, id) {
    return '<div class="flex gap-2 mt-3">' +
      '<button onclick="payAct(\'' + kind + '\',' + Number(id) + ',\'approve\')" class="flex-1 bg-naija-500 hover:bg-naija-600 text-white text-xs font-bold py-2.5 rounded-xl">Approve</button>' +
      '<button onclick="payAct(\'' + kind + '\',' + Number(id) + ',\'decline\')" class="flex-1 bg-red-500/15 text-red-400 border border-red-500/30 text-xs font-bold py-2.5 rounded-xl">Decline</button>' +
      '</div>';
  }

  function depBox(d) {
    const name = d.full_name || d.username;
    return '<div class="box p-4">' +
      '<div class="flex justify-between items-start gap-2">' +
      '<div class="min-w-0"><div class="font-bold text-white truncate">' + esc(name) + '</div>' +
      '<div class="text-xs text-gray-400 truncate">' + esc(d.email) + '</div></div>' + badge(d.status) + '</div>' +
      '<div class="text-xl font-extrabold text-white mt-3">' + esc(naira(d.amount)) + '</div>' +
      '<div class="text-[11px] text-gray-500 mt-1">' + esc((d.created_at || '').slice(0, 16)) + '</div>' +
      '<a href="/api/admin/proof/' + Number(d.id) + '" target="_blank"><img src="/api/admin/proof/' + Number(d.id) + '" alt="Payment screenshot" class="mt-3 w-full max-h-48 object-cover rounded-xl border border-gray-800"></a>' +
      (d.status === 'pending' ? buttons('deposits', d.id) : (d.admin_note ? '<div class="text-xs text-gray-400 mt-3">' + esc(d.admin_note) + '</div>' : '')) +
      '</div>';
  }

  function wdBox(w) {
    const name = w.full_name || w.username;
    return '<div class="box p-4">' +
      '<div class="flex justify-between items-start gap-2">' +
      '<div class="min-w-0"><div class="font-bold text-white truncate">' + esc(name) + '</div>' +
      '<div class="text-xs text-gray-400 truncate">' + esc(w.email) + '</div></div>' + badge(w.status) + '</div>' +
      '<div class="text-xl font-extrabold text-white mt-3">' + esc(naira(w.amount)) + '</div>' +
      '<div class="text-[11px] text-gray-500 mt-1">' + esc((w.created_at || '').slice(0, 16)) + '</div>' +
      '<div class="bg-darkbg border border-gray-800 rounded-xl p-3 mt-3 text-xs">' +
      '<div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Send money to</div>' +
      '<div class="text-white font-semibold">' + esc(w.bank_name) + '</div>' +
      '<div class="text-white text-base font-bold tracking-wider">' + esc(w.account_number) + '</div>' +
      '<div class="text-gray-300">' + esc(w.account_name) + '</div></div>' +
      (w.status === 'pending' ? buttons('withdrawals', w.id) : (w.admin_note ? '<div class="text-xs text-gray-400 mt-3">' + esc(w.admin_note) + '</div>' : '')) +
      '</div>';
  }

  function settingsForm() {
    function input(id, label, value, ph) {
      return '<div><label class="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1.5">' + label + '</label>' +
        '<input id="' + id + '" value="' + esc(value) + '" placeholder="' + ph + '" class="w-full bg-darkbg text-white px-4 py-3 rounded-xl border border-gray-800 focus:border-naija-500 focus:outline-none text-sm"></div>';
    }
    return '<div class="box p-5 max-w-lg space-y-4">' +
      '<div class="text-sm text-gray-300">Users will pay into this account when they deposit.</div>' +
      input('st-bank', 'Bank name', settings.bank_name, 'e.g. GTBank') +
      input('st-number', 'Account number', settings.account_number, '0123456789') +
      input('st-name', 'Account name', settings.account_name, 'Account holder name') +
      input('st-note', 'Note for users (optional)', settings.note, 'e.g. Use your username as the reference') +
      '<button onclick="paySave()" class="w-full bg-naija-500 hover:bg-naija-600 text-white font-extrabold py-3.5 rounded-xl text-sm">Save</button>' +
      '</div>';
  }

  function renderBody() {
    ['deposits', 'withdrawals', 'settings'].forEach(function (v) {
      document.getElementById('pv-' + v).classList.toggle('tab-on', v === view);
    });
    const body = document.getElementById('pay-body');
    const grid = '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">';
    if (view === 'deposits') {
      body.innerHTML = deposits.length ? grid + deposits.map(depBox).join('') + '</div>' : empty('No deposits yet.');
    } else if (view === 'withdrawals') {
      body.innerHTML = withdrawals.length ? grid + withdrawals.map(wdBox).join('') + '</div>' : empty('No withdrawals yet.');
    } else {
      body.innerHTML = settingsForm();
    }
  }

  async function getJson(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    return r.json().catch(function () { return null; });
  }

  async function loadPay() {
    const res = await Promise.all([
      getJson('/api/admin/deposits'),
      getJson('/api/admin/withdrawals'),
      getJson('/api/admin/bank/settings')
    ]);
    if (res[0] && res[0].ok) deposits = res[0].deposits;
    if (res[1] && res[1].ok) withdrawals = res[1].withdrawals;
    if (res[2] && res[2].ok && view !== 'settings') settings = res[2].settings;
    else if (res[2] && res[2].ok && !settings.bank_name) settings = res[2].settings;
    const pending = deposits.filter(function (d) { return d.status === 'pending'; }).length +
      withdrawals.filter(function (w) { return w.status === 'pending'; }).length;
    const b = document.getElementById('pay-badge');
    b.textContent = pending;
    b.classList.toggle('hidden', pending === 0);
    if (view !== 'settings') renderBody();
  }

  window.payView = function (v) {
    view = v;
    renderBody();
  };

  window.payAct = async function (kind, id, action) {
    let note = '';
    if (action === 'approve') {
      const text = kind === 'deposits'
        ? 'Approve this deposit? The money will be added to the user wallet.'
        : 'Approve this withdrawal? Only do this after you have sent the money.';
      if (!confirm(text)) return;
    } else {
      const n = prompt('Reason for declining (optional)');
      if (n === null) return;
      note = n;
    }
    const r = await fetch('/api/admin/' + kind + '/' + id + '/' + action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: note })
    });
    const d = await r.json().catch(function () { return {}; });
    if (!d.ok) alert(d.error || 'Something went wrong.');
    await loadPay();
  };

  window.paySave = async function () {
    const body = {
      bank_name: document.getElementById('st-bank').value,
      account_number: document.getElementById('st-number').value,
      account_name: document.getElementById('st-name').value,
      note: document.getElementById('st-note').value
    };
    const r = await fetch('/api/admin/bank/settings', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const d = await r.json().catch(function () { return {}; });
    if (d.ok) settings = body;
    alert(d.ok ? d.message : (d.error || 'Could not save.'));
  };

  loadPay();
  setInterval(function () { if (view !== 'settings') loadPay(); }, 30000);
})();
