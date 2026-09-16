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
  /** Course-library retrieval (spec section 9.4); without it no retrieval state is emitted. */
  retrieve?: string;
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
  // The visualization stages (spec section 8, stages 5 to 8) are wired only
  // when every Lambda they need exists. A definition that names a Task with
  // an undefined Resource is not a state machine, and a first deploy of the
  // V3/V4 spine is a legitimate, spec-legal pipeline on its own.
  const withVisualization = Boolean(
    arns.planner && arns.route && arns.adapter && arns.generator && arns.critic && arns.recordVisualization,
  );

  const withRetrieval = Boolean(arns.retrieve);

  const perSlideStates: Record<string, State> = {
    // Spec section 9.4: the Pack Author gets up to four course-library
    // excerpts for the slide's own text. A job without a profile keeps the
    // deck-level excerpts (empty when there is no library at all).
    ...(withRetrieval
      ? {
          SlideRetrieval: {
            Type: 'Choice',
            Choices: [{ Variable: '$.profileId', IsNull: false, Next: 'RetrieveForSlide' }],
            Default: 'PackAuthor',
          },
          RetrieveForSlide: {
            ...lambdaTask(arns.retrieve, 'ApplySlideExcerpts', '$.slideRetrieval'),
            Parameters: {
              'profileId.$': '$.profileId',
              'query.$': '$.extractedText',
              k: 4,
            },
            Retry: [{ ErrorEquals: ['States.ALL'], IntervalSeconds: 2, MaxAttempts: 2, BackoffRate: 2 }],
          },
          ApplySlideExcerpts: {
            Type: 'Pass',
            InputPath: '$.slideRetrieval.excerpts',
            ResultPath: '$.excerpts',
            Next: 'PackAuthor',
          },
        }
      : {}),
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
      // With the stages wired this leads into them; without, it is the named
      // extension point the V4 spine always had, and the slide is finished.
      Next: withVisualization ? 'SlideComplete' : 'FinishSlide',
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
        ...(withVisualization
          ? { 'visualizationStatus.$': '$.visualization.status' }
          // With no visualization stages deployed every slide is a clean
          // no-visual (spec section 8 fail behaviour, hard rule 5 intact):
          // nothing unrendered can reach the instructor because nothing
          // is produced at all.
          : { visualizationStatus: 'no-visual' }),
      },
      Next: 'RecordSlideProgress',
    },
    // The review and publish routes read the job record's `slides` to know
    // which assets exist (the fifth real job's review answered "unknown
    // asset slide-01" because nothing ever wrote them). Each slide appends
    // its own progress row; list_append is atomic per update, so the Map's
    // concurrency of five cannot lose rows. The Pass output above stays the
    // Map item's result because this task's ResultPath is null.
    RecordSlideProgress: {
      Type: 'Task',
      Resource: 'arn:aws:states:::dynamodb:updateItem',
      Parameters: {
        'TableName.$': '$$.Execution.Input.jobsTableName',
        Key: { jobId: { 'S.$': '$$.Execution.Input.jobId' } },
        UpdateExpression: 'SET #slides = list_append(if_not_exists(#slides, :empty), :slide), #updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#slides': 'slides', '#updatedAt': 'updatedAt' },
        ExpressionAttributeValues: {
          ':empty': { L: [] },
          ':slide': { L: [{ M: {
            assetId: { 'S.$': '$.assetId' },
            stage: { S: withVisualization ? 'done' : 'audio' },
            status: { S: withVisualization ? 'needs_review' : 'no_visual' },
          } }] },
          ':updatedAt': { 'S.$': '$$.State.EnteredTime' },
        },
      },
      ResultPath: null,
      End: true,
    },
  };
  if (!withVisualization) {
    for (const name of ['SlideComplete', 'Planner', 'Route', 'VisualizationRoute', 'MaterializeCatalogArtifact', 'Adapter', 'Generator', 'Critic', 'CriticOutcome', 'RepairBudget', 'PrepareAdapterRepair', 'PrepareGeneratorRepair', 'RecordVisualization', 'RecordNoVisualization']) delete perSlideStates[name];
  }

  const states: Record<string, State> = {
    MarkIngesting: statusUpdate('ingesting', 'Ingest'),
    Ingest: catchToFailed(lambdaTask(arns.ingest, withRetrieval ? 'DeckRetrieval' : 'MarkDescribing', '$.deck')),
    // Spec section 9.4: the Deck Analyst gets up to eight excerpts for the
    // deck's text in three windows. createJob always sends profileId (null
    // when the job has no course profile), so the Choice never sees a
    // missing path.
    ...(withRetrieval
      ? {
          DeckRetrieval: {
            Type: 'Choice',
            Choices: [{ Variable: '$.profileId', IsNull: false, Next: 'RetrieveForDeck' }],
            Default: 'MarkDescribing',
          },
          RetrieveForDeck: catchToFailed({
            ...lambdaTask(arns.retrieve, 'ApplyDeckExcerpts', '$.deckRetrieval'),
            Parameters: {
              'profileId.$': '$.profileId',
              'slides.$': '$.deck.slides',
              k: 8,
            },
            Retry: [{ ErrorEquals: ['States.ALL'], IntervalSeconds: 2, MaxAttempts: 2, BackoffRate: 2 }],
          }),
          ApplyDeckExcerpts: {
            Type: 'Pass',
            InputPath: '$.deckRetrieval.excerpts',
            ResultPath: '$.excerpts',
            Next: 'MarkDescribing',
          },
        }
      : {}),
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
        'lesson.$': '$.analyst.lesson',
        'excerpts.$': '$.excerpts',
        ...(withRetrieval ? { 'profileId.$': '$.profileId' } : {}),
        'assetId.$': '$$.Map.Item.Value.assetId',
        'page.$': '$$.Map.Item.Value.page',
        'mediaKey.$': '$$.Map.Item.Value.mediaKey',
        'fingerprint.$': '$$.Map.Item.Value.fingerprint',
        'extractedText.$': '$$.Map.Item.Value.extractedText',
        // A JSONPath in an ItemSelector that finds nothing fails the whole
        // Map -- the third real job died exactly there on $.instructorHint.
        // The fields only the visualization branch reads are selected only
        // when that branch is wired, and createJob always sends them.
        ...(withVisualization
          ? {
              'catalogBucket.$': '$.catalogBucket',
              'instructorHint.$': '$.instructorHint',
              'parameters.$': '$.parameters',
              repairState: { repairCount: 0 },
            }
          : {}),
      },
      ItemProcessor: {
        ProcessorConfig: { Mode: 'INLINE' },
        StartAt: withRetrieval ? 'SlideRetrieval' : 'PackAuthor',
        States: perSlideStates,
      },
      ResultPath: '$.slides',
      Next: 'MarkReview',
      // Without this a failed slide leaves the job stuck at "visualizing"
      // forever while the execution reads FAILED; the record must say so.
      Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: '$.stageError', Next: 'MarkFailed' }],
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
      // The HTTP publish route is the only publisher: it checks every asset
      // was reviewed (hard rule 2), writes packs/, media/ and artifacts/, and
      // flips the record to published. The workflow only observes that, so
      // there is exactly one writer of published prefixes and no second
      // version can appear from a poll landing mid-publication.
      Choices: [
        { Variable: '$.reviewRecord.Item.status.S', StringEquals: 'published', Next: 'WorkflowComplete' },
        { Variable: '$.reviewRecord.Item.status.S', StringEquals: 'failed', Next: 'WorkflowFailed' },
      ],
      Default: 'WaitForInstructor',
    },
    WorkflowComplete: { Type: 'Succeed' },
    WorkflowFailed: { Type: 'Fail', Error: 'JobFailed', Cause: 'The job record was marked failed during review' },
    MarkFailed: statusUpdate('failed'),
  };

  return {
    Comment: 'AccessLens authoring pipeline: ingest, analyst, per-slide description/audio, visualization, review; publication is the HTTP route',
    StartAt: 'MarkIngesting',
    States: states,
  };
}
