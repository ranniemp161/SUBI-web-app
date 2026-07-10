import { describe, it, expect } from 'vitest';
import {
  transcriptStatusEnum,
  users,
  projects,
  aiCutRuns,
  creditLedgerReasonEnum,
  creditLedger,
} from './schema';

describe('Database Schema', () => {
  describe('Enums', () => {
    it('defines transcriptStatusEnum with correct values', () => {
      expect(transcriptStatusEnum.enumValues).toEqual([
        'idle',
        'processing',
        'ready',
        'failed',
      ]);
    });

    it('defines creditLedgerReasonEnum with correct values', () => {
      expect(creditLedgerReasonEnum.enumValues).toEqual([
        'purchase',
        'transcription',
        'refund',
        'grant',
        'ai_cut',
        'conversion',
        'auto_recharge',
      ]);
    });
  });

  describe('Tables', () => {
    it('defines users table with expected columns', () => {
      expect(users).toBeDefined();
      expect(users.id).toBeDefined();
      expect(users.clerkId).toBeDefined();
      expect(users.email).toBeDefined();
      expect(users.balanceMicros).toBeDefined();
      expect(users.isMember).toBeDefined();
      expect(users.stripeCustomerId).toBeDefined();
      expect(users.defaultPaymentMethodId).toBeDefined();
      expect(users.autorechargeEnabled).toBeDefined();
      expect(users.autorechargeThresholdMicros).toBeDefined();
      expect(users.autorechargeAmountMicros).toBeDefined();
      expect(users.autorechargeFailures).toBeDefined();
      expect(users.createdAt).toBeDefined();
    });

    it('defines projects table with expected columns', () => {
      expect(projects).toBeDefined();
      expect(projects.id).toBeDefined();
      expect(projects.userId).toBeDefined();
      expect(projects.fileName).toBeDefined();
      expect(projects.fileSize).toBeDefined();
      expect(projects.fileType).toBeDefined();
      expect(projects.durationMs).toBeDefined();
      expect(projects.transcript).toBeDefined();
      expect(projects.transcriptStatus).toBeDefined();
      expect(projects.transcriptCallbackToken).toBeDefined();
      expect(projects.holdMicros).toBeDefined();
      expect(projects.edl).toBeDefined();
      expect(projects.activeAiCutRunId).toBeDefined();
      expect(projects.aiCutClaimAt).toBeDefined();
      expect(projects.createdAt).toBeDefined();
      expect(projects.updatedAt).toBeDefined();
    });

    it('defines aiCutRuns table with expected columns', () => {
      expect(aiCutRuns).toBeDefined();
      expect(aiCutRuns.id).toBeDefined();
      expect(aiCutRuns.projectId).toBeDefined();
      expect(aiCutRuns.runNumber).toBeDefined();
      expect(aiCutRuns.name).toBeDefined();
      expect(aiCutRuns.ranges).toBeDefined();
      expect(aiCutRuns.model).toBeDefined();
      expect(aiCutRuns.createdAt).toBeDefined();
    });

    it('defines creditLedger table with expected columns', () => {
      expect(creditLedger).toBeDefined();
      expect(creditLedger.id).toBeDefined();
      expect(creditLedger.userId).toBeDefined();
      expect(creditLedger.deltaMicros).toBeDefined();
      expect(creditLedger.reason).toBeDefined();
      expect(creditLedger.projectId).toBeDefined();
      expect(creditLedger.stripeEventId).toBeDefined();
      expect(creditLedger.monthKey).toBeDefined();
      expect(creditLedger.costMicros).toBeDefined();
      expect(creditLedger.createdAt).toBeDefined();
    });
  });
});
