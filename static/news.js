(function () {
  const $ = function (id) { return document.getElementById(id); };
  const NAV_ON = 'flex items-center space-x-3 px-4 py-3 rounded-2xl font-bold text-xs sm:text-sm transition-all whitespace-nowrap bg-naija-500/20 text-naija-500 border border-naija-500/30';
  const NAV_OFF = 'flex items-center space-x-3 px-4 py-3 rounded-2xl font-bold text-xs sm:text-sm transition-all whitespace-nowrap text-gray-400 hover:text-white hover:bg-darkcard border border-transparent';
  const LABELS = {
    update: ['Update', 'bg-naija-500/15 text-naija-500 border-naija-500/30'],
    maintenance: ['Maintenance', 'bg-amber-500/15 text-amber-400 border-amber-500/30'],
    community: ['Community', 'bg-blue-500/15 text-blue-400 border-blue-500/30'],
    important: ['Important', 'bg-red-500/15 text-red-400 border-red-500/30']
  };

  let NEWS = [];
  let sessionMax = null;
  let lastSeen = 0;

  const nav = document.createElement('button');
  nav.id = 'nav-news';
  nav.className = NAV_OFF;
  nav.innerHTML =
    '<i class="fa-solid fa-newspaper text-base"></i><span>News</span>' +
    '<span id="news-badge" class="hidden bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 items-center justify-center flex">0</span>';
  nav.onclick = function () { switchTab('news'); };
  $('nav-overview').after(nav);

  const content = document.createElement('div');
  content.id = 'tab-content-news';
  content.className = 'space-y-4 hidden';
  document.querySelector('main').appendChild(content);

  const banner = document.createElement('div');
  banner.className = 'hidden';
  document.querySelector('header').after(banner);

  function key(name) {
    return 'tck_news_' + name + '_' + (ME ? ME.username : '');
  }

  function getNum(name) {
    try {
      const v = localStorage.getItem(key(name));
      return v === null ? 0 : (Number(v) || 0);
    } catch (e) {
      return 0;
    }
  }

  function setNum(name, v) {
    try { localStorage.setItem(key(name), String(v)); } catch (e) {}
  }

  function getDismissed() {
    try {
      const v = JSON.parse(localStorage.getItem(key('dismiss')) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  function dismiss(id) {
    const list = getDismissed();
    if (list.indexOf(id) === -1) list.push(id);
    try { localStorage.setItem(key('dismiss'), JSON.stringify(list.slice(-50))); } catch (e) {}
  }

  function maxId() {
    return NEWS.reduce(function (m, n) { return Math.max(m, n.id); }, 0);
  }

  function isOpen() {
    return !content.classList.contains('hidden');
  }

  function preview(text) {
    const t = String(text).replace(/\s+/g, ' ');
    return t.length > 140 ? t.slice(0, 140) + '...' : t;
  }

  function drawBadge() {
    const b = $('news-badge');
    if (!b) return;
    const seen = getNum('seen');
    const n = isOpen() ? 0 : NEWS.filter(function (x) { return x.id > seen; }).length;
    b.textContent = n > 9 ? '9+' : String(n);
    b.classList.toggle('hidden', n === 0);
  }

  function drawBanner() {
    const gone = getDismissed();
    const urgent = NEWS.filter(function (n) { return n.urgent && gone.indexOf(n.id) === -1; })
      .sort(function (a, b) { return b.id - a.id; })[0];
    if (!urgent) {
      banner.className = 'hidden';
      banner.innerHTML = '';
      return;
    }
    banner.className = 'bg-red-500/15 border-b border-red-500/40';
    banner.innerHTML =
      '<div class="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-start gap-3">' +
      '<i class="fa-solid fa-triangle-exclamation text-red-400 mt-0.5"></i>' +
      '<div class="flex-1 min-w-0"><div class="text-xs font-bold text-white break-words">' + esc(urgent.title) + '</div>' +
      '<div class="text-[11px] text-gray-300 mt-0.5 break-words">' + esc(preview(urgent.body)) + '</div></div>' +
      '<button type="button" data-news-read="1" class="text-[11px] font-bold text-red-300 underline shrink-0">Read</button>' +
      '<button type="button" data-news-close="' + Number(urgent.id) + '" class="text-gray-400 hover:text-white shrink-0" aria-label="Dismiss"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>';
  }

  banner.addEventListener('click', function (e) {
    if (e.target.closest('[data-news-read]')) {
      switchTab('news');
      window.scrollTo(0, 0);
      return;
    }
    const c = e.target.closest('[data-news-close]');
    if (c) {
      dismiss(Number(c.dataset.newsClose));
      drawBanner();
    }
  });

  function card(n) {
    const l = LABELS[n.label] || LABELS.update;
    const isNew = n.id > lastSeen;
    return '<div class="glass-panel rounded-3xl p-5 ' + (n.pinned ? 'border-gold-500/40' : '') + '">' +
      '<div class="flex flex-wrap items-center gap-2 mb-2">' +
      '<span class="text-[10px] font-bold uppercase px-2 py-1 rounded-lg border ' + l[1] + '">' + l[0] + '</span>' +
      (n.pinned ? '<span class="text-[10px] font-bold text-gold-400"><i class="fa-solid fa-thumbtack mr-1"></i>Pinned</span>' : '') +
      (isNew ? '<span class="text-[10px] font-bold text-white bg-red-500 rounded-full px-2 py-0.5">New</span>' : '') +
      '<span class="text-[10px] text-gray-500 ml-auto">' + ago(n.created_at) + '</span></div>' +
      '<h3 class="text-base font-bold text-white break-words">' + esc(n.title) + '</h3>' +
      '<p class="text-xs sm:text-sm text-gray-300 mt-2 leading-relaxed break-words" style="white-space: pre-line;">' + esc(n.body) + '</p>' +
      '</div>';
  }

  function renderNews() {
    content.innerHTML =
      '<div><h2 class="text-2xl font-black text-white">News</h2>' +
      '<p class="text-xs text-gray-400 mt-1">Updates from the TCK team.</p></div>' +
      (NEWS.length
        ? NEWS.map(card).join('')
        : '<div class="glass-panel rounded-3xl p-8 text-center text-sm text-gray-400">No news yet. Check back soon.</div>');
  }

  function markRead() {
    setNum('seen', maxId());
    drawBadge();
  }

  const prevSwitch = window.switchTab;
  window.switchTab = function (tab) {
    prevSwitch(tab);
    const on = tab === 'news';
    content.classList.toggle('hidden', !on);
    nav.className = on ? NAV_ON : NAV_OFF;
    if (on) {
      lastSeen = getNum('seen');
      renderNews();
      markRead();
    }
  };

  async function loadNews() {
    const r = await api('/api/news');
    if (!r.ok) return;
    NEWS = r.data.news;
    const top = maxId();
    if (sessionMax === null) {
      sessionMax = top;
    } else {
      const seen = getNum('seen');
      NEWS.filter(function (n) { return n.id > sessionMax && n.id > seen; })
        .sort(function (a, b) { return a.id - b.id; })
        .forEach(function (n) { toast('News: ' + n.title, n.urgent ? 'error' : 'info'); });
      sessionMax = Math.max(sessionMax, top);
    }
    if (isOpen()) {
      renderNews();
      markRead();
    }
    drawBadge();
    drawBanner();
  }

  const prevLoad = window.loadAll;
  window.loadAll = async function () {
    await prevLoad();
    await loadNews();
  };
})();
