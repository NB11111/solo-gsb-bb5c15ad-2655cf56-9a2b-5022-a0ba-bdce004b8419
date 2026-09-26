'use strict';

/**
 * 木工短料下料优化核心算法。
 *
 * 规则说明：
 * - 同规格的裁片先展开成单片（每片带 A1、A2… 编号），再参与计算；
 * - 目标：使用原料根数最少（精确搜索，保证最优）；
 * - 锯缝只发生在同一根原料上相邻的两片之间：
 *   一根原料放 k 片，占用长度 = 各片长度之和 + (k - 1) × 锯缝宽度；
 * - 总裁片数上限 MAX_TOTAL_PIECES = 12。
 */

const MAX_TOTAL_PIECES = 12;
const MAX_QTY_PER_SPEC = 99;
const EPS = 1e-9; // 浮点比较容差

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.isValidation = true;
  }
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function isPositiveInteger(n) {
  return Number.isInteger(n) && n >= 1;
}

/**
 * 解析并校验输入，返回 { stockLength, kerf, pieces }。
 * pieces 为展开后的数组：[{ label, length }]，按长度从大到小排序。
 */
function parseAndValidate(input) {
  if (input === null || typeof input !== 'object') {
    throw new ValidationError('请求格式不正确');
  }

  const stockLength = toNumber(input.stockLength);
  if (!Number.isFinite(stockLength) || stockLength <= 0) {
    throw new ValidationError('原料长度必须是大于 0 的数字');
  }

  const kerf = toNumber(input.kerf);
  if (!Number.isFinite(kerf) || kerf < 0) {
    throw new ValidationError('锯缝宽度必须是不小于 0 的数字');
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ValidationError('请至少添加一条裁片规格');
  }

  const pieces = [];
  let totalCount = 0;
  const specNames = new Map(); // length -> 规格字母

  input.items.forEach((item, idx) => {
    const row = idx + 1;
    const length = toNumber(item && item.length);
    const qty = toNumber(item && item.qty);

    if (!Number.isFinite(length) || length <= 0) {
      throw new ValidationError(`第 ${row} 条规格：长度必须是大于 0 的数字`);
    }
    if (!isPositiveInteger(qty)) {
      throw new ValidationError(`第 ${row} 条规格：数量必须是正整数`);
    }
    if (qty > MAX_QTY_PER_SPEC) {
      throw new ValidationError(`第 ${row} 条规格：单条数量不能超过 ${MAX_QTY_PER_SPEC}`);
    }
    if (length > stockLength + EPS) {
      throw new ValidationError(
        `第 ${row} 条规格：长度 ${length} 超过原料长度 ${stockLength}，单片无法放入原料`
      );
    }

    // 同长度归入同一规格，共享字母编号
    const key = String(round6(length));
    if (!specNames.has(key)) {
      specNames.set(key, String.fromCharCode(65 + specNames.size)); // A、B、C…
    }
    const spec = specNames.get(key);

    for (let i = 1; i <= qty; i++) {
      pieces.push({ label: `${spec}${i}`, length });
    }
    totalCount += qty;
  });

  if (totalCount === 0) {
    throw new ValidationError('请至少添加一片裁片');
  }
  if (totalCount > MAX_TOTAL_PIECES) {
    throw new ValidationError(
      `总裁片数为 ${totalCount} 片，超过上限 ${MAX_TOTAL_PIECES} 片，请减少数量或合并规格`
    );
  }

  // 从大到小排序，加速搜索收敛
  pieces.sort((a, b) => b.length - a.length);

  return { stockLength, kerf, pieces };
}

/**
 * 精确搜索使用原料根数最少的分配方案（DFS + 剪枝）。
 * 返回各根原料的裁片下标数组。
 */
function minimizeBins(pieces, stockLength, kerf) {
  const n = pieces.length;
  const lengths = pieces.map((p) => p.length);
  const totalLength = lengths.reduce((s, x) => s + x, 0);
  // 全局下界：仅按长度估算（锯缝只会增加占用），用于剪枝
  const globalLB = Math.ceil((totalLength - EPS) / stockLength);

  const bins = []; // { load: 已占用长度（含片间锯缝）, count: 片数, items: [下标] }
  let bestBins = null;
  let bestCount = Infinity;

  function dfs(idx) {
    if (bestBins) {
      const usedCount = bins.filter((b) => b.count > 0).length;
      if (Math.max(usedCount, globalLB) >= bestCount) return; // 不可能更优
    }
    if (idx === n) {
      const used = bins.filter((b) => b.count > 0).map((b) => b.items.slice());
      if (used.length < bestCount) {
        bestCount = used.length;
        bestBins = used;
      }
      return;
    }

    const len = lengths[idx];
    const seen = new Set(); // 跳过已占用长度相同的原料（等价分支去重）

    // 1) 尝试放入已开的原料
    for (let b = 0; b < bins.length; b++) {
      const bin = bins[b];
      if (bin.count === 0) continue;
      const key = `${bin.load.toFixed(6)}#${bin.count}`;
      if (seen.has(key)) continue;
      // 相邻切口才计锯缝：放入第 k 片时新增一条锯缝
      const added = bin.count > 0 ? len + kerf : len;
      if (bin.load + added > stockLength + EPS) continue;

      seen.add(key);
      bin.load += added;
      bin.count += 1;
      bin.items.push(idx);
      dfs(idx + 1);
      bin.items.pop();
      bin.count -= 1;
      bin.load -= added;
    }

    // 2) 新开一根原料（单片独占一根时不计锯缝）
    if (len <= stockLength + EPS) {
      bins.push({ load: len, count: 1, items: [idx] });
      dfs(idx + 1);
      bins.pop();
    }
  }

  dfs(0);
  return bestBins;
}

/**
 * 计算下料方案。
 * 输入：{ stockLength, kerf, items: [{ length, qty }] }
 * 返回：可直接渲染 JSON；输入非法时抛出 ValidationError（message 为明确原因）。
 */
function computeCuttingPlan(input) {
  const { stockLength, kerf, pieces } = parseAndValidate(input);
  const binIndexGroups = minimizeBins(pieces, stockLength, kerf);

  const bins = binIndexGroups.map((group, i) => {
    const binPieces = group
      .map((idx) => ({ label: pieces[idx].label, length: round6(pieces[idx].length) }))
      .sort((a, b) => b.length - a.length); // 裁片顺序：同根内按长度从大到小
    const count = binPieces.length;
    const cuts = count - 1; // 相邻切口数
    const pieceSum = binPieces.reduce((s, p) => s + p.length, 0);
    const used = pieceSum + cuts * kerf;
    return {
      index: i + 1,
      pieces: binPieces,
      count,
      cuts,
      usedLength: round6(used),
      leftover: round6(stockLength - used),
    };
  });

  const totalPieces = pieces.length;
  const totalUsed = bins.reduce((s, b) => s + b.usedLength, 0);
  const totalLeftover = bins.reduce((s, b) => s + b.leftover, 0);

  return {
    stockLength: round6(stockLength),
    kerf: round6(kerf),
    totalPieces,
    binCount: bins.length,
    totalCuts: totalPieces - bins.length, // 锯缝总数 = 总片数 - 根数
    totalUsedLength: round6(totalUsed),
    totalLeftover: round6(totalLeftover),
    utilization: round6(totalUsed / (bins.length * stockLength)),
    bins,
  };
}

module.exports = { computeCuttingPlan, ValidationError, MAX_TOTAL_PIECES };
