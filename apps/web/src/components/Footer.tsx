import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="border-t border-ink-700 py-8 text-center text-xs text-slate-500">
      <div className="mx-auto max-w-6xl px-4">
        <p>
          Online Weekly Tournament Series. Free, every Friday, in your browser.{" "}
          <Link to="/about" className="text-slate-400 hover:text-gold-300">About the code</Link>.
        </p>
        <p className="mt-2">
          Not affiliated with Nintendo. No game data is hosted here: players supply their own disc image.
        </p>
      </div>
    </footer>
  );
}
