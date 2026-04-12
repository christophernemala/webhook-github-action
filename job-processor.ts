// Job Processor - Handles incoming job data from Apify

import { Job, filterJobs, scoreJob } from './job-filter';
import { addJobs, getUnappliedJobs, markAsApplied, getStats } from './job-storage';
import { sendNightSummary, sendHighPriorityAlert, sendDailyStats } from './slack-notify';

const HIGH_PRIORITY_THRESHOLD = 12;

export interface ApifyJobPayload {
    jobs: Array<{
        title: string;
        company: string;
        location: string;
        description: string;
        applyUrl: string;
        source?: string;
    }>;
    source: string;
    scrapedAt?: string;
}

// Process incoming jobs from Apify webhook
export async function processApifyJobs(payload: ApifyJobPayload): Promise<{
    processed: number;
    qualified: number;
    highPriority: number;
}> {
    console.log(`Processing ${payload.jobs.length} jobs from ${payload.source}`);

    // Convert to Job format and score
    const jobs: Job[] = payload.jobs.map(j => ({
        title: j.title,
        company: j.company,
        location: j.location,
        description: j.description,
        applyUrl: j.applyUrl,
        source: payload.source,
        scrapedAt: payload.scrapedAt || new Date().toISOString()
    }));

    // Score all jobs
    for (const job of jobs) {
        job.score = scoreJob(job);
    }

    // Filter jobs
    const result = filterJobs(jobs);

    // Store qualified jobs
    const { added, duplicates } = addJobs(result.qualified);
    console.log(`Added ${added} new jobs, ${duplicates} duplicates skipped`);

    // Check for high priority jobs and alert
    let highPriority = 0;
    for (const job of result.qualified) {
        if ((job.score || 0) >= HIGH_PRIORITY_THRESHOLD) {
            highPriority++;
            await sendHighPriorityAlert(job);
        }
    }

    // Send night summary to Slack
    await sendNightSummary(result, payload.source);

    return {
        processed: jobs.length,
        qualified: result.qualified.length,
        highPriority
    };
}

// Get jobs ready for application
export function getJobsForApplication(limit: number = 20): Job[] {
    return getUnappliedJobs().slice(0, limit);
}

// Record application result
export function recordApplication(job: Job, status: string): void {
    markAsApplied(job, status);
}

// Get current stats for reporting
export async function reportStats(): Promise<void> {
    const stats = getStats();
    await sendDailyStats(stats);
}
