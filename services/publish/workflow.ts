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

function lambdaTask(resource: string, next: string, resultPath: string): State {
  return {
    Type: 'Task',
    Resource: resource,
    ResultPath: resultPath,
    Next: next,
  };
}

/**
 * Build the Standard authoring workflow. Lambda stages receive the execution
 * data directly; the per-slide Map flattens the DeckSlide fields into the
 * Pack Author event and passes its asset into Audio.
 */
export function authoringStateMachine(arns: AuthoringLambdaArns): object {
  const perSlideStates: Record<string, State> = {
    PackAuthor: {
      Type: 'Task',
      Resource: arns.packAuthor,
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
      ResultPath: '$.packAuthor',
      Next: 'Audio',
    },
    Audio: {
      Type: 'Task',
      Resource: arns.audio,
      Parameters: {
        'jobId.$': '$.jobId',
        'packId.$': '$.packId',
        'asset.$': '$.packAuthor.asset',
        'bucket.$': '$.bucket',
      },
      ResultPath: '$.audio',
      Next: 'VisualizationStagesPassThrough',
    },
    // Deliberately named extension point. Planner/retriever/adapter/generator/
    // critic are inserted here by the visualization lane without changing the
    // ingestion, authoring, audio, review, or publish spine.
    VisualizationStagesPassThrough: {
      Type: 'Pass',
      ResultPath: '$.visualization',
      Next: 'SlideComplete',
    },
    SlideComplete: {
      Type: 'Pass',
      End: true,
    },
  };

  const states: Record<string, State> = {
    MarkIngesting: statusUpdate('ingesting', 'Ingest'),
    Ingest: {
      ...lambdaTask(arns.ingest, 'MarkDescribing', '$.deck'),
      Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: '$.stageError', Next: 'MarkFailed' }],
    },
    MarkDescribing: statusUpdate('describing', 'Analyst'),
    Analyst: lambdaTask(arns.analyst, 'AnalystOutcome', '$.analyst'),
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
        'assetId.$': '$$.Map.Item.Value.assetId',
        'page.$': '$$.Map.Item.Value.page',
        'mediaKey.$': '$$.Map.Item.Value.mediaKey',
        'fingerprint.$': '$$.Map.Item.Value.fingerprint',
        'extractedText.$': '$$.Map.Item.Value.extractedText',
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
      Choices: [{ Variable: '$.reviewRecord.Item.status.S', StringEquals: 'publishing', Next: 'MarkPublishing' }],
      Default: 'WaitForInstructor',
    },
    MarkPublishing: statusUpdate('publishing', 'Publish'),
    Publish: {
      ...lambdaTask(arns.publish, 'WorkflowComplete', '$.publish'),
      Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: '$.stageError', Next: 'MarkFailed' }],
    },
    WorkflowComplete: {
      Type: 'Succeed',
    },
    MarkFailed: statusUpdate('failed'),
  };

  return {
    Comment: 'AccessLens authoring pipeline: ingest, analyst, per-slide description/audio, review, publish',
    StartAt: 'MarkIngesting',
    States: states,
  };
}
