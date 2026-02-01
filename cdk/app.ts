#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AppSyncLambdaCacheStack } from './stack';

const app = new cdk.App();
new AppSyncLambdaCacheStack(app, 'AppSyncLambdaCacheStack', {});
