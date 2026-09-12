#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2d310ccf72c7defb2cd49c14dda1d7edc7a524e55e35ecf5fe49619ec25a1938/contract';
import startContract from '../../snapshots/2d310ccf72c7defb2cd49c14dda1d7edc7a524e55e35ecf5fe49619ec25a1938/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/cd266d557bcd75c9575b27b69eb13b25b19688bf9fc47256164e8bbd1e9e7c9e/contract';
import endContract from '../../snapshots/cd266d557bcd75c9575b27b69eb13b25b19688bf9fc47256164e8bbd1e9e7c9e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'repository',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('fullName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('githubId', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('owner', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('url', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'review',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('prNumber', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('prTitle', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('prUrl', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('repositoryId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('review', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('completed'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'repository',
        constraint: 'repository_githubId_key',
        columns: ['githubId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'repository',
        index: 'repository_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'review',
        index: 'review_repositoryId_idx_dce7a8ba',
        columns: ['repositoryId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'repository',
        foreignKey: {
          name: 'repository_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'review',
        foreignKey: {
          name: 'review_repositoryId_fkey',
          columns: ['repositoryId'],
          references: { schema: 'public', table: 'repository', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
