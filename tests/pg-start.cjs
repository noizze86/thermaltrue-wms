const EmbeddedPostgres = require("embedded-postgres").default;
const path = require("path");

(async () => {
  const pg = new EmbeddedPostgres({
    databaseDir: path.join(process.env.TEMP || ".", "pgdata-e2e-" + Date.now()),
    user: "postgres",
    password: "postgres",
    port: 5432,
    persistent: true,
  });
  await pg.initialise();
  await pg.start();
  console.log("PG_STARTED on 5432");
  await new Promise(() => {});
})().catch((e) => {
  console.error("PG_START_FAIL", e && e.message ? e.message : e);
  process.exit(1);
});
