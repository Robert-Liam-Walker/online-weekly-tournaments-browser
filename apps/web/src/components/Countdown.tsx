import { useEffect, useState } from "react";
import { countdownParts } from "../lib/format";

export default function Countdown({ to, className = "" }: { to: number | string | Date; className?: string }) {
  const target = typeof to === "number" ? to : new Date(to).getTime();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const { d, h, m, s } = countdownParts(target - now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div className={`arcade flex items-end gap-4 text-gold-300 ${className}`}>
      {d > 0 && <Unit v={String(d)} label="days" />}
      <Unit v={pad(h)} label="hrs" />
      <Unit v={pad(m)} label="min" />
      <Unit v={pad(s)} label="sec" />
    </div>
  );
}

function Unit({ v, label }: { v: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl sm:text-4xl">{v}</div>
      <div className="mt-2 text-[9px] text-slate-400">{label}</div>
    </div>
  );
}
