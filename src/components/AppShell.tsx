import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Briefcase, Receipt, BookOpen, Repeat2,
  FilePlus2, BarChart3, Settings, LogOut, Bell, Search, Menu,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { OverdueAlertBar } from "@/components/OverdueAlertBar";

const nav = [
  { to: "/",            label: "Dashboard",          icon: LayoutDashboard },
  { to: "/bookings",    label: "Bookings",           icon: Briefcase },
  { to: "/payments",    label: "Payments",           icon: Receipt },
  { to: "/ledger",      label: "Installment Ledger", icon: BookOpen },
  { to: "/adjustments", label: "Adjustments",        icon: Repeat2 },
  { to: "/documents",       label: "Legal Notices",      icon: FilePlus2 },
  { to: "/document-center", label: "Document Center",    icon: FilePlus2 },
  { to: "/reports",     label: "Reports",            icon: BarChart3 },
  { to: "/settings",    label: "Settings",           icon: Settings },
];

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-5 py-5 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-sidebar-primary grid place-items-center text-sidebar-primary-foreground font-bold text-base shadow-sm">
            P
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">Precise Realtors & Builders</div>
            <div className="text-[11px] text-sidebar-primary font-medium tracking-wide">MANAL ARCADE</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {nav.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === "/"}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                  : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-white"
              )
            }
          >
            <it.icon className="h-4 w-4" />
            <span>{it.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-sidebar-border text-[11px] text-sidebar-foreground/60">
        v1.0 · Precise ERP
      </div>
    </div>
  );
}

export default function AppShell() {
  const { user, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0">
        <SidebarBody />
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <OverdueAlertBar />

        {/* Topbar */}
        <header className="h-14 border-b bg-card/80 backdrop-blur px-3 md:px-6 flex items-center gap-2 md:gap-3 sticky top-0 z-20">
          {/* Mobile hamburger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72 bg-sidebar border-sidebar-border">
              <SidebarBody onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="relative flex-1 max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search bookings, clients, units, receipts…"
              className="pl-9 bg-muted/60 border-transparent focus-visible:bg-card"
            />
          </div>
          <Button variant="ghost" size="icon" className="rounded-full">
            <Bell className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="rounded-full px-2.5 gap-2">
                <div className="h-7 w-7 rounded-full bg-primary grid place-items-center text-primary-foreground text-xs font-semibold ring-1 ring-accent/50">
                  {(user?.email ?? "U").slice(0, 1).toUpperCase()}
                </div>
                <span className="hidden sm:inline text-sm">{user?.email?.split("@")[0]}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="text-sm font-medium">{user?.email}</div>
                <div className="text-xs text-muted-foreground capitalize">{roles[0] ?? "viewer"} access</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/settings")}>Settings</DropdownMenuItem>
              <DropdownMenuItem onClick={async () => { await signOut(); navigate("/login"); }}>
                <LogOut className="h-4 w-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6 max-w-[1600px] mx-auto animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
