import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Building2, Home, Users, FileText, Receipt, BookOpen,
  Repeat2, BarChart3, FilePlus2, Upload, ShieldCheck, Settings, LogOut,
  Bell, Search, Briefcase,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navGroups: { label: string; items: { to: string; label: string; icon: any }[] }[] = [
  {
    label: "Overview",
    items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Sales",
    items: [
      { to: "/projects", label: "Projects", icon: Building2 },
      { to: "/units", label: "Units", icon: Home },
      { to: "/clients", label: "Clients", icon: Users },
      { to: "/bookings", label: "Bookings", icon: Briefcase },
    ],
  },
  {
    label: "Accounting",
    items: [
      { to: "/payments", label: "Payments", icon: Receipt },
      { to: "/ledger", label: "Installment Ledger", icon: BookOpen },
      { to: "/adjustments", label: "Adjustments", icon: Repeat2 },
      { to: "/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/documents", label: "Documents", icon: FilePlus2 },
      { to: "/import", label: "Import Center", icon: Upload },
      { to: "/audit", label: "Audit Log", icon: ShieldCheck },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/logic", label: "Logic Notes", icon: FileText },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export default function AppShell() {
  const { user, roles, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-sidebar-primary grid place-items-center text-sidebar-primary-foreground font-bold">P</div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-white">Precise ERP</div>
              <div className="text-[11px] text-sidebar-foreground/70">Realtors & Builders</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {navGroups.map((g) => (
            <div key={g.label}>
              <div className="px-2 pb-1.5 text-[10px] uppercase tracking-wider text-sidebar-foreground/50 font-semibold">{g.label}</div>
              <div className="space-y-0.5">
                {g.items.map((it) => (
                  <NavLink key={it.to} to={it.to} end={it.to === "/"}
                    className={({ isActive }) => cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                        : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-white"
                    )}>
                    <it.icon className="h-4 w-4" />
                    <span>{it.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="px-3 py-3 border-t border-sidebar-border text-[11px] text-sidebar-foreground/60">
          v1.0 · Precise Realtors
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-14 border-b bg-card/80 backdrop-blur px-4 md:px-6 flex items-center gap-3 sticky top-0 z-20">
          <div className="relative flex-1 max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search bookings, clients, units, receipts…" className="pl-9 bg-muted/60 border-transparent focus-visible:bg-card" />
          </div>
          <Button variant="ghost" size="icon" className="rounded-full">
            <Bell className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="rounded-full px-2.5 gap-2">
                <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-adjustment grid place-items-center text-white text-xs font-semibold">
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
