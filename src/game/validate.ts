/**
 * 田鼠挖洞 —— 实时校验
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'
import { componentsOf, hasEmptyNeighbor, visibleCount } from './rules'
import {
  asKuroPuzzle,
  asKuroState,
  BLACK,
  EMPTY,
  WHITE,
  type ClueIssue,
  type KuroResult,
} from './types'

function hasEmptyNeighborAt(
  cells: ArrayLike<number>,
  w: number,
  h: number,
  index: number,
): boolean {
  return hasEmptyNeighbor(cells, w, h, index)
}

export function validate(state: GameState, puzzle: Puzzle): KuroResult {
  const s = asKuroState(state)
  const p = asKuroPuzzle(puzzle)
  const w = s.width
  const h = s.height
  const size = w * h
  const cells = s.cells
  const clues = p.clues ?? []

  let empty = 0
  let clueCount = 0
  const changed = new Set<number>()
  for (let i = 0; i < size; i++) {
    if (cells[i] === EMPTY) empty++
    if ((clues[i] ?? 0) > 0) {
      clueCount++
      if (cells[i] !== WHITE) changed.add(i)
    }
  }

  const bad = new Set<number>()
  for (const i of changed) bad.add(i)

  // 相邻黑格
  let adjacentBlackPairs = 0
  const blackNeighborCells = new Set<number>()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (cells[i] !== BLACK) continue
      if (x + 1 < w && cells[i + 1] === BLACK) {
        adjacentBlackPairs++
        blackNeighborCells.add(i)
        blackNeighborCells.add(i + 1)
      }
      if (y + 1 < h && cells[i + w] === BLACK) {
        adjacentBlackPairs++
        blackNeighborCells.add(i)
        blackNeighborCells.add(i + w)
      }
    }
  }
  for (const i of blackNeighborCells) bad.add(i)

  // 白格连通性
  const whiteComps = componentsOf(cells, w, h, WHITE)
  const trapped: number[] = []
  if (whiteComps.length > 1) {
    for (const comp of whiteComps) {
      const canGrow = comp.some((i) => hasEmptyNeighborAt(cells, w, h, i))
      if (!canGrow) {
        for (const i of comp) {
          trapped.push(i)
          bad.add(i)
        }
      }
    }
    if (empty === 0) {
      let largest = 0
      for (let i = 1; i < whiteComps.length; i++) {
        if (whiteComps[i]!.length > whiteComps[largest]!.length) largest = i
      }
      for (let i = 0; i < whiteComps.length; i++) {
        if (i === largest) continue
        for (const idx of whiteComps[i]!) bad.add(idx)
      }
    }
  }

  const complete = empty === 0

  // 数字值只在填满时判定，避免把"暂时看不到"误判为错误
  const clueIssues: ClueIssue[] = []
  if (complete) {
    for (let i = 0; i < size; i++) {
      const expected = clues[i] ?? 0
      if (expected <= 0) continue
      const actual = visibleCount(cells, w, h, i)
      if (actual !== expected) {
        clueIssues.push({ clueIndex: i, expected, actual })
        for (const j of visibleLine(cells, w, h, i)) bad.add(j)
        bad.add(i)
      }
    }
  }

  const solved =
    complete &&
    adjacentBlackPairs === 0 &&
    whiteComps.length === 1 &&
    changed.size === 0 &&
    clueIssues.length === 0

  return {
    solved,
    empty,
    complete,
    adjacentBlackPairs,
    blackNeighborCells: Array.from(blackNeighborCells),
    whiteParts: whiteComps.length,
    trapped: Array.from(new Set(trapped)),
    clueIssues,
    badCells: Array.from(bad),
    changedGivens: Array.from(changed),
    clueCount,
  }
}

/** 可见射线上的所有格子（用于错误高亮） */
function visibleLine(
  cells: ArrayLike<number>,
  w: number,
  h: number,
  index: number,
): number[] {
  const out: number[] = []
  const x = index % w
  const y = (index / w) | 0
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    let nx = x + dx
    let ny = y + dy
    while (nx >= 0 && ny >= 0 && nx < w && ny < h) {
      const j = ny * w + nx
      if (cells[j] === BLACK) break
      out.push(j)
      nx += dx
      ny += dy
    }
  }
  return out
}

export function statusBits(result: ValidationResult): string[] {
  const r = result as KuroResult
  if (r.solved) return ['完成']

  const bits: string[] = []
  if (typeof r.empty === 'number' && r.empty > 0) bits.push(`还需填 ${r.empty} 格`)
  if (r.adjacentBlackPairs > 0) bits.push(`${r.adjacentBlackPairs} 处黑格相邻`)
  if (r.complete) {
    if (r.whiteParts > 1) bits.push(`白格分成 ${r.whiteParts} 块未连通`)
    if (r.clueIssues.length > 0) bits.push(`${r.clueIssues.length} 个数字与可见格数不符`)
  } else if (r.trapped.length > 0) {
    bits.push(`有 ${r.trapped.length} 格白格被隔断`)
  }
  if (r.changedGivens.length > 0) bits.push('数字格被改动')
  if (bits.length === 0) bits.push('继续推理')
  return bits
}
