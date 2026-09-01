/* 交互与渲染层：依赖 book.js 提供的 window.EbookLib */
(function () {
  'use strict';
  var Lib = window.EbookLib;

  var FONT_MIN = 14;
  var FONT_MAX = 28;
  var BOOK_CACHE_MAX = 4 * 1024 * 1024; // 4MB，超限则不缓存内容，避免撑爆 localStorage

  var state = {
    book: null, // { name, text, chapters, pages, chapterStartIndex }
    currentPage: 0,
    fontSize: 18,
    theme: 'light'
  };

  var els = {};
  function $(id) { return document.getElementById(id); }

  /* ---------- 持久化 ---------- */
  function readPrefs() {
    try { return JSON.parse(localStorage.getItem('ebook:prefs')) || {}; } catch (e) { return {}; }
  }
  function savePrefs() {
    try { localStorage.setItem('ebook:prefs', JSON.stringify({ fontSize: state.fontSize, theme: state.theme })); } catch (e) {}
  }
  function progressKey(name) { return 'ebook:progress:' + encodeURIComponent(name); }
  function readProgress(name) {
    try { return JSON.parse(localStorage.getItem(progressKey(name))) || null; } catch (e) { return null; }
  }
  function saveProgress() {
    if (!state.book) return;
    try { localStorage.setItem(progressKey(state.book.name), JSON.stringify({ page: state.currentPage })); } catch (e) {}
  }
  function cacheBook(name, text) {
    if (text.length > BOOK_CACHE_MAX) { try { localStorage.removeItem('ebook:book'); } catch (e) {} }
    else { try { localStorage.setItem('ebook:book', JSON.stringify({ name: name, text: text })); } catch (e) {} }
  }
  function readCachedBook() {
    try { return JSON.parse(localStorage.getItem('ebook:book')); } catch (e) { return null; }
  }

  /* ---------- 主题 / 字号 ---------- */
  function applyTheme() {
    document.body.setAttribute('data-theme', state.theme);
    els.themeToggle.textContent = state.theme === 'light' ? '🌙' : '☀️';
  }
  function toggleTheme() {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    applyTheme();
    savePrefs();
  }
  function adjustFont(delta) {
    if (!state.book) return;
    var next = Math.max(FONT_MIN, Math.min(FONT_MAX, state.fontSize + delta * 2));
    if (next === state.fontSize) return;
    var totalBefore = state.book.pages.length;
    var pct = state.currentPage && totalBefore > 1 ? state.currentPage / (totalBefore - 1) : 0;
    state.fontSize = next;
    buildPages();
    var totalAfter = state.book.pages.length;
    state.currentPage = totalAfter > 1 ? Math.round(pct * (totalAfter - 1)) : 0;
    if (state.currentPage >= totalAfter) state.currentPage = totalAfter - 1;
    if (state.currentPage < 0) state.currentPage = 0;
    savePrefs();
    renderPage();
    saveProgress();
  }

  /* ---------- 分页 ---------- */
  function readerInner() {
    var cs = getComputedStyle(els.reader);
    var pl = parseFloat(cs.paddingLeft) || 0;
    var pr = parseFloat(cs.paddingRight) || 0;
    var pt = parseFloat(cs.paddingTop) || 0;
    var pb = parseFloat(cs.paddingBottom) || 0;
    var w = els.reader.clientWidth - pl - pr;
    var h = els.reader.clientHeight - pt - pb;
    return { width: Math.max(1, w), height: Math.max(1, h) };
  }
  function buildPages() {
    var inner = readerInner();
    var lineHeight = Math.round(state.fontSize * 1.7);
    var charsPerPage = Lib.computeCharsPerPage({
      pageWidth: inner.width,
      pageHeight: inner.height,
      fontSize: state.fontSize,
      lineHeight: lineHeight
    });
    var res = Lib.paginate(state.book.chapters, charsPerPage);
    state.book.pages = res.pages;
    state.book.chapterStartIndex = res.chapterStartIndex;
  }

  /* ---------- 渲染 ---------- */
  function renderPage() {
    var pages = state.book.pages;
    if (!pages.length) return;
    var total = pages.length;
    if (state.currentPage >= total) state.currentPage = total - 1;
    if (state.currentPage < 0) state.currentPage = 0;
    var page = pages[state.currentPage];

    els.reader.innerHTML = '';
    var lastIdx = -1;
    page.forEach(function (item) {
      if (item.chapterIdx !== lastIdx) {
        lastIdx = item.chapterIdx;
        var title = state.book.chapters[item.chapterIdx].title;
        if (title) {
          var h = document.createElement('h2');
          h.className = 'chapter-title';
          h.textContent = title;
          els.reader.appendChild(h);
        }
      }
      var p = document.createElement('p');
      p.textContent = item.text;
      if (!item.paraStart) p.classList.add('cont');
      els.reader.appendChild(p);
    });

    els.pageInfo.textContent = (state.currentPage + 1) + ' / ' + total;
    els.prevBtn.disabled = state.currentPage <= 0;
    els.nextBtn.disabled = state.currentPage >= total - 1;
  }

  function renderToc() {
    els.tocList.innerHTML = '';
    state.book.chapters.forEach(function (ch, i) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = 'javascript:void(0)';
      a.textContent = ch.title;
      a.addEventListener('click', function () { gotoPage(state.book.chapterStartIndex[i]); });
      li.appendChild(a);
      els.tocList.appendChild(li);
    });
  }

  function gotoPage(idx) {
    var total = state.book.pages.length;
    state.currentPage = Math.max(0, Math.min(idx, total - 1));
    renderPage();
    saveProgress();
  }
  function turn(delta) {
    if (!state.book) return;
    gotoPage(state.currentPage + delta);
  }

  /* ---------- 载书 ---------- */
  function loadBook(name, text) {
    var chapters = Lib.splitIntoChapters(text);
    state.book = { name: name, text: text, chapters: chapters, pages: [], chapterStartIndex: [] };
    buildPages();
    var prog = readProgress(name);
    state.currentPage = prog ? Math.min(Math.max(0, prog.page || 0), state.book.pages.length - 1) : 0;
    renderToc();
    renderPage();
    document.title = name + ' — 电子书阅读器';
    els.topbar.textContent = name;
    cacheBook(name, text);
    saveProgress();
  }

  /* ---------- 文件读取（UTF-8 优先，失败回退 GBK） ---------- */
  function decodeBytes(arrayBuffer) {
    var bytes = new Uint8Array(arrayBuffer);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) {
      try { return new TextDecoder('gbk').decode(bytes); }
      catch (e2) { return new TextDecoder('utf-8').decode(bytes); }
    }
  }
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve({ name: file.name, text: decodeBytes(fr.result) }); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsArrayBuffer(file);
    });
  }
  function onFile(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    readFile(file).then(function (r) { loadBook(r.name, r.text); }).catch(function (err) {
      alert('读取文件失败：' + err);
    });
    e.target.value = ''; // 允许再次选择同一文件
  }

  /* ---------- 启动 ---------- */
  function init() {
    els.openBtn = $('openBtn');
    els.fileInput = $('fileInput');
    els.prevBtn = $('prevBtn');
    els.nextBtn = $('nextBtn');
    els.pageInfo = $('pageInfo');
    els.tocList = $('tocList');
    els.tocToggle = $('tocToggle');
    els.themeToggle = $('themeToggle');
    els.fontMinus = $('fontMinus');
    els.fontPlus = $('fontPlus');
    els.reader = $('reader');
    els.topbar = $('topbar');
    els.emptyOpenBtn = $('emptyOpenBtn');

    var prefs = readPrefs();
    state.fontSize = prefs.fontSize && prefs.fontSize >= FONT_MIN && prefs.fontSize <= FONT_MAX ? prefs.fontSize : 18;
    state.theme = prefs.theme || 'light';
    applyTheme();

    els.openBtn.addEventListener('click', function () { els.fileInput.click(); });
    if (els.emptyOpenBtn) els.emptyOpenBtn.addEventListener('click', function () { els.fileInput.click(); });
    els.fileInput.addEventListener('change', onFile);
    els.prevBtn.addEventListener('click', function () { turn(-1); });
    els.nextBtn.addEventListener('click', function () { turn(1); });
    els.tocToggle.addEventListener('click', function () { document.body.classList.toggle('toc-open'); });
    els.themeToggle.addEventListener('click', toggleTheme);
    els.fontMinus.addEventListener('click', function () { adjustFont(-1); });
    els.fontPlus.addEventListener('click', function () { adjustFont(1); });
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);

    restoreLast();
  }

  function onKey(e) {
    if (!state.book) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); turn(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); turn(-1); }
  }
  function onResize() {
    if (!state.book) return;
    buildPages();
    var total = state.book.pages.length;
    if (state.currentPage >= total) state.currentPage = total - 1;
    renderPage();
  }

  function restoreLast() {
    var cached = readCachedBook();
    if (cached && cached.text) {
      loadBook(cached.name, cached.text);
      return;
    }
    // 无缓存时保持空态（emptyState 已在 HTML 中，renderPage 载书后会自动覆盖）
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
