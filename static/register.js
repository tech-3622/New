async function api(path, body) {
  try {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    let data = {};
    try { data = await r.json(); } catch (e) {}
    return { ok: r.ok && data.ok, data };
  } catch (e) {
    return { ok: false, data: { error: "Network error. Is the server running?" } };
  }
}

function hideProgress() {
  const label = document.getElementById('reg-step-label');
  const bar = document.getElementById('reg-progress-bar');
  if (label && label.parentElement) label.parentElement.classList.add('hidden');
  if (bar && bar.parentElement) bar.parentElement.classList.add('hidden');
}

async function createAccount() {
  const name = document.getElementById('reg-fullname').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;

  if (!name || !email || !password) {
    showAlert("Missing Fields", "Please fill in your name, email and password.");
    return;
  }
  if (password.length < 8) {
    showAlert("Weak Password", "Password must be at least 8 characters.");
    return;
  }

  const btn = document.querySelector('#reg-form-step-1 button[type="submit"]');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch animate-spin"></i><span>Creating account...</span>';

  const res = await api('/api/auth/signup', {
    full_name: name, email, password, account_type: selectedAccountType,
  });

  btn.disabled = false;
  btn.innerHTML = original;

  if (!res.ok) {
    showAlert("Could Not Create Account", res.data.error || "Something went wrong.");
    return;
  }

  const step3 = document.getElementById('reg-step-3');
  document.getElementById('res-acct-name').innerText = name;
  document.getElementById('res-acct-type').innerText =
    selectedAccountType === 'personal' ? 'Personal Trader' : 'Merchant POS';
  document.getElementById('reg-form-step-1').classList.add('hidden');
  step3.classList.remove('hidden');

  const p = step3.querySelector('p');
  if (p) p.innerText = 'Your account is ready and your wallet has been created.';
  const a = step3.querySelector('a');
  if (a) { a.href = '/dashboard'; a.innerText = 'Go to Dashboard'; }

  try {
    const r = await fetch('/api/dash/me', { credentials: 'same-origin' });
    const d = await r.json();
    if (d.ok) {
      const el = step3.querySelector('.font-mono');
      if (el) {
        el.innerText = d.user.wallet_address;
        el.classList.add('break-all', 'text-[10px]');
      }
    }
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', hideProgress);
