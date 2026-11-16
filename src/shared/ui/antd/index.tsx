/**
 * Ant Design 接入层（2026-11-16 用户「装 Ant Design，自建的太丑了」）
 *
 * ## 目的
 * 用 antd 的**表格与交互**，但配色/字号必须跟本系统一致 —— 否则会出现
 * 「一种是狸猫的灰，一种是 antd 的蓝」的拼盘感。
 *
 * ## 做法
 * 1. `ConfigProvider` 主题 token 直接取本系统设计变量（数值与 `styles/theme.css` 对齐）；
 * 2. 只在这一个入口暴露 antd 组件，页面不要直接 `import { Table } from 'antd'`
 *    —— 避免以后换实现时到处改。
 */
import type { ReactNode } from 'react'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'

/** 与 `styles/theme.css` 的 @theme 变量保持一致（CSS 变量传不进 antd token，只能镜像） */
const COLORS = {
  up: '#ee2500',
  down: '#0a8f3c',
  rec: '#8b5cf6',
  lead: '#e8940a',
  mid: '#3b82c4',
  warn: '#0d9488',
  bg: '#f2f3f6',
  card: '#ffffff',
  line: '#e7e8ee',
  lineFaint: '#f0f1f5',
  txt: '#16161a',
  sub: '#6b7280',
} as const

export function AntdProvider({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: COLORS.mid,
          colorError: COLORS.up,       // A 股：涨=红，不要用 antd 默认的"错误红"语义
          colorSuccess: COLORS.down,   // A 股：跌=绿
          colorWarning: COLORS.lead,
          colorInfo: COLORS.mid,
          colorBgContainer: COLORS.card,
          colorBgLayout: COLORS.bg,
          colorBorder: COLORS.line,
          colorBorderSecondary: COLORS.lineFaint,
          colorText: COLORS.txt,
          colorTextSecondary: COLORS.sub,
          borderRadius: 2,
          fontSize: 13,
          controlHeight: 26,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        },
        components: {
          Table: {
            headerBg: COLORS.lineFaint,
            headerColor: COLORS.sub,
            headerSplitColor: 'transparent',
            rowHoverBg: COLORS.lineFaint,
            cellPaddingBlockSM: 4,
            cellPaddingInlineSM: 8,
            borderColor: COLORS.lineFaint,
          },
        },
      }}
    >
      {children}
    </ConfigProvider>
  )
}

export { Table as AntTable } from 'antd'
