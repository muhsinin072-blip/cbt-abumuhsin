import { config } from 'dotenv';

config({ path: ['.env.development.local', '.env.local', '.env'], quiet: true });
