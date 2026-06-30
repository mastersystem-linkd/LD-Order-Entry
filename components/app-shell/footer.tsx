export function Footer() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown";

  return (
    <footer className="border-t border-line px-5 py-3 text-xs text-ink-muted lg:px-7">
      Order Entry System · v{version}
    </footer>
  );
}
