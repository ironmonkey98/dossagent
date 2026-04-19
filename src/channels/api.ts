import { ApiChannel } from '../api-server.js';
import { registerChannel } from './registry.js';

registerChannel('api', (opts) => new ApiChannel(opts));
