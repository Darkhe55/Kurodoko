/**
 * ════════════════════════════════════════════════════════════════════
 *  田鼠挖洞（Kurodoko / Kuromasu）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 规则：
 *   1. 数字格是白格，数字 = 该格向上下左右可见的白格总数（含自身，
 *      遇到黑格或边界停止）；
 *   2. 黑格不能上下左右相邻；
 *   3. 所有白格必须上下左右连通。
 *
 * 状态用 0/1/2：0 = 未定，1 = 黑（洞），2 = 白（地面）。
 */

import { playDrop, playPluck } from '../core/audio'
import type { CustomSupport, GameAdapter, Move, Puzzle, SolveResult } from '../core/types'
import { planLogicSolve } from './logic'
import { builtinPuzzles, getReferenceSolution } from './puzzles'
import { hitTest, metricsFor, renderBoard } from './render'
import { solvePuzzle } from './solver'
import {
  applyMove,
  cloneState,
  createEmptyState,
  cycleValue,
  deserializeState,
  firstHintMove,
  invertMove,
  rightClickValue,
  serializeState,
  valueAt,
} from './state'
import { statusBits, validate } from './validate'
import { BLACK, decodeClues, EMPTY, encodeClues, type KuroPuzzle } from './types'

const meta = {
  title: '田鼠挖洞',
  tagline: '数字是洞口能看见的地面 —— 黑格不相邻，白格连成一片',
  footerNote:
    '规则：数字格是白色，数字等于从该格向上下左右能看见的白格总数（含自身，遇黑格或边界停止）；黑格不能上下左右相邻；所有白格必须连通。',
  storageKeyPrefix: 'kurodoko',
  customIdPrefix: 'kurodoko-custom-',
  customMinW: 5,
  customMinH: 5,
  customMaxW: 60,
  customMaxH: 60,
}

const VALUE_CYCLE: Array<number | null> = [null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

function readClues(value: unknown, size: number): number[] | null {
  if (typeof value === 'string') return decodeClues(value, size)
  if (Array.isArray(value)) {
    if (value.length !== size) return null
    const out: number[] = []
    for (const v of value) {
      const n = Number(v)
      if (!Number.isInteger(n) || n < 0 || n > 999) return null
      out.push(n)
    }
    return out
  }
  return null
}

const custom: CustomSupport = {
  valueCycle: VALUE_CYCLE,

  keyForDigit: (digit) => {
    if (digit === 0) return null
    if (digit >= 1 && digit <= 9) return digit
    return undefined
  },

  cellLabel: (v) => (v == null ? '' : String(v)),

  cellClass: (v) => (v == null ? '' : `r${v}`),

  hint: '数字表示该格四方向可见的白格总数（含自身）：点击格子输入 1-9，0 清空。载入后可用「求解」检查是否恰好一解。',

  toGrid: (p) => {
    const clues = (p as KuroPuzzle).clues
    if (!Array.isArray(clues) || clues.length !== p.width * p.height) return null
    return {
      width: p.width,
      height: p.height,
      grid: clues.map((v) => (typeof v === 'number' && v >= 1 ? v : null)),
    }
  },

  makePuzzle: (w, h, grid, existingId) => {
    const clues = grid.map((v) => (typeof v === 'number' && v >= 1 ? v : 0))
    return {
      id: existingId ?? `${meta.customIdPrefix}${w}x${h}-${Date.now()}`,
      name: `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      clues,
    } satisfies KuroPuzzle
  },

  encodePuzzle: (p) => ({
    clues: encodeClues((p as KuroPuzzle).clues ?? []),
  }),

  decodePuzzle: (record) => {
    if (typeof record.id !== 'string') return null
    if (typeof record.width !== 'number' || typeof record.height !== 'number') return null
    const w = record.width
    const h = record.height
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null
    const clues = readClues(record.clues, w * h)
    if (!clues) return null
    return {
      id: record.id,
      name: typeof record.name === 'string' ? record.name : `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      clues,
    } satisfies KuroPuzzle
  },
}

function playForMove(move: Move, streak: number): void {
  if (move.from === EMPTY) {
    playPluck(streak, move.to === BLACK ? 0.88 : 1.1)
  } else {
    playDrop(streak)
  }
}

export const adapter: GameAdapter = {
  meta,
  builtinPuzzles,
  getReferenceSolution,
  createEmptyState,
  cloneState,
  cycleValue,
  rightClickValue,
  applyMove,
  invertMove,
  valueAt,
  serializeState,
  deserializeState,
  validate,
  statusBits,
  metricsFor,
  renderBoard,
  hitTest,
  planLogicSolve,
  solvePuzzle: (puzzle: Puzzle, maxNodes?: number): SolveResult => solvePuzzle(puzzle, maxNodes),
  firstHintMove,
  custom,
  playForMove,
}
