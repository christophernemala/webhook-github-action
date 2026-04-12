/**
 * Job Application Agent
 *
 * Applies to jobs on Bayt, LinkedIn, NaukriGulf, Indeed
 * - Random delays and pauses
 * - Natural typing speed
 * - Mouse movement simulation
 * - Session management
 * - Multi-platform support
 */

import { Browser } from 'playwright';
import {
    createStealthBrowser,
    createStealthContext,
    loginToAllPlatforms,
    applyToJob,
    detectPlatform
} from './multi-platform-agent';

import { Job } from './job-filter';

interface ApplicationResult {
    job: Job;
    status: 'success' | 'failed' | 'skipped';
    platform: string;
    error?: string;
}

// Configuration
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || '';
const MAX_APPLICATIONS = parseInt(process.env.MAX_APPLICATIONS || '20');

// Human delay for pacing
const humanDelay = (min = 1000, max = 3000): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));

// Report application to webhook
async function reportApplication(result: ApplicationResult): Promise<void> {
    if (!WEBHOOK_BASE_URL) return;

    try {
        await fetch(`${WEBHOOK_BASE_URL}/jobs/applied`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                job: result.job,
                status: result.status,
                platform: result.platform,
                error: result.error
            })
        });
    } catch (error) {
        console.error('Failed to report application:', error);
    }
}

// Main execution
async function main(): Promise<void> {
    // Parse jobs from environment
    const jobsData = process.env.JOBS_DATA;
    if (!jobsData) {
        console.error('No JOBS_DATA provided');
        process.exit(1);
    }

    let jobs: Job[];
    try {
        const parsed = JSON.parse(jobsData);
        jobs = parsed.jobs || parsed;
    } catch {
        console.error('Failed to parse JOBS_DATA');
        process.exit(1);
    }

    if (jobs.length === 0) {
        console.log('No jobs to apply to');
        return;
    }

    console.log(`Starting multi-platform application agent with ${jobs.length} jobs`);

    // Create stealth browser and context
    const browser: Browser = await createStealthBrowser();
    const context = await createStealthContext(browser);

    const results: ApplicationResult[] = [];
    let successCount = 0;
    let failedCount = 0;
    const platformStats: Record<string, { success: number; failed: number }> = {};

    try {
        // Login to all platforms first
        console.log('\n=== Logging in to all platforms ===');
        const loginResults = await loginToAllPlatforms(context);

        const loggedInPlatforms = Object.entries(loginResults)
            .filter(([_, success]) => success)
            .map(([platform]) => platform);

        console.log(`\nLogged in to: ${loggedInPlatforms.join(', ') || 'none'}`);

        if (loggedInPlatforms.length === 0) {
            console.error('Failed to login to any platform - aborting');
            await browser.close();
            process.exit(1);
        }

        // Apply to jobs
        console.log('\n=== Starting applications ===');
        for (let i = 0; i < Math.min(jobs.length, MAX_APPLICATIONS); i++) {
            const job = jobs[i];
            const platform = detectPlatform(job.applyUrl);

            // Skip if not logged in to this platform
            if (!loginResults[platform]) {
                console.log(`Skipping ${job.title} - not logged in to ${platform}`);
                results.push({ job, status: 'skipped', platform, error: 'Not logged in' });
                continue;
            }

            // Random delay between applications (20-50 seconds)
            if (i > 0) {
                const waitTime = Math.random() * 30000 + 20000;
                console.log(`Waiting ${Math.round(waitTime / 1000)}s before next application...`);
                await humanDelay(waitTime, waitTime);
            }

            const applyResult = await applyToJob(context, job);
            const result: ApplicationResult = {
                job,
                status: applyResult.success ? 'success' : 'failed',
                platform,
                error: applyResult.error
            };
            results.push(result);

            // Track platform stats
            if (!platformStats[platform]) {
                platformStats[platform] = { success: 0, failed: 0 };
            }

            if (result.status === 'success') {
                successCount++;
                platformStats[platform].success++;
                await reportApplication(result);
            } else {
                failedCount++;
                platformStats[platform].failed++;
            }

            console.log(`Progress: ${i + 1}/${jobs.length} | ${platform}: ${result.status}`);
        }

    } finally {
        await browser.close();
    }

    // Print summary
    console.log('\n=== Application Summary ===');
    console.log(`Total: ${results.length}`);
    console.log(`Success: ${successCount}`);
    console.log(`Failed: ${failedCount}`);
    console.log(`Skipped: ${results.filter(r => r.status === 'skipped').length}`);

    console.log('\n=== Platform Breakdown ===');
    for (const [platform, stats] of Object.entries(platformStats)) {
        console.log(`${platform}: ${stats.success} success, ${stats.failed} failed`);
    }
}

main().catch(console.error);
