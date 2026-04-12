import { ApifyClient } from 'apify-client';

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
        const run = await apifyClient.actor(actorId).call(input);
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
        const { items } = await apifyClient.actor(actorId).lastRun().dataset().listItems();
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

// Validate Apify webhook signature (basic verification)
export function validateApifyWebhook(payload: string, signature: string | undefined): boolean {
    if (!apifyWebhookSecret || !signature) {
        return false;
    }
    // Apify uses a simple comparison - in production, use crypto for constant-time comparison
    return signature === apifyWebhookSecret;
}
