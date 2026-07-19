import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { ShieldAlert } from "lucide-react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DriftGuard | Configuration Drift Security Dashboard",
  description: "Detect, monitor, and remediate configuration drift security issues across your infrastructure codebases.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground transition-colors duration-200">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
              {/* Logo and Brand */}
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-destructive/10 rounded-md border border-destructive/20 text-destructive flex items-center justify-center">
                  <ShieldAlert className="h-5 w-5" />
                </div>
                <span className="text-lg font-semibold font-sans tracking-tight">
                  Drift<span className="text-muted-foreground font-normal">Guard</span>
                </span>
              </div>

              {/* Navigation Links Placeholder */}
              <nav className="hidden md:flex space-x-8 text-sm font-medium">
                <a href="#" className="text-foreground border-b-2 border-primary px-1 pt-1 pb-3 text-sm font-medium transition-colors">
                  Dashboard
                </a>
                <a href="#" className="text-muted-foreground hover:text-foreground border-b-2 border-transparent hover:border-border px-1 pt-1 pb-3 text-sm font-medium transition-colors">
                  Repositories
                </a>
                <a href="#" className="text-muted-foreground hover:text-foreground border-b-2 border-transparent hover:border-border px-1 pt-1 pb-3 text-sm font-medium transition-colors">
                  Scans
                </a>
                <a href="#" className="text-muted-foreground hover:text-foreground border-b-2 border-transparent hover:border-border px-1 pt-1 pb-3 text-sm font-medium transition-colors">
                  API Docs
                </a>
              </nav>

              {/* Actions: Theme Toggle & Profile placeholder */}
              <div className="flex items-center space-x-4">
                <ThemeToggle />
                <div className="h-8 w-8 rounded-full bg-muted border border-border flex items-center justify-center text-xs font-semibold text-muted-foreground select-none">
                  JD
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 flex flex-col mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>

          <footer className="border-t border-border bg-muted/40">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 flex flex-col md:flex-row items-center justify-between text-xs text-muted-foreground">
              <p>&copy; {new Date().getFullYear()} DriftGuard. All rights reserved.</p>
              <div className="flex space-x-6 mt-4 md:mt-0">
                <a href="#" className="hover:text-foreground transition-colors">Privacy Policy</a>
                <a href="#" className="hover:text-foreground transition-colors">Terms of Service</a>
                <a href="#" className="hover:text-foreground transition-colors">HPE Problem Statement #14</a>
              </div>
            </div>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
