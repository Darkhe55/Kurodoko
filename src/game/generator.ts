/**
 * 田鼠挖洞题库生成器
 *
 * 1. 从全白盘面随机挖出互不相邻的黑格，保持白格连通；
 * 2. 计算每个白格的可见白格数作为潜在线索值；
 * 3. 随机挑选一部分白格作为数字，用规则 + 回溯统计解数；
 * 4. 只保留恰好一解的题面，优先保留规则可推满的题。
 *
 * 该文件被 scripts/gen-config.mjs 直接 import（Node 24 支持 type stripping）。
 */

import type { Difficulty } from '../core/types'
import { BLACK, encodeCells, encodeClues, WHITE } from './types.ts'
import { componentsOf, solveByRules, visibleCount } from './rules.ts'
import { countSolutions } from './solver.ts'

export interface RawPuzzleOut {
  id: string
  name: string
  width: number
  height: number
  difficulty: Difficulty
  series: string
  board: string
  solution: string
}

interface GenSpec {
  w: number
  h: number
  blackRatio: number
  clueDensity: number
  seed: number
  difficulty: Difficulty
  name: string
  series: string
  attempts: number
  clueTries: number
  maxNodes: number
  requireLogic: boolean
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(list: T[], rng: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = list[i]!
    list[i] = list[j]!
    list[j] = tmp
  }
  return list
}

function whiteConnected(cells: ArrayLike<number>, w: number, h: number): boolean {
  return componentsOf(cells, w, h, WHITE).length <= 1
}

function hasBlackNeighbor(cells: ArrayLike<number>, w: number, h: number, i: number): boolean {
  const x = i % w
  const y = (i / w) | 0
  return (
    (x > 0 && cells[i - 1] === BLACK) ||
    (x + 1 < w && cells[i + 1] === BLACK) ||
    (y > 0 && cells[i - w] === BLACK) ||
    (y + 1 < h && cells[i + w] === BLACK)
  )
}

/**
 * 生成合法终盘：全白，逐个挖黑，保持黑格互不相邻、白格连通。
 */
function generateSolution(
  w: number,
  h: number,
  blackRatio: number,
  rng: () => number,
): { cells: number[]; blackCount: number } {
  const n = w * h
  const cells = new Array<number>(n).fill(WHITE)
  const target = Math.round(n * blackRatio)
  const order = shuffle(
    Array.from({ length: n }, (_, i) => i),
    rng,
  )
  let blackCount = 0

  for (const i of order) {
    if (blackCount >= target) break
    if (cells[i] !== WHITE) continue
    if (hasBlackNeighbor(cells, w, h, i)) continue
    cells[i] = BLACK
    if (!whiteConnected(cells, w, h)) {
      cells[i] = WHITE
      continue
    }
    blackCount++
  }

  // 若随机顺序几乎挖不动，再做一轮补充
  if (blackCount < target * 0.6) {
    const rest = shuffle(
      Array.from({ length: n }, (_, i) => i).filter((i) => cells[i] === WHITE),
      rng,
    )
    for (const i of rest) {
      if (blackCount >= target) break
      if (hasBlackNeighbor(cells, w, h, i)) continue
      cells[i] = BLACK
      if (!whiteConnected(cells, w, h)) {
        cells[i] = WHITE
        continue
      }
      blackCount++
    }
  }

  return { cells, blackCount }
}

function buildClues(
  cells: ArrayLike<number>,
  w: number,
  h: number,
  density: number,
  rng: () => number,
): number[] {
  const n = w * h
  const clues = new Array<number>(n).fill(0)
  let count = 0
  for (let i = 0; i < n; i++) {
    if (cells[i] !== WHITE) continue
    if (rng() < density) {
      clues[i] = visibleCount(cells, w, h, i)
      count++
    }
  }
  if (count === 0) {
    for (let i = 0; i < n; i++) {
      if (cells[i] === WHITE) {
        clues[i] = visibleCount(cells, w, h, i)
        break
      }
    }
  }
  return clues
}

interface AttemptStats {
  solutionFail: number
  notUnique: number
  timeout: number
  logicFail: number
}

function attemptPuzzle(
  spec: GenSpec,
  rng: () => number,
  stats: AttemptStats,
): { clues: number[]; solution: number[] } | null {
  const { w, h } = spec
  const size = w * h

  const built = generateSolution(w, h, spec.blackRatio, rng)
  if (built.blackCount < Math.max(1, Math.round(size * spec.blackRatio * 0.5))) {
    stats.solutionFail++
    return null
  }
  const solution = built.cells

  for (let k = 0; k < spec.clueTries; k++) {
    const clues = buildClues(solution, w, h, spec.clueDensity, rng)
    const counted = countSolutions(clues, size, w, h, 2, spec.maxNodes)
    if (counted.timedOut) {
      stats.timeout++
      break
    }
    if (counted.count !== 1) {
      stats.notUnique++
      continue
    }
    if (spec.requireLogic) {
      const rules = solveByRules(clues, size, w, h, true, 240)
      if (!rules.ok || !rules.saturated) {
        stats.logicFail++
        continue
      }
    }
    return { clues, solution }
  }

  return null
}

const SPECS: GenSpec[] = [
  {
    w: 6,
    h: 6,
    blackRatio: 0.28,
    clueDensity: 0.72,
    seed: 0x4b555201,
    difficulty: 'easy',
    name: '初入地洞',
    series: '入门',
    attempts: 160,
    clueTries: 60,
    maxNodes: 100_000,
    requireLogic: true,
  },
  {
    w: 7,
    h: 7,
    blackRatio: 0.3,
    clueDensity: 0.66,
    seed: 0x4b555202,
    difficulty: 'easy',
    name: '交错坑道',
    series: '入门',
    attempts: 200,
    clueTries: 70,
    maxNodes: 120_000,
    requireLogic: true,
  },
  {
    w: 8,
    h: 8,
    blackRatio: 0.32,
    clueDensity: 0.6,
    seed: 0x4b555203,
    difficulty: 'medium',
    name: '鼠道回环',
    series: '进阶',
    attempts: 240,
    clueTries: 80,
    maxNodes: 150_000,
    requireLogic: false,
  },
  {
    w: 9,
    h: 9,
    blackRatio: 0.34,
    clueDensity: 0.55,
    seed: 0x4b555204,
    difficulty: 'medium',
    name: '地下迷宫',
    series: '进阶',
    attempts: 280,
    clueTries: 90,
    maxNodes: 180_000,
    requireLogic: false,
  },
  {
    w: 10,
    h: 10,
    blackRatio: 0.36,
    clueDensity: 0.5,
    seed: 0x4b555205,
    difficulty: 'hard',
    name: '深穴回响',
    series: '挑战',
    attempts: 320,
    clueTries: 100,
    maxNodes: 200_000,
    requireLogic: false,
  },
  {
    w: 10,
    h: 10,
    blackRatio: 0.4,
    clueDensity: 0.45,
    seed: 0x4b555206,
    difficulty: 'hard',
    name: '万洞终局',
    series: '挑战',
    attempts: 360,
    clueTries: 110,
    maxNodes: 220_000,
    requireLogic: false,
  },
]

export function generatePuzzles(): RawPuzzleOut[] {
  const out: RawPuzzleOut[] = []
  for (const spec of SPECS) {
    const rng = mulberry32(spec.seed)
    const stats: AttemptStats = {
      solutionFail: 0,
      notUnique: 0,
      timeout: 0,
      logicFail: 0,
    }
    let made: { clues: number[]; solution: number[] } | null = null
    const t0 = Date.now()
    for (let attempt = 0; attempt < spec.attempts; attempt++) {
      made = attemptPuzzle(spec, rng, stats)
      if (made) break
    }
    if (!made) {
      console.error(`[田鼠挖洞 gen] ${spec.name} 失败统计：`, stats)
      throw new Error(`[田鼠挖洞 gen] ${spec.name} 在 ${spec.attempts} 次尝试内没有生成合法题`)
    }
    const clues = made.clues.filter((v) => v > 0).length
    const black = made.solution.filter((v) => v === BLACK).length
    console.log(
      `[田鼠挖洞 gen] ${spec.name} ${spec.w}×${spec.h}：${clues} 个数字，黑格 ${black}，${Date.now() - t0}ms`,
    )
    out.push({
      id: `kurodoko-${spec.w}x${spec.h}-${spec.seed.toString(36)}`,
      name: spec.name,
      width: spec.w,
      height: spec.h,
      difficulty: spec.difficulty,
      series: spec.series,
      board: encodeClues(made.clues),
      solution: encodeCells(made.solution),
    })
  }
  return out
}
