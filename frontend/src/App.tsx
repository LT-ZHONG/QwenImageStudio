import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useApplyTheme } from '@/hooks/useTheme'
import CreatePage from '@/pages/CreatePage'
import HistoryPage from '@/pages/HistoryPage'
import SettingsPage from '@/pages/SettingsPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
})

export default function App() {
  useApplyTheme()
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<CreatePage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster position="top-center" richColors />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
