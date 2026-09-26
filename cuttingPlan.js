'use strict';

/**
 * 木工短料下料优化核心算法。
 *
 * 规则说明：
 * - 同规格的裁片先展开成单片（每片带 A1、A2… 编号），再参与计算；
 * - 可录入若干规格的余料库存（长度 + 可用根数），计算时每根余料最多使用一次；
 *   原料长度仍表示可购买的新料，新料根数不限；
 * - 目标（在所有可行方案中按顺序比较）：
 *   1) 使用的新料根数最少；
 *   2) 投入原料总长度最小（优先用短余料，同样可少买新料）；
 * - 锯缝只发生在同一根原料上相邻的两片之间：
 *   一根原料放 k 片，占用长度 = 各片长度之和 + (k - 1) × 锯缝宽度；
 * - 总裁片数上限 MAX_TOTAL_PIECES = 12。
 */

const MAX_TOTAL_PIECES = 12;
const MAX_QTY_PER_SPEC = 99;
const MAX_LEFTOVER_SPECS = 50;
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
 * 解析并校验输入，返回 { stockLength, kerf, pieces, leftoverSpecs }。
 * pieces 为展开后的数组：[{ label, length }]，按长度从大到小排序。
 * leftoverSpecs：[{ length, available }]，按长度从大到小排序（相同长度合并）。
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

  // 余料库存（可选）：未录入时保持原有行为
  const leftoverSpecs = parseLeftovers(input.leftovers);

  return { stockLength, kerf, pieces, leftoverSpecs };
}

/**
 * 解析余料库存。允许整段缺省、长度留空（视为未填写）；
 * 相同长度的多行合并根数。返回 [{ length, available }]，按长度从大到小排序。
 */
function parseLeftovers(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ValidationError('余料库存格式不正确');
  }

  const byLength = new Map(); // round6(length) -> { length, available }

  raw.forEach((item, idx) => {
    const row = idx + 1;
    if (item === null || typeof item !== 'object') {
      throw new ValidationError(`第 ${row} 条余料：格式不正确`);
    }
    const length = toNumber(item.length);
    const qtyRaw = toNumber(item.qty ?? item.available);

    // 长度与根数都留空：视为未填写的空行
    if (!Number.isFinite(length) && !Number.isFinite(qtyRaw)) return;

    if (!Number.isFinite(length) || length <= 0) {
      throw new ValidationError(`第 ${row} 条余料：长度必须是大于 0 的数字`);
    }
    if (!isPositiveInteger(qtyRaw)) {
      throw new ValidationError(`第 ${row} 条余料：可用根数必须是正整数`);
    }
    if (qtyRaw > MAX_QTY_PER_SPEC) {
      throw new ValidationError(`第 ${row} 条余料：根数不能超过 ${MAX_QTY_PER_SPEC}`);
    }

    const key = String(round6(length));
    const merged = byLength.get(key);
    if (merged) {
      merged.available += qtyRaw;
      if (merged.available > MAX_QTY_PER_SPEC) {
        throw new ValidationError(
          `余料长度 ${length}：合并后的可用根数不能超过 ${MAX_QTY_PER_SPEC}`
        );
      }
    } else {
      if (byLength.size >= MAX_LEFTOVER_SPECS) {
        throw new ValidationError(`余料规格种类不能超过 ${MAX_LEFTOVER_SPECS} 种`);
      }
      byLength.set(key, { length, available: qtyRaw });
    }
  });

  return Array.from(byLength.values()).sort((a, b) => b.length - a.length);
}

/**
 * 精确搜索最优分配方案（DFS + 剪枝）。
 *
 * 每一根“料”可以是某规格余料（每根最多用一次，总数受限）或新料
 * （长度 stockLength，根数不限）。目标按字典序：
 *   1) 新料根数最少；
 *   2) 投入原料总长度最小（= 新料总长度 + 已用余料长度之和）。
 *
 * 返回 { bins, leftoverUsage }：
 *   bins: [{ kind: 'leftover'|'new', capacity, items: [pieceIndex] }]
 *   leftoverUsage: Map(specIndex -> usedCount)
 */
function minimizeBins(pieces, stockLength, kerf, leftoverSpecs) {
  const n = pieces.length;
  const lengths = pieces.map((p) => p.length);

  // 后缀长度和，用于容量下界剪枝
  const suffixSum = new Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) suffixSum[i] = suffixSum[i + 1] + lengths[i];

  const S = leftoverSpecs.length;
  const leftoversUsed = new Array(S).fill(0);

  // 已开的料：{ kind, capacity, load, count, items, specIndex? }
  const bins = [];
  let newUsed = 0;
  let investedLength = 0; // 已投入的原料总长度

  let best = null;
  let bestNew = Infinity;
  let bestLength = Infinity;

  function dfs(idx) {
    // 叶子：记录字典序最优方案
    if (idx === n) {
      if (
        newUsed < bestNew ||
        (newUsed === bestNew && investedLength < bestLength - EPS)
      ) {
        bestNew = newUsed;
        bestLength = investedLength;
        best = {
          bins: bins.map((b) => ({
            kind: b.kind,
            capacity: b.capacity,
            specIndex: b.specIndex,
            items: b.items.slice(),
          })),
          leftoverUsage: new Map(
            leftoverSpecs.map((spec, s) => [s, leftoversUsed[s]]).filter(([, v]) => v > 0)
          ),
        };
      }
      return;
    }

    // —— 下界剪枝 ——
    // 剩余裁片装入：已开料剩余空间 + 尚未动用的余料 + 需补开的新料。
    // 记可用料根数上限为 B0 + m（B0 个已开/未用位，m 根新料），
    // 则片间锯缝至多 k - (B0 + m) 条（为取下界，按最少锯缝估）。
    const k = n - idx;
    let openRemaining = 0;
    let openSlots = 0;
    for (const bin of bins) {
      const remaining = bin.capacity - bin.load;
      if (remaining > EPS) {
        openRemaining += remaining;
        openSlots += 1;
      }
    }
    let unusedLeftoverCapacity = 0;
    let unusedLeftoverSticks = 0;
    for (let s = 0; s < S; s++) {
      const sticks = leftoverSpecs[s].available - leftoversUsed[s];
      unusedLeftoverSticks += sticks;
      unusedLeftoverCapacity += sticks * leftoverSpecs[s].length;
    }
    const b0 = openSlots + unusedLeftoverSticks;

    // 新料根数下界（忽略碎片不可拼，结果偏小，是安全下界）：
    // P + (k - b0 - m)·kerf ≤ openRemaining + unusedCap + m·stockLength
    // ⇒ m ≥ (P + (k - b0)·kerf - openRemaining - unusedCap) / (stockLength + kerf)
    const overflow =
      suffixSum[idx] + (k - b0) * kerf - openRemaining - unusedLeftoverCapacity;
    const extraNewLB = overflow > EPS ? Math.ceil((overflow - EPS) / (stockLength + kerf)) : 0;
    if (newUsed + extraNewLB > bestNew) return;

    // 次级目标下界：每补开一根新料至少投入 stockLength
    const extraLengthLB = extraNewLB * stockLength;
    if (newUsed + extraNewLB === bestNew && investedLength + extraLengthLB >= bestLength - EPS) {
      return;
    }

    const len = lengths[idx];
    const seen = new Set(); // 跳过等价的已开料（容量/占用/片数相同）

    // 候选已开料：按剩余容量从小到大（最紧的可行料优先）
    const openCandidates = bins
      .map((bin, b) => ({ b, remaining: bin.capacity - bin.load }))
      .sort((x, y) => x.remaining - y.remaining);

    // 1) 尝试放入已开的料
    for (const { b } of openCandidates) {
      const bin = bins[b];
      const key = `${round6(bin.capacity)}#${round6(bin.load)}#${bin.count}`;
      if (seen.has(key)) continue;
      // 相邻切口才计锯缝：放入第 k 片时新增一条锯缝
      const added = bin.count > 0 ? len + kerf : len;
      if (bin.load + added > bin.capacity + EPS) continue;

      seen.add(key);
      bin.load += added;
      bin.count += 1;
      bin.items.push(idx);
      dfs(idx + 1);
      bin.items.pop();
      bin.count -= 1;
      bin.load -= added;
    }

    // 2) 新开一根余料（单片独占一根时不计锯缝），长余料优先以尽快得到可行解
    for (let s = 0; s < S; s++) {
      if (leftoversUsed[s] >= leftoverSpecs[s].available) continue;
      if (len > leftoverSpecs[s].length + EPS) continue;

      leftoversUsed[s] += 1;
      investedLength += leftoverSpecs[s].length;
      bins.push({
        kind: 'leftover',
        specIndex: s,
        capacity: leftoverSpecs[s].length,
        load: len,
        count: 1,
        items: [idx],
      });
      dfs(idx + 1);
      bins.pop();
      investedLength -= leftoverSpecs[s].length;
      leftoversUsed[s] -= 1;
    }

    // 3) 新开一根新料
    if (len <= stockLength + EPS) {
      newUsed += 1;
      investedLength += stockLength;
      bins.push({
        kind: 'new',
        capacity: stockLength,
        load: len,
        count: 1,
        items: [idx],
      });
      dfs(idx + 1);
      bins.pop();
      investedLength -= stockLength;
      newUsed -= 1;
    }
  }

  dfs(0);
  return best;
}

/**
 * 计算下料方案。
 * 输入：{ stockLength, kerf, items: [{ length, qty }], leftovers?: [{ length, qty }] }
 * 返回：可直接渲染 JSON；输入非法时抛出 ValidationError（message 为明确原因）。
 */
function computeCuttingPlan(input) {
  const { stockLength, kerf, pieces, leftoverSpecs } = parseAndValidate(input);
  const solution = minimizeBins(pieces, stockLength, kerf, leftoverSpecs);

  if (!solution) {
    throw new ValidationError('找不到可行的下料方案，请检查输入');
  }

  // 结果排序：余料在前（长度从小到大），新料在后
  const ordered = solution.bins
    .map((bin) => ({ ...bin }))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'leftover' ? -1 : 1;
      return a.capacity - b.capacity;
    });

  const bins = ordered.map((bin, i) => {
    const binPieces = bin.items
      .map((idx) => ({ label: pieces[idx].label, length: round6(pieces[idx].length) }))
      .sort((a, b) => b.length - a.length); // 裁片顺序：同根内按长度从大到小
    const count = binPieces.length;
    const cuts = count - 1; // 相邻切口数
    const pieceSum = binPieces.reduce((s, p) => s + p.length, 0);
    const used = pieceSum + cuts * kerf;
    return {
      index: i + 1,
      kind: bin.kind, // 'leftover' 余料 | 'new' 新料
      source: bin.kind === 'leftover' ? '余料' : '新料',
      stockLength: round6(bin.capacity),
      pieces: binPieces,
      count,
      cuts,
      usedLength: round6(used),
      leftover: round6(bin.capacity - used),
    };
  });

  const totalPieces = pieces.length;
  const newBins = bins.filter((b) => b.kind === 'new');
  const leftoverBins = bins.filter((b) => b.kind === 'leftover');
  const totalUsed = bins.reduce((s, b) => s + b.usedLength, 0);
  const totalLeftover = bins.reduce((s, b) => s + b.leftover, 0);
  const totalStockLength = bins.reduce((s, b) => s + b.stockLength, 0);

  // 各规格余料的消耗与剩余
  const leftoverSummary = leftoverSpecs.map((spec, s) => {
    const used = solution.leftoverUsage.get(s) || 0;
    return {
      length: round6(spec.length),
      available: spec.available,
      used,
      remaining: spec.available - used,
    };
  });

  return {
    stockLength: round6(stockLength),
    kerf: round6(kerf),
    totalPieces,
    binCount: bins.length,
    newBinCount: newBins.length,
    leftoverBinCount: leftoverBins.length,
    totalCuts: totalPieces - bins.length, // 锯缝总数 = 总片数 - 根数
    totalUsedLength: round6(totalUsed),
    totalLeftover: round6(totalLeftover),
    totalStockLength: round6(totalStockLength),
    utilization: round6(totalUsed / totalStockLength),
    hasLeftovers: leftoverSpecs.length > 0,
    leftoverSummary,
    bins,
  };
}

module.exports = {
  computeCuttingPlan,
  ValidationError,
  MAX_TOTAL_PIECES,
};
