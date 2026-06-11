// Dev-only console filter to suppress repeated Supabase gotrue lock warnings
export function installConsoleFilter(): void {
  if (typeof window === "undefined") return;

  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    try {
      const text = args.map(String).join(" ");
      if (text.includes('@supabase/gotrue-js: Lock "lock:sb-') || text.includes("was not released within 5000ms")) {
        return;
      }
    } catch {
      // fall through to the original logger when filtering fails
    }
    originalWarn(...args);
  };
}

export {};
