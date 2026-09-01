/* 电子书阅读器核心纯逻辑库（UMD 双导出）
 * 浏览器：window.EbookLib
 * Node 测试：require('./book.js')
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EbookLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 独立成行、且较短的行才视为章节标题（长度限制避免误判正文中的"第一章"三个字）
  var CHAPTER_RE =
    /^(第\s*[0-9一二三四五六七八九十百千万零〇]+\s*[章回节卷篇]|Chapter\s+\d+|序章|楔子|前言|后记|尾声|引子|开端|番外|外传)/;
  var TITLE_MAX_LEN = 40;

  /**
   * 判断一行是否为章节标题。
   * @param {string} line
   * @returns {{isTitle: boolean, title: (string|null)}}
   */
  function detectChapterTitle(line) {
    var t = String(line == null ? '' : line).trim();
    if (!t || t.length > TITLE_MAX_LEN) return { isTitle: false, title: null };
    if (CHAPTER_RE.test(t)) return { isTitle: true, title: t };
    return { isTitle: false, title: null };
  }

  /**
   * 把整本文本切分为章节数组。每个元素 { title, paragraphs }。
   * 标题行之前的正文归入默认"正文"章节；无标题则全书归入单个"正文"章节。
   * @param {string} text
   * @returns {Array<{title: string, paragraphs: string[]}>}
   */
  function splitIntoChapters(text) {
    var raw = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
    var chapters = [];
    var cur = null;
    for (var i = 0; i < raw.length; i++) {
      var line = raw[i];
      var d = detectChapterTitle(line);
      if (d.isTitle) {
        if (cur) chapters.push(cur);
        cur = { title: d.title, paragraphs: [] };
      } else {
        if (!cur) cur = { title: '正文', paragraphs: [] };
        var s = line.trim();
        if (s) cur.paragraphs.push(s);
      }
    }
    if (cur) chapters.push(cur);
    if (!chapters.length) chapters.push({ title: '正文', paragraphs: [] });
    return chapters;
  }

  /**
   * 按阅读区尺寸 + 字号计算每页容纳的字符数（中文字符宽度≈1em 近似）。
   * @param {{pageWidth:number,pageHeight:number,fontSize:number,lineHeight?:number}} opts
   * @returns {number}
   */
  function computeCharsPerPage(opts) {
    opts = opts || {};
    var fontSize = opts.fontSize || 16;
    var width = opts.pageWidth || 0;
    var height = opts.pageHeight || 0;
    var lineHeight = opts.lineHeight || Math.round(fontSize * 1.6);
    var charsPerLine = Math.floor(width / fontSize);
    var linesPerPage = Math.floor(height / lineHeight);
    return Math.max(1, charsPerLine * linesPerPage);
  }

  /**
   * 分页：字符容量打包，超长段落跨页时切成片段。
   * @param {Array<{title:string, paragraphs:string[]}>} chapters
   * @param {number} charsPerPage
   * @returns {{pages: Array<Array<{chapterIdx:number,paraStart:boolean,text:string}>>, chapterStartIndex: number[]}}
   */
  function paginate(chapters, charsPerPage) {
    chapters = chapters || [];
    charsPerPage = Math.max(1, charsPerPage || 0);
    var pages = [];
    var chapterStartIndex = [];
    var buf = [];
    var used = 0;

    function flush() {
      if (buf.length) {
        pages.push(buf);
        buf = [];
        used = 0;
      }
    }

    for (var ci = 0; ci < chapters.length; ci++) {
      var started = false;
      var paras = chapters[ci].paragraphs || [];
      for (var pi = 0; pi < paras.length; pi++) {
        var rest = paras[pi];
        var fragments = 0;
        while (rest.length) {
          var free = charsPerPage - used;
          if (free <= 0) {
            flush();
            continue;
          }
          var chunk = rest.slice(0, free);
          buf.push({ chapterIdx: ci, paraStart: fragments === 0, text: chunk });
          used += chunk.length;
          rest = rest.slice(chunk.length);
          fragments++;
          if (!started) {
            chapterStartIndex[ci] = pages.length; // 该章第一个片段实际所在的页码
            started = true;
          }
        }
      }
    }
    flush();

    for (var c2 = 0; c2 < chapters.length; c2++) {
      if (chapterStartIndex[c2] === undefined) chapterStartIndex[c2] = pages.length;
    }
    if (!pages.length) pages.push([]);
    return { pages: pages, chapterStartIndex: chapterStartIndex };
  }

  return {
    detectChapterTitle: detectChapterTitle,
    splitIntoChapters: splitIntoChapters,
    computeCharsPerPage: computeCharsPerPage,
    paginate: paginate
  };
});
