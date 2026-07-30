"use client";

import React, { useState, useRef, useEffect } from "react";
import { useSession, signOut } from "@/lib/auth-client";
import { ThemeToggle } from "./theme-toggle";
import { ShieldAlert, LogOut, ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AnimatePresence, motion } from "framer-motion";

export function Header() {
  const { data: session, isPending } = useSession();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    window.location.reload();
  };

  const getInitials = (name?: string) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const userRole = (session?.user as { role?: string })?.role;

  const navLinks = [
    { href: "/", label: "Dashboard" },
    { href: "/repos", label: "Repositories" },
    ...(userRole === "admin" ? [{ href: "/admin/reviews", label: "Reviews (Admin)" }] : []),
    { href: "/api-docs", label: "API Docs" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo and Brand */}
        <Link href="/" className="flex items-center space-x-3 group">
          <div className="p-2 bg-destructive/10 rounded-md border border-destructive/20 text-destructive flex items-center justify-center transition-transform group-hover:scale-105">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold font-sans tracking-tight">
            Drift<span className="text-muted-foreground font-normal transition-colors group-hover:text-foreground">Guard</span>
          </span>
        </Link>

        {/* Navigation Links */}
        <nav className="hidden md:flex space-x-8 text-sm font-medium h-full items-center">
          {navLinks.map((link) => {
            const isActive = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative h-full flex items-center text-sm font-medium transition-colors border-b-2 px-1 pt-1 ${
                  isActive
                    ? "text-foreground border-primary"
                    : "text-muted-foreground hover:text-foreground border-transparent hover:border-border"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Right Section: Theme Toggle & Auth State */}
        <div className="flex items-center space-x-4">
          <ThemeToggle />

          {isPending ? (
            <div className="h-8 w-8 rounded-full bg-muted animate-pulse border border-border" />
          ) : session?.user ? (
            // User Menu Dropdown
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center space-x-2 text-sm focus:outline-none cursor-pointer group"
              >
                <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center text-xs font-semibold select-none transition-colors group-hover:bg-primary/15">
                  {session.user.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={session.user.image}
                      alt={session.user.name || "User Avatar"}
                      className="h-full w-full rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    getInitials(session.user.name)
                  )}
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-hover:text-foreground" />
              </button>

              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-card p-1 shadow-lg focus:outline-none"
                  >
                    <div className="px-3 py-2 border-b border-border text-xs text-muted-foreground">
                      <p className="font-medium text-foreground truncate">{session.user.name}</p>
                      <p className="truncate mt-0.5">{session.user.email}</p>
                    </div>
                    <div className="py-1">
                      <button
                        onClick={handleSignOut}
                        className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-md cursor-pointer transition-colors text-left"
                      >
                        <LogOut className="h-4 w-4" />
                        <span>Sign out</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            // Unauthenticated: Sign in button
            <Link href="/sign-in">
              <Button size="sm" variant="outline" className="cursor-pointer font-medium">
                Sign in
              </Button>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
