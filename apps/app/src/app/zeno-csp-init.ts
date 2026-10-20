import { z } from 'zod';

// This must run before application schemas, including lazy personal pages.
z.config({ jitless: true });
