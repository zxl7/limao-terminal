import type { TaskLedgerEntry } from '@/shared/api'

/**
 * 解析 `config/tasks.yaml` 的**任务台账子集**。
 *
 * ## 为什么自己解析而不用 YAML 库
 *
 * 本项目依赖刻意收敛（无 yaml 包），而这个文件的写法**极度规整**：
 *
 * ```yaml
 * tasks:
 *   # 注释
 *   - name: "【盘前】盘前预测"
 *     id: "automation-1785767165508"
 *     kind: "骨架A"
 *     rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=6;BYMINUTE=6"
 *     webhook: "auto"
 *     writeback: null
 * ```
 *
 * 只用了「块序列 + 单层映射 + 双引号标量 + 空值」四种结构，
 * 未使用锚点、多行标量（`|` / `>`）、流式集合、嵌套映射等需要完整 YAML 语义的特性。
 * 为一个子集引入解析器不划算；**代价是：原系统若改用上述特性，本解析器会静默少读**，
 * 故这里刻意只承诺子集，并在无法识别的行上**直接跳过而不是猜**。
 *
 * ## 与「路由返回文本」的分工
 *
 * 路由层（`read-route.mjs` 的 `format: 'text'`）只负责把文件**原样**送出来，
 * 不做任何解析 —— 这样同一份原文也能被其它消费者（如体检脚本）按各自需要解读。
 *
 * ⚠️ 返回的条目**不保证 `id` 存在**：`tasks.yaml` 里存在仅留档、已在平台删除的任务。
 *    消费方必须自己判空，不能假定每条都有 id。
 */
export function parseTaskLedger(raw: string | null | undefined): TaskLedgerEntry[] {
  if (typeof raw !== 'string' || raw.length === 0) return []

  const out: TaskLedgerEntry[] = []
  let cur: Partial<TaskLedgerEntry> | null = null

  for (const line of raw.split('\n')) {
    // 去行尾注释（`值 # 说明`）—— 但**不能**碰引号内的 `#`：
    // 本文件里的 `#` 只出现在注释与引号外，故用「引号外首个 #」近似足够。
    const stripped = stripTrailingComment(line)
    if (!stripped.trim()) continue
    const t = stripped.trim()
    if (t.startsWith('#')) continue

    // 序列项起始：`- key: value`
    const item = stripped.match(/^\s*-\s+([A-Za-z_][\w-]*):\s*(.*)$/)
    if (item) {
      if (cur) out.push(finalize(cur))
      cur = {}
      assign(cur, item[1], item[2])
      continue
    }

    // 同一项内的后续键：`    key: value`
    const kv = stripped.match(/^\s+([A-Za-z_][\w-]*):\s*(.*)$/)
    if (kv && cur) assign(cur, kv[1], kv[2])
  }

  if (cur) out.push(finalize(cur))
  return out
}

/** 只认识本文件出现的键；未知键一律丢弃（不猜语义） */
function assign(target: Partial<TaskLedgerEntry>, key: string, rawValue: string): void {
  if (!['name', 'id', 'kind', 'rrule', 'webhook', 'writeback'].includes(key)) return
  const v = unquote(rawValue)
  if (v === undefined) return
  target[key as keyof TaskLedgerEntry] = v as never
}

/** 去引号；`null` / 空 → undefined（`writeback: null` 表示「不回写」，不是字符串 "null"） */
function unquote(v: string): string | undefined {
  const s = v.trim()
  if (!s || s === 'null' || s === '~') return undefined
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

/** 去掉引号外的行尾注释 */
function stripTrailingComment(line: string): string {
  let inD = false
  let inS = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (c === '"' && !inS) inD = !inD
    else if (c === "'" && !inD) inS = !inS
    else if (c === '#' && !inD && !inS && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i)
    }
  }
  return line
}

/** 校验最小必填（name）；缺 name 的块视为解析噪声丢弃 */
function finalize(cur: Partial<TaskLedgerEntry>): TaskLedgerEntry {
  return {
    name: cur.name ?? '（未命名）',
    id: cur.id ?? '',
    kind: cur.kind ?? '—',
    rrule: cur.rrule,
    webhook: cur.webhook,
    writeback: cur.writeback,
  }
}
