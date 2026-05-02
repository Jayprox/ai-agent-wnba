require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { supabase } = require('../lib/supabase');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db');

function getMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(file => /^\d+_.*\.sql$/.test(file))
    .sort();
}

async function runWithPostgres(sql, filename, client) {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
    console.log(`[migrate] Applied ${filename}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function runWithRpc(sql, filename) {
  const { error } = await supabase.rpc('exec_sql', { sql });
  if (error) throw error;
  console.log(`[migrate] Applied ${filename}`);
}

async function migrate() {
  const files = getMigrationFiles();
  if (!files.length) {
    console.log('[migrate] No migration files found');
    return;
  }

  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  const client = connectionString ? new Client({ connectionString }) : null;

  if (client) {
    await client.connect();
  } else {
    console.warn('[migrate] SUPABASE_DB_URL/DATABASE_URL not set; falling back to Supabase RPC exec_sql');
  }

  try {
    for (const filename of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      if (client) {
        await runWithPostgres(sql, filename, client);
      } else {
        await runWithRpc(sql, filename);
      }
    }
    console.log(`[migrate] Complete: ${files.length} migration(s) applied`);
  } finally {
    if (client) await client.end();
  }
}

if (require.main === module) {
  migrate().catch(error => {
    console.error('[migrate] Failed:', error.message);
    if (!process.env.SUPABASE_DB_URL && !process.env.DATABASE_URL) {
      console.error('[migrate] Provide SUPABASE_DB_URL/DATABASE_URL, or create an exec_sql RPC in Supabase.');
    }
    process.exit(1);
  });
}

module.exports = { migrate };
