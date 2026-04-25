import {Octokit} from "@octokit/core";
import express, {NextFunction, Request, Response} from "express";
import {Webhook, WebhookUnbrandedRequiredHeaders, WebhookVerificationError} from "standardwebhooks";
import {RenderDeploy, RenderEvent, RenderService, WebhookPayload} from "./render";
import {apifyClient, apifyToken, runActor, getRunDetails, ApifyWebhookPayload, validateApifyWebhook} from "./apify";

const app = express();
const port = Number(process.env.PORT) || 3001;

const renderWebhookSecret = process.env.RENDER_WEBHOOK_SECRET || "";
const renderAPIURL = process.env.RENDER_API_URL || "https://api.render.com/v1";
const renderAPIToken = process.env.RENDER_API_KEY || "";
const githubAPIToken = process.env.GITHUB_API_TOKEN || "";
const githubOwnerName = process.env.GITHUB_OWNER_NAME || "";
const githubRepoName = process.env.GITHUB_REPO_NAME || "";
const githubWorkflowID = process.env.GITHUB_WORKFLOW_ID || "example.yaml";
const apifyActorId = process.env.APIFY_ACTOR_ID || "";

const requiredConfig = {
    RENDER_WEBHOOK_SECRET: Boolean(renderWebhookSecret),
    RENDER_API_KEY: Boolean(renderAPIToken),
    GITHUB_API_TOKEN: Boolean(githubAPIToken),
    GITHUB_OWNER_NAME: Boolean(githubOwnerName),
    GITHUB_REPO_NAME: Boolean(githubRepoName),
};

const missingRequiredConfig = Object.entries(requiredConfig)
    .filter(([, isSet]) => !isSet)
    .map(([key]) => key);

if (missingRequiredConfig.length > 0) {
    console.warn(`Startup warning: missing optional runtime config for webhook execution: ${missingRequiredConfig.join(", ")}`);
}

if (apifyToken) {
    console.log("Apify integration enabled");
} else {
    console.log("Apify integration disabled - APIFY_API_TOKEN not set");
}

const octokit = githubAPIToken ? new Octokit({auth: githubAPIToken}) : null;

app.get("/", (req: Request, res: Response) => {
    res.status(200).send("Render Webhook GitHub Action is running");
});

app.get("/health", (req: Request, res: Response) => {
    res.status(200).json({
        status: "ok",
        service: "webhook-github-action",
        time: new Date().toISOString(),
        config: {
            readyForRenderWebhook: missingRequiredConfig.length === 0,
            missing: missingRequiredConfig,
            apifyConfigured: Boolean(apifyToken),
        },
    });
});

app.post("/webhook", express.raw({type: "application/json"}), (req: Request, res: Response, next: NextFunction) => {
    if (missingRequiredConfig.length > 0) {
        res.status(503).json({
            error: "Webhook runtime config is incomplete",
            missing: missingRequiredConfig,
        });
        return;
    }

    try {
        validateWebhook(req);
    } catch (error) {
        return next(error);
    }

    const payload: WebhookPayload = JSON.parse(req.body.toString("utf8"));

    res.status(200).send({}).end();

    // handle the webhook async so we don't timeout the request
    void handleWebhook(payload);
});

// Apify webhook endpoint
app.post("/apify/webhook", express.json(), (req: Request, res: Response, next: NextFunction) => {
    try {
        const signature = req.header("X-Apify-Webhook-Secret");

        if (!validateApifyWebhook(JSON.stringify(req.body), signature)) {
            console.log("Invalid Apify webhook signature");
            res.status(401).send({error: "Invalid signature"}).end();
            return;
        }

        const payload: ApifyWebhookPayload = req.body;
        res.status(200).send({received: true}).end();

        // Handle Apify webhook async
        void handleApifyWebhook(payload);
    } catch (error) {
        next(error);
    }
});

// Trigger an Apify actor
app.post("/apify/run", express.json(), async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!apifyClient) {
            res.status(503).send({error: "Apify not configured"}).end();
            return;
        }

        const {actorId, input} = req.body;
        const targetActor = actorId || apifyActorId;

        if (!targetActor) {
            res.status(400).send({error: "No actor ID provided"}).end();
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
            res.status(503).send({error: "Apify not configured"}).end();
            return;
        }

        const details = await getRunDetails(req.params.runId);
        res.status(200).send(details).end();
    } catch (error) {
        next(error);
    }
});

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error(err);
    if (err instanceof WebhookVerificationError) {
        res.status(400).send({}).end();
    } else {
        res.status(500).send({}).end();
    }
});

const server = app.listen(port, () => console.log(`Webhook server listening on port ${port}`));

function validateWebhook(req: Request) {
    const headers: WebhookUnbrandedRequiredHeaders = {
        "webhook-id": req.header("webhook-id") || "",
        "webhook-timestamp": req.header("webhook-timestamp") || "",
        "webhook-signature": req.header("webhook-signature") || "",
    };

    const wh = new Webhook(renderWebhookSecret);
    wh.verify(req.body, headers);
}

function assertWorkflowConfig() {
    if (!octokit || missingRequiredConfig.length > 0) {
        throw new Error(`Cannot run workflow. Missing config: ${missingRequiredConfig.join(", ")}`);
    }
}

async function handleWebhook(payload: WebhookPayload) {
    try {
        assertWorkflowConfig();

        switch (payload.type) {
            case "deploy_ended": {
                console.log("handling deploy_ended event");
                const event = await fetchEventInfo(payload);

                // TODO add human readable status
                if (event.details.status != 2) {
                    console.log(`deploy ended for service ${payload.data.serviceId} with unsuccessful status`);
                    return;
                }

                const deploy = await fetchDeployInfo(payload.data.serviceId, event.details.deployId);
                if (!deploy.commit) {
                    console.log(`ignoring deploy success for image backed service: ${payload.data.serviceId}`);
                    return;
                }

                const service = await fetchServiceInfo(payload);

                if (!service.repo.includes(`${githubOwnerName}/${githubRepoName}`)) {
                    console.log(`ignoring deploy success for another service: ${service.name}`);
                    return;
                }

                console.log(`triggering github workflow for ${githubOwnerName}/${githubRepoName} for ${service.name}`);
                await triggerWorkflow(service.id, service.branch);
                return;
            }
            default:
                console.log(`unhandled webhook type ${payload.type} for service ${payload.data.serviceId}`);
        }
    } catch (error) {
        console.error(error);
    }
}

async function handleApifyWebhook(payload: ApifyWebhookPayload) {
    try {
        console.log(`Received Apify webhook: ${payload.eventType} for run ${payload.resource.id}`);

        switch (payload.eventType) {
            case "ACTOR.RUN.SUCCEEDED":
                console.log(`Actor run succeeded: ${payload.resource.id}`);
                // Trigger GitHub workflow on successful actor run
                if (githubAPIToken && githubOwnerName && githubRepoName) {
                    await triggerWorkflowForApify(payload.resource.id, payload.resource.actId);
                }
                break;
            case "ACTOR.RUN.FAILED":
                console.log(`Actor run failed: ${payload.resource.id}`);
                break;
            case "ACTOR.RUN.TIMED_OUT":
                console.log(`Actor run timed out: ${payload.resource.id}`);
                break;
            default:
                console.log(`Unhandled Apify event: ${payload.eventType}`);
        }
    } catch (error) {
        console.error("Error handling Apify webhook:", error);
    }
}

async function triggerWorkflowForApify(runId: string, actorId: string) {
    assertWorkflowConfig();

    await octokit!.request("POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches", {
        owner: githubOwnerName,
        repo: githubRepoName,
        workflow_id: githubWorkflowID,
        ref: "main",
        inputs: {
            apifyRunId: runId,
            apifyActorId: actorId,
        },
        headers: {
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
}

async function triggerWorkflow(serviceID: string, branch: string) {
    assertWorkflowConfig();

    await octokit!.request("POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches", {
        owner: githubOwnerName,
        repo: githubRepoName,
        workflow_id: githubWorkflowID,
        ref: branch,
        inputs: {
            serviceID: serviceID,
        },
        headers: {
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
}

// fetchEventInfo fetches the event that triggered the webhook
// some events have additional information that isn't in the webhook payload
// for example, deploy events have the deploy id
async function fetchEventInfo(payload: WebhookPayload): Promise<RenderEvent> {
    const url = `${renderAPIURL}/events/${payload.data.id}`;
    console.log(`fetching event info at ${url}`);
    const res = await fetch(url, {
        method: "GET",
        headers: {
            accept: "application/json",
            authorization: `Bearer ${renderAPIToken}`,
        },
    });

    if (res.ok) {
        return res.json();
    } else {
        throw new Error(`unable to fetch event info; received code ${res.status.toString()}`);
    }
}

async function fetchDeployInfo(serviceId: string, deployId: string): Promise<RenderDeploy> {
    const res = await fetch(`${renderAPIURL}/services/${serviceId}/deploys/${deployId}`, {
        method: "get",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${renderAPIToken}`,
        },
    });
    if (res.ok) {
        return res.json();
    } else {
        throw new Error(`unable to fetch deploy info; received code :${res.status.toString()}`);
    }
}

async function fetchServiceInfo(payload: WebhookPayload): Promise<RenderService> {
    const res = await fetch(`${renderAPIURL}/services/${payload.data.serviceId}`, {
        method: "get",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${renderAPIToken}`,
        },
    });
    if (res.ok) {
        return res.json();
    } else {
        throw new Error(`unable to fetch service info; received code :${res.status.toString()}`);
    }
}

process.on("SIGTERM", () => {
    console.debug("SIGTERM signal received: closing HTTP server");
    server.close(() => {
        console.debug("HTTP server closed");
    });
});
