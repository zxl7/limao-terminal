import { z } from 'zod'

const nullableNumber = z.number().nullable()
const point = z.object({
  at: z.string(), pct: nullableNumber, amount_yi: nullableNumber,
  sealed: z.boolean().nullable(), seal_yi: nullableNumber, today_fbt: z.string().nullable(),
})
const summary = z.object({
  key: z.string(), count: z.number(), quote_count: z.number(), amount_count: z.number(),
  state_count: z.number(), window_count: z.number(), avg_pct: nullableNumber, median_pct: nullableNumber,
  up_rate: nullableNumber, seal_rate: nullableNumber, amount_yi: nullableNumber,
  window_amount_yi: nullableNumber, window_pct_change: nullableNumber,
})
export const RelayEffectSchema = z.object({
  date: z.string(), prev_date: z.string(), generated_ts: z.string(), phase: z.enum(['live', 'closed']),
  overview: summary, groups: z.array(summary),
  stocks: z.array(point.extend({
    at: z.string().nullable(), code: z.string(), name: z.string(), prev_boards: z.number(), stale: z.boolean(),
    window: z.object({ start: z.string(), end: z.string(), amount_yi: z.number(), pct_change: z.number() }).nullable(),
    series: z.array(point),
  })),
})
export type RelayEffect = z.infer<typeof RelayEffectSchema>
export type RelayStock = RelayEffect['stocks'][number]
