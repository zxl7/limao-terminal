/** 极简 className 合并。不引 clsx/tailwind-merge —— 作为模板保持依赖最小。 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
