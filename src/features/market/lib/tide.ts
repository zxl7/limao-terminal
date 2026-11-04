import type { FeedbackMatrix } from '@/shared/api'

/**
 * 情绪潮汐是候选链路使用的环境门控，不是另一套情绪评分。
 *
 * 阈值严格镜像 `wealth_code/adapters/input_zt.py::load_environment`：
 * `feedback_matrix` 是事实源，本模块只把已有门控翻译成终端可读状态。
 */
export type TideRegime = 'risk_on' | 'neutral' | 'risk_off' | 'ice' | 'unknown'
export type TidePhase = 'ice' | 'repair' | 'exuberance' | 'divergence' | 'unknown'

/** 多日样本的字段来自各自归档源；未采到时保持空值，不能补成当日数据。 */
export interface TideWindowDay {
  date: string
  sentiment: number | null
  ztCount: number | null
  premium: number | null
  promoteRate: number | null
  nukeCount: number | null
}

export interface TideState {
  regime: TideRegime
  /** 四阶段周期位置：冰点 → 修复 → 亢奋 → 分歧 → 冰点。 */
  phase: TidePhase
  label: string
  /** 当前阶段下一步需要验证的方向，不能只用强弱分数替代周期。 */
  next: string
  /** 当前候选链路对该环境的处理方式，不代替 AI 的最终裁决。 */
  action: string
  tone: 'up' | 'down' | 'warn' | 'neutral'
  evidence: string[]
  /** 数据缺项或上游异常；保留原因，不能把缺料装作平潮。 */
  caveat: string | null
}

export function buildTideState(
  fb: FeedbackMatrix | null | undefined,
): TideState {
  if (!fb || fb.error || fb.sentiment_score == null || !Number.isFinite(fb.sentiment_score)) {
    return {
      regime: 'unknown',
      phase: 'unknown',
      label: '潮位待确认',
      next: '等待反馈矩阵恢复后确认周期位置',
      action: '等待反馈矩阵恢复后再判断环境',
      tone: 'neutral',
      evidence: [],
      caveat: fb?.error || (fb ? '情绪评分缺失，原始风险指标仍应独立查看' : '反馈矩阵未生成'),
    }
  }

  const score = fb.sentiment_score
  const nuke = fb.nuke_count
  const broken = fb.broken_rate
  const breaks = fb.break_count
  const premium = fb.avg_pct
  const recentPremium = fb.trend?.avg_pct_weak ? '近3日溢价偏弱' : '近3日溢价未弱化'
  const recentRelay = fb.trend?.promote_downtrend ? '近几日晋级走弱' : '近几日晋级未走弱'
  const common = [
    `昨涨停溢价 ${premium >= 0 ? '+' : ''}${premium.toFixed(2)}%`,
    `涨停扩张 ${fb.zt_expand >= 0 ? '+' : ''}${(fb.zt_expand * 100).toFixed(0)}%`,
    `最高板 ${fb.prev_max_boards}→${fb.now_max_boards}`,
    recentPremium,
    recentRelay,
    `核按钮 ${nuke} 家`,
    `炸板率 ${broken.toFixed(1)}%`,
  ]
  const caveat = fb.market_missing ? '量能与涨跌广度缺失，潮位不据此加减分。' : null
  const heightUp = fb.max_trend > 0
  const expansion = fb.zt_expand > 0
  const profitStrong = score >= 6 || premium > 1 || fb.up_rate >= 60
  const lossStrong = nuke >= 3 || broken >= 35 || breaks >= 1 || fb.trend?.defense_level >= 2

  // 周期先看赚钱效应与亏钱效应是否同时出现；不能仅按情绪分给“升潮”。
  if (score <= 3.5 || nuke >= 5 || broken >= 50) {
    return {
      regime: 'ice', phase: 'ice', label: '冰点',
      next: '等核按钮收敛、高度止跌，再确认是否进入修复',
      action: '停止接力，保留观察仓等待止跌信号', tone: 'down', evidence: common, caveat,
    }
  }
  if (profitStrong && lossStrong) {
    return {
      regime: breaks >= 1 ? 'risk_off' : 'neutral', phase: 'divergence', label: '分歧',
      next: heightUp && broken < 30 ? '高度继续打开且核按钮收敛，才转回修复' : '高度回落或真破位出现，则转向冰点',
      action: '只跟踪龙头承接；高位接力降档，等待分歧的结果',
      tone: 'warn', evidence: common, caveat,
    }
  }
  if (score >= 7 && nuke <= 2 && broken < 20 && heightUp && expansion) {
    return {
      regime: 'risk_on', phase: 'exuberance', label: '亢奋',
      next: '盯首个核按钮、炸板率抬升与高度滞涨，出现即进入分歧',
      action: '只持有最强核心，逐步兑现，避免追逐后排', tone: 'up', evidence: common, caveat,
    }
  }
  if ((score >= 5.5 && nuke <= 2 && broken < 40) || (heightUp && expansion && !lossStrong)) {
    return {
      regime: 'risk_on', phase: 'repair', label: '修复',
      next: '连续扩张并打开高度，才进入亢奋；修复失败则回到分歧',
      action: '围绕新主线与高度核心试错，确认后再提高参与度', tone: 'up', evidence: common, caveat,
    }
  }

  return {
    regime: breaks >= 1 ? 'risk_off' : 'neutral', phase: 'divergence', label: '分歧',
    next: '观察高度与负反馈，确认修复或冰点方向',
    action: '控制仓位，只参与最有辨识度的承接', tone: 'warn', evidence: common, caveat,
  }
}
