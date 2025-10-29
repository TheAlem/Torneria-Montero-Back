import { logger } from './utils/logger';
import dotenv from 'dotenv';
dotenv.config();

// When running via ts-node/esm import the compiled JS path
import app from './app';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

app.listen(PORT, () => {
  logger.info(`Server listening on http://localhost:${PORT}`);
});
