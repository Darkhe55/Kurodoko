/**
 * 田鼠挖洞（Kurodoko / Kuromasu）—— 游戏专用类型
 *
 * 约定与模板核心一致：
 *   0 = 未定（空格）
 *   1 = 黑格（洞）
 *   2 = 白格（地面）
 *
 * 题面由 clues 给出：0 表示没有数字，正整数表示该白格在四方向上
 * 能看见的白格总数（含自身，遇到黑格或边界停止）。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'

export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2

export type CellValue = 0 | 1 | 2

export interface ClueIssue {
  clueIndex: number
  expected: number
  actual: number
}

/** 题面：在模板 Puzzle 上增加 clues（每格 0 或可见白格数） */
export interface KuroPuzzle extends Puzzle {
  clues: number[]
  /** 参考解（1 = 黑，2 = 白；仅内置题携带） */
  solution?: number[]
}

export interface KuroState extends GameState {
  cells: number[]
  givens: number[]
}

export interface KuroResult extends ValidationResult {
  empty: number
  complete: boolean
  /** 上下左右相邻的黑格对数 */
  adjacentBlackPairs: number
  /** 相邻黑格涉及的格 */
  blackNeighborCells: number[]
  /** 白格连通块数量（完整盘面应为 1） */
  whiteParts: number
  /** 被永久隔断、无法再连通的格 */
  trapped: number[]
  /** 数字与当前可见白格数不符的线索 */
  clueIssues: ClueIssue[]
  badCells: number[]
  changedGivens: number[]
  clueCount: number
}

export function asKuroPuzzle(p: Puzzle): KuroPuzzle {
  return p as KuroPuzzle
}

export function asKuroState(s: GameState): KuroState {
  return s as KuroState
}

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * 编码线索：每格固定 2 个 base36 字符（0..1295），
 * 因为可见白格数可能超过 35。
 */
export function encodeClues(clues: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < clues.length; i++) {
    let v = clues[i]! | 0
    if (v < 0) v = 0
    if (v >= BASE36.length * BASE36.length) v = BASE36.length * BASE36.length - 1
    out += BASE36[Math.floor(v / BASE36.length)]! + BASE36[v % BASE36.length]!
  }
  return out
}

/** 解码线索：每格 2 个 base36 字符 */
export function decodeClues(text: string, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected * 2) return null
  const out = new Array<number>(expected).fill(0)
  for (let i = 0; i < expected; i++) {
    const hi = BASE36.indexOf(text[i * 2]!.toLowerCase())
    const lo = BASE36.indexOf(text[i * 2 + 1]!.toLowerCase())
    if (hi < 0 || lo < 0) return null
    out[i] = hi * BASE36.length + lo
  }
  return out
}

export function clueCountOf(clues: ArrayLike<number>): number {
  let count = 0
  for (let i = 0; i < clues.length; i++) if (clues[i]! > 0) count++
  return count
}

export function encodeCells(cells: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < cells.length; i++) out += String(cells[i]! | 0)
  return out
}

export function decodeCells(text: string, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected)
  for (let i = 0; i < expected; i++) {
    const ch = text[i]!
    if (ch === '0' || ch === '.') out[i] = EMPTY
    else if (ch === '1' || ch === 'B' || ch === 'b' || ch === '#') out[i] = BLACK
    else if (ch === '2' || ch === 'W' || ch === 'w' || ch === 'o' || ch === 'O') out[i] = WHITE
    else return null
  }
  return out
}

export function givensFromClues(clues: ArrayLike<number>, size: number): number[] {
  const givens = new Array<number>(size).fill(EMPTY)
  for (let i = 0; i < size; i++) {
    if ((clues[i] ?? 0) > 0) givens[i] = WHITE
  }
  return givens
}
