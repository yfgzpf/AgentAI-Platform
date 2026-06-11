import { describe, it } from 'vitest';
import { normalizePath, globToRegex, matchAny, defaultRules } from './rules.js';

describe('debug', () => {
    it('traces **/.env*', () => {
        const p = process.cwd() + '/.env.production';
        const norm = normalizePath(p);
        const re = globToRegex('**/.env*');
        // eslint-disable-next-line no-console
        console.log('orig:', p);
        // eslint-disable-next-line no-console
        console.log('norm:', norm);
        // eslint-disable-next-line no-console
        console.log('regex:', re);
        // eslint-disable-next-line no-console
        console.log('match direct:', re.test(norm));
        // eslint-disable-next-line no-console
        console.log('matchAny:', matchAny(norm, ['**/.env*']));
        // eslint-disable-next-line no-console
        console.log('defaultRules.allow first 3:', defaultRules().allow.slice(0, 3));
    });
});

