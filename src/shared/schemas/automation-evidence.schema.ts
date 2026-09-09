import { z } from 'zod';
import { AutomationTerminalCodeEnum, RolloutStageSchema } from './automation.schema';

const WorkerAliasSchema = z.string().regex(/^worker-[1-9]\d*$/);
const SessionAliasSchema = z.string().regex(/^worker-[1-9]\d*-session-[1-9]\d*$/);
const AccountAliasSchema = z.string().regex(/^account-[1-9]\d*$/);
export const EvidenceTaskKeySchema = z.enum([
  'capcut_web_newbie_register', 'capcut_web_pwa_install', 'capcut_web_push_authorize',
  'capcut_web_design_studio_picture_creation', 'capcut_web_design_studio_ai_chat',
  'capcut_web_design_studio_upload_img', 'capcut_web_design_studio_canvas_edit',
  'capcut_web_inspiration_generate_done', 'capcut_web_video_studio_creation',
  'capcut_web_video_studio_send_msg', 'capcut_web_video_studio_generate_done', 'capcut_web_video_studio_export'
]);
export const UiEvidenceLabelSchema = z.enum([
  'ui-action', 'launch', 'auth', 'trial', 'overlay', 'popover', 'claim',
  'design-studio', 'video-studio', 'pwa-install', 'notifications', 'renderer-health', 'canvas-area'
]);
export type UiEvidenceLabel = z.infer<typeof UiEvidenceLabelSchema>;

/** Map operational strings to fixed public categories; never forward a raw label. */
export function toUiEvidenceLabel(label: string): UiEvidenceLabel {
  if (/^(launch|window|attach)/i.test(label)) return 'launch';
  if (/^(auth|login|signup)/i.test(label)) return 'auth';
  if (/^trial/i.test(label)) return 'trial';
  if (/^overlay/i.test(label)) return 'overlay';
  if (/^(popover:claim|claim)/i.test(label)) return 'claim';
  if (/^(popover|task-popover)/i.test(label)) return 'popover';
  if (/^(design|mission:design)/i.test(label)) return 'design-studio';
  if (/^(video|mission:video)/i.test(label)) return 'video-studio';
  if (/^(pwa|mission:pwa)/i.test(label)) return 'pwa-install';
  if (/^(notification|mission:notification)/i.test(label)) return 'notifications';
  if (/^(health|renderer)/i.test(label)) return 'renderer-health';
  if (/^canvas/i.test(label)) return 'canvas-area';
  return 'ui-action';
}

export const EvidenceBaseSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().uuid().or(z.string().regex(/^run-[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/)),
  at: z.string().datetime(),
  workerAlias: WorkerAliasSchema.optional(),
  sessionAlias: SessionAliasSchema.optional(),
  accountAlias: AccountAliasSchema.optional()
}).strict();

export type EvidenceBase = z.infer<typeof EvidenceBaseSchema>;

export const RunStartEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('run-start'),
  mode: z.enum(['new', 'resume', 'health']),
  headed: z.literal(true),
  stage: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(10)]).nullable(),
  workerTarget: z.number().int().min(0),
  maxBillablePurchases: z.number().int().min(0),
  uiScope: z.enum(['run-native', 'session-target']).optional()
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

export const ProfileStartEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('profile-start'), workerAlias: WorkerAliasSchema, sessionAlias: SessionAliasSchema
}).strict();

export const AccountTerminalEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('account-terminal'), workerAlias: WorkerAliasSchema, accountAlias: AccountAliasSchema,
  outcome: z.enum(['completed', 'failed', 'stopped', 'skipped'])
}).strict();

export const MailboxAcquiredEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('mailbox-acquired'), workerAlias: WorkerAliasSchema, accountAlias: AccountAliasSchema
}).strict();

export const UiQueuedEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('ui-queued'),
  lane: z.enum(['foreground', 'editor']),
  label: UiEvidenceLabelSchema
}).strict();

export const UiStartedEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('ui-started'),
  lane: z.enum(['foreground', 'editor']),
  label: UiEvidenceLabelSchema,
  waitMs: z.number().int().min(0)
}).strict();

export const UiFinishedEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('ui-finished'),
  lane: z.enum(['foreground', 'editor']),
  label: UiEvidenceLabelSchema,
  holdMs: z.number().int().min(0),
  outcome: z.enum(['resolved', 'rejected']).optional()
}).strict();

export const UiQuarantinedEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('ui-quarantined'),
  label: UiEvidenceLabelSchema,
  code: z.enum(['DOM_READ_TIMEOUT', 'ACTIVE_ABORT'])
}).strict();

export const UiLateSettledEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('ui-late-settled'),
  label: UiEvidenceLabelSchema,
  outcome: z.enum(['resolved', 'rejected'])
}).strict();

export const SchedulerShutdownEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('scheduler-shutdown'),
  code: z.enum(['RESOURCE_CLEANUP_FAILED', 'RUN_ABORTED'])
}).strict();

export const TaskCheckpointItemSchema = z.object({
  key: EvidenceTaskKeySchema,
  status: z.number().int().min(0),
  errNo: z.number().int().optional()
}).strict();

export const TaskCheckpointEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('task-checkpoint'),
  workerAlias: WorkerAliasSchema,
  sessionAlias: SessionAliasSchema,
  accountAlias: AccountAliasSchema,
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
  workerAlias: WorkerAliasSchema,
  sessionAlias: SessionAliasSchema,
  outcome: z.enum(['confirmed', 'failed']),
  code: z.literal('RESOURCE_CLEANUP_FAILED').optional()
}).strict();

export const TerminalEventSchema = EvidenceBaseSchema.extend({
  type: z.literal('terminal'),
  mode: z.enum(['new', 'resume', 'health']),
  stage: RolloutStageSchema.nullable(),
  mailboxAcquisitions: z.number().int().min(0),
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
  ProfileStartEventSchema,
  AccountTerminalEventSchema,
  MailboxAcquiredEventSchema,
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
export type AutomationEvidenceNonTerminalEvent = Exclude<AutomationEvidenceEvent, { type: 'terminal' }>;
