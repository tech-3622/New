async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('btn-login');
  const original = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch animate-spin"></i><span>Authenticating...</span>';
  btn.disabled = true;
  let ok = false, data = {};
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email, password}),
    });
    data = await r.json().catch(() => ({}));
    ok = r.ok && data.ok;
  } catch (e) { data = {error: 'Network error. Is the server running?'}; }
  if (!ok) {
    btn.innerHTML = original; btn.disabled = false;
    showAlert('Sign In Failed', data.error || 'Could not sign in.', false);
    return;
  }
  let target = '/dashboard';
  try {
    const c = await fetch('/api/admin/check', {credentials: 'same-origin'});
    const cd = await c.json().catch(() => ({}));
    if (cd.is_admin) target = '/admin';
  } catch (e) {}
  showAlert('Success', 'Welcome back! Redirecting...', true);
  setTimeout(() => { location.href = target; }, 800);
}

function sendPasswordReset() {
  showAlert('Not Available Yet', 'Password reset by email has not been set up yet.', false);
}
