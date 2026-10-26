export interface InvalidDataQuery {
  error: 'invalid_request'
  message: string
}

export interface MarketDailyQuery {
  command: 'market-daily'
  code: string
  limit: number
}

export interface StockRegistryQuery {
  command: 'stock-registry'
  code: string
}

export type DataQuery = MarketDailyQuery | StockRegistryQuery

export declare const CODE_RE: RegExp
export declare const MARKET_DAILY_LIMIT_MAX: number

export declare function parseDataQuery(
  pathname: string,
  searchParams: URLSearchParams,
): DataQuery | InvalidDataQuery | null

export declare function readDataQuery(dataRoot: string, request: DataQuery): unknown
