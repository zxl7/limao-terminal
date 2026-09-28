import type { FeedbackMatrix } from '@/shared/api'

/**
 * 情绪潮汐是候选链路使用的环境门控，不是另一套情绪评分。
 *
 * 阈值严格镜像 `wealth_code/adapters/input_zt.py::load_environment`：
 * `feedback_matrix` 是事实源，本模块只把已有门控翻译成终端可读状态。
 */
export type TideRegime = 'risk_on' | 'neutral' | 'risk_off' | 'ice' | 'unknown'

export interface TideState {
  regime: TideRegime
  label: string
  /** 当前候选链路对该环境的处理方式，不代替 AI 的最终裁决。 */
  action: string
  tone: 'up' | 'down' | 'warn' | 'neutral'
  evidence: string[]
  /** 数据缺项或上游异常；保留原因，不能把缺料装作平潮。 */
  caveat: string | null
}

export function buildTideState(fb: FeedbackMatrix | null | undefined): TideState {
  if (!fb || fb.error) {
    return {
      regime: 'unknown',
      label: '潮位待确认',
      action: '等待反馈矩阵恢复后再判断环境',
      tone: 'neutral',
      evidence: [],
      caveat: fb?.error || '反馈矩阵未生成',
    }
  }

  const score = fb.sentiment_score
  const nuke = fb.nuke_count
  const broken = fb.broken_rate
  const breaks = fb.break_count
  const common = [
    `情绪分 ${score.toFixed(1)}/10`,
    `核按钮 ${nuke} 家`,
    `炸板率 ${broken.toFixed(1)}%`,
    `真破位 ${breaks} 家`,
  ]
  const caveat = fb.market_missing ? '量能与涨跌广度缺失，潮位不据此加减分。' : null

  if (score <= 2) {
    return { regime: 'ice', label: '冰点', action: '候选仅作观察；最终是否入场以 AI 裁决为准', tone: 'down', evidence: common, caveat }
  }
  if (score >= 6.5 && nuke <= 2 && broken < 30) {
    return { regime: 'risk_on', label: '升潮', action: '顺势聚焦主线核心，仍须核验个股承接', tone: 'up', evidence: common, caveat }
  }
  if (breaks >= 1) {
    return { regime: 'risk_off', label: '退潮', action: '接力降档收严；不以市场转弱一票否定龙头', tone: 'down', evidence: common, caveat }
  }
  return { regime: 'neutral', label: '平潮', action: '只看辨识度与承接均确认的核心', tone: 'warn', evidence: common, caveat }
}

/** 日频方向与实时潮位相反时，必须显式暴露，不能静默覆盖。 */
export function tideConflict(tide: TideState, direction: string | null | undefined): string | null {
  if (direction === 'repair' && (tide.regime === 'risk_off' || tide.regime === 'ice')) {
    return '日频仍在修复方向，但盘中承接已转弱，以实时风险为先核验。'
  }
  if (direction === 'ebb' && tide.regime === 'risk_on') {
    return '盘后方向仍偏退潮，但盘中反馈转强，需等待收盘确认是否持续。'
  }
  return null
}
