#!/usr/bin/env node
import { startDefault } from './index.js';
startDefault().catch((e) => {
  console.error(e);
  process.exit(1);
});
