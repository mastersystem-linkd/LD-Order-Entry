// Animated aurora mesh-gradient backdrop (Prism). Fixed behind all content;
// pure CSS drift animations (see globals.css), disabled under reduced-motion.
export function Mesh() {
  return (
    <div className="mesh" aria-hidden>
      <i className="m1" />
      <i className="m2" />
      <i className="m3" />
    </div>
  );
}
