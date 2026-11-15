/**
 * 田鼠挖洞（Kurodoko）—— 规则引擎
 *
 * 规则：
 *   R1 数字格是白格，数字 = 从该格向上下左右能看见的白格总数（含自身，
 *      遇到黑格或棋盘边界停止）；
 *   R2 黑格不能上下左右相邻；
 *   R3 所有白格必须上下左右连通。
 *
 * 传播只做必然结论，可用于唯一解证明、逻辑回放与提示。
 */

import { BLACK, EMPTY, WHITE } from './types.ts'

export type RuleKind = 'adj' | 'connect' | 'visible'

export type SetCallback = (index: number, value: number, rule: RuleKind) => void

const DX = [1, -1, 0, 0]
const DY = [0, 0, 1, -1]

export function neighborsOf(index: number, w: number, h: number): number[] {
  const x = index % w
  const y = (index / w) | 0
  const out: number[] = []
  if (x > 0) out.push(index - 1)
  if (x + 1 < w) out.push(index + 1)
  if (y > 0) out.push(index - w)
  if (y + 1 < h) out.push(index + w)
  return out
}

export function hasEmptyNeighbor(
  cells: ArrayLike<number>,
  w: number,
  h: number,
  index: number,
): boolean {
  return neighborsOf(index, w, h).some((j) => cells[j] === EMPTY)
}

export function componentsOf(
  cells: ArrayLike<number>,
  w: number,
  h: number,
  color: number,
  passable?: number,
): number[][] {
  const n = w * h
  const seen = new Uint8Array(n)
  const out: number[][] = []
  for (let start = 0; start < n; start++) {
    if (cells[start] !== color || seen[start]) continue
    const comp: number[] = []
    const stack = [start]
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()!
      comp.push(i)
      const x = i % w
      const y = (i / w) | 0
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d]!
        const ny = y + DY[d]!
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (seen[j]) continue
        if (passable === undefined) {
          if (cells[j] !== color) continue
        } else if (cells[j] !== color && cells[j] !== passable) {
          continue
        }
        seen[j] = 1
        stack.push(j)
      }
    }
    out.push(comp)
  }
  return out
}

export function initialGrid(clues: ArrayLike<number>, size: number): number[] {
  const grid = new Array<number>(size).fill(EMPTY)
  for (let i = 0; i < size; i++) if ((clues[i] ?? 0) > 0) grid[i] = WHITE
  return grid
}

/** 完整盘面上某数字格的可见白格数；非白格返回 -1 */
export function visibleCount(
  cells: ArrayLike<number>,
  w: number,
  h: number,
  index: number,
): number {
  if (cells[index] !== WHITE) return -1
  let count = 1
  const x = index % w
  const y = (index / w) | 0

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (Math.abs(dx) + Math.abs(dy) !== 1) continue
      let nx = x + dx
      let ny = y + dy
      while (nx >= 0 && ny >= 0 && nx < w && ny < h) {
        const j = ny * w + nx
        if (cells[j] === BLACK) break
        count++
        nx += dx
        ny += dy
      }
    }
  }
  return count
}

interface RayInfo {
  /** 紧邻数字格连续白格数 */
  whites: number
  /** 从数字格出发直到第一个黑格/边界之间的非黑格数（含白与空） */
  reach: number
  /** 连续白格之后的第一个未知格（若有） */
  boundary: number
  /** 该方向直到黑格/边界之间的所有非黑格索引（含白与空） */
  ray: number[]
}

function rayInfo(
  cells: ArrayLike<number>,
  w: number,
  h: number,
  index: number,
  dx: number,
  dy: number,
): RayInfo {
  const x = index % w
  const y = (index / w) | 0
  let nx = x + dx
  let ny = y + dy
  let whites = 0
  let reach = 0
  let boundary = -1
  let sawEmpty = false
  const ray: number[] = []

  while (nx >= 0 && ny >= 0 && nx < w && ny < h) {
    const j = ny * w + nx
    if (cells[j] === BLACK) break
    ray.push(j)
    reach++
    if (!sawEmpty && cells[j] === WHITE) {
      whites++
    } else {
      if (!sawEmpty && cells[j] === EMPTY) {
        boundary = j
        sawEmpty = true
      }
      // 一旦遇到空格，后面的白格也算进 reach，但不再是紧邻连续白格
      if (cells[j] === EMPTY) sawEmpty = true
    }
    nx += dx
    ny += dy
  }
  return { whites, reach, boundary, ray }
}

/**
 * 规则传播到不动点。
 * 返回 false 表示发现矛盾；onSet 会收到每一次确定性填色。
 */
export function propagate(
  cells: Int8Array | number[],
  clues: ArrayLike<number>,
  w: number,
  h: number,
  onSet?: SetCallback,
): boolean {
  const n = w * h
  let changed = true

  const set = (i: number, value: number, kind: RuleKind): boolean => {
    if (cells[i] === value) return true
    if (cells[i] !== EMPTY) return false
    cells[i] = value
    onSet?.(i, value, kind)
    changed = true
    return true
  }

  // 数字格必须是白格
  for (let i = 0; i < n; i++) {
    if ((clues[i] ?? 0) <= 0) continue
    if (cells[i] === BLACK) return false
    if (cells[i] === EMPTY && !set(i, WHITE, 'visible')) return false
  }

  while (changed) {
    changed = false

    // —— R2：黑格不能相邻，黑格四周必须是白 ——
    for (let i = 0; i < n; i++) {
      if (cells[i] !== BLACK) continue
      for (const j of neighborsOf(i, w, h)) {
        if (cells[j] === BLACK) return false
        if (cells[j] === EMPTY && !set(j, WHITE, 'adj')) return false
      }
    }

    // —— R3：所有白格必须连通 ——
    let firstWhite = -1
    for (let i = 0; i < n; i++) {
      if (cells[i] === WHITE) {
        firstWhite = i
        break
      }
    }
    if (firstWhite < 0) {
      // 题面没有数字（也没有任何白格）时无意义
      if (!clues || clues.length === 0) return true
      let hasClue = false
      for (let i = 0; i < n; i++) {
        if ((clues[i] ?? 0) > 0) {
          hasClue = true
          break
        }
      }
      if (hasClue) return false
    } else {
      const possible = new Uint8Array(n)
      const stack = [firstWhite]
      possible[firstWhite] = 1
      while (stack.length) {
        const i = stack.pop()!
        const x = i % w
        const y = (i / w) | 0
        if (x > 0 && cells[i - 1] !== BLACK && !possible[i - 1]) {
          possible[i - 1] = 1
          stack.push(i - 1)
        }
        if (x + 1 < w && cells[i + 1] !== BLACK && !possible[i + 1]) {
          possible[i + 1] = 1
          stack.push(i + 1)
        }
        if (y > 0 && cells[i - w] !== BLACK && !possible[i - w]) {
          possible[i - w] = 1
          stack.push(i - w)
        }
        if (y + 1 < h && cells[i + w] !== BLACK && !possible[i + w]) {
          possible[i + w] = 1
          stack.push(i + w)
        }
      }
      for (let i = 0; i < n; i++) {
        if (cells[i] === WHITE && !possible[i]) return false
        if (cells[i] === EMPTY && !possible[i]) {
          if (!set(i, BLACK, 'connect')) return false
        }
      }
    }

    // —— R1：数字的可见范围上下界 ——
    for (let clueCell = 0; clueCell < n; clueCell++) {
      const value = clues[clueCell] ?? 0
      if (value <= 0) continue
      if (cells[clueCell] !== WHITE) return false

      let minTotal = 1
      let maxTotal = 1
      const rays: RayInfo[] = []
      for (let d = 0; d < 4; d++) {
        const info = rayInfo(cells, w, h, clueCell, DX[d]!, DY[d]!)
        rays.push(info)
        minTotal += info.whites
        maxTotal += info.reach
      }

      if (value < minTotal || value > maxTotal) return false

      if (value === minTotal) {
        // 每条方向都必须立刻被黑格挡住
        for (const info of rays) {
          if (info.boundary >= 0 && !set(info.boundary, BLACK, 'visible')) return false
        }
      }
      if (value === maxTotal) {
        // 视野内的所有非黑格都必须是白格
        for (const info of rays) {
          for (const j of info.ray) {
            if (cells[j] === EMPTY && !set(j, WHITE, 'visible')) return false
          }
        }
      }
    }
  }

  return true
}

/** 完整盘面是否满足全部规则 */
export function isValidSolution(
  cells: ArrayLike<number>,
  clues: ArrayLike<number>,
  w: number,
  h: number,
): boolean {
  const n = w * h
  let whiteCount = 0
  for (let i = 0; i < n; i++) {
    if (cells[i] !== BLACK && cells[i] !== WHITE) return false
    if (cells[i] === WHITE) whiteCount++
    if ((clues[i] ?? 0) > 0 && cells[i] !== WHITE) return false
  }
  if (whiteCount === 0) return false

  // 黑格不相邻
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (cells[i] !== BLACK) continue
      if (x + 1 < w && cells[i + 1] === BLACK) return false
      if (y + 1 < h && cells[i + w] === BLACK) return false
    }
  }

  // 白格连通
  if (componentsOf(cells, w, h, WHITE).length !== 1) return false

  // 数字值
  for (let i = 0; i < n; i++) {
    const value = clues[i] ?? 0
    if (value <= 0) continue
    if (visibleCount(cells, w, h, i) !== value) return false
  }

  return true
}

export interface RuleSolveResult {
  ok: boolean
  solution: number[] | null
  contradiction: boolean
  saturated: boolean
  usedProbing: boolean
}

export function solveByRules(
  clues: ArrayLike<number>,
  size: number,
  w: number,
  h: number,
  probing = true,
  maxRounds = 400,
): RuleSolveResult {
  const grid = initialGrid(clues, size)
  let usedProbing = false

  for (let round = 0; round < maxRounds; round++) {
    if (!propagate(grid, clues, w, h)) {
      return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
    }

    let unknown = -1
    for (let i = 0; i < size; i++) {
      if (grid[i] === EMPTY) {
        unknown = i
        break
      }
    }
    if (unknown < 0) {
      const solution = Array.from(grid)
      const ok = isValidSolution(solution, clues, w, h)
      return {
        ok,
        solution: ok ? solution : null,
        contradiction: false,
        saturated: ok,
        usedProbing,
      }
    }

    if (!probing) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }

    usedProbing = true
    const forced: Array<{ index: number; value: number }> = []
    for (let i = 0; i < size; i++) {
      if (grid[i] !== EMPTY) continue
      let blackImpossible = false
      let whiteImpossible = false
      {
        const trial = Int8Array.from(grid)
        trial[i] = BLACK
        if (!propagate(trial, clues, w, h)) blackImpossible = true
      }
      {
        const trial = Int8Array.from(grid)
        trial[i] = WHITE
        if (!propagate(trial, clues, w, h)) whiteImpossible = true
      }
      if (blackImpossible && whiteImpossible) {
        return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
      }
      if (blackImpossible !== whiteImpossible) {
        forced.push({ index: i, value: blackImpossible ? WHITE : BLACK })
      }
    }

    if (!forced.length) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }
    for (const { index, value } of forced) {
      if (grid[index] === EMPTY) grid[index] = value
    }
  }

  return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
}
