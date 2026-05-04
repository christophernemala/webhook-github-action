import { ApifyClient } from 'apify-client';
import crypto from 'crypto';

// Apify Configuration
export const apifyToken = process.env.APIFY_API_TOKEN || '';
export const apifyWebhookSecret = process.env.APIFY_WEBHOOK_SECRET || '';

// Default actor IDs - configure via environment variables
export const defaultActorId = process.env.APIFY_DEFAULT_ACTOR_ID || '';

// Initialize Apify client
export const apifyClient = apifyToken ? new ApifyClient({ token: apifyToken }) : null;

// Apify webhook payload types
export interface ApifyWebhookPayload {
    eventType: 'ACTOR.RUN.SUCCEEDED' | 'ACTOR.RUN.FAILED' | 'ACTOR.RUN.TIMED_OUT' | 'ACTOR.RUN.ABORTED' | 'ACTOR.RUN.CREATED';
    eventData: {
        actorId: string;
        actorRunId: string;
        actorTaskId?: string;
    };
    resource: {
        id: string;
        actId: string;
        status: string;
        startedAt: string;
        finishedAt?: string;
        defaultKeyValueStoreId: string;
        defaultDatasetId: string;
        defaultRequestQueueId: string;
    };
    createdAt: string;
}

// Run an Apify actor with input data
export async function runActor(actorId: string, input?: Record<string, unknown>): Promise<string | null> {
    if (!apifyClient) {
        console.error('Apify client not initialized - APIFY_API_TOKEN not set');
        return null;
    }

    try {
        const run = await apifyClient.actor(actorId).call(input || {});
        console.log(`Started Apify actor ${actorId}, run ID: ${run.id}`);
        return run.id;
    } catch (error) {
        console.error(`Failed to run Apify actor ${actorId}:`, error);
        throw error;
    }
}

// Get results from a completed actor run
export async function getActorRunResults(actorId: string, runId: string): Promise<unknown[] | null> {
    if (!apifyClient) {
        console.error('Apify client not initialized - APIFY_API_TOKEN not set');
        return null;
    }

    try {
        const run = apifyClient.run(runId);
        const dataset = run.dataset();
        const { items } = await dataset.listItems();
        return items;
    } catch (error) {
        console.error(`Failed to get results for actor ${actorId} run ${runId}:`, error);
        throw error;
    }
}

// Get run details
export async function getRunDetails(runId: string) {
    if (!apifyClient) {
        console.error('Apify client not initialized - APIFY_API_TOKEN not set');
        return null;
    }

    try {
        return await apifyClient.run(runId).get();
    } catch (error) {
        console.error(`Failed to get run details for ${runId}:`, error);
        throw error;
    }
}

// Validate Apify webhook signature.
// Supports the simple secret header used in this service and common Apify signature formats.
export function validateApifyWebhook(payload: string, signature: string | undefined): boolean {
    if (!apifyWebhookSecret) {
        return true;
    }

    if (!signature) {
        return false;
    }

    const expectedPlain = Buffer.from(apifyWebhookSecret);
    const receivedPlain = Buffer.from(signature);

    if (expectedPlain.length === receivedPlain.length && crypto.timingSafeEqual(expectedPlain, receivedPlain)) {
        return true;
    }

    const hmac = crypto.createHmac('sha256', apifyWebhookSecret).update(payload).digest('hex');
    const expectedHmac = Buffer.from(hmac);
    const receivedHmac = Buffer.from(signature.replace(/^sha256=/, ''));

    return expectedHmac.length === receivedHmac.length && crypto.timingSafeEqual(expectedHmac, receivedHmac);
}
