/**
 * 田鼠挖洞（Kurodoko）题面图片自动导入
 *
 * 用法：
 *   node scripts/import-image.mjs <图片路径> [--name 名称] [--append] [--verify]
 *                                   [--width 50 --height 50] [--map 0=1,1=3] [--dry]
 *                                   [--max-nodes 400000] [--verify-timeout 120000]
 *
 * 流程：
 *   1. Playwright + Edge 把图片画到 canvas 取像素；
 *   2. 投影暗像素找贯穿棋盘的长线，得到 W×H 网格；
 *   3. 逐格裁掉网格线与圆环，提取圆内数字的连通域，20×20 归一化；
 *   4. 多套字体模板自动择优 + 字形簇识别数字；--map 人工覆盖；
 *   5. 生成题面编码，预览；--append 写入 src/game/puzzles-data.ts；
 *   6. --verify 在子进程里用项目求解器检查唯一解（超时/崩溃只警告）。
 */


import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const EDGE_PATH =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const NORM = 20
const CLUSTER_SIM = 0.86
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'

/** matplotlib/PIL 渲染的题图数字是 DejaVu Sans Bold；本机能找到就优先用。 */
function findDejaVuBold() {
  const cands = []
  if (process.env.IMPORT_FONT) cands.push(process.env.IMPORT_FONT)
  cands.push(
    'C:\\Program Files\\inkstone\\resources\\science-pack\\python\\Lib\\site-packages\\matplotlib\\mpl-data\\fonts\\ttf\\DejaVuSans-Bold.ttf',
  )
  const local = process.env.LOCALAPPDATA
  if (local) {
    const uvRoot = path.join(local, 'uv', 'cache', 'archive-v0')
    try {
      if (fs.existsSync(uvRoot))
        for (const d of fs.readdirSync(uvRoot)) {
          cands.push(
            path.join(uvRoot, d, 'matplotlib', 'mpl-data', 'fonts', 'ttf', 'DejaVuSans-Bold.ttf'),
          )
          cands.push(path.join(uvRoot, d, 'matplotlib', 'mpl-data', 'fonts', 'ttf', 'DejaVuSans.ttf'))
        }
    } catch {
      /* ignore */
    }
  }
  return (
    cands.find((p) => {
      try {
        return fs.statSync(p).isFile()
      } catch {
        return false
      }
    }) || null
  )
}

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const arg = (flag, fallback = null) => {
  const i = argv.findIndex((a) => a === flag || a.startsWith(flag + '='))
  if (i < 0) return fallback
  return argv[i].startsWith(flag + '=') ? argv[i].slice(flag.length + 1) : (argv[i + 1] ?? fallback)
}
const imagePath = argv.find((a) => !a.startsWith('--'))
if (!imagePath) {
  console.error(
    '用法：node scripts/import-image.mjs <图片路径> [--name 名称] [--append] [--verify] [--width N --height N] [--map 0=1,1=3] [--dry]',
  )
  process.exit(1)
}
if (!fs.existsSync(imagePath)) {
  console.error('找不到图片：', imagePath)
  process.exit(1)
}

const widthOpt = Number(arg('--width', '0')) || 0
const heightOpt = Number(arg('--height', '0')) || 0
const name = arg('--name', path.basename(imagePath, path.extname(imagePath)))
const series = arg('--series', '导入')
const append = has('--append')
const verify = has('--verify')
const dry = has('--dry')
const debugDir = arg('--debug', '')
const maxNodesOpt = Number(arg('--max-nodes', '400000')) || 400000
const verifyTimeout = Number(arg('--verify-timeout', '120000')) || 120000
const manualMap = {}
const manualMapArg = arg('--map', '')
if (manualMapArg) {
  for (const pair of String(manualMapArg).split(',')) {
    const [k, v] = pair.split('=')
    if (k !== undefined && v !== undefined && k.trim() !== '' && v.trim() !== '') {
      manualMap[Number(k)] = Number(v)
    }
  }
}
const fontPath = findDejaVuBold()
const fontB64 = fontPath ? fs.readFileSync(fontPath).toString('base64') : null

const dataUrl = 'data:image/png;base64,' + fs.readFileSync(imagePath).toString('base64')
const browser = await chromium.launch({ headless: true, executablePath: EDGE_PATH })
const page = await browser.newPage()

const analyzed = await page.evaluate(
  async ({ u, widthOpt, heightOpt, NORM, debug }) => {
    const img = new Image()
    img.src = u
    await img.decode()
    const W = img.naturalWidth
    const H = img.naturalHeight
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const g = cv.getContext('2d', { willReadFrequently: true })
    g.drawImage(img, 0, 0)
    const px = g.getImageData(0, 0, W, H).data
    const isDark = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false
      const i = (y * W + x) * 4
      return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < 120
    }

    // 1) 投影找贯穿棋盘的长线（灰色坐标标签会被阈值滤掉）
    const colC = new Int32Array(W)
    const rowC = new Int32Array(H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (isDark(x, y)) {
          colC[x]++
          rowC[y]++
        }
    const clusters = (counts, thr) => {
      const out = []
      let s = -1
      for (let i = 0; i < counts.length; i++) {
        const on = counts[i] >= thr
        if (on && s < 0) s = i
        if (!on && s >= 0) {
          out.push((s + i - 1) / 2)
          s = -1
        }
      }
      if (s >= 0) out.push((s + counts.length - 1) / 2)
      return out
    }
    const rawX = clusters(colC, H * 0.7)
    const rawY = clusters(rowC, W * 0.7)
    const boardLines = (lines) => {
      if (lines.length < 3) return lines
      const deltas = []
      for (let i = 1; i < lines.length; i++) deltas.push(lines[i] - lines[i - 1])
      const med = deltas.slice().sort((a, b) => a - b)[Math.floor(deltas.length / 2)]
      let start = 0
      for (let i = 0; i < deltas.length; i++) if (deltas[i] > med * 3) start = i + 1
      return lines.slice(start)
    }
    const xs = boardLines(rawX)
    const ys = boardLines(rawY)
    const w = widthOpt || xs.length - 1
    const h = heightOpt || ys.length - 1
    if (!(w >= 3) || !(h >= 3)) throw new Error(`无法确定网格：竖线 ${xs.length} 条 / 横线 ${ys.length} 条`)
    if (xs.length !== w + 1 || ys.length !== h + 1) {
      throw new Error(`网格不匹配：识别到 ${xs.length - 1}×${ys.length - 1}，目标 ${w}×${h}`)
    }
    const x0 = xs[0]
    const x1 = xs[w]
    const y0 = ys[0]
    const y1 = ys[h]
    const cellX = (x1 - x0) / w
    const cellY = (y1 - y0) / h

    const normalize = (mask, bw, bh) => {
      const out = new Array(NORM * NORM).fill(0)
      for (let j = 0; j < NORM; j++)
        for (let i = 0; i < NORM; i++) {
          const ax0 = Math.floor((i * bw) / NORM)
          const ax1 = Math.max(ax0 + 1, Math.floor(((i + 1) * bw) / NORM))
          const ay0 = Math.floor((j * bh) / NORM)
          const ay1 = Math.max(ay0 + 1, Math.floor(((j + 1) * bh) / NORM))
          let s = 0
          let n = 0
          for (let y = ay0; y < ay1; y++)
            for (let x = ax0; x < ax1; x++) {
              s += mask[y * bw + x]
              n++
            }
          out[j * NORM + i] = s / n >= 0.5 ? 1 : 0
        }
      return out
    }

    // 2) 逐格提取圆内数字：裁掉格子边缘的网格线与圆环，只保留靠中心的墨迹
    const cells = []
    const glyphs = []
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const cx = x0 + (i + 0.5) * cellX
        const cy = y0 + (j + 0.5) * cellY
        const rx = cellX * 0.42
        const ry = cellY * 0.42
        const xa = Math.max(0, Math.round(cx - rx))
        const ya = Math.max(0, Math.round(cy - ry))
        const ww = Math.min(W - xa, Math.round(rx * 2))
        const hh = Math.min(H - ya, Math.round(ry * 2))
        cells.push({ number: 0 })
        if (ww <= 0 || hh <= 0) continue
        const mask = new Uint8Array(ww * hh)
        for (let y = 0; y < hh; y++)
          for (let x = 0; x < ww; x++) mask[y * ww + x] = isDark(xa + x, ya + y) ? 1 : 0
        const seen = new Uint8Array(ww * hh)
        const kept = []
        for (let s = 0; s < ww * hh; s++) {
          if (!mask[s] || seen[s]) continue
          const st = new Int32Array(ww * hh)
          let sp = 0
          st[sp++] = s
          seen[s] = 1
          let area = 0
          let sx = 0
          let sy = 0
          let bx0 = ww
          let bx1 = -1
          let by0 = hh
          let by1 = -1
          while (sp) {
            const p = st[--sp]
            const x = p % ww
            const y = (p / ww) | 0
            area++
            sx += xa + x
            sy += ya + y
            if (x < bx0) bx0 = x
            if (x > bx1) bx1 = x
            if (y < by0) by0 = y
            if (y > by1) by1 = y
            if (x > 0 && mask[p - 1] && !seen[p - 1]) {
              seen[p - 1] = 1
              st[sp++] = p - 1
            }
            if (x + 1 < ww && mask[p + 1] && !seen[p + 1]) {
              seen[p + 1] = 1
              st[sp++] = p + 1
            }
            if (y > 0 && mask[p - ww] && !seen[p - ww]) {
              seen[p - ww] = 1
              st[sp++] = p - ww
            }
            if (y + 1 < hh && mask[p + ww] && !seen[p + ww]) {
              seen[p + ww] = 1
              st[sp++] = p + ww
            }
          }
          const bw = bx1 - bx0 + 1
          const bh = by1 - by0 + 1
          if (area < 8 || bh < 4 || bh > ry * 1.7) continue
          if (Math.abs(sx / area - cx) > cellX * 0.34 || Math.abs(sy / area - cy) > cellY * 0.34) continue
          kept.push({ area, bx0, bx1, by0, by1, sx, sy })
        }
        if (!kept.length) continue
        let bx0 = ww
        let bx1 = -1
        let by0 = hh
        let by1 = -1
        let ink = 0
        for (const k of kept) {
          if (k.bx0 < bx0) bx0 = k.bx0
          if (k.bx1 > bx1) bx1 = k.bx1
          if (k.by0 < by0) by0 = k.by0
          if (k.by1 > by1) by1 = k.by1
          ink += k.area
        }
        const bw = bx1 - bx0 + 1
        const bh = by1 - by0 + 1
        if (bw < 2 || bh < 4 || ink < 8) continue
        const sub = new Uint8Array(bw * bh)
        for (let y = 0; y < bh; y++)
          for (let x = 0; x < bw; x++) sub[y * bw + x] = mask[(by0 + y) * ww + bx0 + x]
        glyphs.push({
          group: `cell${j * w + i}`,
          cell: j * w + i,
          color: 2,
          x: xa + bx0,
          y: ya + by0,
          w: bw,
          h: bh,
          ink,
          m: normalize(sub, bw, bh),
          raw: bw > bh * 0.95 ? Array.from(sub) : null,
        })
      }
    }

    let overlay = null
    if (debug) {
      const oc = document.createElement('canvas')
      oc.width = W
      oc.height = H
      const og = oc.getContext('2d')
      og.drawImage(img, 0, 0)
      og.strokeStyle = 'rgba(30,120,220,0.9)'
      og.lineWidth = 2
      og.strokeRect(x0, y0, x1 - x0, y1 - y0)
      og.strokeStyle = 'rgba(220,30,30,0.9)'
      og.lineWidth = 1
      for (const gl of glyphs) og.strokeRect(gl.x, gl.y, gl.w, gl.h)
      overlay = oc.toDataURL('image/png').slice('data:image/png;base64,'.length)
    }
    return { W, H, w, h, x0, y0, x1, y1, cellX, cellY, cells, glyphs, overlay }
  },
  { u: dataUrl, widthOpt, heightOpt, NORM, debug: !!debugDir },
)
if (analyzed.overlay) {
  fs.mkdirSync(debugDir || '.', { recursive: true })
  const out = path.join(debugDir || '.', path.basename(imagePath, path.extname(imagePath)) + '-glyphs.png')
  fs.writeFileSync(out, Buffer.from(analyzed.overlay, 'base64'))
  console.log(`[import] 调试覆盖图已写入 ${out}`)
}
console.log(
  `[import] ${path.basename(imagePath)}：${analyzed.W}×${analyzed.H} 像素，网格 ${analyzed.w}×${analyzed.h}，线索字形 ${analyzed.glyphs.length} 个`,
)

/* ═══════════════════════════ 字形模板 + 分类 ═══════════════════════════ */
const medH = (() => {
  const hs = analyzed.glyphs.map((gl) => gl.h).sort((a, b) => a - b)
  return hs.length ? hs[Math.floor(hs.length / 2)] : 15
})()
const FONTS = []
if (fontB64) FONTS.push({ fam: 'ImportFont', weight: 400 })
for (const fam of ['Tahoma', 'Verdana', 'Arial', 'Segoe UI', 'Calibri'])
  for (const weight of [700, 400]) FONTS.push({ fam, weight })
const SIZES = [...new Set([0.66, 0.7, 0.74].map((r) => Math.max(8, Math.round(medH / r))))]

const templates = await page.evaluate(
  async ({ FONTS, SIZES, NORM, fontB64 }) => {
    if (fontB64) {
      const face = new FontFace('ImportFont', `url(data:font/ttf;base64,${fontB64})`)
      await face.load()
      document.fonts.add(face)
      await document.fonts.ready
    }
    const render = (fam, weight, size, ch) => {
      const c = document.createElement('canvas')
      c.width = 160
      c.height = 160
      const g = c.getContext('2d', { willReadFrequently: true })
      g.fillStyle = '#fff'
      g.fillRect(0, 0, 160, 160)
      g.fillStyle = '#000'
      g.font = `${weight} ${size}px "${fam}"`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(ch, 80, 80)
      const d = g.getImageData(0, 0, 160, 160).data
      const dk = (x, y) => {
        const i = (y * 160 + x) * 4
        return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 120
      }
      let x0 = 160
      let x1v = -1
      let y0 = 160
      let y1v = -1
      for (let y = 0; y < 160; y++)
        for (let x = 0; x < 160; x++)
          if (dk(x, y)) {
            if (x < x0) x0 = x
            if (x > x1v) x1v = x
            if (y < y0) y0 = y
            if (y > y1v) y1v = y
          }
      if (x1v < 0) return null
      const bw = x1v - x0 + 1
      const bh = y1v - y0 + 1
      const out = new Array(NORM * NORM).fill(0)
      for (let j = 0; j < NORM; j++)
        for (let i = 0; i < NORM; i++) {
          const ax0 = Math.floor((i * bw) / NORM)
          const ax1 = Math.max(ax0 + 1, Math.floor(((i + 1) * bw) / NORM))
          const ay0 = Math.floor((j * bh) / NORM)
          const ay1 = Math.max(ay0 + 1, Math.floor(((j + 1) * bh) / NORM))
          let s = 0
          let n = 0
          for (let y = ay0; y < ay1; y++)
            for (let x = ax0; x < ax1; x++) {
              s += dk(x0 + x, y0 + y) ? 1 : 0
              n++
            }
          out[j * NORM + i] = s / n >= 0.5 ? 1 : 0
        }
      return out
    }
    const out = []
    for (const f of FONTS)
      for (const size of SIZES) {
        const digits = []
        for (const ch of '0123456789') digits.push(render(f.fam, f.weight, size, ch))
        out.push({ fam: f.fam, weight: f.weight, size, digits })
      }
    return out
  },
  { FONTS, SIZES, NORM, fontB64 },
)
await browser.close()

const sim = (a, b) => {
  let inter = 0
  let uni = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++
    if (a[i] || b[i]) uni++
  }
  return uni ? inter / uni : 0
}
const bestDigit = (mask, tpl) => {
  let best = -1
  let bestScore = -1
  let second = -1
  for (let d = 0; d < 10; d++) {
    const s = sim(mask, tpl.digits[d])
    if (s > bestScore) {
      second = bestScore
      bestScore = s
      best = d
    } else if (s > second) second = s
  }
  return { digit: best, score: bestScore, margin: bestScore - second }
}
const normBits = (bits, bw, bh) => {
  const out = new Array(NORM * NORM).fill(0)
  for (let j = 0; j < NORM; j++)
    for (let i = 0; i < NORM; i++) {
      const ax0 = Math.floor((i * bw) / NORM)
      const ax1 = Math.max(ax0 + 1, Math.floor(((i + 1) * bw) / NORM))
      const ay0 = Math.floor((j * bh) / NORM)
      const ay1 = Math.max(ay0 + 1, Math.floor(((j + 1) * bh) / NORM))
      let s = 0
      let n = 0
      for (let y = ay0; y < ay1; y++)
        for (let x = ax0; x < ax1; x++) {
          s += bits[y * bw + x]
          n++
        }
      out[j * NORM + i] = s / n >= 0.5 ? 1 : 0
    }
  return out
}
const classifyCut = (gl, tpl) => {
  if (!gl.raw || gl.w <= gl.h * 0.95) return null
  const bw = gl.w
  const bh = gl.h
  let best = null
  for (let cut = Math.ceil(bw * 0.28); cut <= Math.floor(bw * 0.72); cut++) {
    if (cut < 4 || bw - cut < 4) continue
    const left = new Uint8Array(cut * bh)
    const right = new Uint8Array((bw - cut) * bh)
    let inkL = 0
    let inkR = 0
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < cut; x++) {
        left[y * cut + x] = gl.raw[y * bw + x]
        inkL += left[y * cut + x]
      }
      for (let x = cut; x < bw; x++) {
        right[y * (bw - cut) + (x - cut)] = gl.raw[y * bw + x]
        inkR += right[y * (bw - cut) + (x - cut)]
      }
    }
    if (inkL < 8 || inkR < 8) continue
    const sl = bestDigit(normBits(left, cut, bh), tpl)
    const sr = bestDigit(normBits(right, bw - cut, bh), tpl)
    const score = (sl.score + sr.score) / 2
    if (!best || score > best.score) {
      best = { label: `${sl.digit}${sr.digit}`, score, margin: Math.min(sl.margin, sr.margin) }
    }
  }
  return best
}
const classifyGlyph = (gl, tpl) => {
  const single = bestDigit(gl.m, tpl)
  if (gl.raw) {
    const cut = classifyCut(gl, tpl)
    if (cut && cut.score >= single.score + 0.015) return cut
  }
  return { label: String(single.digit), score: single.score, margin: single.margin }
}
/** 小字号抗锯齿会让同一数字在不同位置像素形态不同：逐字形在全部字体模板里取最高分 */
const classifyAll = (gl) => {
  let best = null
  let bestSingle = null
  for (const tpl of templates) {
    const r = classifyGlyph(gl, tpl)
    if (!best || r.score > best.score) best = r
    const s = bestDigit(gl.m, tpl)
    if (!bestSingle || s.score > bestSingle.score) bestSingle = { label: String(s.digit), score: s.score, margin: s.margin }
  }
  // 信号旗圆内只有 0~9，识别成两位数说明字形粘连/失真，退回单个数字
  if (best && best.label.length > 1 && bestSingle && bestSingle.score >= best.score - 0.06) return bestSingle
  return best
}

let chosen = null
const fontRanking = []
for (const cand of templates) {
  let total = 0
  for (const gl of analyzed.glyphs) total += classifyGlyph(gl, cand).score
  const avg = analyzed.glyphs.length ? total / analyzed.glyphs.length : 0
  fontRanking.push({ name: `${cand.fam} ${cand.weight}@${cand.size}`, avg })
  if (!chosen || avg > chosen.avg) chosen = { ...cand, avg }
}
if (!chosen) {
  console.error('[import] 没有可用字体模板')
  process.exit(1)
}
if (debugDir) {
  fontRanking.sort((a, b) => b.avg - a.avg)
  console.log(`[debug] 字体模板: ${fontPath || '未找到 DejaVu'}`)
  for (const r of fontRanking.slice(0, 5)) console.log(`[debug]   ${r.name} avg=${r.avg.toFixed(3)}`)
  for (let gi = 0; gi < Math.min(6, analyzed.glyphs.length); gi++) {
    const gl = analyzed.glyphs[gi]
    console.log(
      `[debug] glyph${gi} cell=${gl.cell} color=${gl.color} w=${gl.w} h=${gl.h} ink=${gl.ink}\n` +
        Array.from({ length: NORM }, (_, j) => gl.m.slice(j * NORM, (j + 1) * NORM).map((v) => (v ? '#' : '.')).join('')).join('\n'),
    )
  }
}

const clusterOf = []
const clusters = []
for (let gi = 0; gi < analyzed.glyphs.length; gi++) {
  const gl = analyzed.glyphs[gi]
  let best = -1
  let bestScore = CLUSTER_SIM
  for (let k = 0; k < clusters.length; k++) {
    const s = sim(gl.m, clusters[k].mask)
    if (s > bestScore) {
      bestScore = s
      best = k
    }
  }
  if (best < 0) {
    clusters.push({ mask: gl.m, members: [] })
    best = clusters.length - 1
  }
  clusters[best].members.push(gi)
  clusterOf[gi] = best
}
const clusterDigit = []
for (let k = 0; k < clusters.length; k++) {
  const votes = new Map()
  for (const gi of clusters[k].members) {
    const r = classifyAll(analyzed.glyphs[gi])
    votes.set(r.label, (votes.get(r.label) || 0) + 1)
  }
  let label = '0'
  let count = -1
  for (const [lbl, n] of votes) if (n > count) { count = n; label = lbl }
  const sorted = [...votes.values()].sort((a, b) => b - a)
  const n = clusters[k].members.length
  clusterDigit[k] = {
    label,
    count: n,
    score: sorted[0] / n,
    margin: (sorted[0] - (sorted[1] || 0)) / n,
    final: manualMap[k] !== undefined ? String(manualMap[k]) : label,
    manual: manualMap[k] !== undefined,
  }
}
console.log(
  `[import] 字体自动择优：${chosen.fam === 'ImportFont' ? 'DejaVu Sans Bold' : chosen.fam + ' ' + chosen.weight} / ${chosen.size}px（平均字形相似度 ${chosen.avg.toFixed(3)}），字形簇 ${clusters.length} 个`,
)
for (let k = 0; k < clusters.length; k++) {
  const c = clusterDigit[k]
  const tag = c.manual ? `人工→${c.final}` : `自动→${c.label}`
  const warn = !c.manual && (c.margin < 0.06 || c.score < 0.72) ? '  ⚠ 低置信' : ''
  console.log(`  簇${k}: ${tag}（n=${c.count}，一致率 ${c.score.toFixed(3)}）${warn}`)
}
const lowConfidence = clusterDigit.some((c) => !c.manual && (c.margin < 0.06 || c.score < 0.72))
if (lowConfidence) {
  console.warn('[import] 存在低置信字形簇：可用 --map 0=3,1=2 人工指定；默认仍按自动结果继续。')
}

// 数字回填到格子（田鼠挖洞线索 0 表示无数字）
for (let gi = 0; gi < analyzed.glyphs.length; gi++) {
  const gl = analyzed.glyphs[gi]
  const label = clusterDigit[clusterOf[gi]].final
  const num = Number(label)
  if (!Number.isInteger(num) || num < 0 || num > 1295) {
    console.warn(`[import] 第 ${gl.cell + 1} 格线索异常（识别为 ${label}），按无数字处理。`)
    continue
  }
  analyzed.cells[gl.cell].number = num
}

/* ═══════════════════════════ 预览 + 编码 ═══════════════════════════ */
const { w, h, cells } = analyzed
const clues = cells.map((c) => Math.max(0, c.number | 0))
const clueCount = clues.filter((v) => v > 0).length
console.log('[import] 线索网格（0 = 空格）：')
for (let y = 0; y < h; y++) {
  const row = clues.slice(y * w, y * w + w).map((v) => (v > 0 ? String(v).padStart(2) : ' .'))
  console.log('  ' + row.join(''))
}
console.log(`[import] 线索 ${clueCount} 个 / 共 ${w * h} 格`)
if (clueCount === 0) {
  console.error('[import] 没有识别到任何线索数字：识别失败，可用 --debug 查看覆盖图。')
  process.exit(1)
}

if (dry) {
  console.log('[import] --dry：仅识别预览，不求解、不写入。')
  process.exit(0)
}

/* ═══════════════════════════ 求解 / 唯一性（子进程隔离） ═══════════════════════════ */
function runSolverChild(code, payload, timeoutMs, solverPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        IMPORT_SOLVER: pathToFileURL(solverPath).href,
        IMPORT_PAYLOAD: JSON.stringify(payload),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    const timer = setTimeout(() => {
      child.kill()
      resolve({ status: 'timeout', stdout, stderr })
    }, timeoutMs)
    child.on('close', (code2) => {
      clearTimeout(timer)
      resolve({ status: code2 === 0 ? 'ok' : 'crash', code: code2, stdout, stderr })
    })
  })
}

const size = w * h
let solution = ''
const t0 = Date.now()
if (verify) {
  const res = await runSolverChild(
    `
const mod = await import(process.env.IMPORT_SOLVER)
const p = JSON.parse(process.env.IMPORT_PAYLOAD)
const counted = mod.countSolutions(p.clues, p.size, p.w, p.h, 2, p.maxNodes)
let solution = ''
if (counted.count === 1 && !counted.timedOut) {
  const found = mod.findSolution(p.clues, p.size, p.w, p.h, p.maxNodes)
  if (found.solution) solution = found.solution.join('')
}
console.log(JSON.stringify({ count: counted.count, nodes: counted.nodes, timedOut: counted.timedOut, solution }))
`,
    { clues, size, w, h, maxNodes: maxNodesOpt },
    verifyTimeout,
    'src/game/solver.ts',
  )
  if (res.status === 'ok') {
    const line = res.stdout.trim().split('\n').filter(Boolean).pop() || '{}'
    let data = {}
    try {
      data = JSON.parse(line)
    } catch {
      data = {}
    }
    if (data.timedOut) {
      console.warn(
        `[import] 唯一性检查超时（${data.nodes} 节点，${Date.now() - t0}ms）：未能确认唯一解，条目不写参考解。`,
      )
    } else if (data.count === 0) {
      console.error('[import] 求解无解：线索识别可能有误。')
      process.exit(1)
    } else if (data.count !== 1) {
      console.error(`[import] 解不唯一：${data.count} 个（${data.nodes} 节点）。`)
      process.exit(1)
    } else {
      console.log(`[import] 唯一解校验通过（${data.nodes} 节点，${Date.now() - t0}ms）`)
      solution = data.solution || ''
      if (solution) console.log(`[import] 已生成参考解（${solution.length} 格）`)
    }
  } else if (res.status === 'timeout') {
    console.warn(`[import] 唯一性检查超过 ${verifyTimeout}ms 未完成（已终止）：未确认唯一解，条目不写参考解。`)
  } else {
    console.warn(
      `[import] 唯一性检查子进程异常退出（${res.code}，可能题板过大/内存不足）：未确认唯一解，条目不写参考解。`,
    )
  }
} else {
  console.log('[import] 未加 --verify：跳过唯一解校验。')
}

const id = arg('--id', `kurodoko-import-${Date.now().toString(36)}`)
const board = clues
  .map((v) => {
    const clamped = Math.max(0, Math.min(1295, v))
    return BASE36[Math.floor(clamped / 36)] + BASE36[clamped % 36]
  })
  .join('')
if (!append) {
  console.log('[import] 预览模式（未写入）。加 --append 写入 src/game/puzzles-data.ts。')
  process.exit(0)
}
const dataFile = path.resolve('src/game/puzzles-data.ts')
if (!fs.existsSync(dataFile)) {
  console.error('[import] 找不到 src/game/puzzles-data.ts')
  process.exit(1)
}
const entry = `  { id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, width: ${w}, height: ${h}, difficulty: 'hard', series: ${JSON.stringify(series)}, board: ${JSON.stringify(board)}, solution: ${JSON.stringify(solution)} },\n`
let text = fs.readFileSync(dataFile, 'utf8').replace(/\r\n/g, '\n')
const marker = text.lastIndexOf('\n]')
if (marker < 0) {
  console.error('[import] puzzles-data.ts 格式异常：找不到结尾 ]')
  process.exit(1)
}
text = text.slice(0, marker + 1) + '\n' + entry + text.slice(marker + 1)
fs.writeFileSync(dataFile, text)
console.log(`[import] 已写入 ${dataFile}：${id} ${name}`)
