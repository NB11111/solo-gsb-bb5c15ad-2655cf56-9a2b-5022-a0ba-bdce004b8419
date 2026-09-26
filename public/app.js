'use strict';

const MAX_TOTAL_PIECES = 12;

const rowsBody = document.getElementById('spec-rows');
const counterEl = document.getElementById('piece-counter');
const errorEl = document.getElementById('form-error');
const resultEl = document.getElementById('result');

function specLetter(index) {
  return String.fromCharCode(65 + index); // A、B、C…
}

function addRow(length = '', qty = 1) {
  const tr = document.createElement('tr');
  tr.className = 'spec-row';
  tr.innerHTML = `
    <td><span class="spec-letter"></span></td>
    <td><input type="number" class="len-input" min="0" step="any" /></td>
    <td><input type="number" class="qty-input" min="1" step="1" /></td>
    <td><button type="button" class="btn-remove" title="删除该行">✕</button></td>
  `;
  tr.querySelector('.len-input').value = length;
  tr.querySelector('.qty-input').value = qty;
  tr.querySelector('.btn-remove').addEventListener('click', () => {
    if (rowsBody.children.length > 1) {
      tr.remove();
      refreshLetters();
      updateCounter();
    }
  });
  tr.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updateCounter);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('calc-btn').click();
    });
  });
  rowsBody.appendChild(tr);
  refreshLetters();
  updateCounter();
}

function refreshLetters() {
  Array.from(rowsBody.children).forEach((tr, i) => {
    tr.querySelector('.spec-letter').textContent = specLetter(i);
  });
}

function updateCounter() {
  let total = 0;
  rowsBody.querySelectorAll('.qty-input').forEach((input) => {
    const q = Number(input.value);
    if (Number.isInteger(q) && q > 0) total += q;
  });
  counterEl.textContent = `总片数：${total} / ${MAX_TOTAL_PIECES}`;
  counterEl.classList.toggle('over', total > MAX_TOTAL_PIECES);
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = '';
}

function fmt(n) {
  // 最多保留 3 位小数并去掉多余的 0
  return (Math.round(n * 1000) / 1000).toString();
}

function collectPayload() {
  const stockLength = Number(document.getElementById('stock-length').value);
  const kerf = Number(document.getElementById('kerf').value);
  const items = [];
  Array.from(rowsBody.children).forEach((tr) => {
    items.push({
      length: tr.querySelector('.len-input').value,
      qty: tr.querySelector('.qty-input').value,
    });
  });
  return { stockLength, kerf, items };
}

function renderBins(result) {
  const L = result.stockLength;
  const summary = `
    <span>原料长度：<strong>${fmt(result.stockLength)}</strong></span>
    <span>锯缝宽度：<strong>${fmt(result.kerf)}</strong></span>
    <span>原料根数：<strong>${result.binCount}</strong></span>
    <span>总片数：<strong>${result.totalPieces}</strong></span>
    <span>锯缝总数：<strong>${result.totalCuts}</strong></span>
    <span>总余长：<strong>${fmt(result.totalLeftover)}</strong></span>
    <span>综合利用率：<strong>${(result.utilization * 100).toFixed(1)}%</strong></span>
  `;
  document.getElementById('summary').innerHTML = summary;

  const binsHtml = result.bins
    .map((bin) => {
      const seq = bin.pieces
        .map((p) => `${p.label}(${fmt(p.length)})`)
        .join('<span class="arrow">→</span>');

      // 示意图：裁片 + 片间锯缝（红色）+ 余长（灰色）
      let barInner = '';
      bin.pieces.forEach((p, i) => {
        barInner += `<div class="seg" style="flex-grow:${p.length}" title="${p.label} ${fmt(p.length)}">${p.label}</div>`;
        if (i < bin.cuts && result.kerf > 0) {
          // 按真实比例显示；过小的锯缝适当加宽以便辨认（示意图，精确数值见下方文字）
          const kerfWidth = Math.max(result.kerf, result.stockLength * 0.008);
          barInner += `<div class="seg kerf" style="flex-grow:${kerfWidth}" title="锯缝 ${fmt(result.kerf)}"></div>`;
        }
      });
      if (bin.leftover > 1e-9) {
        barInner += `<div class="seg leftover" style="flex-grow:${bin.leftover}" title="余长 ${fmt(bin.leftover)}">余 ${fmt(bin.leftover)}</div>`;
      }

      return `
        <div class="bin">
          <div class="bin-title">第 ${bin.index} 根原料</div>
          <div class="bar">${barInner}</div>
          <div class="bin-seq">裁切顺序：${seq}<span class="arrow">→</span><span class="leftover-tag">余长 ${fmt(bin.leftover)}</span></div>
          <div class="bin-meta">共 ${bin.count} 片，锯缝 ${bin.cuts} 条，已用 ${fmt(bin.usedLength)}，余长 ${fmt(bin.leftover)}</div>
        </div>
      `;
    })
    .join('');
  document.getElementById('bins').innerHTML = binsHtml;
}

document.getElementById('add-row').addEventListener('click', () => addRow());
document.getElementById('calc-btn').addEventListener('click', async () => {
  clearError();
  resultEl.hidden = true;

  try {
    const resp = await fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectPayload()),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      showError(data.error || '计算失败，请检查输入');
      return;
    }
    renderBins(data.result);
    resultEl.hidden = false;
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError('无法连接服务器，请确认服务已启动');
  }
});
document.getElementById('print-btn').addEventListener('click', () => {
  document.getElementById('print-time').textContent =
    '打印时间：' + new Date().toLocaleString('zh-CN');
  window.print();
});

// 默认示例
addRow(800, 2);
addRow(600, 2);
addRow(400, 1);
