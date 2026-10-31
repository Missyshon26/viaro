import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { ThemeScript } from "@/components/theme/ThemeScript";
import { RequireRole } from "@/components/auth/RequireRole";
import { ConsoleShell, type NavItem } from "@/components/layout/ConsoleShell";


export const metadata: Metadata = {
  title: "ABL · Operations",
  description: "Platform dashboards, city pricing, dispatch and support triage.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0b" },
  ],
  width: "device-width",
  initialScale: 1,
};

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "home" },
  { href: "/trips", label: "Trips", icon: "route" },
  { href: "/users", label: "Users", icon: "users" },
  { href: "/clients", label: "Clients", icon: "contact" },
  { href: "/pricing", label: "City pricing", icon: "pricing" },
  { href: "/drivers", label: "Drivers", icon: "driver" },
  { href: "/vehicles", label: "Vehicles", icon: "car" },
  { href: "/packages", label: "Packages", icon: "package" },
  { href: "/revenue", label: "Revenue", icon: "money" },
  { href: "/reports", label: "Reports", icon: "report" },
  { href: "/support", label: "Support", icon: "support" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full bg-surface font-sans text-fg">
        <AuthProvider>
          <RequireRole>
            <ConsoleShell nav={NAV} title="Operations">
              {children}
            </ConsoleShell>
          </RequireRole>
        </AuthProvider>
      </body>
    </html>
  );
}
