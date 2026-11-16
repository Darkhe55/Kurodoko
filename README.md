# 田鼠挖洞 Kurodoko

一个基于 Web 的田鼠挖洞（Kurodoko）谜题游戏，原生 SVG 渲染，内置逻辑解题器。

## 在线体验

```bash
npm install
npm start
```

`npm start` 会等开发服务就绪后用默认浏览器打开 **http://127.0.0.1:5182/**。

> 也可以用 `npm run dev`，但不会自动打开浏览器。

## 游戏规则

- 数字格是白色，数字等于从该格向上下左右能看见的白格总数，含自身，遇黑格或边界停止
- 黑格不能上下左右相邻
- 所有白格必须连通

## 操作

| 操作 | 说明 |
|------|------|
| 左键点格 | 循环：空 → 黑 → 白标记 → 空 |
| 右键点格 | 反向循环 / 清除 |
| 按住拖动 | 连续涂写 |
| 滚轮 / 中键拖拽 | 缩放 / 平移画布 |
| Z / Shift+Z / Y | 撤销 / 重做 |
| C / H / S / Esc | 检查 / 提示一格 / 显示解 / 清空 |
| R / L / P / M | 随机抽题 / 逻辑解题 / 暂停回放 / 音效开关 |
| 0 / + / - | 视图复位 / 放大 / 缩小 |

## 数据存放

运行 `npm start` / `npm run dev` 时，题库、进度和上次题目保存在项目内 `data/` 目录；静态部署时自动降级到浏览器 localStorage。

## 功能

- **题库**：内置多道题，题目均校验唯一解
- **自定义题板**：在侧边栏编辑题面，载入后即可游玩，支持保存、编辑、删除与唯一解校验
- **实时校验**：冲突与违规位置即时高亮，满足的条件同步变灰
- **逻辑解题**：规则引擎逐帧回放，显示每一步理由；回放中按钮变为停止，按 `P` 暂停/继续
- **提示一格 / 显示解**：提示优先揭示所有解一致的格子，显示解直接填入可行答案
- **撤销/重做**：按手势分组，一次拖拽只需一步撤销
- **进度保存**：自动保存当前题目进度，刷新不丢失
- **音效特效**：Web Audio 合成拨弦、水滴与落子动画，无外部音频资源
- **缩放/平移**：滚轮缩放，中键或 `Shift` 拖拽平移

## 技术栈

- Vite + TypeScript
- 原生 SVG（无框架）
- Web Audio 合成音效（无外部资源）
- localStorage / 项目内 `data/` 存储进度与题库

## 从图片导入题库（自动识图）

```bash
node scripts/import-image.mjs month.png                     # 只预览识别结果，不写入
node scripts/import-image.mjs month.png --append            # 追加到 src/game/puzzles-data.ts
node scripts/import-image.mjs month.png --append --verify   # 顺带校验唯一解并写入参考解
```

- 用 Playwright + Edge 无头浏览器读像素：投影找棋盘网格 → 逐格裁掉网格线与圆环，只保留靠中心的圆内数字墨迹 → 字体模板自动择优 + 字形簇识别。
- 常用选项：`--name`、`--series`、`--width N --height N`（自动识别失败时手动指定）、`--map 0=3,1=2`（人工指定字形簇对应的数字）、`--dry`、`--debug <目录>`（输出识别覆盖图）、`--max-nodes`、`--verify-timeout`。
- `--verify` 在子进程里调用项目求解器，大盘题超时或崩溃只警告，此时条目不写参考解。

## 项目结构

```
src/
  main.ts
  core/
    app.ts / ui.ts / view.ts      界面、交互、缩放、回放控制
    store.ts / library.ts         题库、进度、上次题目存储
    audio.ts / fx.ts              音效与落子特效
  game/
    adapter.ts                    游戏规则接入
    rules.ts                      推理规则
    logic.ts                      逻辑解题回放
    render.ts / state.ts          SVG 渲染与盘面状态
    validate.ts / solver.ts       实时校验与回溯求解
    puzzles.ts / puzzles-data.ts  题库加载与静态题库
```

## 命令

```bash
npm run dev       # 开发服务
npm start         # 开发服务 + 自动打开浏览器
npm run build     # tsc --noEmit + vite build
npm run gen       # 重新生成题库
npm run check     # 审计题库
npm run verify    # 参考解、逻辑回放与交互验证
npm run audit     # 逐题审计逻辑解题
```
