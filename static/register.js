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

let resendTimer = null;
function startResendCooldown(sec) {
  const btn = document.querySelector('#reg-step-2 button[onclick="resendOTP()"]');
  if (!btn) return;
  clearInterval(resendTimer);
  let left = sec;
  btn.disabled = true;
  btn.textContent = `Resend in ${left}s`;
  resendTimer = setInterval(() => {
    left--;
    if (left <= 0) {
      clearInterval(resendTimer);
      btn.disabled = false;
      btn.textContent = "Resend Code";
    } else {
      btn.textContent = `Resend in ${left}s`;
    }
  }, 1000);
}

function showStep2UI(email) {
  document.getElementById('confirm-email-display').innerText = email;
  document.getElementById('reg-form-step-1').classList.add('hidden');
  document.getElementById('reg-step-2').classList.remove('hidden');
  document.getElementById('reg-step-3').classList.add('hidden');
  document.getElementById('reg-step-label').innerText = "Section 2 of 3: Email Verification";
  document.getElementById('reg-step-percent').innerText = "66%";
  document.getElementById('reg-progress-bar').className =
    "bg-gradient-to-r from-naija-500 to-emerald-400 h-1.5 rounded-full transition-all duration-500 w-2/3";
  document.querySelectorAll('.otp-input').forEach(i => i.value = '');
  const first = document.querySelector('.otp-input');
  if (first) setTimeout(() => first.focus(), 100);
}

async function goToStep2() {
  const name = document.getElementById('reg-fullname').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const referral = document.getElementById('reg-ref').value.trim();

  if (!name || !email || !password) {
    showAlert("Missing Fields", "Please fill in your name, email and password.");
    return;
  }
  if (password.length < 8) {
    showAlert("Weak Password", "Password must be at least 8 characters.");
    return;
  }

  const btn = document.querySelector('#reg-form-step-1 button[type="submit"]');
  btn.disabled = true;
  const res = await api('/api/auth/register/start', {
    full_name: name, email, password,
    account_type: selectedAccountType, referral,
  });
  btn.disabled = false;

  if (!res.ok) {
    showAlert("Could Not Send Code", res.data.error || "Something went wrong.");
    return;
  }
  showStep2UI(email);
  startResendCooldown(res.data.resend_in || 60);
}

async function resendOTP() {
  const email = document.getElementById('reg-email').value.trim();
  const res = await api('/api/auth/register/resend', { email });
  if (!res.ok) {
    showAlert("Resend Failed", res.data.error || "Could not resend the code.");
    return;
  }
  startResendCooldown(res.data.resend_in || 60);
  showAlert("Code Resent", "A new 6-digit code was sent. The old one no longer works.");
}

async function verifyOTPAndFinish() {
  const code = [...document.querySelectorAll('.otp-input')].map(i => i.value).join('');
  const email = document.getElementById('reg-email').value.trim();
  if (code.length !== 6) {
    showAlert("Incomplete Code", "Enter all 6 digits.");
    return;
  }
  const res = await api('/api/auth/register/verify', { email, code });
  if (!res.ok) {
    showAlert("Verification Failed", res.data.error || "Could not verify the code.");
    return;
  }

  document.getElementById('res-acct-name').innerText =
    document.getElementById('reg-fullname').value.trim() || "User";
  document.getElementById('res-acct-type').innerText =
    selectedAccountType === 'personal' ? 'Personal Trader' : 'Merchant POS';

  document.getElementById('reg-form-step-1').classList.add('hidden');
  document.getElementById('reg-step-2').classList.add('hidden');
  document.getElementById('reg-step-3').classList.remove('hidden');
  document.getElementById('reg-step-label').innerText = "Section 3 of 3: Registration Complete";
  document.getElementById('reg-step-percent').innerText = "100%";
  document.getElementById('reg-progress-bar').className =
    "bg-gradient-to-r from-naija-500 to-emerald-400 h-1.5 rounded-full transition-all duration-500 w-full";
}

document.addEventListener('DOMContentLoaded', () => {
  const boxes = document.querySelectorAll('.otp-input');
  if (boxes[0]) {
    boxes[0].addEventListener('paste', e => {
      const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      if (!digits) return;
      e.preventDefault();
      boxes.forEach((b, i) => b.value = digits[i] || '');
    });
  }
});
