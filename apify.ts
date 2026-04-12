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

/**
 * Starts an Apify actor run with the provided input.
 *
 * @param actorId - The actor identifier (ID or actor resource name) to run
 * @param input - Optional input object passed to the actor run
 * @returns The started run's ID, or `null` if the Apify client is not initialized
 * @throws The underlying error from the Apify client if the actor call fails
 */
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

/**
 * Retrieve dataset items from the last run of the specified actor.
 *
 * @param actorId - The actor identifier whose run results to fetch
 * @param runId - The run identifier (used for logging only; the function fetches the actor's last run)
 * @returns The array of dataset items from the actor's last run, or `null` if the Apify client is not initialized
 * @throws Propagates any error thrown by the Apify client when fetching dataset items
 */
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

/**
 * Retrieves metadata for a specific Apify run.
 *
 * @param runId - The Apify run identifier to fetch.
 * @returns The run details object from Apify, or `null` if the Apify client is not initialized.
 * @throws The error thrown by the Apify client when retrieval fails.
 */
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

/**
 * Verifies a webhook request by comparing the provided signature to the configured Apify webhook secret.
 *
 * @param payload - Raw webhook payload (currently ignored by this comparison)
 * @param signature - Signature provided with the webhook request
 * @returns `true` if `signature` exactly matches the configured webhook secret, `false` otherwise
 */
export function validateApifyWebhook(payload: string, signature: string | undefined): boolean {
    if (!apifyWebhookSecret || !signature) {
        return false;
    }
    // Apify uses a simple comparison - in production, use crypto for constant-time comparison
    return signature === apifyWebhookSecret;
}
