import {Octokit} from "@octokit/core";
import express, {NextFunction, Request, Response} from "express";
import {Webhook, WebhookUnbrandedRequiredHeaders, WebhookVerificationError} from "standardwebhooks"
import {RenderDeploy, RenderEvent, RenderService, WebhookPayload} from "./render";
import {apifyClient, apifyToken, runActor, getRunDetails, ApifyWebhookPayload, validateApifyWebhook} from "./apify";

const app = express();
const port = process.env.PORT || 3001;
const renderWebhookSecret = process.env.RENDER_WEBHOOK_SECRET || '';

if (!renderWebhookSecret ) {
    console.error("Error: RENDER_WEBHOOK_SECRET is not set.");
    process.exit(1);
}

const renderAPIURL = process.env.RENDER_API_URL || "https://api.render.com/v1"

// To create a Render API token, follow instructions here: https://render.com/docs/api#1-create-an-api-key
const renderAPIToken = process.env.RENDER_API_KEY || '';

if (!renderAPIToken) {
    console.error("Error: RENDER_API_KEY is not set.");
    process.exit(1);
}

const githubAPIToken = process.env.GITHUB_API_TOKEN || '';
const githubOwnerName = process.env.GITHUB_OWNER_NAME || '';
const githubRepoName = process.env.GITHUB_REPO_NAME || '';

if (!githubAPIToken || !githubOwnerName || !githubRepoName) {
		console.error("Error: GITHUB_API_TOKEN, GITHUB_OWNER_NAME, or GITHUB_REPO_NAME is not set.");
		process.exit(1);
}

const githubWorkflowID = process.env.GITHUB_WORKFLOW_ID || 'example.yaml';

// Apify configuration (optional)
const apifyActorId = process.env.APIFY_ACTOR_ID || '';

if (apifyToken) {
    console.log('Apify integration enabled');
} else {
    console.log('Apify integration disabled - APIFY_API_TOKEN not set');
}

const octokit = new Octokit({
    auth: githubAPIToken
})

app.post("/webhook", express.raw({type: 'application/json'}), (req: Request, res: Response, next: NextFunction) => {
    try {
        validateWebhook(req);
    } catch (error) {
        return next(error)
    }

    const payload: WebhookPayload = JSON.parse(req.body)

    res.status(200).send({}).end()

    // handle the webhook async so we don't timeout the request
    handleWebhook(payload)
});

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error(err);
    if (err instanceof WebhookVerificationError) {
        res.status(400).send({}).end()
    } else {
        res.status(500).send({}).end()
    }
});

// Apify webhook endpoint
app.post("/apify/webhook", express.json(), (req: Request, res: Response, next: NextFunction) => {
    try {
        const signature = req.header("X-Apify-Webhook-Secret");

        if (!validateApifyWebhook(JSON.stringify(req.body), signature)) {
            console.log('Invalid Apify webhook signature');
            res.status(401).send({error: 'Invalid signature'}).end();
            return;
        }

        const payload: ApifyWebhookPayload = req.body;
        res.status(200).send({received: true}).end();

        // Handle Apify webhook async
        handleApifyWebhook(payload);
    } catch (error) {
        next(error);
    }
});

// Trigger an Apify actor
app.post("/apify/run", express.json(), async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!apifyClient) {
            res.status(503).send({error: 'Apify not configured'}).end();
            return;
        }

        const { actorId, input } = req.body;
        const targetActor = actorId || apifyActorId;

        if (!targetActor) {
            res.status(400).send({error: 'No actor ID provided'}).end();
            return;
        }

        const runId = await runActor(targetActor, input);
        res.status(200).send({runId, actorId: targetActor}).end();
    } catch (error) {
        next(error);
    }
});

// Get Apify run status
app.get("/apify/run/:runId", async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!apifyClient) {
            res.status(503).send({error: 'Apify not configured'}).end();
            return;
        }

        const details = await getRunDetails(req.params.runId);
        res.status(200).send(details).end();
    } catch (error) {
        next(error);
    }
});

app.get('/', (req: Request, res: Response) => {
  res.send('Render Webhook GitHub Action is listening!')
})

const server = app.listen(port, () => console.log(`Example app listening on port ${port}!`));

function validateWebhook(req: Request) {
    const headers: WebhookUnbrandedRequiredHeaders = {
        "webhook-id": req.header("webhook-id") || "",
        "webhook-timestamp": req.header("webhook-timestamp") || "",
        "webhook-signature": req.header("webhook-signature") || ""
    }

    const wh = new Webhook(renderWebhookSecret);
    wh.verify(req.body, headers);
}

/**
 * Handle an incoming Render webhook payload and, for successful deploys of the configured repository, trigger the configured GitHub Actions workflow.
 *
 * This function processes Render webhook events, verifies that a deploy finished successfully, ignores image-backed deploys and deploys for other repositories, and dispatches the GitHub workflow when appropriate. All errors are caught and logged.
 *
 * @param payload - The Render webhook payload to handle
 */
async function handleWebhook(payload: WebhookPayload) {
    try {
        switch (payload.type) {
            case "deploy_ended":
                console.log("handling deploy_ended event")
                const event = await fetchEventInfo(payload)

                // TODO add human readable status
                if (event.details.status != 2) {
                    console.log(`deploy ended for service ${payload.data.serviceId} with unsuccessful status`)
                    return
                }

                const deploy = await fetchDeployInfo(payload.data.serviceId, event.details.deployId)
                if (!deploy.commit) {
                    console.log(`ignoring deploy success for image backed service: ${payload.data.serviceId}`)
                    return
                }

                const service = await fetchServiceInfo(payload)

                if (! service.repo.includes(`${githubOwnerName}/${githubRepoName}`)) {
                    console.log(`ignoring deploy success for another service: ${service.name}`)
                    return
                }

                console.log(`triggering github workflow for ${githubOwnerName}/${githubRepoName} for ${service.name}`)
                await triggerWorkflow(service.id, service.branch)
                return
            default:
                console.log(`unhandled webhook type ${payload.type} for service ${payload.data.serviceId}`)
        }
    } catch (error) {
        console.error(error)
    }
}

/**
 * Handle incoming Apify webhook payloads and act on actor run events.
 *
 * Dispatches a GitHub workflow when an actor run succeeds (if GitHub credentials and repository config are available)
 * and records other run outcomes via logging.
 *
 * @param payload - The Apify webhook payload containing `eventType` and `resource` details for the actor run
 */
async function handleApifyWebhook(payload: ApifyWebhookPayload) {
    try {
        console.log(`Received Apify webhook: ${payload.eventType} for run ${payload.resource.id}`);

        switch (payload.eventType) {
            case 'ACTOR.RUN.SUCCEEDED':
                console.log(`Actor run succeeded: ${payload.resource.id}`);
                // Trigger GitHub workflow on successful actor run
                if (githubAPIToken && githubOwnerName && githubRepoName) {
                    await triggerWorkflowForApify(payload.resource.id, payload.resource.actId);
                }
                break;
            case 'ACTOR.RUN.FAILED':
                console.log(`Actor run failed: ${payload.resource.id}`);
                break;
            case 'ACTOR.RUN.TIMED_OUT':
                console.log(`Actor run timed out: ${payload.resource.id}`);
                break;
            default:
                console.log(`Unhandled Apify event: ${payload.eventType}`);
        }
    } catch (error) {
        console.error('Error handling Apify webhook:', error);
    }
}

/**
 * Dispatches the configured GitHub Actions workflow with Apify run details.
 *
 * @param runId - The Apify run ID to pass as the `apifyRunId` workflow input
 * @param actorId - The Apify actor ID to pass as the `apifyActorId` workflow input
 */
async function triggerWorkflowForApify(runId: string, actorId: string) {
    await octokit.request('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', {
        owner: githubOwnerName,
        repo: githubRepoName,
        workflow_id: githubWorkflowID,
        ref: 'main',
        inputs: {
            apifyRunId: runId,
            apifyActorId: actorId
        },
        headers: {
            'X-GitHub-Api-Version': '2022-11-28'
        }
    });
}

/**
 * Dispatches the configured GitHub Actions workflow with the given service ID as input on the specified ref.
 *
 * @param serviceID - The service identifier to pass to the workflow as the `serviceID` input
 * @param branch - The git ref (branch name or commit SHA) to run the workflow against
 */
async function triggerWorkflow(serviceID: string, branch: string) {
    await octokit.request('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', {
        owner: githubOwnerName,
        repo: githubRepoName,
        workflow_id: githubWorkflowID,
        ref: branch,
        inputs: {
            serviceID: serviceID
        },
        headers: {
            'X-GitHub-Api-Version': '2022-11-28'
        }
    })
}

// fetchEventInfo fetches the event that triggered the webhook
// some events have additional information that isn't in the webhook payload
// for example, deploy events have the deploy id
async function fetchEventInfo(payload: WebhookPayload): Promise<RenderEvent> {
    const url = `${renderAPIURL}/events/${payload.data.id}`
		console.log(`fetching event info at ${url}`)
    const res = await fetch(
        url,
        {
            method: "GET",
            headers: {
                accept: "application/json",
                authorization: `Bearer ${renderAPIToken}`,
            },
        },
    )

    if (res.ok) {
        return res.json()
    } else {
        throw new Error(`unable to fetch event info; received code ${res.status.toString()}`)
    }
}

async function fetchDeployInfo(serviceId: string, deployId: string): Promise<RenderDeploy> {
    const res = await fetch(
        `${renderAPIURL}/services/${serviceId}/deploys/${deployId}`,
        {
            method: "get",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${renderAPIToken}`,
            },
        },
    )
    if (res.ok) {
        return res.json()
    } else {
        throw new Error(`unable to fetch deploy info; received code :${res.status.toString()}`)
    }
}

async function fetchServiceInfo(payload: WebhookPayload): Promise<RenderService> {
    const res = await fetch(
        `${renderAPIURL}/services/${payload.data.serviceId}`,
        {
            method: "get",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${renderAPIToken}`,
            },
        },
    )
    if (res.ok) {
        return res.json()
    } else {
        throw new Error(`unable to fetch service info; received code :${res.status.toString()}`)
    }
}

process.on('SIGTERM', () => {
    console.debug('SIGTERM signal received: closing HTTP server')
    server.close(() => {
        console.debug('HTTP server closed')
    })
})
