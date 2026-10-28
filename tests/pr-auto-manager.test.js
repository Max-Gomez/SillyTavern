import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';
import { parse } from 'yaml';

const workflowPath = join(dirname(fileURLToPath(import.meta.url)), '../.github/workflows/pr-auto-manager.yml');

describe('check-merge-blocking-labels', () => {
    test('grants only the checks permission its script uses', () => {
        const workflow = parse(readFileSync(workflowPath, 'utf8'));
        const job = workflow.jobs['check-merge-blocking-labels'];
        const script = job.steps.find(step => step.id === 'label-check').with.script;

        const restCalls = [...script.matchAll(/github\.rest\.([a-z]+)\.([a-zA-Z]+)/g)]
            .map(match => `${match[1]}.${match[2]}`);

        // The inline script only creates a check run. A job-level permissions block
        // replaces the workflow grant, so any other scope here is unused.
        expect(restCalls).toEqual(['checks.create']);
        expect(job.permissions).toEqual({ checks: 'write' });
    });
});
