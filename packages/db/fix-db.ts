import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  
  try {
    await sql`ALTER TABLE projects RENAME COLUMN credit_hold_seconds TO tokens_hold;`;
    console.log("projects.credit_hold_seconds -> projects.tokens_hold done");
  } catch (e) {
    console.log("projects rename error:", e.message);
  }

  try {
    const res = await sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`;
    const tables = {};
    for (const row of res) {
      if (!tables[row.table_name]) tables[row.table_name] = [];
      tables[row.table_name].push(row.column_name);
    }
    console.log(tables);
  } catch (e) {
    console.log("error:", e.message);
  }
}

main();
