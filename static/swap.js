(function () {
  const IDS = ['bal-naira', 'bal-tck', 'bal-ngn', 'bal-staking', 'unclaimed-rewards-val',
               'dash-pay-balance', 'dash-receive-balance', 'sw-ngn', 'sw-tck'];
  const MASK = '••••';
  const real = {};
  let hidden = false;
  let lastMode = null;
  try { hidden = localStorage.getItem('tck_hide') === '1'; } catch (e) {}

  const $ = function (id) { return document.getElementById(id); };

  const TCK_BADGE = '<div class="w-5 h-5 rounded-full bg-naija-500 flex items-center justify-center text-[10px] text-black font-bold">T</div><span class="font-bold text-sm text-gray-200">TCK</span>';
  const NGN_BADGE = '<span class="text-lg">🇳🇬</span><span class="font-bold text-sm text-gray-200">NGN</span>';
  const EYE_CLASS = 'eye-btn text-xs font-bold text-gray-400 hover:text-white border border-gray-800 rounded-xl px-2.5 py-1.5';

  $('dash-receive-balance').parentElement.innerHTML =
    'Balance: <span id="dash-receive-balance">0.00</span> <span id="dash-receive-currency">TCK</span>';

  const strip = document.createElement('div');
  strip.className = 'mb-5';
  strip.innerHTML =
    '<div class="grid grid-cols-2 gap-3">' +
    '<div class="bg-darkbg/80 border border-gray-800 rounded-2xl p-3">' +
    '<div class="text-[10px] text-gray-400 uppercase tracking-wider">Naira balance</div>' +
    '<div class="text-base font-black text-white mt-1">₦<span id="sw-ngn">0.00</span></div></div>' +
    '<div class="bg-darkbg/80 border border-gray-800 rounded-2xl p-3">' +
    '<div class="text-[10px] text-gray-400 uppercase tracking-wider">TCK balance</div>' +
    '<div class="text-base font-black text-naija-500 mt-1"><span id="sw-tck">0.00</span> TCK</div></div>' +
    '</div>' +
    '<div class="flex items-center justify-between mt-3 text-xs">' +
    '<span class="text-gray-400">Rate: <span class="text-white font-bold">1 TCK = ₦' + fmt(rateNGNtoTCK) + '</span></span>' +
    '<button type="button" id="sw-eye" data-label="1"></button></div>';
  $('dash-tab-buy').parentElement.before(strip);

  const swEye = $('sw-eye');
  swEye.className = EYE_CLASS;

  const payBox = $('dash-input-pay').closest('.rounded-2xl');
  const msg = document.createElement('div');
  msg.id = 'sw-msg';
  msg.className = 'text-xs text-red-400 mb-3 px-1 hidden';
  payBox.after(msg);

  $('dash-pay-balance').parentElement.insertAdjacentHTML(
    'beforeend',
    ' <button type="button" onclick="swapMax()" class="text-naija-500 font-bold ml-1">MAX</button>'
  );

  const confirmBtn = document.querySelector('#tab-content-swap button[onclick="executeDashSwap()"]');
  confirmBtn.id = 'sw-confirm';

  function bal() {
    return dashSwapMode === 'buy' ? userNGN : userTCK;
  }

  function setBalances() {
    const buy = dashSwapMode === 'buy';
    $('dash-pay-balance').textContent = fmt(buy ? userNGN : userTCK);
    $('dash-receive-balance').textContent = fmt(buy ? userTCK : userNGN);
    $('sw-ngn').textContent = fmt(userNGN);
    $('sw-tck').textContent = fmt(userTCK);
  }

  window.calcDashSwap = function () {
    const pay = parseFloat($('dash-input-pay').value) || 0;
    const fee = Math.round(pay * 0.01 * 100) / 100;
    const buy = dashSwapMode === 'buy';
    const rec = $('dash-input-receive');
    if (pay > 0) {
      rec.value = (buy ? (pay - fee) / rateNGNtoTCK : (pay - fee) * rateNGNtoTCK).toFixed(2);
    } else {
      rec.value = '';
    }
    $('dash-fee-calc').innerText = buy ? '₦' + fee.toFixed(2) + ' NGN' : fee.toFixed(2) + ' TCK';
    const over = pay > bal() + 0.000001;
    if (over) {
      msg.innerHTML = buy
        ? 'Not enough Naira. <button type="button" onclick="openActionModal(\'deposit\')" class="underline font-bold">Add money</button>'
        : 'Not enough TCK. Buy some first.';
      msg.classList.remove('hidden');
    } else {
      msg.classList.add('hidden');
    }
    const ok = pay > 0 && !over;
    confirmBtn.disabled = !ok;
    confirmBtn.classList.toggle('opacity-50', !ok);
  };

  window.switchSwapMode = function (mode) {
    const changed = lastMode !== null && lastMode !== mode;
    lastMode = mode;
    dashSwapMode = mode;
    const buy = mode === 'buy';
    const on = 'flex-1 py-2.5 rounded-lg text-xs font-bold text-white bg-naija-600 transition-all';
    const off = 'flex-1 py-2.5 rounded-lg text-xs font-bold text-gray-400 hover:text-white transition-all';
    $('dash-tab-buy').className = buy ? on : off;
    $('dash-tab-sell').className = buy ? off : on;
    $('dash-label-pay').innerText = buy ? 'You Pay' : 'You Sell';
    $('dash-symbol-pay').innerText = buy ? 'NGN' : 'TCK';
    $('dash-symbol-flag').innerText = buy ? '🇳🇬' : '🪙';
    $('dash-pay-currency').innerText = buy ? 'NGN' : 'TCK';
    $('dash-receive-currency').innerText = buy ? 'TCK' : 'NGN';
    $('dash-input-receive').nextElementSibling.innerHTML = buy ? TCK_BADGE : NGN_BADGE;
    if (changed) $('dash-input-pay').value = '';
    setBalances();
    window.calcDashSwap();
  };

  window.swapMax = function () {
    $('dash-input-pay').value = (Math.floor(bal() * 100) / 100).toFixed(2);
    window.calcDashSwap();
  };

  window.executeDashSwap = async function () {
    const input = $('dash-input-pay');
    const pay = parseFloat(input.value) || 0;
    if (!(pay > 0)) { alert('Enter an amount to swap.'); return; }
    if (pay > bal() + 0.000001) {
      alert(dashSwapMode === 'buy' ? 'You do not have enough Naira.' : 'You do not have enough TCK.');
      return;
    }
    confirmBtn.disabled = true;
    const r = await api('/api/dash/swap', { side: dashSwapMode, amount: input.value });
    alert(r.ok ? r.data.message : (r.data.error || 'Swap failed.'));
    if (r.ok) {
      input.value = '';
      await loadAll();
    }
    window.calcDashSwap();
  };

  const prevPaint = window.paint;
  window.paint = function () {
    prevPaint();
    setBalances();
    window.calcDashSwap();
  };

  function apply() {
    IDS.forEach(function (id) {
      const el = $(id);
      if (!el) return;
      if (hidden) {
        if (el.textContent !== MASK) {
          real[id] = el.textContent;
          el.textContent = MASK;
        }
      } else if (real[id] !== undefined && el.textContent === MASK) {
        el.textContent = real[id];
      }
    });
  }

  function drawEye() {
    document.querySelectorAll('.eye-btn').forEach(function (b) {
      const icon = hidden ? 'fa-eye-slash' : 'fa-eye';
      const label = b.dataset.label ? (hidden ? ' Show balances' : ' Hide balances') : '';
      b.innerHTML = '<i class="fa-solid ' + icon + '"></i>' + label;
      b.title = hidden ? 'Show balances' : 'Hide balances';
    });
  }

  window.toggleBalances = function () {
    hidden = !hidden;
    try { localStorage.setItem('tck_hide', hidden ? '1' : '0'); } catch (e) {}
    apply();
    drawEye();
  };

  swEye.onclick = window.toggleBalances;

  const headBtn = document.createElement('button');
  headBtn.type = 'button';
  headBtn.className = EYE_CLASS;
  headBtn.onclick = window.toggleBalances;
  const box = document.querySelector('header .space-x-3');
  if (box) box.insertBefore(headBtn, box.firstChild);

  const obs = new MutationObserver(function () {
    IDS.forEach(function (id) {
      const el = $(id);
      if (!el) return;
      const t = el.textContent;
      if (t === MASK) return;
      real[id] = t;
      if (hidden) el.textContent = MASK;
    });
  });
  IDS.forEach(function (id) {
    const el = $(id);
    if (el) obs.observe(el, { childList: true, characterData: true, subtree: true });
  });

  $('dash-input-pay').value = '';
  window.switchSwapMode('buy');
  apply();
  drawEye();
})();
