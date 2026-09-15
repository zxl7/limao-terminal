import { useQuery } from '@tanstack/react-query'
import { Card } from '@/shared/ui'
import { marketQueries } from '../api/queries'

/**
 * 极值名单（`latest.limit_down.names` / `latest.broken.names`）—— 亏钱效应的具象化。
 *
 * ## 为什么值得单独一张卡
 *
 * 情绪条只给「跌停 33 家」这个数字。数字说不了的是**是谁在跌**：
 * 33 家里如果有昨日的连板龙头，那是核按钮；如果全是 ST 与低位票，那只是
 * 存量资金的日常出清 —— 两种盘面同样是「跌停 33」，交易含义完全相反。
 *
 * ## ⚠️ 为什么限高 + 内部滚动
 *
 * 实测跌停 33 条 + 炸板 24 条 = 57 个名字。在全宽平铺时它会成为整页最高的卡，
 * 把同一网格行的其它卡拉开一大截空白（`items-start` 下表现为「下方留白」）。
 * 限定高度后，这张卡回到与邻居同一量级，需要时滚动查看全部。
 *
 * ## ⚠️ 名单通常**不打「跌停」二字**
 *
 * 脚本给的是纯股票名（`names: string[]`），没有代码、没有跌幅、没有板数 ——
 * 所以此处只做名单呈现，不去编造「几连板」之类的附加信息。
 * 需要板数细节请看「昨日涨停反馈」卡的核按钮明细（那份带 prev_boards 与均线破位）。
 */
export function ExtremeCard() {
  const { data } = useQuery(marketQueries.latest())
  const ld = data?.limit_down
  const broken = data?.broken

  const ldNames = ld?.names ?? []
  const brokenNames = broken?.names ?? []

  return (
    <Card
      title="🧊 极值名单"
      extra={
        <span className="text-[11px] font-normal text-sub">
          跌停 <b className="num text-[12px] text-down">{ld?.count ?? '—'}</b> · 炸板{' '}
          <b className="num text-[12px] text-down">{broken?.count ?? '—'}</b>
        </span>
      }
    >
      <div className="flex flex-col gap-2">
        <NameGroup
          label="跌停"
          hint="按封单额排序 · 无代码详情"
          names={ldNames}
          chipClass="bg-down-soft text-down"
          emptyText="今日无跌停"
        />
        <NameGroup
          label="炸板"
          hint="曾涨停后打开 · 承接不足"
          names={brokenNames}
          chipClass="bg-line-faint text-down"
          emptyText="今日无炸板"
        />
      </div>
    </Card>
  )
}

function NameGroup({
  label,
  hint,
  names,
  chipClass,
  emptyText,
}: {
  label: string
  hint: string
  names: string[]
  chipClass: string
  emptyText: string
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-[10.5px] text-sub">{label}</span>
        <span className="text-[10.5px] text-sub">· {hint}</span>
      </div>
      {names.length > 0 ? (
        <div className="flex flex-wrap gap-1 mt-1 max-h-[104px] overflow-y-auto">
          {names.map((n) => (
            <span key={n} className={`badge ${chipClass}`}>
              {n}
            </span>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-sub mt-1">{emptyText}</div>
      )}
    </div>
  )
}
