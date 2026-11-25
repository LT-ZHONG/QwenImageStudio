import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { History, Menu, PanelLeftClose, PanelLeftOpen, Settings, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'

const NAV = [
  { to: '/', label: '图片创作', icon: Wand2 },
  { to: '/history', label: '创作历史', icon: History },
  { to: '/settings', label: '设置', icon: Settings },
]

export function useComfyStatus() {
  return useQuery({
    queryKey: ['comfy-status'],
    queryFn: async () => {
      try {
        return await api.comfyStatus()
      } catch {
        return { online: false, url: '', comfyui_version: null, detail: '无法连接后端服务' }
      }
    },
    refetchInterval: 10_000,
  })
}

function StatusDot({ collapsed }: { collapsed: boolean }) {
  const { data } = useComfyStatus()
  const state = data === undefined ? 'checking' : data.online ? 'online' : 'offline'
  const text = { checking: '检测中…', online: 'ComfyUI 已连接', offline: 'ComfyUI 未连接' }[state]
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground" title={data?.detail ?? data?.url}>
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          state === 'online' && 'bg-green-500',
          state === 'offline' && 'bg-red-500',
          state === 'checking' && 'animate-pulse bg-yellow-500',
        )}
      />
      {!collapsed && <span className="truncate">{text}</span>}
    </div>
  )
}

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-1 p-2">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
          title={label}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              collapsed && 'justify-center px-0',
            )
          }
        >
          <Icon className="size-4 shrink-0" />
          {!collapsed && label}
        </NavLink>
      ))}
    </nav>
  )
}

export function AppLayout() {
  const collapsed = useApp((s) => s.sidebarCollapsed)
  const toggle = useApp((s) => s.toggleSidebar)
  const [drawer, setDrawer] = useState(false)

  return (
    <div className="flex h-dvh bg-background text-foreground">
      <aside className={cn('hidden shrink-0 flex-col border-r transition-[width] md:flex', collapsed ? 'w-14' : 'w-56')}>
        <div className={cn('flex h-14 items-center gap-2 px-3', collapsed && 'justify-center px-0')}>
          <Wand2 className="size-5 shrink-0 text-primary" />
          {!collapsed && <span className="font-semibold">Qwen Image Studio</span>}
        </div>
        <NavList collapsed={collapsed} />
        <StatusDot collapsed={collapsed} />
        <Button variant="ghost" size="sm" className="m-2" onClick={toggle} title={collapsed ? '展开导航' : '折叠导航'}>
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          {!collapsed && '折叠'}
        </Button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-2 border-b px-3 md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setDrawer(true)} aria-label="打开导航">
            <Menu />
          </Button>
          <span className="font-semibold">Qwen Image Studio</span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
          <Outlet />
        </main>
      </div>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="flex h-14 items-center gap-2 px-4 font-semibold">Qwen Image Studio</SheetTitle>
          <SheetDescription className="sr-only">导航菜单</SheetDescription>
          <div className="flex h-full flex-col">
            <NavList collapsed={false} onNavigate={() => setDrawer(false)} />
            <StatusDot collapsed={false} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
