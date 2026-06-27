#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { StuardAiStack } from "../lib/stuardai-stack";

const app = new App();
new StuardAiStack(app, "StuardAiStack", {});
