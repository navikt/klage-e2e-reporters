import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

export interface StatusReporterOptions {
  /** Display name for the job. @default 'E2E' */
  name?: string;
  /** Base URL for the job status API. @default 'https://klage-job-status.ekstern.dev.nav.no' */
  baseUrl?: string;
  /** Timeout in seconds for the job. @default 900 (15 minutes) */
  timeout?: number;
  /** Environment variable name for the write API key. @default 'WRITE_API_KEY' */
  apiKeyEnvVar?: string;
  /** Environment variable name for the job ID. @default 'JOB_ID' */
  jobIdEnvVar?: string;
}

const VERSION = process.env.VERSION ?? 'unknown';
const GITHUB_ACTOR = process.env.GITHUB_ACTOR ?? '<unknown>';
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY ?? '<unknown>';

enum Status {
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

class StatusReporter implements Reporter {
  private jobId: string | undefined;
  private apiKey: string | undefined;
  private createUrl: string;
  private updateUrl: string;
  private displayName: string;
  private timeout: number;

  constructor(options: StatusReporterOptions = {}) {
    const name = options.name ?? 'E2E';
    const baseUrl = options.baseUrl ?? 'https://klage-job-status.ekstern.dev.nav.no';
    const apiKeyEnvVar = options.apiKeyEnvVar ?? 'WRITE_API_KEY';
    const jobIdEnvVar = options.jobIdEnvVar ?? 'JOB_ID';

    this.apiKey = process.env[apiKeyEnvVar];
    this.jobId = process.env[jobIdEnvVar] ?? crypto.randomUUID();
    this.createUrl = `${baseUrl}/jobs/${this.jobId}`;
    this.updateUrl = `${this.createUrl}/status`;
    this.displayName = `${name} (${VERSION}) - ${GITHUB_ACTOR} @ ${GITHUB_REPOSITORY}`;
    this.timeout = options.timeout ?? 15 * 60;
  }

  private async update(status: Status) {
    if (this.jobId === undefined || this.apiKey === undefined) {
      return;
    }

    await fetch(this.updateUrl, { method: 'PUT', headers: { API_KEY: this.apiKey }, body: status });
  }

  async onBegin() {
    if (this.jobId === undefined) {
      console.warn('JOB_ID is not set. Skipping status reporter.');
      return;
    }

    if (this.apiKey === undefined) {
      console.warn('WRITE_API_KEY is not set. Skipping status reporter.');
      return;
    }

    await fetch(this.createUrl, {
      method: 'POST',
      headers: {
        API_KEY: this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: this.displayName, timeout: this.timeout }),
    });

    console.debug('Job status created', this.jobId);
  }

  async onTestBegin() {
    await this.update(Status.RUNNING);
  }

  async onStepBegin() {
    await this.update(Status.RUNNING);
  }

  async onStepEnd(test: TestCase, result: TestResult) {
    await this.setStatusOnEnd(test, result);
  }

  async onTestEnd(test: TestCase, result: TestResult) {
    await this.setStatusOnEnd(test, result);
  }

  async onEnd(result: FullResult) {
    if (result.status === 'passed') {
      return await this.update(Status.SUCCESS);
    }

    return await this.update(Status.FAILED);
  }

  private async setStatusOnEnd(test: TestCase, result: TestResult) {
    if (result.retry < test.retries) {
      // If it is retrying, we don't want to set the final status yet.
      return await this.update(Status.RUNNING);
    }

    if (result.status === 'failed') {
      return await this.update(Status.FAILED);
    }
  }
}

export default StatusReporter;
