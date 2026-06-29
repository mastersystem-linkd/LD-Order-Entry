export function Footer() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown";

  return (
    <footer className="border-t border-border px-[30px] py-3 text-xs text-muted-foreground">
      Order Entry System · v{version}
    </footer>
  );
}
