(function () {
  const $ = function (id) { return document.getElementById(id); };
  const NOTIF = ['Payment Received', 'Deposit Approved', 'Deposit Declined', 'Withdrawal Approved', 'Withdrawal Declined'];
  const NAV_ON = 'flex items-center space-x-3 px-4 py-3 rounded-2xl font-bold text-xs sm:text-sm transition-all whitespace-nowrap bg-naija-500/20 text-naija-500 border border-naija-500/30';
  const NAV_OFF = 'flex items-center space-x-3 px-4 py-3 rounded-2xl font-bold text-xs sm:text-sm transition-all whitespace-nowrap text-gray-400 hover:text-white hover:bg-darkcard border border-transparent';
  const ERR = /insufficient|not enough|invalid|failed|could not|can't|cannot|not found|enter |please|too |wrong|already|must|only |network|no rewards|choose|minimum|between|not available|try again/i;

  const css = document.createElement('style');
  css.textContent =
    '@keyframes toastIn { from { opacity: 0; transform: translateY(-8px) scale(.98); } to { opacity: 1; transform: none; } }' +
    '@keyframes toastOut { to { opacity: 0; transform: translateX(20px); } }' +
    '@keyframes barMove { 0% { transform: translateX(-100%); } 100% { transform: translateX(260%); } }' +
    '.toast-in { animation: toastIn .22s ease-out; }' +
    '.toast-out { animation: toastOut .2s ease-in forwards; }' +
    '.top-bar-run { animation: barMove 1.1s ease-in-out infinite; }';
  document.head.appendChild(css);

  const toastWrap = document.createElement('div');
  toastWrap.className = 'fixed top-20 right-3 z-[60] space-y-2 w-80 max-w-[calc(100vw-1.5rem)] pointer-events-none';
  document.body.appendChild(toastWrap);

  const topBar = document.createElement('div');
  topBar.className = 'fixed top-0 left-0 right-0 h-1 z-[70] overflow-hidden hidden';
  topBar.innerHTML = '<div class="top-bar-run h-full w-2/5 bg-gradient-to-r from-naija-500 via-emerald-400 to-gold-400"></div>';
  document.body.appendChild(topBar);

  let busy = 0;
  function begin() { busy++; topBar.classList.remove('hidden'); }
  function end() { busy = Math.max(0, busy - 1); if (busy === 0) topBar.classList.add('hidden'); }

  function toast(message, type) {
    type = type || 'success';
    const styles = {
      success: ['border-emerald-500/40', 'text-emerald-400', 'fa-circle-check'],
      error: ['border-red-500/40', 'text-red-400', 'fa-triangle-exclamation'],
      info: ['border-naija-500/40', 'text-naija-500', 'fa-circle-info']
    };
    const c = styles[type] || styles.success;
    const el = document.createElement('div');
    el.className = 'toast-in glass-panel border ' + c[0] + ' rounded-2xl p-3 flex items-start gap-3 shadow-2xl pointer-events-auto';
    el.innerHTML =
      '<i class="fa-solid ' + c[2] + ' ' + c[1] + ' mt-0.5"></i>' +
      '<div class="text-xs text-gray-100 flex-1 leading-relaxed break-words"></div>' +
      '<button type="button" class="text-gray-500 hover:text-white text-xs" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>';
    el.querySelector('div').textContent = message;
    toastWrap.appendChild(el);
    function close() {
      el.classList.add('toast-out');
      setTimeout(function () { el.remove(); }, 200);
    }
    el.querySelector('button').onclick = close;
    setTimeout(close, type === 'error' ? 6000 : 4500);
  }
  window.toast = toast;

  window.alert = function (m) {
    const s = String(m);
    toast(s, ERR.test(s) ? 'error' : 'success');
  };

  function rm(id) {
    const el = $(id);
    if (el) el.remove();
  }

  const roleBtn = $('btn-role-personal');
  if (roleBtn && roleBtn.parentElement) roleBtn.parentElement.remove();
  rm('nav-pos');
  rm('tab-content-pos');

  const stakeNum = $('bal-staking');
  if (stakeNum) {
    const stakeCard = stakeNum.closest('.glass-panel');
    if (stakeCard) stakeCard.remove();
  }
  const stub = document.createElement('span');
  stub.id = 'bal-staking';
  stub.className = 'hidden';
  document.body.appendChild(stub);

  const demo = Array.prototype.find.call(document.querySelectorAll('span'), function (s) {
    return s.children.length === 0 && s.textContent.trim() === 'Demo';
  });
  if (demo) demo.remove();

  const cardGrid = $('bal-tck').closest('.grid');
  if (cardGrid) cardGrid.className = 'grid grid-cols-1 md:grid-cols-3 gap-4';

  window.switchRole = function () {};
  window.updatePosQr = function () {};
  window.simulatePosScan = function () {};
  window.triggerSettlement = function () {};

  window.switchTab = function (tab) {
    currentTab = tab;
    ['overview', 'swap', 'staking', 'governance'].forEach(function (t) {
      const nav = $('nav-' + t);
      const content = $('tab-content-' + t);
      if (!nav || !content) return;
      if (t === tab) {
        nav.className = NAV_ON;
        content.classList.remove('hidden');
      } else {
        nav.className = NAV_OFF;
        content.classList.add('hidden');
      }
    });
  };

  let lastBtn = null;
  let lastClickAt = 0;
  document.addEventListener('click', function (e) {
    const b = e.target.closest ? e.target.closest('button') : null;
    if (b) { lastBtn = b; lastClickAt = Date.now(); }
  }, true);

  function setBusy(btn) {
    const html = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('opacity-70');
    btn.innerHTML = '<i class="fa-solid fa-circle-notch animate-spin mr-1.5"></i>' + html;
    return function () {
      btn.innerHTML = html;
      btn.disabled = false;
      btn.classList.remove('opacity-70');
    };
  }

  const prevApi = window.api;
  window.api = async function (path, body) {
    const post = body !== undefined;
    let restore = null;
    if (post && lastBtn && Date.now() - lastClickAt < 600) {
      restore = setBusy(lastBtn);
      lastBtn = null;
    }
    if (post) begin();
    try {
      return await prevApi(path, body);
    } finally {
      if (post) end();
      if (restore) restore();
    }
  };

  function getSeen() {
    try {
      const v = localStorage.getItem('tck_notif_seen_' + (ME ? ME.username : ''));
      return v === null ? null : Number(v);
    } catch (e) {
      return null;
    }
  }

  function setSeen(n) {
    try { localStorage.setItem('tck_notif_seen_' + (ME ? ME.username : ''), String(n)); } catch (e) {}
  }

  function notifiable(a) {
    return NOTIF.indexOf(a.title) !== -1;
  }

  function maxId() {
    return ACT.reduce(function (m, a) { return Math.max(m, a.id); }, 0);
  }

  const bell = document.createElement('button');
  bell.type = 'button';
  bell.className = 'relative text-xs font-bold text-gray-400 hover:text-white border border-gray-800 rounded-xl px-2.5 py-1.5';
  bell.title = 'Notifications';
  bell.innerHTML =
    '<i class="fa-solid fa-bell"></i>' +
    '<span id="bell-badge" class="hidden absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 items-center justify-center flex">0</span>';
  const headBox = document.querySelector('header .space-x-3');
  if (headBox) headBox.insertBefore(bell, headBox.firstChild);

  const panel = document.createElement('div');
  panel.className = 'hidden fixed top-20 right-3 z-50 w-80 max-w-[calc(100vw-1.5rem)] glass-panel rounded-2xl p-3 shadow-2xl max-h-96 overflow-y-auto';
  document.body.appendChild(panel);
  let panelOpen = false;

  function drawBell() {
    const b = $('bell-badge');
    if (!b) return;
    const seen = getSeen();
    const n = seen === null ? 0 : ACT.filter(function (a) { return notifiable(a) && a.id > seen; }).length;
    b.textContent = n > 9 ? '9+' : String(n);
    b.classList.toggle('hidden', n === 0);
  }

  function noteItem(a, unread) {
    const bad = a.title.indexOf('Declined') !== -1;
    const recv = a.title === 'Payment Received';
    const icon = recv ? 'fa-arrow-down-left text-emerald-400' : (bad ? 'fa-circle-xmark text-red-400' : 'fa-circle-check text-emerald-400');
    return '<div class="flex items-start gap-3 p-2.5 rounded-xl border ' + (unread ? 'bg-naija-500/10 border-naija-500/30' : 'border-transparent') + '">' +
      '<i class="fa-solid ' + icon + ' mt-0.5"></i>' +
      '<div class="min-w-0 flex-1"><div class="text-xs font-bold text-white">' + esc(a.title) + '</div>' +
      '<div class="text-[11px] text-gray-400 break-words">' + esc(a.subtitle) + '</div></div>' +
      '<div class="text-[10px] text-gray-500 shrink-0">' + ago(a.created_at) + '</div></div>';
  }

  function renderPanel() {
    const seen = getSeen() || 0;
    const items = ACT.filter(notifiable).slice(0, 15);
    panel.innerHTML =
      '<div class="text-sm font-bold text-white mb-2 px-1">Notifications</div>' +
      (items.length
        ? items.map(function (a) { return noteItem(a, a.id > seen); }).join('')
        : '<p class="text-xs text-gray-500 text-center py-6">No notifications yet.</p>');
    setSeen(maxId());
    drawBell();
  }

  bell.onclick = function () {
    panelOpen = !panelOpen;
    panel.classList.toggle('hidden', !panelOpen);
    if (panelOpen) renderPanel();
  };

  document.addEventListener('click', function (e) {
    if (panelOpen && !panel.contains(e.target) && !bell.contains(e.target)) {
      panelOpen = false;
      panel.classList.add('hidden');
    }
  });

  let sessionMax = null;
  function onActivity() {
    if (!Array.isArray(ACT)) return;
    const top = maxId();
    if (sessionMax === null) {
      sessionMax = top;
      if (getSeen() === null) setSeen(top);
    } else {
      ACT.filter(function (a) { return a.id > sessionMax && notifiable(a); })
        .sort(function (a, b) { return a.id - b.id; })
        .forEach(function (a) {
          const bad = a.title.indexOf('Declined') !== -1;
          const text = a.title === 'Payment Received'
            ? 'Payment received: +' + fmt(a.tck_delta) + ' TCK. ' + a.subtitle
            : a.title + '. ' + a.subtitle;
          toast(text, bad ? 'error' : 'success');
        });
      sessionMax = Math.max(sessionMax, top);
    }
    if (panelOpen) renderPanel();
    drawBell();
  }

  let firstLoad = true;
  const prevLoadAll = window.loadAll;
  window.loadAll = async function () {
    if (firstLoad) {
      firstLoad = false;
      begin();
      try { await prevLoadAll(); } finally { end(); }
    } else {
      await prevLoadAll();
    }
    onActivity();
  };

  setInterval(function () {
    if (!document.hidden) loadAll();
  }, 25000);

  function copyText(text, msg) {
    function done() { toast(msg || 'Copied!', 'success'); }
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
      if (ok) done(); else toast('Could not copy. Press and hold the text to copy it.', 'error');
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  window.copyWalletAddr = function () {
    if (ME) copyText(ME.wallet_address, 'Wallet address copied!');
  };

  document.addEventListener('click', function (e) {
    const c = e.target.closest ? e.target.closest('[data-copy]') : null;
    if (c) { copyText(c.dataset.copy, c.dataset.msg); return; }
    const s = e.target.closest ? e.target.closest('[data-share]') : null;
    if (s && ME && navigator.share) {
      navigator.share({
        title: 'My TCK address',
        text: 'Send me TCK on TCK Token: @' + ME.username + '\n' + ME.wallet_address
      }).catch(function () {});
    }
  });

  let rcvKey = '';
  function renderReceive(force) {
    const box = $('modal-view-receive');
    if (!ME) {
      rcvKey = '';
      box.innerHTML = '<div class="text-center text-gray-400 text-sm py-10"><i class="fa-solid fa-circle-notch animate-spin mr-2"></i>Loading...</div>';
      return;
    }
    const key = ME.username + '|' + ME.wallet_address;
    if (!force && key === rcvKey) return;
    rcvKey = key;
    const w = ME.wallet_address;
    const u = ME.username;
    box.innerHTML =
      '<h3 class="text-xl font-bold text-white">Receive TCK</h3>' +
      '<p class="text-xs text-gray-400">Share your @username or wallet address, or let them scan the QR code.</p>' +
      '<div class="bg-white p-3 rounded-2xl inline-block border-4 border-naija-500 my-1">' +
      '<img src="https://api.qrserver.com/v1/create-qr-code/?size=170x170&data=' + encodeURIComponent(w) + '" alt="QR code" class="mx-auto rounded w-40 h-40" onerror="var s=this.nextElementSibling;this.remove();s.classList.remove(\'hidden\')">' +
      '<div class="hidden text-xs text-gray-700 w-40 py-10">QR code could not load. Use the address below.</div></div>' +
      '<div class="bg-darkbg p-3 rounded-xl border border-gray-800 text-left">' +
      '<div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Username</div>' +
      '<div class="flex items-center justify-between gap-2"><span class="text-sm font-bold text-white truncate">@' + esc(u) + '</span>' +
      '<button type="button" data-copy="@' + esc(u) + '" data-msg="Username copied!" class="shrink-0 text-naija-500 bg-naija-500/10 px-2.5 py-1.5 rounded-lg text-xs font-bold"><i class="fa-solid fa-copy mr-1"></i>Copy</button></div></div>' +
      '<div class="bg-darkbg p-3 rounded-xl border border-gray-800 text-left">' +
      '<div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Wallet address</div>' +
      '<div class="flex items-center justify-between gap-2"><span class="text-xs font-mono text-gray-300 break-all">' + esc(w) + '</span>' +
      '<button type="button" data-copy="' + esc(w) + '" data-msg="Wallet address copied!" class="shrink-0 text-naija-500 bg-naija-500/10 px-2.5 py-1.5 rounded-lg text-xs font-bold"><i class="fa-solid fa-copy mr-1"></i>Copy</button></div></div>' +
      (navigator.share ? '<button type="button" data-share="1" class="w-full bg-naija-500 hover:bg-naija-600 text-white font-bold py-3 rounded-xl text-xs"><i class="fa-solid fa-share-nodes mr-1.5"></i>Share</button>' : '');
  }

  const sendLabel = $('send-amount').parentElement.querySelector('label');
  sendLabel.innerHTML =
    'Amount (TCK) <span class="float-right normal-case font-medium text-gray-400">Balance: <span id="send-balance">0.00</span> ' +
    '<button type="button" onclick="sendMax()" class="text-naija-500 font-bold ml-1">MAX</button></span>';

  function sendBalance() {
    const el = $('send-balance');
    if (!el) return;
    let hid = false;
    try { hid = localStorage.getItem('tck_hide') === '1'; } catch (e) {}
    el.textContent = hid ? '••••' : fmt(userTCK);
  }

  window.sendMax = function () {
    $('send-amount').value = (Math.floor(userTCK * 100) / 100).toFixed(2);
  };

  window.executeSend = async function () {
    const to = $('send-address').value.trim();
    const amount = $('send-amount').value;
    const n = parseFloat(amount);
    if (!to) { toast('Enter a wallet address or @username.', 'error'); return; }
    if (!(n > 0)) { toast('Enter an amount to send.', 'error'); return; }
    if (n > userTCK + 0.000001) { toast('You do not have enough TCK. Buy some in Swap first.', 'error'); return; }
    const r = await api('/api/dash/send', { to: to, amount: amount });
    if (!r.ok) { toast(r.data.error || 'Transfer failed.', 'error'); return; }
    $('send-address').value = '';
    $('send-amount').value = '';
    closeActionModal();
    toast(r.data.message, 'success');
    await loadAll();
  };

  const prevOpen = window.openActionModal;
  window.openActionModal = function (view) {
    prevOpen(view);
    if (view === 'receive') renderReceive(true);
    if (view === 'send') sendBalance();
  };

  $('action-modal').addEventListener('click', function (e) {
    if (e.target === e.currentTarget) closeActionModal();
  });

  const prevPaint = window.paint;
  window.paint = function () {
    prevPaint();
    sendBalance();
    renderReceive(false);
  };

  begin();
  window.addEventListener('load', function () { setTimeout(end, 0); });
})();
