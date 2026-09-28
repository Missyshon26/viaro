import dns from 'node:dns';
import mongoose from 'mongoose';
import { env, isProduction } from './env';
import { logger } from '../utils/logger';

mongoose.set('strictQuery', true);

if (!isProduction) {
  mongoose.set('debug', false); // flip to true when you need query tracing locally
}

export async function connectMongo(): Promise<typeof mongoose> {
  mongoose.connection.on('connected', () => logger.info('Mongo connected'));
  mongoose.connection.on('disconnected', () => logger.warn('Mongo disconnected'));
  mongoose.connection.on('error', (err: Error) => logger.error('Mongo error', err));

  try {
    await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
  } catch (err) {
    /*
     * A mongodb+srv:// URI needs a DNS SRV lookup, and on some Windows machines Node
     * sends it to a resolver (the router, a VPN adapter, an IPv6 link-local address)
     * that refuses SRV queries — `querySrv ECONNREFUSED` — even though the browser and
     * nslookup resolve the same name fine. Locally, retry once through public resolvers
     * rather than making every developer rewrite their connection string.
     */
    const code = (err as NodeJS.ErrnoException)?.code;
    const isSrvFailure =
      (err as NodeJS.ErrnoException)?.syscall === 'querySrv' &&
      (code === 'ECONNREFUSED' || code === 'ETIMEOUT' || code === 'ESERVFAIL');
    if (isProduction || !isSrvFailure) throw err;

    logger.warn('Mongo SRV lookup refused by the system resolver; retrying via 1.1.1.1 / 8.8.8.8');
    dns.setServers(['1.1.1.1', '8.8.8.8']);
    await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
  }

  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.connection.close();
}

export { mongoose };
