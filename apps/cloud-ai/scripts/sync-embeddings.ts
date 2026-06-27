import { ensureToolEmbeddings } from '../src/tools/meta-tools';
import 'dotenv/config';

async function main() {
  console.log('Starting tool embedding sync...');
  
  try {
    // ensureToolEmbeddings handles checks internally (database connection, existing embeddings)
    // It relies on environment variables being set (SUPABASE_URL, KEY, OPENAI_API_KEY)
    await ensureToolEmbeddings();
    console.log('Tool embedding sync completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Tool embedding sync failed:', error);
    process.exit(1);
  }
}

main();


