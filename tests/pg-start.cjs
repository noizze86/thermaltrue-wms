const path = require("path");
const fs = require("fs");

const workdir = path.join("C:\\ProgramData", "pg-embed");
const logFile = path.join(workdir, "pg-embed.log");
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try {
    fs.appendFileSync(logFile, line + "\n");
  } catch (e) {
    try {
      fs.appendFileSync(path.join(process.cwd(), "pg-embed.log"), line + "\n");
    } catch (e2) {}
  }
  console.log(line);
}

process.on("uncaughtException", (e) => {
  log("UNCAUGHT " + (e && e.stack ? e.stack : e));
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  log("UNHANDLED " + (e && e.stack ? e.stack : e));
  process.exit(1);
});

(async () => {
  try {
    fs.mkdirSync(workdir, { recursive: true });
  } catch (e) {}
  log("pg-start launched (user=" + process.env.USERNAME + ")");
  const EmbeddedPostgres = require("embedded-postgres").default;
  log("embedded-postgres loaded");
  const pg = new EmbeddedPostgres({
    databaseDir: path.join(workdir, "pgdata-e2e-" + Date.now()),
    user: "postgres",
    password: "postgres",
    port: 5432,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  log("initialising...");
  await pg.initialise();
  log("initialised, starting...");
  await pg.start();
  log("PG_STARTED on 5432");
  await new Promise(() => {});
})().catch((e) => {
  log("PG_START_FAIL " + (e && e.stack ? e.stack : e));
  process.exit(1);
});