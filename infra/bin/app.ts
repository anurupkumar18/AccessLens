#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { AccessLensAuthoringStack } from '../lib/access-lens-authoring-stack';

const app = new App();
new AccessLensAuthoringStack(app, 'AccessLensAuthoring');
app.synth();
