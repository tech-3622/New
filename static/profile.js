const $ = id => document.getElementById(id);
let P = null;

async function api(path, body) {
  try {
    const opt = body === undefined
      ? {credentials: 'same-origin'}
      : {method: 'POST', credentials: 'same-origin',
         headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)};
    const r = await fetch(path, opt);
    let data = {}; try { data = await r.json(); } catch (e) {}
    if (r.status === 401) location.href = '/login';
    return {ok: r.ok && data.ok, data};
  } catch (e) {
    return {ok: false, data: {error: 'Network error. Is the server running?'}};
  }
}

function initials(name) {
  const p = name.trim().split(/\s+/);
  return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
}

function fillSelect(sel, items, value, placeholder) {
  sel.innerHTML = '';
  if (placeholder) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = placeholder; sel.appendChild(o);
  }
  items.forEach(it => {
    const o = document.createElement('option');
    const [v, l] = Array.isArray(it) ? it : [it, it];
    o.value = v; o.textContent = l; sel.appendChild(o);
  });
  sel.value = value || '';
}

function paint(states, banks) {
  const u = P, ini = initials(u.full_name);
  $('hdr-initials').textContent = ini;
  $('side-initials').textContent = ini;
  $('side-name').textContent = u.full_name;
  $('side-email').textContent = u.email;
  $('side-state').textContent = u.state || 'Not set';
  const d = new Date(u.created_at.replace(' ', 'T') + 'Z');
  $('side-since').textContent = isNaN(d) ? '-' : d.toLocaleDateString(undefined, {month: 'short', year: 'numeric'});

  $('prof-fullname').value = u.full_name;
  $('prof-email').value = u.email;
  $('prof-phone').value = u.phone;
  $('prof-address').value = u.address;
  if (states) fillSelect($('prof-state'), states, u.state, '- Select state -');
  else $('prof-state').value = u.state;
  if (banks) fillSelect($('bank-name'), banks, u.bank ? u.bank.key : '');

  const card = $('bank-card');
  if (u.bank) {
    card.innerHTML = '';
    const mk = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; };
    const top = mk('div', 'flex justify-between items-start mb-4', '');
    const left = mk('div', '', '');
    left.appendChild(mk('span', 'text-[10px] text-gray-400 uppercase font-bold tracking-widest block', 'Primary Payout Bank'));
    left.appendChild(mk('h3', 'text-base font-black text-white mt-0.5', u.bank.label));
    top.appendChild(left);
    top.appendChild(mk('span', 'text-xs font-bold text-gold-400 bg-gold-500/20 px-2.5 py-1 rounded-full border border-gold-500/30', 'Unverified (demo)'));
    card.appendChild(top);
    const body = mk('div', 'space-y-1 font-mono', '');
    body.appendChild(mk('span', 'text-xl font-black text-gold-400 tracking-wider', u.bank.number));
    body.appendChild(mk('p', 'text-xs font-sans text-gray-300 font-semibold uppercase', u.bank.account_name));
    card.appendChild(body);
  } else {
    card.innerHTML = '<p class="text-xs text-gray-400 text-center py-3">No bank account linked yet.</p>';
  }
}

async function load(first) {
  const r = await api('/api/profile/me');
  if (!r.ok) { alert(r.data.error || 'Could not load profile.'); return; }
  P = r.data.profile;
  paint(first ? r.data.states : null, first ? r.data.banks : null);
}

async function handlePersonalSave(e) {
  e.preventDefault();
  const r = await api('/api/profile/personal', {
    full_name: $('prof-fullname').value, phone: $('prof-phone').value,
    state: $('prof-state').value, address: $('prof-address').value});
  alert(r.ok ? r.data.message : (r.data.error || 'Save failed.'));
  if (r.ok) load(false);
}

async function handleBankSave(e) {
  e.preventDefault();
  const r = await api('/api/profile/bank', {
    bank: $('bank-name').value, account_number: $('bank-acc-num').value.trim(),
    account_name: $('bank-acc-name').value});
  if (!r.ok) { alert(r.data.error || 'Save failed.'); return; }
  $('bank-acc-num').value = ''; $('bank-acc-name').value = '';
  alert(r.data.message); load(false);
}

async function handlePasswordChange(e) {
  e.preventDefault();
  const cur = $('pw-current').value, nw = $('pw-new').value, cf = $('pw-confirm').value;
  if (nw !== cf) { alert('New passwords do not match.'); return; }
  const r = await api('/api/profile/password', {current_password: cur, new_password: nw});
  if (!r.ok) { alert(r.data.error || 'Update failed.'); return; }
  ['pw-current', 'pw-new', 'pw-confirm'].forEach(i => $(i).value = '');
  alert(r.data.message);
}

async function logoutUser() {
  if (!confirm('Are you sure you want to sign out of your TCK account?')) return;
  await api('/api/auth/logout', {});
  location.href = '/login';
}

window.addEventListener('load', () => load(true));
