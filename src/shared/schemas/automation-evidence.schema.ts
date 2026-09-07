import { z } from 'zod';
import { AutomationTerminalCodeEnum } from './automation.schema';

export const EvidenceBaseSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().uuid().or(z.string().regex(/^run-/)),
  at: z.string().datetime(),
  workerAlias: z.string().regex(/^worker-\d+$/).optional(),
  sessionAlias: z.string().regex(/^worker-\d+-session-\d+$/).optional()
}).strict();

export type EvidenceBase = z.infer<typeof EvidenceBaseSchema>;

export const RunStartEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('run-start'),
  mode: z.enum(['new', 'resume', 'health']),
  headed: z.literal(true),
  stage: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(10)]).nullable(),
  workerTarget: z.number().int().min(0),
  maxBillablePurchases: z.number().int().min(0)
}).strict();

export const StageEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('stage'),
  name: z.enum(['acquire', 'launch', 'auth', 'mission', 'checkpoint', 'cleanup']),
  state: z.enum(['start', 'end'])
}).strict();

export const ResourceSnapshotEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('resource-snapshot'),
  activeWorkers: z.number().int().min(0),
  activeProfiles: z.number().int().min(0),
  activeProxies: z.number().int().min(0),
  activeMailReservations: z.number().int().min(0)
}).strict();

export const PurchaseEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('purchase'),
  provider: z.enum(['gmail94', 'dongvanfb']),
  outcome: z.enum(['attempted', 'confirmed', 'ambiguous']),
  attempted: z.number().int().min(0),
  confirmed: z.number().int().min(0),
  ambiguous: z.number().int().min(0),
  budget: z.number().int().min(0)
}).strict();

export const HealthSummaryEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('health-summary'),
  attempted: z.number().int().min(0),
  healthy: z.number().int().min(0),
  stopped: z.number().int().min(0),
  cleanupFailures: z.number().int().min(0)
}).strict();

export const UiQueuedEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('ui-queued'),
  lane: z.enum(['foreground', 'editor']),
  label: z.string().min(1)
}).strict();

export const UiStartedEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('ui-started'),
  lane: z.enum(['foreground', 'editor']),
  label: z.string().min(1),
  waitMs: z.number().int().min(0)
}).strict();

export const UiFinishedEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('ui-finished'),
  lane: z.enum(['foreground', 'editor']),
  label: z.string().min(1),
  holdMs: z.number().int().min(0)
}).strict();

export const UiQuarantinedEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('ui-quarantined'),
  label: z.string().min(1),
  code: z.enum(['DOM_READ_TIMEOUT', 'ACTIVE_ABORT'])
}).strict();

export const UiLateSettledEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('ui-late-settled'),
  label: z.string().min(1),
  outcome: z.enum(['resolved', 'rejected'])
}).strict();

export const SchedulerShutdownEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('scheduler-shutdown'),
  code: z.enum(['RESOURCE_CLEANUP_FAILED', 'RUN_ABORTED'])
}).strict();

export const TaskCheckpointItemSchema = z.object({
  key: z.string().min(1),
  status: z.number().int().min(0),
  errNo: z.number().int().optional()
}).strict();

export const TaskCheckpointEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('task-checkpoint'),
  fresh: z.boolean(),
  final: z.boolean(),
  observedAt: z.string().datetime(),
  requiredAfter: z.string().datetime(),
  serverTotal: z.number().int().min(0),
  serverDone: z.number().int().min(0),
  tasks: z.array(TaskCheckpointItemSchema)
}).strict();

export const PersistenceFailureEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('persistence-failure'),
  code: z.literal('TASK_CHECKPOINT_PERSISTENCE_FAILED')
}).strict();

export const ProfileStopEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('profile-stop'),
  outcome: z.enum(['confirmed', 'failed']),
  code: z.literal('RESOURCE_CLEANUP_FAILED').optional()
}).strict();

export const TerminalEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('terminal'),
  state: z.enum(['completed', 'failed', 'stopped', 'blocked']),
  code: AutomationTerminalCodeEnum,
  accepted: z.number().int().min(0),
  completed: z.number().int().min(0),
  failed: z.number().int().min(0),
  stopped: z.number().int().min(0),
  skipped: z.number().int().min(0),
  cleanupFailures: z.number().int().min(0),
  purchaseAttempted: z.number().int().min(0),
  purchaseConfirmed: z.number().int().min(0),
  purchaseAmbiguous: z.number().int().min(0)
}).strict();

export type AutomationEvidenceTerminalEvent = z.infer<typeof TerminalEventSchema>;

export const AutomationEvidenceEventDiscriminatedSchema = z.discriminatedUnion('type', [
  RunStartEventSchema,
  StageEventSchema,
  ResourceSnapshotEventSchema,
  PurchaseEventSchema,
  HealthSummaryEventSchema,
  UiQueuedEventSchema,
  UiStartedEventSchema,
  UiFinishedEventSchema,
  UiQuarantinedEventSchema,
  UiLateSettledEventSchema,
  SchedulerShutdownEventSchema,
  TaskCheckpointEventSchema,
  PersistenceFailureEventSchema,
  ProfileStopEventSchema,
  TerminalEventSchema
]);

export const AutomationEvidenceEventSchema = AutomationEvidenceEventDiscriminatedSchema.superRefine(
  (event, ctx) => {
    if (event.type === 'purchase') {
      if (event.confirmed + event.ambiguous > event.attempted) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'confirmed + ambiguous cannot exceed attempted'
        });
      }
      if (event.attempted > event.budget) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'attempted cannot exceed budget'
        });
      }
    } else if (event.type === 'task-checkpoint') {
      const seen = new Set<string>();
      for (const task of event.tasks) {
        if (seen.has(task.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate task key in checkpoint: ${task.key}`
          });
          break;
        }
        seen.add(task.key);
      }
    }
  }
);

export type AutomationEvidenceEvent = z.infer<typeof AutomationEvidenceEventSchema>;
