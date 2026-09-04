"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard", glyph: "01" },
  { href: "/cases", label: "Resolution Cases", glyph: "02" },
  { href: "/payments", label: "Payment Ledger", glyph: "03" },
  { href: "/razorpay-demo", label: "Razorpay Test Demo", glyph: "04" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="w-60 shrink-0 h-screen sticky top-0 flex flex-col justify-between"
      style={{ background: "var(--ink)", color: "#EDEFE9" }}
    >
      <div>
        <div className="px-6 pt-7 pb-6">
          <div className="flex items-baseline gap-2">
            <span className="font-display font-semibold text-xl tracking-tight text-white">
              ReconcileX
            </span>
          </div>
          <p className="mt-1 text-[11px] font-mono uppercase tracking-[0.08em]" style={{ color: "#8A93A6" }}>
            Resolution Agent
          </p>
        </div>

        <nav className="mt-2 px-3 flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors"
                style={{
                  background: active ? "rgba(230,239,232,0.08)" : "transparent",
                  color: active ? "#FFFFFF" : "#AEB4C2",
                }}
              >
                <span
                  className="font-mono text-[10px]"
                  style={{ color: active ? "#7FB69A" : "#5B6472" }}
                >
                  {item.glyph}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="px-6 pb-6">
        <div className="rule-soft opacity-20 mb-4" />
        <p className="text-[11px] leading-relaxed" style={{ color: "#6E7688" }}>
          An AI decision &amp; resolution layer on top of your payment infrastructure. Every
          recommendation requires human approval before money moves.
        </p>
      </div>
    </aside>
  );
}
