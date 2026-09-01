const test = require('node:test');
const assert = require('node:assert');
const Lib = require('./book.js');

function pageTotals(res) {
  return res.pages.map((p) => p.reduce((s, i) => s + i.text.length, 0));
}

test('detectChapterTitle：识别中文章节标题', () => {
  assert.deepStrictEqual(Lib.detectChapterTitle('第一章 缘起'), { isTitle: true, title: '第一章 缘起' });
  assert.deepStrictEqual(Lib.detectChapterTitle('第 三 章 相遇'), { isTitle: true, title: '第 三 章 相遇' });
  assert.strictEqual(Lib.detectChapterTitle('Chapter 5 Transform').isTitle, true);
  assert.strictEqual(Lib.detectChapterTitle('Chapter 5 Transform').title, 'Chapter 5 Transform');
});

test('detectChapterTitle：非标题/空行不误判', () => {
  assert.strictEqual(Lib.detectChapterTitle('这是正文内容的一行。').isTitle, false);
  assert.strictEqual(Lib.detectChapterTitle('').isTitle, false);
  assert.strictEqual(Lib.detectChapterTitle('   ').isTitle, false);
  // 正文行里含"第一章"但整行过长 → 不是标题
  assert.strictEqual(
    Lib.detectChapterTitle('第一章这三个字出现在一段很长很长的正文里而不是单独成行的标题因为整行文字都超过了四十个字符长度限制的边界').isTitle,
    false
  );
});

test('splitIntoChapters：识别多章并把正文归章', () => {
  const text =
    '第一章 开头\n这是第一章内容。\n第二章 发展\n这是第二章内容，相对更长一些以测试分页正确性。';
  const chs = Lib.splitIntoChapters(text);
  assert.strictEqual(chs.length, 2);
  assert.strictEqual(chs[0].title, '第一章 开头');
  assert.deepStrictEqual(chs[0].paragraphs, ['这是第一章内容。']);
  assert.strictEqual(chs[1].title, '第二章 发展');
  assert.deepStrictEqual(chs[1].paragraphs, ['这是第二章内容，相对更长一些以测试分页正确性。']);
});

test('splitIntoChapters：无标题全书为单章', () => {
  const chs = Lib.splitIntoChapters('没有章节标题的正文\n第二行正文\n');
  assert.strictEqual(chs.length, 1);
  assert.strictEqual(chs[0].title, '正文');
  assert.deepStrictEqual(chs[0].paragraphs, ['没有章节标题的正文', '第二行正文']);
});

test('splitIntoChapters：空文本退化为单章', () => {
  const chs = Lib.splitIntoChapters('');
  assert.strictEqual(chs.length, 1);
  assert.strictEqual(chs[0].title, '正文');
  assert.deepStrictEqual(chs[0].paragraphs, []);
});

test('computeCharsPerPage：按尺寸与字号计算', () => {
  // charsPerLine = floor(800/16)=50，linesPerPage = floor(600/26)=23 → 1150
  assert.strictEqual(
    Lib.computeCharsPerPage({ pageWidth: 800, pageHeight: 600, fontSize: 16, lineHeight: 26 }),
    1150
  );
  // 默认字号保护：不足时至少返回 1
  assert.strictEqual(Lib.computeCharsPerPage({ pageWidth: 0, pageHeight: 0, fontSize: 16 }), 1);
});

test('paginate：单页不超过容量，多章跨页章节起始页正确', () => {
  const chs = [
    { title: '第一章', paragraphs: ['aaaa', 'bbbb'] },
    { title: '第二章', paragraphs: ['cccc', 'dddd'] },
  ];
  const res = Lib.paginate(chs, 6);
  const totals = pageTotals(res);
  totals.forEach((n) => assert.ok(n <= 6, `页内容 ${n} 应不超过容量 6`));
  assert.strictEqual(res.chapterStartIndex[0], 0);
  assert.strictEqual(res.chapterStartIndex[1], 1);
  assert.deepStrictEqual(totals, [6, 6, 4]);
});

test('paginate：超长段落被拆分且每页不超容量', () => {
  const chs = [{ title: 'A', paragraphs: ['xxxxxxxxxx'] }];
  const res = Lib.paginate(chs, 5);
  pageTotals(res).forEach((n) => assert.ok(n <= 5));
  assert.strictEqual(res.chapterStartIndex[0], 0);
});

test('paginate：多章各自的起始页单调递增', () => {
  const chs = [
    { title: 'A', paragraphs: ['xxxxxxxxxx'] },
    { title: 'B', paragraphs: ['yyyyyyyyyy'] },
  ];
  const res = Lib.paginate(chs, 5);
  pageTotals(res).forEach((n) => assert.ok(n <= 5));
  assert.strictEqual(res.pages.length, 4);
  assert.strictEqual(res.chapterStartIndex[0], 0);
  assert.strictEqual(res.chapterStartIndex[1], 2);
});

test('paginate：空章节数组回退为单空页', () => {
  const res = Lib.paginate([], 10);
  assert.strictEqual(res.pages.length, 1);
  assert.deepStrictEqual(res.chapterStartIndex, []);
});
