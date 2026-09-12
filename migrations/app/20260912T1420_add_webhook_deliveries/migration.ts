#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/cd266d557bcd75c9575b27b69eb13b25b19688bf9fc47256164e8bbd1e9e7c9e/contract';
import startContract from '../../snapshots/cd266d557bcd75c9575b27b69eb13b25b19688bf9fc47256164e8bbd1e9e7c9e/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/ed8602c2406d47c4a9b5caa100f50ba1c3c0a51ceb789be5209ebc48588a68b5/contract';
import endContract from '../../snapshots/ed8602c2406d47c4a9b5caa100f50ba1c3c0a51ceb789be5209ebc48588a68b5/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'webhook_delivery',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('deliveryId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'webhook_delivery',
        constraint: 'webhook_delivery_deliveryId_key',
        columns: ['deliveryId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
