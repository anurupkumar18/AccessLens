/**
 * The authoring Step Functions definition (spec §8).
 *
 * This module intentionally returns plain Amazon States Language data. The CDK
 * stack owns Lambda roles, table names, and state-machine deployment; keeping
 * the definition here lets it be tested without deploying or calling AWS.
 * `jobsTableName` is read from execution input by the DynamoDB integration
 * states, so the definition does not bake an environment-specific resource
 * name into source control.
 */
export interface AuthoringLambdaArns {
  ingest: string;
  analyst: string;
  packAuthor: string;
  audio: string;
  /** Visualization stages are optional for callers that inspect the V4 spine. */
  planner?: string;
  route?: string;
  adapter?: string;
  generator?: string;
  critic?: string;
  /** Writes one staged asset and one compact per-slide progress result. */
  recordVisualization?: string;
  publish: string;
}

interface State {
  Type: string;
  [key: string]: unknown;
}

function statusUpdate(status: string, next?: string): State {
  const state: State = {
    Type: 'Task',
    Resource: 'arn:aws:states:::dynamodb:updateItem',
    Parameters: {
      'TableName.$': '$.jobsTableName',
      Key: { jobId: { 'S.$': '$.jobId' } },
      UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status', '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: {
        ':status': { S: status },
        ':updatedAt': { 'S.$': '$$.State.EnteredTime' },
      },
    },
    ResultPath: null,
  };
  if (next) state.Next = next;
  else state.End = true;
  return state;
}

function lambdaTask(resource: string | undefined, next: string, resultPath: string): State {
  return {
    Type: 'Task',
    Resource: resource,
    ResultPath: resultPath,
    Next: next,
  };
}

function catchToFailed(state: State): State {
  return {
    ...state,
    Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: '$.stageError', Next: 'MarkFailed' }],
  };
}

/**
 * Build the Standard authoring workflow. The per-slide Map keeps the existing
 * Pack Author -> Audio spine and then runs Planner -> Route -> candidate ->
 * Critic. Every candidate returns through the same critic gate on repair, and
 * only the record state writes a draft asset for review.
 */
export function authoringStateMachine(arns: AuthoringLambdaArns): object {
  const perSlideStates: Record<string, State> = {
    PackAuthor: {
      ...lambdaTask(arns.packAuthor, 'Audio', '$.packAuthor'),
      Parameters: {
        'jobId.$': '$.jobId',
        'packId.$': '$.packId',
        'assetId.$': '$.assetId',
        'slideNumber.$': '$.page',
        'mediaKey.$': '$.mediaKey',
        'fingerprint.$': '$.fingerprint',
        'extractedText.$': '$.extractedText',
        'lesson.$': '$.lesson',
        'excerpts.$': '$.excerpts',
        'bucket.$': '$.bucket',
      },
    },
    Audio: {
      ...lambdaTask(arns.audio, 'VisualizationStagesPassThrough', '$.audio'),
      Parameters: {
        'jobId.$': '$.jobId',
        'packId.$': '$.packId',
        'asset.$': '$.packAuthor.asset',
        'bucket.$': '$.bucket',
      },
    },
    // This named state was the V4 extension point. Keep it in the execution
    // history while making its successor the first real visualization stage.
    VisualizationStagesPassThrough: {
      Type: 'Pass',
      ResultPath: '$.visualizationSpine',
      Next: 'SlideComplete',
    },
    // Historical name retained for old execution histories and definition
    // tests. It is now a no-op transition into Planner, not a terminal state.
    SlideComplete: {
      Type: 'Pass',
      ResultPath: null,
      Next: 'Planner',
    },
    Planner: {
      ...lambdaTask(arns.planner, 'Route', '$.planner'),
      Parameters: {
        'jobId.$': '$.jobId',
        'slideId.$': '$.assetId',
        'slideText.$': '$.extractedText',
        'slideImageKey.$': '$.mediaKey',
        'lesson.$': '$.lesson',
        'regions.$': '$.audio.asset.regions',
        'instructorHint.$': '$.instructorHint',
        'excerpts.$': '$.excerpts',
        'bucket.$': '$.bucket',
      },
    },
    Route: {
      ...lambdaTask(arns.route, 'VisualizationRoute', '$.route'),
      Parameters: {
        'jobId.$': '$.jobId',
        'slideId.$': '$.assetId',
        'plan.$': '$.planner.plan',
        'parameters.$': '$.parameters',
        'bucket.$': '$.bucket',
        'catalogBucket.$': '$.catalogBucket',
      },
    },
    VisualizationRoute: {
      Type: 'Choice',
      Choices: [
        { Variable: '$.route.decision', StringEquals: 'none', Next: 'RecordNoVisualization' },
        { Variable: '$.route.decision', StringEquals: 'retrieve', Next: 'MaterializeCatalogArtifact' },
        { Variable: '$.route.decision', StringEquals: 'adapt', Next: 'Adapter' },
        { Variable: '$.route.decision', StringEquals: 'generate', Next: 'Generator' },
      ],
      Default: 'RecordNoVisualization',
    },
    // Retrieved artifacts are materialized into the job staging prefix and
    // still pass through Critic; retrieval is never a review bypass.
    MaterializeCatalogArtifact: {
      ...lambdaTask(arns.route, 'Critic', '$.candidate'),
      Parameters: {
        operation: 'materialize',
        'jobId.$': '$.jobId',
        'slideId.$': '$.assetId',
        'parent.$': '$.route.parent',
        'bucket.$': '$.bucket',
        'catalogBucket.$': '$.catalogBucket',
      },
    },
    Adapter: {
      ...lambdaTask(arns.adapter, 'Critic', '$.candidate'),
      Parameters: {
        'jobId.$': '$.jobId',
        'slideId.$': '$.assetId',
        'parent.$': '$.route.parent',
        'plan.$': '$.planner.plan',
        'excerpts.$': '$.excerpts',
        'repairProblems.$': '$.repairState.repairProblems',
        'bucket.$': '$.bucket',
        'catalogBucket.$': '$.catalogBucket',
      },
      // Adapter validation failure is the specified fall-through to Generator.
      Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: '$.adapterError', Next: 'Generator' }],
    },
    Generator: {
      ...lambdaTask(arns.generator, 'Critic', '$.candidate'),
      Parameters: {
        'jobId.$': '$.jobId',
        'slideId.$': '$.assetId',
        'plan.$': '$.planner.plan',
        'excerpts.$': '$.excerpts',
        'repairProblems.$': '$.repairState.repairProblems',
        'bucket.$': '$.bucket',
      },
      Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: '$.generatorError', Next: 'RecordNoVisualization' }],
    },
    Critic: {
      ...lambdaTask(arns.critic, 'CriticOutcome', '$.critic'),
      Parameters: {
        'jobId.$': '$.jobId',
        'slideId.$': '$.assetId',
        'plan.$': '$.planner.plan',
        'candidate.$': '$.candidate',
        'slideText.$': '$.extractedText',
        'slideTitle.$': '$.audio.asset.title',
        'slideDescription.$': '$.audio.asset.regions[0].shortDescription',
        'lessonContext.$': '$.lesson.summary',
        'excerpts.$': '$.excerpts',
        'bucket.$': '$.bucket',
      },
      Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: '$.criticError', Next: 'RecordNoVisualization' }],
    },
    CriticOutcome: {
      Type: 'Choice',
      Choices: [
        { Variable: '$.critic.status', StringEquals: 'ready', Next: 'RecordVisualization' },
        { Variable: '$.critic.status', StringEquals: 'repair', Next: 'RepairBudget' },
      ],
      Default: 'RecordNoVisualization',
    },
    RepairBudget: {
      Type: 'Choice',
      Choices: [
        { Variable: '$.repairState.repairCount', NumericGreaterThanEquals: 2, Next: 'RecordNoVisualization' },
        { Variable: '$.route.decision', StringEquals: 'adapt', Next: 'PrepareAdapterRepair' },
      ],
      Default: 'PrepareGeneratorRepair',
    },
    // A repair is an explicit ASL turn. The next candidate always returns to
    // Critic, and the initialized counter permits at most two repair turns.
    PrepareAdapterRepair: {
      Type: 'Pass',
      Parameters: {
        'repairCount.$': 'States.MathAdd($.repairState.repairCount, 1)',
        'repairProblems.$': '$.critic.problems',
      },
      ResultPath: '$.repairState',
      Next: 'Adapter',
    },
    PrepareGeneratorRepair: {
      Type: 'Pass',
      Parameters: {
        'repairCount.$': 'States.MathAdd($.repairState.repairCount, 1)',
        'repairProblems.$': '$.critic.problems',
      },
      ResultPath: '$.repairState',
      Next: 'Generator',
    },
    RecordVisualization: {
      ...lambdaTask(arns.recordVisualization, 'FinishSlide', '$.visualization'),
      Parameters: {
        'jobId.$': '$.jobId',
        'assetId.$': '$.assetId',
        'asset.$': '$.audio.asset',
        'packAuthorStatus.$': '$.packAuthor.status',
        'candidate.$': '$.candidate',
        'critic.$': '$.critic',
        'bucket.$': '$.bucket',
        status: 'ready',
      },
    },
    RecordNoVisualization: {
      ...lambdaTask(arns.recordVisualization, 'FinishSlide', '$.visualization'),
      Parameters: {
        'jobId.$': '$.jobId',
        'assetId.$': '$.assetId',
        'asset.$': '$.audio.asset',
        'packAuthorStatus.$': '$.packAuthor.status',
        'bucket.$': '$.bucket',
        status: 'no-visual',
        reason: 'No harness-verified visualization was produced.',
      },
    },
    FinishSlide: {
      Type: 'Pass',
      Parameters: {
        'assetId.$': '$.assetId',
        'descriptionStatus.$': '$.packAuthor.status',
        'visualizationStatus.$': '$.visualization.status',
      },
      End: true,
    },
  };

  const states: Record<string, State> = {
    MarkIngesting: statusUpdate('ingesting', 'Ingest'),
    Ingest: catchToFailed(lambdaTask(arns.ingest, 'MarkDescribing', '$.deck')),
    MarkDescribing: statusUpdate('describing', 'Analyst'),
    Analyst: catchToFailed(lambdaTask(arns.analyst, 'AnalystOutcome', '$.analyst')),
    AnalystOutcome: {
      Type: 'Choice',
      Choices: [{ Variable: '$.analyst.status', StringEquals: 'needs_input', Next: 'MarkNeedsInput' }],
      Default: 'MarkVisualizing',
    },
    MarkNeedsInput: statusUpdate('needs_input'),
    MarkVisualizing: statusUpdate('visualizing', 'SlideMap'),
    SlideMap: {
      Type: 'Map',
      ItemsPath: '$.deck.slides',
      MaxConcurrency: 5,
      ItemSelector: {
        'jobId.$': '$.jobId',
        'packId.$': '$.packId',
        'bucket.$': '$.bucket',
        'catalogBucket.$': '$.catalogBucket',
        'lesson.$': '$.analyst.lesson',
        'excerpts.$': '$.excerpts',
        'instructorHint.$': '$.instructorHint',
        'parameters.$': '$.parameters',
        'assetId.$': '$$.Map.Item.Value.assetId',
        'page.$': '$$.Map.Item.Value.page',
        'mediaKey.$': '$$.Map.Item.Value.mediaKey',
        'fingerprint.$': '$$.Map.Item.Value.fingerprint',
        'extractedText.$': '$$.Map.Item.Value.extractedText',
        repairState: { repairCount: 0 },
      },
      ItemProcessor: {
        ProcessorConfig: { Mode: 'INLINE' },
        StartAt: 'PackAuthor',
        States: perSlideStates,
      },
      ResultPath: '$.slides',
      Next: 'MarkReview',
    },
    MarkReview: statusUpdate('review', 'WaitForInstructor'),
    // Review is an API action, so the Standard execution waits by polling the
    // job record. The route changes the status to publishing; no client token
    // or student value enters the workflow.
    WaitForInstructor: {
      Type: 'Wait',
      Seconds: 3,
      Next: 'CheckReview',
    },
    CheckReview: {
      Type: 'Task',
      Resource: 'arn:aws:states:::dynamodb:getItem',
      Parameters: {
        'TableName.$': '$.jobsTableName',
        Key: { jobId: { 'S.$': '$.jobId' } },
        ProjectionExpression: '#status',
        ExpressionAttributeNames: { '#status': 'status' },
      },
      ResultPath: '$.reviewRecord',
      Next: 'ReviewOutcome',
    },
    ReviewOutcome: {
      Type: 'Choice',
      Choices: [
        { Variable: '$.reviewRecord.Item.status.S', StringEquals: 'publishing', Next: 'MarkPublishing' },
        // The HTTP publish route may complete deterministic publication before
        // this poll observes `publishing`; that is still a successful workflow.
        { Variable: '$.reviewRecord.Item.status.S', StringEquals: 'published', Next: 'WorkflowComplete' },
      ],
      Default: 'WaitForInstructor',
    },
    MarkPublishing: statusUpdate('publishing', 'Publish'),
    Publish: catchToFailed(lambdaTask(arns.publish, 'WorkflowComplete', '$.publish')),
    WorkflowComplete: { Type: 'Succeed' },
    MarkFailed: statusUpdate('failed'),
  };

  return {
    Comment: 'AccessLens authoring pipeline: ingest, analyst, per-slide description/audio, visualization, review, publish',
    StartAt: 'MarkIngesting',
    States: states,
  };
}
