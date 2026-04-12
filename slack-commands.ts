// Slack Command Handler - Trigger automation from Slack

import { Request, Response } from 'express';
import { runActor, apifyClient } from './apify';
import { getStats, getUnappliedJobs } from './job-storage';
import { sendDailyStats, sendNightSummary } from './slack-notify';
import { filterJobs } from './job-filter';

// Slack verification token (set in Slack app settings)
const SLACK_VERIFICATION_TOKEN = process.env.SLACK_VERIFICATION_TOKEN || '';
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';

// Default Apify actor for Bayt scraping
const BAYT_ACTOR_ID = process.env.BAYT_ACTOR_ID || '';

interface SlackCommand {
    token: string;
    command: string;
    text: string;
    user_id: string;
    user_name: string;
    channel_id: string;
    response_url: string;
}

// Verify Slack request (basic token check)
export function verifySlackRequest(req: Request): boolean {
    const token = req.body.token;
    if (SLACK_VERIFICATION_TOKEN && token !== SLACK_VERIFICATION_TOKEN) {
        return false;
    }
    return true;
}

// Handle /scrape command - trigger Apify scraping
export async function handleScrapeCommand(cmd: SlackCommand): Promise<string> {
    if (!apifyClient || !BAYT_ACTOR_ID) {
        return 'Apify not configured. Set APIFY_API_TOKEN and BAYT_ACTOR_ID.';
    }

    try {
        const runId = await runActor(BAYT_ACTOR_ID, {
            searchQueries: [
                'accounts-receivable-jobs',
                'credit-control-jobs',
                'collections-jobs',
                'senior-accountant-jobs'
            ],
            maxPages: 3
        });

        return `Scraping started! Run ID: ${runId}\nYou'll receive a Slack notification when complete.`;
    } catch (error: any) {
        return `Failed to start scraping: ${error.message}`;
    }
}

// Handle /jobs command - show job stats
export async function handleJobsCommand(cmd: SlackCommand): Promise<string> {
    const stats = getStats();

    return `*Job Stats*
Total Jobs: ${stats.totalJobs}
Qualified: ${stats.qualifiedJobs}
Applied: ${stats.appliedJobs}
Pending: ${stats.pendingJobs}`;
}

// Handle /apply command - trigger application process
export async function handleApplyCommand(cmd: SlackCommand): Promise<string> {
    const jobs = getUnappliedJobs();

    if (jobs.length === 0) {
        return 'No pending jobs to apply to. Run /scrape first.';
    }

    // Parse limit from command text
    const limit = parseInt(cmd.text) || 10;
    const jobsToApply = jobs.slice(0, limit);

    // Note: In a real implementation, this would trigger the apply agent
    // For now, return the jobs that would be applied to
    const jobList = jobsToApply.map((j, i) =>
        `${i + 1}. *${j.title}* at ${j.company} (Score: ${j.score})`
    ).join('\n');

    return `*Ready to apply to ${jobsToApply.length} jobs:*\n${jobList}\n\n_Use the morning workflow or manual trigger to apply._`;
}

// Handle /status command - show system status
export async function handleStatusCommand(cmd: SlackCommand): Promise<string> {
    const stats = getStats();
    const apifyStatus = apifyClient ? 'Connected' : 'Not configured';

    return `*System Status*
Apify: ${apifyStatus}
Storage: Active
Jobs Tracked: ${stats.totalJobs}
Pending Applications: ${stats.pendingJobs}`;
}

// Handle /top command - show top jobs
export async function handleTopCommand(cmd: SlackCommand): Promise<string> {
    const limit = parseInt(cmd.text) || 5;
    const jobs = getUnappliedJobs().slice(0, limit);

    if (jobs.length === 0) {
        return 'No qualified jobs found. Run /scrape to fetch new jobs.';
    }

    const jobList = jobs.map((j, i) =>
        `${i + 1}. *${j.title}*\n   ${j.company} | ${j.location}\n   Score: ${j.score} | <${j.applyUrl}|Apply>`
    ).join('\n\n');

    return `*Top ${jobs.length} Jobs:*\n\n${jobList}`;
}

// Main command router
export async function handleSlackCommand(req: Request, res: Response): Promise<void> {
    if (!verifySlackRequest(req)) {
        res.status(401).send('Unauthorized');
        return;
    }

    const cmd: SlackCommand = req.body;
    let response: string;

    try {
        switch (cmd.command) {
            case '/scrape':
                response = await handleScrapeCommand(cmd);
                break;
            case '/jobs':
                response = await handleJobsCommand(cmd);
                break;
            case '/apply':
                response = await handleApplyCommand(cmd);
                break;
            case '/status':
                response = await handleStatusCommand(cmd);
                break;
            case '/top':
                response = await handleTopCommand(cmd);
                break;
            default:
                response = `Unknown command: ${cmd.command}\n\nAvailable commands:\n/scrape - Start job scraping\n/jobs - Show job stats\n/apply [limit] - Show jobs to apply\n/top [n] - Show top n jobs\n/status - System status`;
        }
    } catch (error: any) {
        response = `Error: ${error.message}`;
    }

    res.status(200).send({
        response_type: 'in_channel',
        text: response
    });
}

// Handle Slack interactive components (buttons, etc)
export async function handleSlackInteractive(req: Request, res: Response): Promise<void> {
    const payload = JSON.parse(req.body.payload || '{}');

    // Handle button clicks, etc.
    // This can be extended for interactive job applications

    res.status(200).send({ text: 'Action received' });
}
