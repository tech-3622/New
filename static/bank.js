(function () {
  let INFO = null;
  let HIST = [];
  let mode = 'deposit';
  let proofFile = null;
  let proofUrl = null;

  ICONS.withdraw = 'fa-money-bill-transfer';

  const BTN = 'w-full font-extrabold py-3.5 rounded-xl text-xs transition-all';
  const BTN_ON = BTN + ' bg-naija-500 hover:bg-naija-600 text-white';
  const BTN_OFF = BTN + ' bg-gray-800 text-gray-500 cursor-not-allowed';
  const INPUT = 'w-full bg-darkbg text-white px-4 py-3 rounded-xl border border-gray-800 focus:border-naija-500 focus:outline-none text-sm font-bold';
  const LABEL = 'block text-xs font-bold text-gray-300 uppercase mb-1';

  const card = document.querySelector('#action-modal > div');
  card.classList.add('max-h-[90vh]', 'overflow-y-auto');

  const hist = document.createElement('div');
  hist.className = 'glass-panel p-5 sm:p-6 rounded-3xl border border-naija-500/20';
  hist.innerHTML =
    '<div class="flex justify-between items-center mb-4">' +
    '<h3 class="text-base font-bold text-white">Transaction History</h3>' +
    '<span class="text-xs text-gray-400">Deposits &amp; withdrawals</span></div>' +
    '<div id="bank-history" class="space-y-3 overflow-y-auto max-h-96 pr-1"></div>';
  document.getElementById('tab-content-overview').appendChild(hist);

  function histRow(h) {
    const dep = h.type === 'deposit';
    const states = {
      pending: ['bg-amber-500/15 text-amber-400', '<i class="fa-solid fa-circle-notch animate-spin mr-1"></i>Pending'],
      approved: ['bg-emerald-500/15 text-emerald-400', '<i class="fa-solid fa-check mr-1"></i>Approved'],
      declined: ['bg-red-500/15 text-red-400', '<i class="fa-solid fa-xmark mr-1"></i>Declined']
    };
    const st = states[h.status] || ['bg-gray-800 text-gray-400', esc(h.status)];
    const color = h.status === 'declined' ? 'text-gray-500 line-through' : (dep ? 'text-emerald-400' : 'text-red-400');
    return `<div class="bg-darkbg/80 p-3 rounded-2xl border border-gray-800 text-xs">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center space-x-3 min-w-0">
          <div class="w-8 h-8 rounded-xl bg-darkcard flex items-center justify-center text-gray-300 border border-gray-800 shrink-0"><i class="fa-solid ${dep ? 'fa-arrow-down' : 'fa-arrow-up'}"></i></div>
          <div class="min-w-0"><span class="font-bold text-white block">${dep ? 'Deposit' : 'Withdrawal'}</span><span class="text-[10px] text-gray-400 block truncate">${esc(h.detail)}</span></div>
        </div>
        <div class="text-right shrink-0"><span class="font-bold block ${color}">${dep ? '+' : '-'}₦${fmt(h.amount)}</span><span class="text-[9px] text-gray-500">${ago(h.created_at)}</span></div>
      </div>
      <div class="flex items-center justify-between mt-2">
        <span class="text-[10px] font-bold px-2 py-1 rounded-lg ${st[0]}">${st[1]}</span>
        ${h.note ? `<span class="text-[10px] text-gray-400 truncate ml-2">${esc(h.note)}</span>` : ''}
      </div>
    </div>`;
  }

  function renderHistory() {
    const box = document.getElementById('bank-history');
    box.innerHTML = HIST.length
      ? HIST.map(histRow).join('')
      : '<p class="text-xs text-gray-500 text-center py-6">No deposits or withdrawals yet.</p>';
  }

  async function loadHistory() {
    const r = await api('/api/bank/history');
    if (r.ok) { HIST = r.data.history; renderHistory(); }
  }

  async function bankLoad() {
    const r = await api('/api/bank/info');
    if (r.ok) INFO = r.data;
  }

  const origLoadAll = window.loadAll;
  window.loadAll = async function () {
    await origLoadAll();
    await loadHistory();
  };

  setInterval(function () {
    if (HIST.some(function (h) { return h.status === 'pending'; })) loadAll();
  }, 20000);

  function pendingBanner(n, word) {
    if (!n) return '';
    return `<div class="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3">
      <i class="fa-solid fa-circle-notch animate-spin text-amber-400"></i>
      <span class="text-xs text-amber-300">${n} ${word}${n > 1 ? 's' : ''} waiting for approval</span>
    </div>`;
  }

  function waitingScreen(title, text) {
    return `<div class="text-center space-y-4 py-4">
      <div class="relative w-24 h-24 mx-auto flex items-center justify-center">
        <span class="absolute inset-0 rounded-full bg-amber-500/20 animate-ping"></span>
        <span class="absolute inset-3 rounded-full bg-amber-500/20 animate-pulse"></span>
        <i class="fa-solid fa-hourglass-half text-3xl text-amber-400 relative"></i>
      </div>
      <h3 class="text-lg font-bold text-white">${title}</h3>
      <p class="text-xs text-gray-400 leading-relaxed">${text}</p>
      <div class="flex items-center justify-center gap-2 text-xs text-amber-400 font-semibold"><i class="fa-solid fa-circle-notch animate-spin"></i><span>Pending approval</span></div>
      <button onclick="closeActionModal()" class="w-full bg-naija-500 hover:bg-naija-600 text-white font-bold py-3 rounded-xl text-xs">Done</button>
    </div>`;
  }

  function tabButtons() {
    const on = 'flex-1 py-2.5 rounded-lg text-xs font-bold text-white bg-naija-600 transition-all';
    const off = 'flex-1 py-2.5 rounded-lg text-xs font-bold text-gray-400 hover:text-white transition-all';
    return `<div class="flex bg-darkbg p-1 rounded-xl border border-gray-800">
      <button onclick="bankMode('deposit')" class="${mode === 'deposit' ? on : off}">Deposit</button>
      <button onclick="bankMode('withdraw')" class="${mode === 'withdraw' ? on : off}">Withdraw</button>
    </div>`;
  }

  function depositHtml() {
    const a = INFO.deposit_account;
    const banner = pendingBanner(INFO.pending_deposits, 'deposit');
    if (!a) {
      return banner + '<div class="bg-darkbg p-4 rounded-2xl border border-gray-800 text-xs text-gray-400 text-center">Deposits are not open yet. Please try again later.</div>';
    }
    return banner + `<div class="bg-darkbg p-4 rounded-2xl border border-gray-800 space-y-2 text-xs">
        <div class="text-[10px] uppercase tracking-wider text-gray-500">Step 1 · Send your payment to</div>
        <div class="flex justify-between"><span class="text-gray-400">Bank</span><span class="text-white font-bold">${esc(a.bank_name)}</span></div>
        <div class="flex justify-between items-center"><span class="text-gray-400">Account number</span>
          <span class="flex items-center gap-2"><span class="text-white font-mono font-bold tracking-wider">${esc(a.account_number)}</span>
          <button onclick="bankCopy()" class="text-naija-500 bg-naija-500/10 px-2 py-1 rounded-lg" title="Copy"><i class="fa-solid fa-copy"></i></button></span></div>
        <div class="flex justify-between"><span class="text-gray-400">Account name</span><span class="text-white font-bold text-right">${esc(a.account_name)}</span></div>
        ${a.note ? `<div class="text-[11px] text-amber-300 pt-1">${esc(a.note)}</div>` : ''}
      </div>
      <div>
        <label class="${LABEL}">Step 2 · Amount you sent (NGN)</label>
        <input type="number" id="bk-dep-amount" inputmode="decimal" oninput="bankCheck()" placeholder="Minimum ₦${fmt(INFO.min_deposit)}" class="${INPUT}">
      </div>
      <div>
        <label class="${LABEL}">Step 3 · Upload payment screenshot</label>
        <input type="file" id="bk-proof" accept="image/png,image/jpeg,image/webp" onchange="bankPicked(this)" class="hidden">
        <button type="button" onclick="document.getElementById('bk-proof').click()" class="w-full bg-darkbg border border-dashed border-naija-500/50 text-naija-500 font-bold py-3 rounded-xl text-xs">
          <i class="fa-solid fa-cloud-arrow-up mr-1.5"></i> Choose screenshot
        </button>
        <div id="bk-file-name" class="text-[11px] text-gray-500 mt-1.5 truncate">No screenshot chosen</div>
        <img id="bk-preview" alt="Screenshot preview" class="hidden mt-2 w-full max-h-40 object-cover rounded-xl border border-gray-800">
      </div>
      <button id="bk-dep-btn" onclick="bankSubmitDeposit()" disabled class="${BTN_OFF}">I Confirm Payment</button>`;
  }

  function withdrawHtml() {
    const b = INFO.bank;
    const banner = pendingBanner(INFO.pending_withdrawals, 'withdrawal');
    if (!b) {
      return banner + `<div class="bg-darkbg p-4 rounded-2xl border border-gray-800 text-xs text-gray-300 text-center space-y-3">
        <div>Add your bank account in your profile before you withdraw.</div>
        <a href="/profile" class="inline-block bg-naija-500 hover:bg-naija-600 text-white font-bold px-4 py-2.5 rounded-xl">Open Profile</a>
      </div>`;
    }
    const dest = `<div class="bg-darkbg p-4 rounded-2xl border border-gray-800 text-xs space-y-1">
      <div class="text-[10px] uppercase tracking-wider text-gray-500">Money will be sent to</div>
      <div class="text-white font-bold">${esc(b.bank_name)}</div>
      <div class="text-white font-mono font-bold tracking-wider">${esc(b.account_number)}</div>
      <div class="text-gray-300">${esc(b.account_name)}</div>
    </div>`;
    if (!INFO.has_pin) {
      return banner + dest + `<div class="bg-naija-500/10 border border-naija-500/30 rounded-2xl p-3 text-xs text-gray-300">
        First time withdrawing. Create a 4-digit PIN. You will use it for every withdrawal.
      </div>
      <div>
        <label class="${LABEL}">Create PIN</label>
        <input type="password" id="bk-pin1" inputmode="numeric" maxlength="4" placeholder="••••" class="${INPUT} tracking-[0.5em] text-center">
      </div>
      <div>
        <label class="${LABEL}">Confirm PIN</label>
        <input type="password" id="bk-pin2" inputmode="numeric" maxlength="4" placeholder="••••" class="${INPUT} tracking-[0.5em] text-center">
      </div>
      <button onclick="bankSavePin()" class="${BTN_ON}">Save PIN</button>`;
    }
    return banner + dest + `<div>
        <label class="${LABEL}">Amount (NGN)</label>
        <input type="number" id="bk-wd-amount" inputmode="decimal" placeholder="Minimum ₦${fmt(INFO.min_withdraw)}" class="${INPUT}">
      </div>
      <div>
        <label class="${LABEL}">Your PIN</label>
        <input type="password" id="bk-wd-pin" inputmode="numeric" maxlength="4" placeholder="••••" class="${INPUT} tracking-[0.5em] text-center">
      </div>
      <button onclick="bankSubmitWithdraw()" class="${BTN_ON}">Request Withdrawal</button>`;
  }

  function render() {
    const v = document.getElementById('modal-view-deposit');
    if (!INFO) {
      v.innerHTML = '<div class="text-center text-gray-400 text-sm py-10"><i class="fa-solid fa-circle-notch animate-spin mr-2"></i>Loading...</div>';
      return;
    }
    v.innerHTML =
      '<h3 class="text-xl font-bold text-white text-center">Bank Cash-In</h3>' +
      `<div class="text-center text-xs text-gray-400">Naira wallet: <span class="text-white font-bold">₦${fmt(INFO.balance)}</span></div>` +
      tabButtons() +
      (mode === 'deposit' ? depositHtml() : withdrawHtml());
  }

  function clearProof() {
    if (proofUrl) URL.revokeObjectURL(proofUrl);
    proofUrl = null;
    proofFile = null;
  }

  const origOpen = window.openActionModal;
  window.openActionModal = function (view) {
    origOpen(view);
    if (view === 'deposit') {
      clearProof();
      mode = 'deposit';
      INFO = null;
      render();
      bankLoad().then(render);
    }
  };

  window.bankMode = function (m) {
    mode = m;
    clearProof();
    render();
  };

  window.bankCopy = function () {
    const n = INFO && INFO.deposit_account ? INFO.deposit_account.account_number : '';
    try { navigator.clipboard.writeText(n); alert('Account number copied!'); }
    catch (e) { alert(n); }
  };

  window.bankCheck = function () {
    const btn = document.getElementById('bk-dep-btn');
    if (!btn) return;
    const amt = parseFloat(document.getElementById('bk-dep-amount').value);
    const ok = amt >= Number(INFO.min_deposit) && !!proofFile;
    btn.disabled = !ok;
    btn.className = ok ? BTN_ON : BTN_OFF;
  };

  window.bankPicked = function (input) {
    const f = input.files && input.files[0];
    const prev = document.getElementById('bk-preview');
    const name = document.getElementById('bk-file-name');
    clearProof();
    prev.classList.add('hidden');
    name.innerText = 'No screenshot chosen';
    if (f) {
      if (!/^image\/(png|jpeg|webp)$/.test(f.type)) {
        alert('Please choose a PNG, JPG or WEBP screenshot.');
        input.value = '';
      } else if (f.size > 5 * 1024 * 1024) {
        alert('Screenshot is too big (max 5MB).');
        input.value = '';
      } else {
        proofFile = f;
        proofUrl = URL.createObjectURL(f);
        prev.src = proofUrl;
        prev.classList.remove('hidden');
        name.innerText = f.name;
      }
    }
    bankCheck();
  };

  window.bankSubmitDeposit = async function () {
    const amount = document.getElementById('bk-dep-amount').value;
    if (!proofFile) { alert('Upload your payment screenshot first.'); return; }
    const btn = document.getElementById('bk-dep-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch animate-spin mr-1.5"></i> Sending...';
    const fd = new FormData();
    fd.append('amount', amount);
    fd.append('proof', proofFile);
    let ok = false, data = {};
    try {
      const r = await fetch('/api/bank/deposit', { method: 'POST', credentials: 'same-origin', body: fd });
      if (r.status === 401) { location.href = '/login'; return; }
      data = await r.json().catch(function () { return {}; });
      ok = r.ok && data.ok;
    } catch (e) {
      data = { error: 'Network error. Is the server running?' };
    }
    if (!ok) {
      alert(data.error || 'Could not send your payment.');
      btn.innerHTML = 'I Confirm Payment';
      bankCheck();
      return;
    }
    clearProof();
    document.getElementById('modal-view-deposit').innerHTML = waitingScreen(
      'Confirming your payment',
      'We received your screenshot. Your Naira wallet will be credited as soon as the payment is approved.'
    );
    loadAll();
  };

  window.bankSavePin = async function () {
    const p1 = document.getElementById('bk-pin1').value;
    const p2 = document.getElementById('bk-pin2').value;
    if (!/^\d{4}$/.test(p1)) { alert('PIN must be exactly 4 digits.'); return; }
    if (p1 !== p2) { alert('The two PINs do not match.'); return; }
    const r = await api('/api/bank/pin', { pin: p1 });
    if (!r.ok) { alert(r.data.error || 'Could not save your PIN.'); return; }
    await bankLoad();
    render();
  };

  window.bankSubmitWithdraw = async function () {
    const amount = document.getElementById('bk-wd-amount').value;
    const pin = document.getElementById('bk-wd-pin').value;
    if (!(parseFloat(amount) >= Number(INFO.min_withdraw))) {
      alert('Minimum withdrawal is ₦' + fmt(INFO.min_withdraw) + '.');
      return;
    }
    if (!/^\d{4}$/.test(pin)) { alert('Enter your 4-digit PIN.'); return; }
    const r = await api('/api/bank/withdraw', { amount, pin });
    if (!r.ok) { alert(r.data.error || 'Withdrawal failed.'); return; }
    document.getElementById('modal-view-deposit').innerHTML = waitingScreen(
      'Withdrawal requested',
      'Your money is on hold while we send it to your bank. If it is declined, it goes back to your wallet.'
    );
    loadAll();
  };
})();
