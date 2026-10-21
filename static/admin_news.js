(function () {
  let posts = [];
  let editId = null;

  const LABELS = [['update', 'Update'], ['maintenance', 'Maintenance'], ['community', 'Community'], ['important', 'Important']];
  const FIELD = 'w-full bg-darkbg text-white px-4 py-3 rounded-xl border border-gray-800 focus:border-naija-500 focus:outline-none text-sm';
  const LABEL_CLASS = 'block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1.5';

  const usersBtn = document.getElementById('btn-users');
  const anchor = document.getElementById('btn-payments') || usersBtn;
  const tabBtn = document.createElement('button');
  tabBtn.id = 'btn-news';
  tabBtn.className = usersBtn.className.replace('tab-on', '').trim() + ' shrink-0 whitespace-nowrap';
  tabBtn.innerHTML = '<i class="fa-solid fa-newspaper mr-2"></i>News';
  tabBtn.onclick = function () { showTab('news'); };
  anchor.after(tabBtn);
  anchor.parentElement.classList.add('overflow-x-auto');

  const sec = document.createElement('section');
  sec.id = 'tab-news';
  sec.className = 'hidden';
  sec.innerHTML =
    '<div class="box p-5 max-w-2xl space-y-4">' +
    '<div id="nw-heading" class="text-sm font-bold text-white">Post news</div>' +
    '<div><label class="' + LABEL_CLASS + '">Title</label><input id="nw-title" maxlength="120" class="' + FIELD + '" placeholder="Short headline"></div>' +
    '<div><label class="' + LABEL_CLASS + '">Message</label><textarea id="nw-body" rows="5" maxlength="2000" class="' + FIELD + '" placeholder="Write the news here"></textarea></div>' +
    '<div><label class="' + LABEL_CLASS + '">Label</label><select id="nw-label" class="' + FIELD + '">' +
    LABELS.map(function (l) { return '<option value="' + l[0] + '">' + l[1] + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="flex flex-wrap gap-5 text-xs text-gray-300">' +
    '<label class="flex items-center gap-2"><input type="checkbox" id="nw-pinned"> Pin to top</label>' +
    '<label class="flex items-center gap-2"><input type="checkbox" id="nw-urgent"> Urgent banner</label></div>' +
    '<div class="flex gap-2">' +
    '<button id="nw-save" onclick="newsSave()" class="flex-1 bg-naija-500 hover:bg-naija-600 text-white font-extrabold py-3 rounded-xl text-sm">Post news</button>' +
    '<button id="nw-cancel" onclick="newsCancel()" class="hidden px-5 bg-darkbg border border-gray-800 text-gray-300 font-bold rounded-xl text-sm">Cancel</button>' +
    '</div></div>' +
    '<div id="news-list" class="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"></div>';
  document.querySelector('main').appendChild(sec);

  const origShow = window.showTab;
  window.showTab = function (name) {
    origShow(name);
    sec.classList.toggle('hidden', name !== 'news');
    tabBtn.classList.toggle('tab-on', name === 'news');
    if (name === 'news') loadNews();
  };

  function postBox(n) {
    const labelName = (LABELS.filter(function (l) { return l[0] === n.label; })[0] || LABELS[0])[1];
    const text = String(n.body).length > 160 ? String(n.body).slice(0, 160) + '...' : n.body;
    return '<div class="box p-4">' +
      '<div class="flex flex-wrap items-center gap-2 mb-2">' +
      '<span class="text-[10px] uppercase font-bold px-2 py-1 rounded-lg bg-naija-500/15 text-naija-500">' + esc(labelName) + '</span>' +
      (n.pinned ? '<span class="text-[10px] font-bold text-amber-400">Pinned</span>' : '') +
      (n.urgent ? '<span class="text-[10px] font-bold text-red-400">Urgent</span>' : '') +
      '<span class="text-[10px] text-gray-500 ml-auto">' + esc((n.created_at || '').slice(0, 16)) + '</span></div>' +
      '<div class="font-bold text-white text-sm break-words">' + esc(n.title) + '</div>' +
      '<div class="text-xs text-gray-400 mt-1 break-words" style="white-space: pre-line;">' + esc(text) + '</div>' +
      '<div class="flex gap-2 mt-3">' +
      '<button onclick="newsEdit(' + Number(n.id) + ')" class="flex-1 bg-darkbg border border-gray-800 text-gray-200 text-xs font-bold py-2 rounded-xl">Edit</button>' +
      '<button onclick="newsPin(' + Number(n.id) + ')" class="flex-1 bg-darkbg border border-gray-800 text-amber-400 text-xs font-bold py-2 rounded-xl">' + (n.pinned ? 'Unpin' : 'Pin') + '</button>' +
      '<button onclick="newsDelete(' + Number(n.id) + ')" class="flex-1 bg-red-500/15 text-red-400 border border-red-500/30 text-xs font-bold py-2 rounded-xl">Delete</button>' +
      '</div></div>';
  }

  function renderList() {
    document.getElementById('news-list').innerHTML = posts.length
      ? posts.map(postBox).join('')
      : '<div class="box p-6 text-center text-gray-400 text-sm col-span-full">No news posted yet.</div>';
  }

  async function loadNews() {
    const r = await fetch('/api/admin/news', { credentials: 'same-origin' });
    const d = await r.json().catch(function () { return null; });
    if (d && d.ok) {
      posts = d.news;
      renderList();
    }
  }

  async function send(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return r.json().catch(function () { return {}; });
  }

  function resetForm() {
    editId = null;
    document.getElementById('nw-title').value = '';
    document.getElementById('nw-body').value = '';
    document.getElementById('nw-label').value = 'update';
    document.getElementById('nw-pinned').checked = false;
    document.getElementById('nw-urgent').checked = false;
    document.getElementById('nw-heading').textContent = 'Post news';
    document.getElementById('nw-save').textContent = 'Post news';
    document.getElementById('nw-cancel').classList.add('hidden');
  }

  function find(id) {
    return posts.filter(function (p) { return p.id === id; })[0];
  }

  window.newsSave = async function () {
    const body = {
      title: document.getElementById('nw-title').value,
      body: document.getElementById('nw-body').value,
      label: document.getElementById('nw-label').value,
      pinned: document.getElementById('nw-pinned').checked,
      urgent: document.getElementById('nw-urgent').checked
    };
    const url = editId ? '/api/admin/news/' + editId + '/update' : '/api/admin/news';
    const d = await send(url, body);
    if (!d.ok) { alert(d.error || 'Could not save.'); return; }
    resetForm();
    alert(d.message || 'Saved.');
    loadNews();
  };

  window.newsCancel = function () {
    resetForm();
  };

  window.newsEdit = function (id) {
    const n = find(id);
    if (!n) return;
    editId = id;
    document.getElementById('nw-title').value = n.title;
    document.getElementById('nw-body').value = n.body;
    document.getElementById('nw-label').value = n.label;
    document.getElementById('nw-pinned').checked = !!n.pinned;
    document.getElementById('nw-urgent').checked = !!n.urgent;
    document.getElementById('nw-heading').textContent = 'Edit news';
    document.getElementById('nw-save').textContent = 'Save changes';
    document.getElementById('nw-cancel').classList.remove('hidden');
    sec.scrollIntoView();
  };

  window.newsPin = async function (id) {
    const n = find(id);
    if (!n) return;
    const d = await send('/api/admin/news/' + id + '/update', {
      title: n.title, body: n.body, label: n.label, pinned: !n.pinned, urgent: !!n.urgent
    });
    if (!d.ok) alert(d.error || 'Could not update.');
    loadNews();
  };

  window.newsDelete = async function (id) {
    if (!confirm('Delete this post? Members will no longer see it.')) return;
    const d = await send('/api/admin/news/' + id + '/delete');
    if (!d.ok) alert(d.error || 'Could not delete.');
    loadNews();
  };
})();
