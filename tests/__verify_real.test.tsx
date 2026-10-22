import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { render } from '@testing-library/react'
import {
  buildTimelineSlots,
  groupTimelineSlots,
  isLowStrengthSlot,
  TimelineSnake,
} from '@/features/analytics'
import type { IntradayTimelineEvent } from '@/shared/api'

/**
 * 临时校验：用**真实落盘数据**（2026-10-21）走一遍页面管线，确认
 * 短线精灵（`signal_new`）真的落在轴上、下区标签出得来。
 * 跑完即删，不进版本库。
 */
describe('real-data', () => {
  it('2026-10-21 轴上出现「异动·」标签', () => {
    const root = '/Users/zxl/WorkBuddy/狸猫猎手/cache'
    const itEvents: IntradayTimelineEvent[] = readFileSync(`${root}/intraday_timeline_20261021.jsonl`, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as IntradayTimelineEvent)
    const sig = JSON.parse(readFileSync(`${root}/short_spirit_signals.json`, 'utf8'))
    const signalEvents = (sig.signals_today ?? [])
      .filter((r: { name?: string; first_seen?: string }) => r.name && r.first_seen)
      .map((r: Record<string, unknown>) => ({
        at: `${sig.date} ${r.first_seen}`,
        kind: 'signal_new',
        name: r.name,
        code: r.code,
        pct: r.pct ?? null,
        strength: r.strength ?? null,
        type: r.type ?? null,
      })) as unknown as IntradayTimelineEvent[]

    const all = [...itEvents, ...signalEvents].sort((a, b) => String(a.at).localeCompare(String(b.at)))
    const slots = buildTimelineSlots([], all)
    const blocks = groupTimelineSlots(slots, isLowStrengthSlot)
    const { container } = render(
      <TimelineSnake blocks={blocks} topBoard={5} tags={new Map()} reasonByCode={new Map()} width={1560} />,
    )
    const labels = Array.from(container.querySelectorAll('[data-label-tier]')).map((el) => el.textContent ?? '')
    const sigLabels = labels.filter((t) => t.includes('异动·'))
    // eslint-disable-next-line no-console
    console.log(`blocks=${blocks.length} slots=${slots.length} labels=${labels.length} 异动=${sigLabels.length}`)
    console.log('样例:', sigLabels.slice(0, 6).join(' | '))
    console.log('消息:', labels.filter((t) => t.includes('消息·')).slice(0, 4).join(' | '))
    expect(sigLabels.length).toBeGreaterThan(0)
  }, 30_000)
})
