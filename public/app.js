'use strict';

const MAX_TOTAL_PIECES = 12;

const rowsBody = document.getElementById('spec-rows');
const leftoverBody = document.getElementById('leftover-rows');
const counterEl = document.getElementById('piece-counter');
const errorEl = document.getElementById('form-error');
const resultEl = document.getElementById('result');

function specLetter(index) {
  return String.fromCharCode(65 + index); // A、B、C…
}

function bindRowInputs(tr, triggerCalc = false) {
  tr.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updateCounter);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('calc-btn').click();
    });
  });
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
  bindRowInputs(tr);
  rowsBody.appendChild(tr);
  refreshLetters();
  updateCounter();
}

function refreshLetters() {
  Array.from(rowsBody.children).forEach((tr, i) => {
    tr.querySelector('.spec-letter').textContent = specLetter(i);
  });
  Array.from(leftoverBody.children).forEach((tr, i) => {
    tr.querySelector('.spec-letter').textContent = `余${i + 1}`;
  });
}

function addLeftoverRow(length = '', qty = '') {
  const tr = document.createElement('tr');
  tr.className = 'leftover-row';
  tr.innerHTML = `
    <td><span class="spec-letter leftover-badge"></span></td>
    <td><input type="number" class="len-input" min="0" step="any" placeholder="如 1200" /></td>
    <td><input type="number" class="qty-input" min="1" step="1" placeholder="根数" /></td>
    <td><button type="button" class="btn-remove" title="删除该行">✕</button></td>
  `;
  tr.querySelector('.len-input').value = length;
  tr.querySelector('.qty-input').value = qty;
  tr.querySelector('.btn-remove').addEventListener('click', () => {
    tr.remove();
    refreshLetters();
    updateCounter();
  });
  bindRowInputs(tr);
  leftoverBody.appendChild(tr);
  refreshLetters();
  updateCounter();
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

function collectRows(body) {
  const rows = [];
  Array.from(body.children).forEach((tr) => {
    rows.push({
      length: tr.querySelector('.len-input').value,
      qty: tr.querySelector('.qty-input').value,
    });
  });
  return rows;
}

function collectPayload() {
  const stockLength = Number(document.getElementById('stock-length').value);
  const kerf = Number(document.getElementById('kerf').value);
  return {
    stockLength,
    kerf,
    items: collectRows(rowsBody),
    leftovers: collectRows(leftoverBody),
  };
}

function renderLeftoverSummary(result) {
  if (!result.hasLeftovers) return '';
  const rows = result.leftoverSummary
    .map(
      (s) => `
      <tr>
        <td><span class="leftover-badge">余料</span> ${fmt(s.length)}</td>
        <td>${s.available}</td>
        <td><strong>${s.used}</strong></td>
        <td>${s.remaining}</td>
      </tr>`
    )
    .join('');
  return `
    <h3 class="sub-heading">余料库存消耗汇总</h3>
    <table class="summary-table">
      <thead>
        <tr><th>余料规格（长度）</th><th>库存根数</th><th>消耗根数</th><th>剩余根数</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderBins(result) {
  const summarySpans = [];
  if (result.hasLeftovers) {
    summarySpans.push(`<span>新料长度：<strong>${fmt(result.stockLength)}</strong></span>`);
    summarySpans.push(
      `<span>投入根数：<strong>${result.binCount}</strong> 根（余料 ${result.leftoverBinCount} 根 + 新料 ${result.newBinCount} 根）</span>`
    );
  } else {
    summarySpans.push(`<span>原料长度：<strong>${fmt(result.stockLength)}</strong></span>`);
    summarySpans.push(`<span>原料根数：<strong>${result.binCount}</strong></span>`);
  }
  summarySpans.push(`<span>锯缝宽度：<strong>${fmt(result.kerf)}</strong></span>`);
  summarySpans.push(`<span>总片数：<strong>${result.totalPieces}</strong></span>`);
  summarySpans.push(`<span>锯缝总数：<strong>${result.totalCuts}</strong></span>`);
  summarySpans.push(`<span>投入原料总长度：<strong>${fmt(result.totalStockLength)}</strong></span>`);
  summarySpans.push(`<span>总余长：<strong>${fmt(result.totalLeftover)}</strong></span>`);
  summarySpans.push(
    `<span>综合利用率：<strong>${(result.utilization * 100).toFixed(1)}%</strong></span>`
  );
  document.getElementById('summary').innerHTML = summarySpans.join('');
  document.getElementById('leftover-summary').innerHTML = renderLeftoverSummary(result);

  const binsHtml = result.bins
    .map((bin) => {
      const isLeftover = bin.kind === 'leftover';
      const tag = isLeftover
        ? '<span class="kind-tag tag-leftover">余料</span>'
        : '<span class="kind-tag tag-new">新料</span>';
      const seq = bin.pieces
        .map((p) => `${p.label}(${fmt(p.length)})`)
        .join('<span class="arrow">→</span>');

      // 示意图：裁片 + 片间锯缝（红色）+ 余长（灰色）
      let barInner = '';
      bin.pieces.forEach((p, i) => {
        barInner += `<div class="seg${isLeftover ? ' seg-leftover' : ''}" style="flex-grow:${p.length}" title="${p.label} ${fmt(p.length)}">${p.label}</div>`;
        if (i < bin.cuts && result.kerf > 0) {
          // 按真实比例显示；过小的锯缝适当加宽以便辨认（示意图，精确数值见下方文字）
          const kerfWidth = Math.max(result.kerf, bin.stockLength * 0.008);
          barInner += `<div class="seg kerf" style="flex-grow:${kerfWidth}" title="锯缝 ${fmt(result.kerf)}"></div>`;
        }
      });
      if (bin.leftover > 1e-9) {
        barInner += `<div class="seg leftover" style="flex-grow:${bin.leftover}" title="余长 ${fmt(bin.leftover)}">余 ${fmt(bin.leftover)}</div>`;
      }

      return `
        <div class="bin${isLeftover ? ' bin-leftover' : ''}">
          <div class="bin-title">第 ${bin.index} 根：${tag} 长度 ${fmt(bin.stockLength)}</div>
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
document.getElementById('add-leftover-row').addEventListener('click', () => addLeftoverRow());
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
// 默认给一条空余料行（留空即不参与计算）
addLeftoverRow();
