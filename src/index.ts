import express, { Express } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { join } from 'path';
import authRouter from './routes/auth.js';
import transactionsRouter from './routes/transactions.js';
import companiesRouter from './routes/companies.js';
import kpisRouter from './routes/kpis.js';
import reportsRouter from './routes/reports.js';
import settlementRouter from './routes/settlement.route.js';
import settlementWorkflowRouter from './routes/settlement-workflow.js';
import ratesRouter from './routes/rates.js';
import exchangeRatesRouter from './routes/exchange-rates.js';
import usersRouter from './routes/users.js';
import analyticsRouter from './routes/analytics.js';
import { initializeSchema } from './db/schema.js';
import { initDatabase, getDb, queryOne, saveDb } from './db/instance.js';
import { seedUsers } from './db/seed.js';
import setupSocketIO from './socket/handlers.js';

export interface ServerOptions {
  port?: number;
  dbPath?: string;
  corsOrigins?: string[];
  staticDir?: string;  // Path to built frontend files
}

/**
 * Start the Serafa backend server
 * Can be called from Electron main process or run standalone
 */
export async function startServer(options: ServerOptions = {}) {
  // Render & other PaaS platforms inject process.env.PORT
  const port = process.env.PORT || options.port || 3001;
  const defaultOrigins = ['http://localhost:5173', 'http://localhost:3001', 'https://adim-beta.com.ly'];
  if (process.env.CORS_ORIGIN) {
    defaultOrigins.push(process.env.CORS_ORIGIN);
  }
  const corsOrigins = options.corsOrigins || defaultOrigins;

  const app: Express = express();
  const httpServer = createServer(app);

  // Middleware
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
    })
  );
  app.options('*', cors());
  app.use(express.json());

  // Serve static frontend files (for Electron / production)
  if (options.staticDir) {
    app.use(express.static(options.staticDir));
  }

  // Routes
  app.use('/api/auth', authRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/companies', companiesRouter);
  app.use('/api/kpis', kpisRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/settlement', settlementRouter);
  app.use('/api/settlement', settlementWorkflowRouter);
  app.use('/api/rates', ratesRouter);
  app.use('/api/rates', exchangeRatesRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/analytics', analyticsRouter);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', port });
  });

  // SPA fallback: serve index.html for non-API routes (for Electron)
  if (options.staticDir) {
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api/')) {
        res.sendFile(join(options.staticDir!, 'index.html'));
      }
    });
  }

  // Initialize database
  try {
    console.log('Initializing database...');
    await initDatabase(options.dbPath);

    console.log('Initializing schema...');
    initializeSchema();

    // Setup Socket.io with dynamic CORS
    setupSocketIO(httpServer, corsOrigins);

    // Check if database needs seeding
    const existingCount = queryOne('SELECT COUNT(*) as count FROM transactions') as {
      count: number;
    };

    if (!existingCount || existingCount.count === 0) {
      console.log('Database is empty. Please run: npm run seed');
    }

    // Always ensure default users exist on startup
    await seedUsers();
    saveDb();

    // Start server
    return new Promise<{ httpServer: typeof httpServer; app: Express; port: number }>((resolve, reject) => {
      httpServer.listen(port, () => {
        console.log(`Serafa Backend is running on http://localhost:${port}`);
        console.log(`Socket.io connected on http://localhost:${port}`);
        resolve({ httpServer, app, port: Number(port) });
      });
      httpServer.on('error', reject);
    });
  } catch (err) {
    console.error('Failed to initialize:', err);
    throw err;
  }
}

// Auto-start when run directly (not imported by Electron)
const isDirectRun = !process.env.ELECTRON_RUN_AS_NODE && !process.env.SERAFA_EMBEDDED;
if (isDirectRun) {
  startServer().catch(err => {
    console.error('Server startup failed:', err);
    process.exit(1);
  });
}
