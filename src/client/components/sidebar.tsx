import { AppNav, embedded } from "@clawnify/app/client";
import {
  Calendar,
  Users,
  Settings,
  Stethoscope,
  FileBarChart2,
  FlaskConical,
  Pill,
  Boxes,
  Search,
  LayoutDashboard,
  UserPlus,
  Monitor,
  Moon,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { openQuickRegister } from "@/lib/quick-register";
import { useTheme, type ThemePreference } from "@/hooks/use-theme";
import type { Route } from "@/hooks/use-router";

interface NavItem {
  label: string;
  icon: typeof Calendar;
  path?: string;
  match?: (r: Route) => boolean;
  disabled?: boolean;
}

const sections: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Practice",
    items: [
      { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard", match: (r) => r.name === "dashboard" },
      { label: "Agenda",     icon: Calendar,      path: "/agenda",   match: (r) => r.name === "agenda" },
      { label: "Patients",   icon: Users,         path: "/patients", match: (r) => r.name === "patients" || r.name === "patient" },
      { label: "Lab cases",  icon: FlaskConical,  path: "/lab",      match: (r) => r.name === "lab" },
      { label: "Medicines",  icon: Pill,          path: "/medicines", match: (r) => r.name === "medicines" },
      { label: "Inventory",  icon: Boxes,         path: "/inventory", match: (r) => r.name === "inventory" },
    ],
  },
  {
    heading: "Admin",
    items: [
      { label: "Reports",  icon: FileBarChart2, path: "/reports",  match: (r) => r.name === "reports" },
      { label: "Settings", icon: Settings,      path: "/settings", match: (r) => r.name === "settings" },
    ],
  },
];

export function Sidebar({
  route,
  navigate,
  onOpenSearch,
}: {
  route: Route;
  navigate: (to: string) => void;
  onOpenSearch?: () => void;
}) {
  const { pref: theme, cycleTheme } = useTheme();
  if (embedded) {
    const icons: Record<string, string> = { "/dashboard": "layout-dashboard", "/agenda": "calendar-days", "/patients": "users", "/lab": "package", "/medicines": "clipboard-list", "/inventory": "archive", "/reports": "bar-chart-3", "/settings": "settings" };
    const active = sections.flatMap(section => section.items).find(item => item.match?.(route))?.path;
    return <AppNav title="Dental Canvas" icon="calendar-days" active={active}
      groups={sections.map(section => ({ label: section.heading, items: section.items.filter(item => item.path && !item.disabled).map(item => ({
        id: item.path!, label: item.label, href: item.path!, icon: icons[item.path!],
      })) }))}
      onNavigate={item => navigate(item.href ?? "/dashboard")} />;
  }

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Stethoscope className="h-4 w-4" />
        </div>
        <span className="flex-1 text-base font-semibold tracking-tight">Dental Canvas</span>
        <button
          type="button"
          onClick={cycleTheme}
          title={themeLabel(theme)}
          aria-label={`Theme: ${themeLabel(theme)} — click to change`}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          {theme === "system" ? <Monitor className="h-4 w-4" /> : theme === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>


      <div className="flex gap-2 px-2 pt-3">
        <button
          type="button"
          onClick={() => onOpenSearch?.()}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate text-left">Search…</span>
          <kbd className="hidden shrink-0 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-semibold lg:block">⌘K</kbd>
        </button>
        <button
          type="button"
          onClick={openQuickRegister}
          title="Register patient (N)"
          aria-label="Register patient"
          className="flex shrink-0 items-center justify-center rounded-md border bg-primary px-3 py-2 text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <UserPlus className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {sections.map((section) => (
          <div key={section.heading} className="mb-4">
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {section.heading}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = item.match ? item.match(route) : false;
                const isDisabled = !!item.disabled;
                return (
                  <li key={item.label}>
                    <button
                      type="button"
                      disabled={isDisabled}
                      onClick={() => item.path && navigate(item.path)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        active && "bg-sidebar-accent text-sidebar-accent-foreground",
                        !active && !isDisabled && "hover:bg-sidebar-accent/60",
                        isDisabled && "cursor-not-allowed text-muted-foreground/60",
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 text-left">{item.label}</span>
                      {isDisabled && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Soon
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function themeLabel(p: ThemePreference): string {
  return p === "system" ? "System" : p === "light" ? "Light" : "Dark";
}
