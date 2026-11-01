(() => {
  'use strict';

  // ---------- 分類設定 ----------
  const CATS = [
    { key: 'bnb',    label: '民宿',      color: 'var(--c-bnb)',    hex: '#0f7c8c', match: ['民宿', '農莊住宿'] },
    { key: 'hotel',  label: '飯店／酒店', color: 'var(--c-hotel)',  hex: '#c2562b', match: ['酒店', '度假酒店', '長期住宿酒店', '服務式住宿'] },
    { key: 'inn',    label: '旅館／賓館', color: 'var(--c-inn)',    hex: '#7a5bb5', match: ['旅館', '賓館', '汽車旅館'] },
    { key: 'hostel', label: '青年旅館',   color: 'var(--c-hostel)', hex: '#2f8f46', match: ['青年旅館'] },
    { key: 'camp',   label: '露營',      color: 'var(--c-camp)',   hex: '#8a6d1f', match: ['營地', '露營地', '豪華露營'] },
    { key: 'other',  label: '其他住宿',   color: 'var(--c-other)',  hex: '#6b7680', match: [] },
  ];
  const FEATS = [
    { key: 'food', label: '餐廳／咖啡', match: ['餐廳', '咖啡店', '小餐館', '自助餐廳', '台灣餐廳', '早午餐餐廳', '冰品飲料店'] },
    { key: 'pool', label: '泳池',      match: ['游泳池'] },
    { key: 'spa',  label: '水療／按摩', match: ['水療中心', '按摩水療', '溫泉', '水療及健身俱樂部'] },
  ];
  const TAITUNG = [22.72, 121.08];
  const STATION = [22.79377, 121.12318]; // 台東火車站

  // 兩點間距離（公里）
  function distKm([lat1, lng1], [lat2, lng2]) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);
  let regionRank = {};

  // ---------- 狀態 ----------
  const state = {
    q: '', regions: new Set(), cats: new Set(), feats: new Set(),
    minRating: 0, minReviews: 0, hasPhone: false, hasWeb: false, hasLine: false,
    inBounds: false, sort: 'score',
  };
  let data = [];
  let filtered = [];
  let activeId = null;

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (u && /^https?:\/\//i.test(u) ? u : null);

  // ---------- 地圖 ----------
  const map = L.map('map', { zoomControl: true, preferCanvas: false }).setView(TAITUNG, 11);
  // 全部為免 API key 的公開圖磚
  const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const baseLayers = {
    'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: OSM_ATTR }),
    '人道地圖 (HOT)': L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
      maxZoom: 19, subdomains: 'abc', attribution: `${OSM_ATTR}, Tiles: <a href="https://www.hotosm.org/">HOT</a>`,
    }),
    '地形 (OpenTopoMap)': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17, subdomains: 'abc', attribution: `${OSM_ATTR}, SRTM | <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
    }),
    '衛星 (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
    }),
  };
  baseLayers['OpenStreetMap'].addTo(map);
  L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);

  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false, maxClusterRadius: 45, spiderfyOnMaxZoom: true,
    iconCreateFunction: (c) => {
      const n = c.getChildCount();
      const size = n < 10 ? 34 : n < 100 ? 40 : 48;
      return L.divIcon({ html: `<div>${n}</div>`, className: 'cluster', iconSize: [size, size] });
    },
  });
  map.addLayer(cluster);

  const pinIcon = (hex, hl) => L.divIcon({
    className: '',
    html: `<div class="pin${hl ? ' hl' : ''}" style="background:${hex}"></div>`,
    iconSize: hl ? [30, 30] : [22, 22],
    iconAnchor: hl ? [15, 30] : [11, 22],
    popupAnchor: [0, hl ? -28 : -20],
  });

  // ---------- 資料處理 ----------
  function categorize(types) {
    const tokens = (types || '').split('/').map((t) => t.trim()).filter(Boolean);
    const cats = new Set();
    for (const c of CATS) if (c.match.some((m) => tokens.includes(m))) cats.add(c.key);
    if (!cats.size) cats.add('other');
    const feats = new Set();
    for (const f of FEATS) if (f.match.some((m) => tokens.includes(m))) feats.add(f.key);
    return { tokens, cats, feats };
  }

  function prepare(raw) {
    return raw
      .filter((d) => Number.isFinite(d['緯度']) && Number.isFinite(d['經度']))
      .map((d, i) => {
        const { tokens, cats, feats } = categorize(d['類型']);
        const primary = CATS.find((c) => cats.has(c.key));
        const rating = Number.isFinite(d['評分']) ? d['評分'] : null;
        const reviews = Number.isFinite(d['評論數']) ? d['評論數'] : 0;
        const item = {
          id: i,
          name: d['名稱'] || '(未命名)',
          region: d['地區'] || '其他',
          address: d['地址'] || '',
          phone: d['電話'] || '',
          rating, reviews,
          line: safeUrl(d['Line']),
          web: safeUrl(d['網站']),
          types: tokens,
          cats, feats, primary,
          lat: d['緯度'], lng: d['經度'],
          photo: safeUrl(d['照片']),
          gmap: safeUrl(d['Google地圖']),
          // 貝氏平均：評論少的高分不會壓過評論多的
          score: rating == null ? 0 : (rating * reviews + 4.3 * 20) / (reviews + 20),
          dist: distKm(STATION, [d['緯度'], d['經度']]),
        };
        item.search = [item.name, item.address, item.region, tokens.join(' ')].join(' ').toLowerCase();
        item.marker = L.marker([item.lat, item.lng], { icon: pinIcon(primary.hex) })
          .bindPopup(() => popupHtml(item), { maxWidth: 260, minWidth: 240 })
          .on('click', () => highlight(item.id, { fromMap: true }));
        return item;
      });
  }

  // ---------- 渲染 ----------
  const fmtRating = (it) => (it.rating == null ? '<span>尚無評分</span>'
    : `<span class="stars">★ ${it.rating.toFixed(1)}</span><span>(${it.reviews.toLocaleString()})</span>`);

  const actionsHtml = (it) => [
    it.gmap && `<a href="${esc(it.gmap)}" target="_blank" rel="noopener">Google 地圖</a>`,
    it.web && `<a href="${esc(it.web)}" target="_blank" rel="noopener">網站</a>`,
    it.line && `<a href="${esc(it.line)}" target="_blank" rel="noopener">LINE</a>`,
    it.phone && `<a href="tel:${esc(it.phone.replace(/\s+/g, ''))}">${esc(it.phone)}</a>`,
  ].filter(Boolean).join('');

  const tagHtml = (it) => `<span class="tag" style="background:${it.primary.hex}">${esc(it.primary.label)}</span>`;

  function popupHtml(it) {
    return `<div class="pop">
      ${it.photo ? `<img src="${esc(it.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      <div class="pb">
        <h4>${esc(it.name)}</h4>
        <div class="meta">${tagHtml(it)}${fmtRating(it)}</div>
        <div class="addr">${esc(it.address)}</div>
        <div class="actions">${actionsHtml(it)}</div>
      </div></div>`;
  }

  function cardHtml(it) {
    const img = it.photo
      ? `<img class="thumb" src="${esc(it.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;thumb fallback&quot;>🏠</div>'">`
      : '<div class="thumb fallback">🏠</div>';
    return `<li class="card${it.id === activeId ? ' active' : ''}" data-id="${it.id}" tabindex="0">
      ${img}
      <div class="card-body">
        <h4>${esc(it.name)}</h4>
        <div class="meta">${tagHtml(it)}${fmtRating(it)}<span>· ${esc(it.region)}</span>${state.sort === 'station' ? `<span class="dist">🚉 ${fmtKm(it.dist)}</span>` : ''}</div>
        <div class="addr" title="${esc(it.address)}">${esc(it.address)}</div>
        <div class="actions">${actionsHtml(it)}</div>
      </div></li>`;
  }

  function groupedHtml(items) {
    const counts = {};
    items.forEach((it) => { counts[it.region] = (counts[it.region] || 0) + 1; });
    let html = '', cur = null;
    for (const it of items) {
      if (it.region !== cur) {
        cur = it.region;
        html += `<li class="group-head"><span>${esc(cur)}</span><span>${counts[cur]} 間・距車站 ${fmtKm(it.dist)} 起</span></li>`;
      }
      html += cardHtml(it);
    }
    return html;
  }

  function computeRegionRank() {
    const by = {};
    data.forEach((it) => (by[it.region] ||= []).push(it.dist));
    const med = Object.fromEntries(Object.entries(by).map(([r, ds]) => {
      ds.sort((a, b) => a - b);
      return [r, ds[Math.floor(ds.length / 2)]];
    }));
    Object.keys(med).sort((a, b) => med[a] - med[b]).forEach((r, i) => { regionRank[r] = i; });
  }

  function matches(it, skip) {
    if (state.q && !state.q.split(/\s+/).every((w) => it.search.includes(w))) return false;
    if (skip !== 'region' && state.regions.size && !state.regions.has(it.region)) return false;
    if (skip !== 'cat' && state.cats.size && ![...it.cats].some((c) => state.cats.has(c))) return false;
    if (skip !== 'feat' && state.feats.size && ![...state.feats].every((f) => it.feats.has(f))) return false;
    if (state.minRating && (it.rating == null || it.rating < state.minRating)) return false;
    if (state.minReviews && it.reviews < state.minReviews) return false;
    if (state.hasPhone && !it.phone) return false;
    if (state.hasWeb && !it.web) return false;
    if (state.hasLine && !it.line) return false;
    return true;
  }

  const sorters = {
    score: (a, b) => b.score - a.score,
    // 火車站擴散排序：區域依「離車站的中位距離」由近到遠，區域內再依距離由近到遠
    station: (a, b) => (regionRank[a.region] - regionRank[b.region]) || (a.dist - b.dist),
    rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.reviews - a.reviews,
    reviews: (a, b) => b.reviews - a.reviews,
    name: (a, b) => a.name.localeCompare(b.name, 'zh-Hant'),
  };

  function apply({ refit = false } = {}) {
    const base = data.filter((it) => matches(it));
    // 地圖上顯示所有符合篩選者；「只顯示地圖範圍內」只影響列表
    cluster.clearLayers();
    cluster.addLayers(base.map((it) => it.marker));
    if (refit && base.length) map.fitBounds(L.latLngBounds(base.map((it) => [it.lat, it.lng])), { padding: [30, 30], maxZoom: 15 });

    const bounds = map.getBounds();
    filtered = (state.inBounds ? base.filter((it) => bounds.contains([it.lat, it.lng])) : base).sort(sorters[state.sort]);

    $('#list').innerHTML = state.sort === 'station' ? groupedHtml(filtered) : filtered.map(cardHtml).join('');
    $('#count').textContent = `${filtered.length} 間${state.inBounds ? '（地圖範圍內）' : ''}`;
    $('#applyCount').textContent = filtered.length;
    $('#empty').hidden = filtered.length > 0;
    updateCounts();
    updateBadge();
  }

  // 每個選項顯示「選了它會有幾間」
  function updateCounts() {
    const count = (skip, pred) => data.reduce((n, it) => n + (matches(it, skip) && pred(it) ? 1 : 0), 0);
    document.querySelectorAll('#regionChips .chip').forEach((el) => {
      el.querySelector('.n').textContent = count('region', (it) => it.region === el.dataset.v);
    });
    document.querySelectorAll('#catChips .chip').forEach((el) => {
      el.querySelector('.n').textContent = count('cat', (it) => it.cats.has(el.dataset.v));
    });
    document.querySelectorAll('#featChips .chip').forEach((el) => {
      el.querySelector('.n').textContent = count('feat', (it) => [...state.feats, el.dataset.v].every((f) => it.feats.has(f)));
    });
  }

  function updateBadge() {
    const n = state.regions.size + state.cats.size + state.feats.size
      + (state.minRating ? 1 : 0) + (state.minReviews ? 1 : 0)
      + state.hasPhone + state.hasWeb + state.hasLine + state.inBounds;
    $('#filterBadge').hidden = !n;
    $('#filterBadge').textContent = n;
    const regions = state.regions.size ? [...state.regions].join('、') : '台東市・知本・太麻里';
    $('#summary').textContent = `${regions}｜共 ${data.length} 間住宿`;
  }

  // ---------- 互動 ----------
  function highlight(id, { fromMap = false } = {}) {
    const prev = data[activeId];
    if (prev) prev.marker.setIcon(pinIcon(prev.primary.hex)).setZIndexOffset(0);
    activeId = id;
    const it = data[id];
    if (!it) return;
    it.marker.setIcon(pinIcon(it.primary.hex, true)).setZIndexOffset(1000);
    document.querySelectorAll('.card.active').forEach((el) => el.classList.remove('active'));
    const card = document.querySelector(`.card[data-id="${id}"]`);
    if (card) {
      card.classList.add('active');
      if (fromMap) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    if (!fromMap) {
      if (isPhone()) setView('map');
      cluster.zoomToShowLayer(it.marker, () => it.marker.openPopup());
    }
  }

  const isPhone = () => matchMedia('(max-width: 720px)').matches;

  function setView(v) {
    document.querySelector('.layout').dataset.view = v;
    document.querySelectorAll('.viewbar button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    if (v === 'map') setTimeout(() => map.invalidateSize(), 0);
  }

  function openFilters(open) {
    $('#filters').classList.toggle('open', open);
    $('#scrim').hidden = !open;
    $('#filterToggle').setAttribute('aria-expanded', open);
  }

  function chip(container, value, label, set, color) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.v = value;
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `${color ? `<span class="dot" style="background:${color}"></span>` : ''}${esc(label)} <span class="n"></span>`;
    b.addEventListener('click', () => {
      set.has(value) ? set.delete(value) : set.add(value);
      b.setAttribute('aria-pressed', set.has(value));
      apply({ refit: container.id === 'regionChips' });
    });
    container.appendChild(b);
  }

  function seg(id, key) {
    const root = $(id);
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      root.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      state[key] = Number(b.dataset.v);
      if (key === 'minRating') $('#ratingOut').textContent = state.minRating ? `${state.minRating}+` : '不限';
      apply();
    });
  }

  function reset() {
    Object.assign(state, { q: '', minRating: 0, minReviews: 0, hasPhone: false, hasWeb: false, hasLine: false, inBounds: false });
    state.regions.clear(); state.cats.clear(); state.feats.clear();
    $('#q').value = '';
    document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.v === '0'));
    $('#ratingOut').textContent = '不限';
    ['hasPhone', 'hasWeb', 'hasLine', 'inBounds'].forEach((k) => { $('#' + k).checked = false; });
    apply({ refit: true });
  }

  function bind() {
    const regions = [...new Set(data.map((d) => d.region))];
    regions.forEach((r) => chip($('#regionChips'), r, r, state.regions));
    CATS.filter((c) => data.some((d) => d.cats.has(c.key)))
      .forEach((c) => chip($('#catChips'), c.key, c.label, state.cats, c.hex));
    FEATS.filter((f) => data.some((d) => d.feats.has(f.key)))
      .forEach((f) => chip($('#featChips'), f.key, f.label, state.feats));

    seg('#ratingSeg', 'minRating');
    seg('#reviewSeg', 'minReviews');
    ['hasPhone', 'hasWeb', 'hasLine', 'inBounds'].forEach((k) => {
      $('#' + k).addEventListener('change', (e) => { state[k] = e.target.checked; apply(); });
    });

    let t;
    $('#q').addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); apply(); }, 150);
    });
    $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; apply(); });
    $('#resetBtn').addEventListener('click', reset);
    $('#emptyReset').addEventListener('click', reset);

    $('#list').addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const card = e.target.closest('.card');
      if (card) highlight(Number(card.dataset.id));
    });
    $('#list').addEventListener('keydown', (e) => {
      const card = e.target.closest('.card');
      if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); highlight(Number(card.dataset.id)); }
    });

    map.on('moveend', () => { if (state.inBounds) apply(); });

    $('#filterToggle').addEventListener('click', () => openFilters(true));
    $('#filterClose').addEventListener('click', () => openFilters(false));
    $('#applyBtn').addEventListener('click', () => openFilters(false));
    $('#scrim').addEventListener('click', () => openFilters(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openFilters(false); });
    document.querySelectorAll('.viewbar button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  }

  // ---------- 啟動 ----------
  fetch('taitung_lodging.json')
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((raw) => {
      data = prepare(raw);
      computeRegionRank();
      const qsSort = new URLSearchParams(location.search).get('sort');
      if (qsSort && sorters[qsSort]) { state.sort = qsSort; $('#sort').value = qsSort; }
      L.marker(STATION, {
        icon: L.divIcon({ className: '', html: '<div class="station">🚉</div>', iconSize: [32, 32], iconAnchor: [16, 16] }),
        zIndexOffset: 2000, title: '台東火車站',
      }).bindTooltip('台東火車站').addTo(map);
      bind();
      apply({ refit: true });
    })
    .catch((err) => {
      $('#summary').textContent = '資料載入失敗';
      $('#list').innerHTML = `<li class="empty">無法讀取 taitung_lodging.json（${esc(err.message)}）。<br>若是直接開啟檔案，請改用本機伺服器，例如 <code>python -m http.server</code>。</li>`;
    });
})();
