const fmt = n => Number(n).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let ME = null, ACT = [], STAKES = [], PROPS = [], EL = {};

async function api(path, body) {
  try {
    const opt = body === undefined
      ? {credentials: 'same-origin'}
      : {method: 'POST', credentials: 'same-origin',
         headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)};
    const r = await fetch(path, opt);
    let data = {}; try { data = await r.json(); } catch (e) {}
    if (r.status === 401 && !path.includes('/auth/')) location.href = '/login';
    return {ok: r.ok && data.ok, data};
  } catch (e) {
    return {ok: false, data: {error: 'Network error. Is the server running?'}};
  }
}

function leaf(text, root) {
  return [...(root || document).querySelectorAll('*')]
    .find(el => el.children.length === 0 && el.textContent.trim() === text);
}

function cacheEls() {
  const h = document.querySelector('header');
  EL.initials = leaf('CA', h); EL.name = leaf('Chukwuma A.', h); EL.tier = leaf('Tier 2 Verified', h);
  EL.posVol = leaf('₦185,000'); EL.posCount = leaf('37 Orders');
}

function paint() {
  if (!ME) return;
  userTCK = Number(ME.tck_balance); userNGN = Number(ME.ngn_balance); userStakingRewards = Number(ME.rewards);
  document.getElementById('bal-tck').innerText = fmt(userTCK);
  document.getElementById('bal-ngn').innerText = `₦${fmt(userTCK * rateNGNtoTCK)} NGN`;
  document.getElementById('bal-staking').innerText = fmt(ME.rewards);
  document.getElementById('unclaimed-rewards-val').innerText = `${fmt(ME.rewards)} TCK`;
  const w = ME.wallet_address;
  document.getElementById('user-wallet-addr').innerText = w.slice(0, 8) + '...' + w.slice(-6);
  document.getElementById('dash-receive-balance').innerText = fmt(userTCK);
  document.getElementById('dash-pay-balance').innerText = fmt(dashSwapMode === 'buy' ? userNGN : userTCK);
  const parts = ME.full_name.trim().split(/\s+/);
  if (EL.initials) EL.initials.innerText = (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  if (EL.name) EL.name.innerText = ME.full_name;
  if (EL.tier) EL.tier.innerText = 'Email Verified';
  if (EL.posVol) EL.posVol.innerText = '₦' + fmt(ME.pos_today.volume_ngn);
  if (EL.posCount) EL.posCount.innerText = ME.pos_today.count + ' Orders';
  const qr = document.querySelector('#modal-view-receive img');
  if (qr) qr.src = 'https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=' + encodeURIComponent(w);
  const ad = document.querySelector('#modal-view-receive .break-all');
  if (ad) ad.innerText = w;
}

const ICONS = {swap:'fa-right-left', send:'fa-paper-plane', receive:'fa-arrow-down-left',
  deposit:'fa-building-columns', pos_sale:'fa-qrcode', staking:'fa-coins', stake:'fa-lock', unstake:'fa-unlock'};

function ago(ts) {
  const s = (Date.now() - new Date(ts.replace(' ', 'T') + 'Z')) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
}

function renderTransactions() {
  const box = document.getElementById('tx-activity-list');
  if (!ACT.length) { box.innerHTML = '<p class="text-xs text-gray-500 text-center py-6">No activity yet.</p>'; return; }
  box.innerHTML = ACT.map(tx => {
    const t = Number(tx.tck_delta), n = Number(tx.ngn_delta);
    const val = t !== 0 ? `${t > 0 ? '+' : ''}${fmt(t)} TCK` : `${n >= 0 ? '+' : '-'}₦${fmt(Math.abs(n))}`;
    const color = (t !== 0 ? t : n) >= 0 ? 'text-emerald-400' : 'text-red-400';
    return `<div class="bg-darkbg/80 p-3 rounded-2xl border border-gray-800 flex items-center justify-between text-xs">
      <div class="flex items-center space-x-3">
        <div class="w-8 h-8 rounded-xl bg-darkcard flex items-center justify-center text-gray-300 border border-gray-800"><i class="fa-solid ${ICONS[tx.kind] || 'fa-circle'}"></i></div>
        <div><span class="font-bold text-white block">${esc(tx.title)}</span><span class="text-[10px] text-gray-400">${esc(tx.subtitle)}</span></div>
      </div>
      <div class="text-right"><span class="font-bold block ${color}">${val}</span><span class="text-[9px] text-gray-500">${ago(tx.created_at)}</span></div>
    </div>`;
  }).join('');
}

function renderStakes() {
  let box = document.getElementById('my-stakes');
  if (!box) {
    box = document.createElement('div'); box.id = 'my-stakes'; box.className = 'mt-6 space-y-3';
    document.querySelector('#tab-content-staking .glass-panel').appendChild(box);
  }
  if (!STAKES.length) { box.innerHTML = '<p class="text-xs text-gray-500 text-center">You have no active stakes.</p>'; return; }
  box.innerHTML = '<h4 class="text-sm font-bold text-white">My Active Stakes</h4>' + STAKES.map(s => `
    <div class="bg-darkbg p-4 rounded-2xl border border-gray-800 flex items-center justify-between gap-3 text-xs">
      <div><span class="font-bold text-white block">${fmt(s.amount)} TCK · ${s.vault_days}-Day · ${s.apy}% APY</span>
      <span class="text-gray-400">Unlocks ${new Date(s.unlock_at * 1000).toLocaleDateString()} · Earned ${fmt(s.accrued)} TCK</span></div>
      <button onclick="unstakeVault(${s.id}, ${s.matured})" class="shrink-0 bg-naija-500/20 text-naija-500 border border-naija-500/40 font-bold px-3 py-2 rounded-xl">${s.matured ? 'Unstake' : 'Unstake early (-2%)'}</button>
    </div>`).join('');
}

function renderProps() {
  PROPS.forEach(p => {
    const tot = p.yes + p.no, y = tot ? Math.round(p.yes * 100 / tot) : 0, n = tot ? 100 - y : 0;
    const yb = document.querySelector(`#tab-content-governance button[onclick="voteProposal(${p.id}, 'yes')"]`);
    const nb = document.querySelector(`#tab-content-governance button[onclick="voteProposal(${p.id}, 'no')"]`);
    if (yb) { yb.innerHTML = `<i class="fa-solid fa-thumbs-up mr-1"></i> Vote YES (${y}%)${p.my_vote === 'yes' ? ' ✓' : ''}`; yb.disabled = !!p.my_vote; }
    if (nb) { nb.innerHTML = `<i class="fa-solid fa-thumbs-down mr-1"></i> Vote NO (${n}%)${p.my_vote === 'no' ? ' ✓' : ''}`; nb.disabled = !!p.my_vote; }
  });
}

async function loadAll() {
  const [m, a, s, p] = await Promise.all([
    api('/api/dash/me'), api('/api/dash/activity'), api('/api/dash/stakes'), api('/api/dash/proposals')]);
  if (m.ok) { ME = m.data.user; paint(); }
  if (a.ok) { ACT = a.data.activity; renderTransactions(); }
  if (s.ok) { STAKES = s.data.stakes; renderStakes(); }
  if (p.ok) { PROPS = p.data.proposals; renderProps(); }
}

function refreshTransactions() { loadAll(); }

// ---- swap ----
function calcDashSwap() {
  const pay = parseFloat(document.getElementById('dash-input-pay').value) || 0;
  const fee = Math.round(pay * 0.01 * 100) / 100;
  const rec = document.getElementById('dash-input-receive'), f = document.getElementById('dash-fee-calc');
  if (dashSwapMode === 'buy') { rec.value = ((pay - fee) / rateNGNtoTCK).toFixed(2); f.innerText = `₦${fee.toFixed(2)} NGN`; }
  else { rec.value = ((pay - fee) * rateNGNtoTCK).toFixed(2); f.innerText = `${fee.toFixed(2)} TCK`; }
}

async function executeDashSwap() {
  const amount = document.getElementById('dash-input-pay').value;
  if (!(parseFloat(amount) > 0)) { alert('Please enter a valid swap amount.'); return; }
  const r = await api('/api/dash/swap', {side: dashSwapMode, amount});
  alert(r.ok ? r.data.message : (r.data.error || 'Swap failed.'));
  if (r.ok) loadAll();
}

// ---- send / receive ----
async function executeSend() {
  const to = document.getElementById('send-address').value.trim();
  const amount = document.getElementById('send-amount').value;
  if (!to || !(parseFloat(amount) > 0)) { alert('Please enter a valid recipient and amount.'); return; }
  const r = await api('/api/dash/send', {to, amount});
  if (!r.ok) { alert(r.data.error || 'Transfer failed.'); return; }
  document.getElementById('send-address').value = ''; document.getElementById('send-amount').value = '';
  closeActionModal(); alert(r.data.message); loadAll();
}

function copyWalletAddr() {
  if (!ME) return;
  try { navigator.clipboard.writeText(ME.wallet_address); alert('Wallet address copied!'); }
  catch (e) { alert(ME.wallet_address); }
}

// ---- deposit (simulated) ----
function setupDepositModal() {
  const v = document.getElementById('modal-view-deposit');
  v.querySelector('h3').innerText = 'Demo Cash-In';
  v.querySelector('p').innerText = 'Simulation mode: enter an amount to add demo NGN to your wallet. No real money moves.';
  v.querySelector('.bg-darkbg').innerHTML =
    '<label class="block text-xs font-bold text-gray-300 uppercase mb-1">Amount (NGN)</label>' +
    '<input type="number" id="deposit-amount" placeholder="10000" class="w-full bg-darkbg text-white px-4 py-3 rounded-xl border border-gray-800 focus:border-naija-500 focus:outline-none text-sm font-bold">';
  const b = v.querySelector('button');
  b.removeAttribute('onclick'); b.innerText = 'Add Demo NGN'; b.onclick = submitDeposit;
}

async function submitDeposit() {
  const amount = document.getElementById('deposit-amount').value;
  const r = await api('/api/dash/deposit', {amount});
  if (!r.ok) { alert(r.data.error || 'Cash-in failed.'); return; }
  document.getElementById('deposit-amount').value = '';
  closeActionModal(); alert(r.data.message); loadAll();
}

// ---- POS ----
function updatePosQr() {
  const a = parseFloat(document.getElementById('pos-amount-ngn').value) || 0;
  document.getElementById('pos-tck-calc').innerText = `${(a / rateNGNtoTCK).toFixed(2)} TCK`;
  const w = ME ? ME.wallet_address : '';
  document.getElementById('pos-qr-img').src =
    'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(`tck:${w}?amount_ngn=${a}`);
}

async function simulatePosScan() {
  const amount_ngn = document.getElementById('pos-amount-ngn').value;
  const r = await api('/api/dash/pos-sale', {amount_ngn});
  alert(r.ok ? r.data.message : (r.data.error || 'Sale failed.'));
  if (r.ok) loadAll();
}

function triggerSettlement() {
  alert('Simulation: no real bank settlement is made. Your sales are already in your TCK balance.');
}

// ---- staking ----
async function stakeVault(apy) {
  const days = apy >= 18 ? 90 : 30;
  const v = prompt(`TCK to stake in the ${days}-day vault? (Balance: ${fmt(userTCK)})`);
  if (v === null) return;
  const r = await api('/api/dash/stake', {vault: days, amount: v.trim()});
  alert(r.ok ? r.data.message : (r.data.error || 'Stake failed.'));
  if (r.ok) loadAll();
}

async function claimRewards() {
  const r = await api('/api/dash/claim', {});
  alert(r.ok ? r.data.message : (r.data.error || 'Claim failed.'));
  if (r.ok) loadAll();
}

async function unstakeVault(id, matured) {
  if (!matured && !confirm('Unstake early? A 2% penalty applies to your principal.')) return;
  const r = await api('/api/dash/unstake', {id});
  alert(r.ok ? r.data.message : (r.data.error || 'Unstake failed.'));
  if (r.ok) loadAll();
}

// ---- governance ----
async function voteProposal(id, option) {
  const r = await api('/api/dash/vote', {proposal_id: id, choice: option});
  alert(r.ok ? r.data.message : (r.data.error || 'Vote failed.'));
  if (r.ok) loadAll();
}

// ---- logout + init ----
async function doLogout() { await api('/api/auth/logout', {}); location.href = '/login'; }

function addLogout() {
  const box = document.querySelector('header .space-x-3');
  if (!box) return;
  const b = document.createElement('button');
  b.className = 'text-xs font-bold text-gray-400 hover:text-white border border-gray-800 rounded-xl px-2.5 py-1.5';
  b.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i>';
  b.title = 'Log out'; b.onclick = doLogout;
  box.appendChild(b);
}

window.addEventListener('load', async () => {
  cacheEls(); setupDepositModal(); addLogout();
  await loadAll();
  if (ME && ME.account_type === 'merchant') switchRole('merchant');
  updatePosQr(); calcDashSwap();
});
