import 'dotenv/config';
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const prisma = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
});
