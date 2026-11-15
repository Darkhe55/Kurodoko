/**
 * 田鼠挖洞题库生成配置
 */

import { generatePuzzles as generate } from '../src/game/generator.ts'

export const NAME = '田鼠挖洞生成器'

export function generatePuzzles() {
  return generate()
}
