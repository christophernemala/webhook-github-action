// Slack Notification Layer

import { Job, FilterResult } from './job-filter';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';

interface SlackBlock {
    type: string;
    text?: { type: string; text: string; emoji?: boolean };
    fields?: { type: string; text: string }[];
    elements?: { type: string; text: string }[];
}

// Send message to Slack
async function sendSlackMessage(blocks: SlackBlock[], text: string): Promise<boolean> {
    if (!SLACK_WEBHOOK_URL) {
        console.log('SLACK_WEBHOOK_URL not set, skipping notification');
        console.log('Message:', text);
        return false;
    }

    try {
        const response = await fetch(SLACK_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocks, text })
        });

        if (!response.ok) {
            console.error('Slack notification failed:', response.status);
            return false;
        }
        return true;
    } catch (error) {
        console.error('Slack notification error:', error);
        return false;
    }
}

// Night summary - after scraping
export async function sendNightSummary(result: FilterResult, source: string): Promise<boolean> {
    const topMatches = result.qualified.slice(0, 5);

    const blocks: SlackBlock[] = [
        {
            type: 'header',
            text: { type: 'plain_text', text: 'Job Scraping Complete', emoji: true }
        },
        {
            type: 'section',
            fields: [
                { type: 'mrkdwn', text: `*Source:*\n${source}` },
                { type: 'mrkdwn', text: `*Time:*\n${new Date().toLocaleString()}` },
                { type: 'mrkdwn', text: `*Total Scraped:*\n${result.stats.total}` },
                { type: 'mrkdwn', text: `*Qualified:*\n${result.stats.qualified}` }
            ]
        },
        { type: 'divider' } as SlackBlock,
        {
            type: 'section',
            text: { type: 'mrkdwn', text: '*Top Matches:*' }
        }
    ];

    // Add top matches
    for (const job of topMatches) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*${job.title}* | ${job.company} | ${job.location}\nScore: ${job.score}`
            }
        });
    }

    if (result.qualified.length > 5) {
        blocks.push({
            type: 'context',
            elements: [
                { type: 'mrkdwn', text: `_+${result.qualified.length - 5} more qualified jobs_` }
            ]
        });
    }

    const text = `Job Scraping: ${result.stats.qualified}/${result.stats.total} qualified from ${source}`;
    return sendSlackMessage(blocks, text);
}

// Morning summary - after applying
export async function sendMorningSummary(
    applied: { job: Job; status: string }[],
    failed: { job: Job; error: string }[]
): Promise<boolean> {
    const blocks: SlackBlock[] = [
        {
            type: 'header',
            text: { type: 'plain_text', text: 'Morning Applications Complete', emoji: true }
        },
        {
            type: 'section',
            fields: [
                { type: 'mrkdwn', text: `*Submitted:*\n${applied.length}` },
                { type: 'mrkdwn', text: `*Failed:*\n${failed.length}` },
                { type: 'mrkdwn', text: `*Time:*\n${new Date().toLocaleString()}` }
            ]
        },
        { type: 'divider' } as SlackBlock,
        {
            type: 'section',
            text: { type: 'mrkdwn', text: '*Applications Submitted:*' }
        }
    ];

    // Add applied jobs
    for (const { job, status } of applied.slice(0, 10)) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `${job.company} | *${job.title}* | ${status}`
            }
        });
    }

    if (applied.length > 10) {
        blocks.push({
            type: 'context',
            elements: [
                { type: 'mrkdwn', text: `_+${applied.length - 10} more applications_` }
            ]
        });
    }

    // Add failures if any
    if (failed.length > 0) {
        blocks.push({ type: 'divider' } as SlackBlock);
        blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: '*Failed Applications:*' }
        });

        for (const { job, error } of failed.slice(0, 5)) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `${job.company} | ${job.title}\n_Error: ${error}_`
                }
            });
        }
    }

    const text = `Applications: ${applied.length} submitted, ${failed.length} failed`;
    return sendSlackMessage(blocks, text);
}

// Alert for high-priority job
export async function sendHighPriorityAlert(job: Job): Promise<boolean> {
    const blocks: SlackBlock[] = [
        {
            type: 'header',
            text: { type: 'plain_text', text: 'High Priority Job Found!', emoji: true }
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*${job.title}*\n${job.company} | ${job.location}\n\nScore: *${job.score}*`
            }
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `<${job.applyUrl}|View & Apply>`
            }
        }
    ];

    return sendSlackMessage(blocks, `High Priority: ${job.title} at ${job.company}`);
}

// Daily stats
export async function sendDailyStats(stats: {
    totalJobs: number;
    qualifiedJobs: number;
    appliedJobs: number;
    pendingJobs: number;
}): Promise<boolean> {
    const blocks: SlackBlock[] = [
        {
            type: 'header',
            text: { type: 'plain_text', text: 'Daily Job Stats', emoji: true }
        },
        {
            type: 'section',
            fields: [
                { type: 'mrkdwn', text: `*Total Jobs:*\n${stats.totalJobs}` },
                { type: 'mrkdwn', text: `*Qualified:*\n${stats.qualifiedJobs}` },
                { type: 'mrkdwn', text: `*Applied:*\n${stats.appliedJobs}` },
                { type: 'mrkdwn', text: `*Pending:*\n${stats.pendingJobs}` }
            ]
        }
    ];

    return sendSlackMessage(blocks, `Stats: ${stats.appliedJobs} applied, ${stats.pendingJobs} pending`);
}
