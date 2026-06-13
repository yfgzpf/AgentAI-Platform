import { describe, it, expect } from 'vitest';
import { SelfModifier, type ModifyRequest, type ModificationProposal } from './self-modify';

describe('SelfModifier', () => {
  const modifier = new SelfModifier({ requireHumanApproval: false });

  const baseCode = `
// MODIFIABLE: worker execution logic
function execute(task: string): string {
  return 'original result';
}
// END_MODIFIABLE

export { execute };
`;

  it('should generate an approved proposal for safe code', async () => {
    const safeCode = `
// MODIFIABLE: worker execution logic
function execute(task: string): string {
  return 'improved result for: ' + task;
}
// END_MODIFIABLE

export { execute };
`;

    const request: ModifyRequest = {
      targetFile: 'workers/test.ts',
      reason: 'Need to add prefix',
      desiredOutcome: 'Return improved result with prefix',
    };

    const proposal = await modifier.generateProposal(request, baseCode, safeCode);
    expect(proposal.id).toBeDefined();
    expect(proposal.status).toBe('approved'); // requireHumanApproval=false
    expect(proposal.securityScan.passed).toBe(true);
    expect(proposal.compileCheck.passed).toBe(true);
    expect(proposal.diff).not.toBe('(no changes)');
  });

  it('should reject proposals with forbidden patterns', async () => {
    const dangerousCode = `
function execute(task: string): string {
  eval('console.log("dangerous")');
  return 'ok';
}
`;

    const request: ModifyRequest = {
      targetFile: 'workers/test.ts',
      reason: 'Add eval',
      desiredOutcome: 'Evaluate arbitrary code',
    };

    const proposal = await modifier.generateProposal(request, baseCode, dangerousCode);
    expect(proposal.status).toBe('rejected');
    expect(proposal.securityScan.violations).toBeDefined();
    expect(proposal.securityScan.violations![0]).toContain('Forbidden pattern');
  });

  it('should reject modifications to forbidden directories', async () => {
    const safeCode = 'function foo() { return 1; }';
    const request: ModifyRequest = {
      targetFile: 'judge/self-eval.ts',
      reason: 'Fix bug',
      desiredOutcome: 'Better scoring',
    };

    const proposal = await modifier.generateProposal(request, baseCode, safeCode);
    expect(proposal.status).toBe('rejected');
  });

  it('should reject modifications that change exports', async () => {
    const modifiedCode = `
// MODIFIABLE: worker execution logic
function execute(task: string): string {
  return 'new result';
}
// END_MODIFIABLE

export { execute, foo };
`;

    const request: ModifyRequest = {
      targetFile: 'workers/test.ts',
      reason: 'Add export',
      desiredOutcome: 'Export new function',
    };

    const proposal = await modifier.generateProposal(request, baseCode, modifiedCode);
    expect(proposal.status).toBe('rejected');
    expect(proposal.securityScan.violations).toBeDefined();
  });

  it('should unmatch braces trigger compile failure', async () => {
    const brokenCode = `
function execute(task: string) {
  return 'oops';
`;

    const request: ModifyRequest = {
      targetFile: 'workers/test.ts',
      reason: 'Fix',
      desiredOutcome: 'Broken',
    };

    const proposal = await modifier.generateProposal(request, baseCode, brokenCode);
    expect(proposal.compileCheck.passed).toBe(false);
  });

  it('should allow approve/reject/rollback states', () => {
    const proposal: ModificationProposal = {
      id: 'test_proposal',
      targetFile: 'workers/test.ts',
      originalCode: '',
      newCode: '',
      diff: '',
      reason: 'test',
      desiredOutcome: 'test',
      compileCheck: { passed: true },
      testCheck: { passed: true },
      securityScan: { passed: true },
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    modifier.approveProposal(proposal);
    expect(proposal.status).toBe('approved');

    modifier.rejectProposal(proposal, 'Not good enough');
    expect(proposal.status).toBe('rejected');

    modifier.rollbackProposal(proposal);
    expect(proposal.status).toBe('rolled_back');
  });
});
