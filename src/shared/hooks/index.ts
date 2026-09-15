/**
 * 通用 hooks —— 无业务语义、可跨域复用。
 *
 * 判断标准：如果这个 hook 换个业务域还能用，它属于 shared/hooks；
 * 只对「行情」有意义的 hook（如 useMarketPolling）属于 features/market/hooks。
 */
export { useNow } from './useNow'
export { useContractIssues, useContractIssueCount } from './useContractIssues'
