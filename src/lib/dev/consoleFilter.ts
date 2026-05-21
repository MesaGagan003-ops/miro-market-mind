// Dev-only console filter to suppress repeated Supabase gotrue lock warnings
if (typeof window !== "undefined") {
  const originalWarn = console.warn.bind(console);
  console.warn = (...args: any[]) => {
    try {
      const text = args.map(String).join(" ");
      if (text.includes('@supabase/gotrue-js: Lock "lock:sb-') || text.includes('was not released within 5000ms')) {
        // swallow this noisy dev-only warning
        return;
      }
    } catch (e) {
      // fall through
    }
    originalWarn(...args);
  };
}

export {};
