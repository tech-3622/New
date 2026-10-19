const _origVerify = verifyOTPAndFinish;
verifyOTPAndFinish = async function () {
  await _origVerify();
  const step3 = document.getElementById('reg-step-3');
  if (step3.classList.contains('hidden')) return;
  try {
    const r = await fetch('/api/dash/me', {credentials: 'same-origin'});
    const d = await r.json();
    if (d.ok) {
      const el = step3.querySelector('.font-mono');
      el.innerText = d.user.wallet_address;
      el.classList.add('break-all', 'text-[10px]');
    }
  } catch (e) {}
  step3.querySelector('p').innerText = 'Your account is verified and your wallet is ready. All balances start at zero.';
  const a = step3.querySelector('a');
  a.href = '/dashboard'; a.innerText = 'Go to Dashboard';
};
