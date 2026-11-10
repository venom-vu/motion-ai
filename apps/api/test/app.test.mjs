import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { Queue, QueueEvents, Worker } from 'bullmq';
import pg from 'pg';
import { AppModule } from '../dist/app.module.js';
import {
  InfraModule,
  PrismaService,
  RedisService,
  parseRedisUrlToOptions,
} from '../dist/infra/index.js';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi, resolvePort } from '../dist/main.js';
import { AuditModule } from '../dist/modules/audit/index.js';
import { AuthModule } from '../dist/modules/auth/index.js';
import { OpsModule } from '../dist/modules/ops/index.js';
import { PipelinesModule } from '../dist/modules/pipelines/index.js';
import { StorageModule } from '../dist/modules/storage/index.js';
import { TasksModule } from '../dist/modules/tasks/index.js';
import { TopupsModule } from '../dist/modules/topups/index.js';
import { WalletModule } from '../dist/modules/wallet/index.js';
import {
  NOTIFIER_PORT,
  RUNNING_HUB_PORT,
  STORAGE_PORT,
} from '../dist/ports/index.js';
import { bootstrapWorker } from '../dist/worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '../..');
const composePath = path.join(repoRoot, 'deploy', 'compose.yml');
const dockerfilePath = path.join(repoRoot, 'deploy', 'Dockerfile');

const ORIGINAL_PORT = process.env.PORT;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

const DEFAULT_DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://motion_user:change_me_local_password@localhost:5432/flowvis?schema=public';
const DEFAULT_REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

function checkTcpPort(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const onDone = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => onDone(true));
    socket.once('timeout', () => onDone(false));
    socket.once('error', () => onDone(false));
    socket.connect(port, host);
  });
}

async function ensureInfraServicesRunning() {
  const dbUrl = new URL(DEFAULT_DATABASE_URL);
  const redisUrl = new URL(DEFAULT_REDIS_URL);

  const [pgUp, redisUp] = await Promise.all([
    checkTcpPort(dbUrl.hostname || 'localhost', Number(dbUrl.port || 5432)),
    checkTcpPort(
      redisUrl.hostname || 'localhost',
      Number(redisUrl.port || 6379),
    ),
  ]);

  if (!pgUp || !redisUp) {
    execFileSync(
      'docker',
      [
        'compose',
        '-f',
        composePath,
        'up',
        '-d',
        '--wait',
        'postgres-16',
        'redis-7',
      ],
      {
        cwd: repoRoot,
        stdio: 'inherit',
      },
    );
  }

  execFileSync('pnpm', ['run', 'prisma:migrate:deploy'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      DATABASE_URL: DEFAULT_DATABASE_URL,
    },
    stdio: 'pipe',
  });
}

process.env.RUNNINGHUB_WORKFLOW_BODY_RESHAPE ??= 'wf-body';
process.env.RUNNINGHUB_WORKFLOW_MOTION ??= 'wf-motion';

describe('@flowvis/api infrastructure, worker, PostgreSQL 16 & Redis 7', () => {
  before(async () => {
    process.env.DATABASE_URL = DEFAULT_DATABASE_URL;
    process.env.REDIS_URL = DEFAULT_REDIS_URL;
    await ensureInfraServicesRunning();
  });

  after(() => {
    if (ORIGINAL_PORT === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = ORIGINAL_PORT;
    }

    if (ORIGINAL_DATABASE_URL === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
    }

    if (ORIGINAL_REDIS_URL === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = ORIGINAL_REDIS_URL;
    }
  });

  it('pins exact versions in apps/api/package.json and provides .env.example files without secrets', () => {
    const pkgRaw = fs.readFileSync(path.join(apiRoot, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw);

    assert.equal(pkg.dependencies['prisma'], '7.10.1');
    assert.equal(pkg.dependencies['@prisma/client'], '7.10.1');
    assert.equal(pkg.dependencies['@prisma/adapter-pg'], '7.10.1');
    assert.equal(pkg.dependencies['ioredis'], '5.11.1');
    assert.equal(pkg.dependencies['bullmq'], '6.5.3');
    assert.equal(pkg.dependencies['@nestjs/bullmq'], '12.0.0');

    for (const [name, version] of Object.entries({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    })) {
      if (name === '@flowvis/contracts') continue;
      assert.equal(
        /^[0-9]+\.[0-9]+\.[0-9]+$/.test(String(version)),
        true,
        `Dependency ${name} must be pinned to an exact semver version, got: ${version}`,
      );
    }

    const apiEnvExample = fs.readFileSync(
      path.join(apiRoot, '.env.example'),
      'utf8',
    );
    const deployEnvExample = fs.readFileSync(
      path.join(repoRoot, 'deploy', '.env.example'),
      'utf8',
    );

    for (const key of ['PORT=', 'DATABASE_URL=', 'REDIS_URL=']) {
      assert.ok(
        apiEnvExample.includes(key),
        `apps/api/.env.example missing ${key}`,
      );
      assert.ok(
        deployEnvExample.includes(key),
        `deploy/.env.example missing ${key}`,
      );
    }
    for (const key of [
      'POSTGRES_USER=',
      'POSTGRES_PASSWORD=',
      'POSTGRES_DB=',
    ]) {
      assert.ok(
        deployEnvExample.includes(key),
        `deploy/.env.example missing ${key}`,
      );
    }
  });

  it('defines 4 services in deploy/compose.yml with Redis AD-15 flags and worker without HTTP ports', () => {
    const composeContent = fs.readFileSync(composePath, 'utf8');

    const serviceMatches = [
      ...composeContent.matchAll(/^ {2}([a-z0-9-]+):\s*$/gm),
    ].map((m) => m[1]);
    assert.deepEqual(
      serviceMatches.sort(),
      ['nestjs-api', 'nestjs-worker', 'postgres-16', 'redis-7'].sort(),
    );

    assert.ok(composeContent.includes('image: postgres:16-alpine'));
    assert.ok(composeContent.includes('image: redis:7-alpine'));
    assert.ok(composeContent.includes('--appendonly'));
    assert.ok(composeContent.includes('--appendfsync'));
    assert.ok(composeContent.includes('everysec'));
    assert.ok(composeContent.includes('--maxmemory-policy'));
    assert.ok(composeContent.includes('noeviction'));

    const workerSection = composeContent.split('nestjs-worker:')[1] || '';
    const workerBlock = workerSection.split(/^\S/m)[0] || '';
    assert.equal(
      workerBlock.includes('ports:'),
      false,
      'nestjs-worker must not expose HTTP ports in compose.yml',
    );
    assert.equal(
      workerBlock.includes('expose:'),
      false,
      'nestjs-worker must not expose ports in compose.yml',
    );
  });

  it('validates docker compose config and builds deploy/Dockerfile successfully', () => {
    const configOut = execFileSync(
      'docker',
      ['compose', '-f', composePath, 'config'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
    assert.ok(configOut.includes('nestjs-api:'));
    assert.ok(configOut.includes('nestjs-worker:'));
    assert.ok(configOut.includes('postgres-16:'));
    assert.ok(configOut.includes('redis-7:'));

    execFileSync(
      'docker',
      ['build', '-f', dockerfilePath, '-t', 'flowvis-api:test', '.'],
      {
        cwd: repoRoot,
        stdio: 'pipe',
      },
    );
  });

  it('parses Redis URLs accurately and rejects invalid protocol, port, or db index', () => {
    const parsedTls = parseRedisUrlToOptions(
      'rediss://default:s3cr3t%40pass@redis.internal:6380/2',
    );
    assert.deepEqual(parsedTls, {
      host: 'redis.internal',
      port: 6380,
      username: 'default',
      password: 's3cr3t@pass',
      db: 2,
      tls: {},
      maxRetriesPerRequest: null,
    });

    const parsedPlain = parseRedisUrlToOptions('redis://localhost');
    assert.deepEqual(parsedPlain, {
      host: 'localhost',
      port: 6379,
      username: undefined,
      password: undefined,
      db: 0,
      tls: undefined,
      maxRetriesPerRequest: null,
    });

    assert.throws(
      () => parseRedisUrlToOptions('http://localhost:6379'),
      /Invalid Redis URL protocol/,
    );
    assert.throws(
      () => parseRedisUrlToOptions('redis://localhost:6379/-1'),
      /Invalid Redis db index/,
    );
    assert.throws(
      () => parseRedisUrlToOptions('redis://localhost:0'),
      /Redis port out of range/,
    );
  });

  it('creates worker application context with InfraModule and all 8 modules without opening HTTP port', async () => {
    const prevRole = process.env.MOTION_PROCESS_ROLE;
    const ctx = await bootstrapWorker();
    try {
      assert.equal(
        process.env.MOTION_PROCESS_ROLE,
        'worker',
        'bootstrapWorker phải đặt MOTION_PROCESS_ROLE=worker để job đối soát chạy',
      );
      assert.ok(ctx);
      assert.ok(ctx.get(AppModule));
      assert.ok(ctx.get(InfraModule));
      assert.ok(ctx.get(PrismaService));
      assert.ok(ctx.get(RedisService));
      assert.ok(ctx.get(AuthModule));
      assert.ok(ctx.get(WalletModule));
      assert.ok(ctx.get(TasksModule));
      assert.ok(ctx.get(PipelinesModule));
      assert.ok(ctx.get(TopupsModule));
      assert.ok(ctx.get(StorageModule));
      assert.ok(ctx.get(OpsModule));
      assert.ok(ctx.get(AuditModule));
      assert.equal(typeof bootstrapApi, 'function');

      const redisService = ctx.get(RedisService);
      assert.equal(
        redisService.getWorkerConnectionOptions().maxRetriesPerRequest,
        null,
      );
      assert.equal(
        'getHttpServer' in ctx,
        false,
        'ApplicationContext must not have an HTTP server',
      );
    } finally {
      await ctx.close();
      if (prevRole === undefined) delete process.env.MOTION_PROCESS_ROLE;
      else process.env.MOTION_PROCESS_ROLE = prevRole;
    }
  });

  it('defines port tokens for RunningHubPort, StoragePort, NotifierPort', () => {
    assert.equal(typeof RUNNING_HUB_PORT, 'symbol');
    assert.equal(typeof STORAGE_PORT, 'symbol');
    assert.equal(typeof NOTIFIER_PORT, 'symbol');
  });

  it('exits with code 1 when worker entrypoint fails to initialize', async () => {
    const workerPath = path.join(apiRoot, 'dist', 'worker.js');
    const exitCode = await new Promise((resolve) => {
      const child = spawn(process.execPath, [workerPath], {
        env: {
          ...process.env,
          REDIS_URL: ':::invalid-url:::',
        },
        stdio: 'ignore',
      });
      child.on('exit', (code) => resolve(code));
    });
    assert.equal(exitCode, 1);
  });

  it('serves GET /health returning 200 with postgres: up and redis: up when both are healthy', async () => {
    process.env.DATABASE_URL = DEFAULT_DATABASE_URL;
    process.env.REDIS_URL = DEFAULT_REDIS_URL;
    process.env.PORT = '0';

    const app = await bootstrapApi();
    try {
      const server = app.getHttpServer();
      const address = server.address();
      assert.ok(address && typeof address === 'object');

      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body, {
        status: 'ok',
        postgres: 'up',
        redis: 'up',
      });
    } finally {
      await app.close();
    }
  });

  it('serves GET /health returning 200 and reporting down service when PostgreSQL or Redis is unreachable', async () => {
    process.env.DATABASE_URL =
      'postgresql://motion_user:wrong@127.0.0.1:59999/flowvis?schema=public';
    process.env.REDIS_URL = DEFAULT_REDIS_URL;
    process.env.PORT = '0';

    const appPgDown = await bootstrapApi();
    try {
      const address = appPgDown.getHttpServer().address();
      const res = await fetch(`http://127.0.0.1:${address.port}/health`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, {
        status: 'degraded',
        postgres: 'down',
        redis: 'up',
      });
    } finally {
      await appPgDown.close();
    }

    process.env.DATABASE_URL = DEFAULT_DATABASE_URL;
    process.env.REDIS_URL = 'redis://127.0.0.1:59998';
    process.env.PORT = '0';

    const appRedisDown = await bootstrapApi();
    try {
      const address = appRedisDown.getHttpServer().address();
      const res = await fetch(`http://127.0.0.1:${address.port}/health`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, {
        status: 'degraded',
        postgres: 'up',
        redis: 'down',
      });
    } finally {
      await appRedisDown.close();
      process.env.DATABASE_URL = DEFAULT_DATABASE_URL;
      process.env.REDIS_URL = DEFAULT_REDIS_URL;
    }
  });

  it('applies Prisma and raw SQL migrations on an empty PostgreSQL 16 schema and enforces raw CHECK constraint', async () => {
    const tempSchema = `test_migrate_${crypto.randomUUID().replace(/-/g, '')}`;
    const baseDbUrl = new URL(DEFAULT_DATABASE_URL);
    baseDbUrl.searchParams.set('schema', tempSchema);
    const schemaDbUrl = baseDbUrl.toString();

    const pool = new pg.Pool({ connectionString: DEFAULT_DATABASE_URL });
    try {
      execFileSync('pnpm', ['run', 'prisma:migrate:deploy'], {
        cwd: apiRoot,
        env: {
          ...process.env,
          DATABASE_URL: schemaDbUrl,
        },
        stdio: 'pipe',
      });

      const constraintRes = await pool.query(
        `SELECT conname
         FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE n.nspname = $1 AND c.conname = 'infra_probes_probe_key_non_empty_chk'`,
        [tempSchema],
      );
      assert.equal(
        constraintRes.rowCount,
        1,
        'Raw SQL CHECK constraint must exist after prisma migrate deploy',
      );

      await assert.rejects(
        () =>
          pool.query(
            `INSERT INTO "${tempSchema}"."infra_probes" ("probe_key") VALUES ('')`,
          ),
        (err) => err && err.code === '23514',
        'Empty probe_key must be rejected by raw SQL CHECK constraint (23514)',
      );
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${tempSchema}" CASCADE`);
      await pool.end();
    }
  });

  it('fails prisma migrate deploy with non-zero exit code when a raw SQL migration contains invalid SQL', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'flowvis-bad-migration-'),
    );
    const tempSchema = `test_bad_mig_${crypto.randomUUID().replace(/-/g, '')}`;
    const baseDbUrl = new URL(DEFAULT_DATABASE_URL);
    baseDbUrl.searchParams.set('schema', tempSchema);

    try {
      const prismaDir = path.join(tempDir, 'prisma');
      const badMigDir = path.join(
        prismaDir,
        'migrations',
        '20261101000000_invalid_sql',
      );
      fs.mkdirSync(badMigDir, { recursive: true });
      fs.copyFileSync(
        path.join(apiRoot, 'prisma', 'schema.prisma'),
        path.join(prismaDir, 'schema.prisma'),
      );
      fs.copyFileSync(
        path.join(apiRoot, 'prisma', 'migrations', 'migration_lock.toml'),
        path.join(prismaDir, 'migrations', 'migration_lock.toml'),
      );
      fs.writeFileSync(
        path.join(badMigDir, 'migration.sql'),
        'THIS IS INVALID SQL SYNTAX;',
      );
      const badConfigPath = path.join(tempDir, 'prisma.config.ts');
      fs.writeFileSync(
        badConfigPath,
        `export default { schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: process.env.DATABASE_URL } };\n`,
      );

      assert.throws(
        () => {
          execFileSync(
            'pnpm',
            ['exec', 'prisma', 'migrate', 'deploy', '--config', badConfigPath],
            {
              cwd: apiRoot,
              env: {
                ...process.env,
                DATABASE_URL: baseDbUrl.toString(),
              },
              stdio: 'pipe',
            },
          );
        },
        (error) => {
          assert.notEqual(error.status, 0);
          const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
          assert.match(
            output,
            /P3018|20261101000000_invalid_sql|syntax error/i,
            `Expected migration failure output, got: ${output}`,
          );
          return true;
        },
      );
    } finally {
      const pool = new pg.Pool({ connectionString: DEFAULT_DATABASE_URL });
      await pool.query(`DROP SCHEMA IF EXISTS "${tempSchema}" CASCADE`);
      await pool.end();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rolls back interactive transaction on P2002 unique violation and reuses connection from pool for subsequent queries', async () => {
    process.env.DATABASE_URL = DEFAULT_DATABASE_URL;
    // Pool 1 kết nối: truy vấn sau P2002 buộc phải dùng lại đúng kết nối của transaction đã rollback.
    const singlePool = new pg.Pool({
      connectionString: DEFAULT_DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 2000,
    });
    const prisma = new PrismaClient({
      adapter: new PrismaPg(singlePool, { disposeExternalPool: true }),
    });
    prisma.checkHealth = async () => {
      await prisma.$queryRaw`SELECT 1`;
      return 'up';
    };
    prisma.onModuleDestroy = () => prisma.$disconnect();
    const duplicateKey = `p2002-probe-${crypto.randomUUID()}`;
    const followUpKey = `followup-probe-${crypto.randomUUID()}`;

    try {
      await assert.rejects(
        () =>
          prisma.$transaction(async (tx) => {
            await tx.infraProbe.create({
              data: { probeKey: duplicateKey },
            });
            // Trigger P2002 unique violation inside the interactive transaction;
            // do not run any further queries in tx after P2002.
            await tx.infraProbe.create({
              data: { probeKey: duplicateKey },
            });
          }),
        (error) => {
          assert.equal(error?.code, 'P2002');
          return true;
        },
      );

      // Verify the first insert inside the aborted transaction was rolled back
      const rolledBackRow = await prisma.infraProbe.findUnique({
        where: { probeKey: duplicateKey },
      });
      assert.equal(
        rolledBackRow,
        null,
        'First row inside rolled-back P2002 transaction must not persist',
      );

      // Verify the connection pool remains healthy and executes subsequent queries and transactions
      const createdAfterRollback = await prisma.infraProbe.create({
        data: { probeKey: followUpKey },
      });
      assert.equal(createdAfterRollback.probeKey, followUpKey);

      const fetched = await prisma.infraProbe.findUnique({
        where: { id: createdAfterRollback.id },
      });
      assert.ok(fetched);
      assert.equal(fetched.probeKey, followUpKey);

      const healthAfter = await prisma.checkHealth();
      assert.equal(healthAfter, 'up');
      assert.ok(
        singlePool.totalCount <= 1,
        'Pool must never open more than 1 connection',
      );
    } finally {
      await prisma.infraProbe
        .deleteMany({
          where: { probeKey: { in: [duplicateKey, followUpKey] } },
        })
        .catch(() => {});
      await prisma.onModuleDestroy();
    }
  });

  it('resolves PORT strictly: invalid, empty, negative or out-of-range values fall back to 3001', () => {
    assert.equal(resolvePort(undefined), 3001);
    for (const raw of ['', 'abc', '-1', '3001abc', '70000', '65536', ' ']) {
      assert.equal(resolvePort(raw), 3001, `PORT=${JSON.stringify(raw)}`);
    }
    assert.equal(resolvePort('0'), 0);
    assert.equal(resolvePort('8080'), 8080);
    assert.equal(resolvePort('65535'), 65535);
  });

  it('keeps worker process alive after bootstrap and opens no listening TCP socket', async () => {
    const workerPath = path.join(apiRoot, 'dist', 'worker.js');
    const child = spawn(process.execPath, [workerPath], {
      env: { ...process.env },
      stdio: 'ignore',
    });
    let exited = false;
    child.on('exit', () => {
      exited = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      assert.equal(exited, false, 'Worker must stay alive after bootstrap');

      let listening = '';
      try {
        listening = execFileSync(
          'lsof',
          ['-a', '-p', String(child.pid), '-iTCP', '-sTCP:LISTEN', '-n', '-P'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        );
      } catch (error) {
        // lsof exits 1 when nothing matches; any other failure means lsof is unavailable
        if (error.code === 'ENOENT') {
          return;
        }
        listening = error.stdout ?? '';
      }
      assert.equal(listening.trim(), '', 'Worker must not listen on any TCP port');
    } finally {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        if (exited) {
          resolve();
          return;
        }
        const killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
        child.once('exit', () => {
          clearTimeout(killTimer);
          resolve();
        });
      });
    }
  });

  it(
    'runs full compose stack end-to-end: migrate in container, /health via published port, worker stays running',
    {
      skip:
        process.env.RUN_COMPOSE_E2E === '1'
          ? false
          : 'Đặt RUN_COMPOSE_E2E=1 để chạy (cần Docker, build image, dựng cả stack)',
      timeout: 900_000,
    },
    async () => {
      const project = 'flowvis-e2e';
      const apiPort = '3101';
      const env = {
        ...process.env,
        PORT: apiPort,
        POSTGRES_PORT: '15432',
        REDIS_PORT: '16379',
      };
      delete env.DATABASE_URL;
      delete env.REDIS_URL;
      const compose = (args, options = {}) =>
        execFileSync(
          'docker',
          ['compose', '-p', project, '-f', composePath, ...args],
          { cwd: repoRoot, env, encoding: 'utf8', stdio: 'pipe', ...options },
        );

      try {
        compose(['up', '-d', '--build', '--wait']);

        const res = await fetch(`http://127.0.0.1:${apiPort}/health`);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), {
          status: 'ok',
          postgres: 'up',
          redis: 'up',
        });

        const table = compose([
          'exec',
          '-T',
          'postgres-16',
          'psql',
          '-U',
          'motion_user',
          '-d',
          'flowvis',
          '-tAc',
          "select to_regclass('public.infra_probes')",
        ]).trim();
        assert.equal(table, 'infra_probes');

        await new Promise((resolve) => setTimeout(resolve, 5000));
        const running = compose(['ps', '--status', 'running', '--services']);
        assert.match(running, /nestjs-worker/);
        assert.match(running, /nestjs-api/);
      } finally {
        try {
          compose(['down', '-v']);
        } catch {
          // best-effort cleanup
        }
      }
    },
  );

  it('processes a sample BullMQ job on Redis 7 with worker connection maxRetriesPerRequest: null', async () => {
    process.env.REDIS_URL = DEFAULT_REDIS_URL;
    const redisService = new RedisService();
    const connectionOptions = parseRedisUrlToOptions(DEFAULT_REDIS_URL);
    assert.equal(connectionOptions.maxRetriesPerRequest, null);

    const queueName = `infra-test-queue-${crypto.randomUUID()}`;
    const queue = new Queue(queueName, {
      connection: connectionOptions,
    });
    const queueEvents = new QueueEvents(queueName, {
      connection: connectionOptions,
    });

    const workerConnection = redisService.createWorkerConnection();
    assert.equal(workerConnection.options.maxRetriesPerRequest, null);

    const processedPayloads = [];
    const worker = new Worker(
      queueName,
      async (job) => {
        processedPayloads.push(job.data);
        return {
          processed: true,
          echoTaskId: job.data.taskId,
        };
      },
      {
        connection: workerConnection,
      },
    );

    try {
      await queueEvents.waitUntilReady();
      await worker.waitUntilReady();

      const sampleTaskId = crypto.randomUUID();
      const job = await queue.add(
        'sample-task',
        { taskId: sampleTaskId, pipeline: 'motion-control' },
        { jobId: sampleTaskId, removeOnComplete: false, removeOnFail: false },
      );

      const result = await job.waitUntilFinished(queueEvents, 5000);
      assert.deepEqual(result, {
        processed: true,
        echoTaskId: sampleTaskId,
      });
      assert.equal(processedPayloads.length, 1);
      assert.equal(processedPayloads[0].taskId, sampleTaskId);
    } finally {
      await worker.close();
      await queueEvents.close();
      await queue.obliterate({ force: true }).catch(() => {});
      await queue.close();
      workerConnection.disconnect();
      await redisService.onModuleDestroy();
    }
  });
});
