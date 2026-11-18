import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import { analyticsQueries } from '@/features/analytics'
import { RelayPerformanceBoard } from '@/features/wealth'

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.accountNav())
  return null
}

export function Component() {
  const nav = useQuery(analyticsQueries.accountNav())
  return <RelayPerformanceBoard rows={nav.data ?? []} loading={nav.isLoading} />
}
