// Starts a throwaway local Postgres for development (no Docker needed).
// Data lives in .devdb/ (gitignored). Ctrl+C stops it.
import EmbeddedPostgres from "embedded-postgres";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pg = new EmbeddedPostgres({
  databaseDir: path.join(root, ".devdb"),
  user: "owt",
  password: "owt",
  port: 5432,
  persistent: true,
});

const exists = await pg.status?.().catch(() => false);
if (!exists) await pg.initialise().catch(() => {});
await pg.start();
await pg.createDatabase("owtbrowser").catch(() => {});
console.log("postgres ready: postgresql://owt:owt@localhost:5432/owtbrowser");

const stop = async () => { await pg.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
