"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks() {
  const pathname = usePathname();

  const isCharacters =
    pathname === "/dashboard/characters" || pathname === "/characters";
  const isRenders =
    pathname === "/dashboard/renders" || pathname === "/renders";
  const isProjects =
    !isCharacters &&
    !isRenders &&
    (pathname === "/dashboard" ||
      pathname.startsWith("/dashboard/new") ||
      pathname.startsWith("/dashboard/"));

  const links = [
    { href: "/dashboard", label: "Projects", active: isProjects },
    { href: "/dashboard/characters", label: "Characters", active: isCharacters },
    { href: "/dashboard/renders", label: "Renders", active: isRenders },
  ];

  return (
    <nav className="hidden md:flex items-center gap-1.5 text-xs font-medium">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`px-3 py-1.5 rounded-lg transition-all ${
            link.active
              ? "bg-white/15 text-white font-bold shadow-sm"
              : "text-zinc-400 hover:text-white hover:bg-white/5"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
