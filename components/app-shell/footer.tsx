export function Footer() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown";

  return (
    <footer className="flex flex-wrap gap-x-2 gap-y-1 border-t border-line px-4 py-3 text-xs text-ink-muted sm:px-5 lg:px-7">
      <span>Order Entry System · v{version}</span>
    </footer>
  );
}
