/**
 * Bayt.com Job Scraper - Apify Actor
 *
 * Human-like behavior to avoid detection:
 * - Random delays between actions
 * - Natural scroll patterns
 * - Mouse movement simulation
 * - Session persistence
 */

import { Actor, log } from 'apify';
import { PlaywrightCrawler, RequestQueue } from 'crawlee';

interface JobData {
    title: string;
    company: string;
    location: string;
    description: string;
    applyUrl: string;
    postedDate?: string;
}

// Human-like delay
const humanDelay = (min = 1000, max = 3000) =>
    new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));

// Random scroll behavior
async function humanScroll(page: any) {
    const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    let currentPosition = 0;

    while (currentPosition < scrollHeight - viewportHeight) {
        const scrollAmount = Math.random() * 300 + 100;
        currentPosition += scrollAmount;
        await page.evaluate((y: number) => window.scrollTo({ top: y, behavior: 'smooth' }), currentPosition);
        await humanDelay(500, 1500);
    }
}

// Mouse movement simulation
async function simulateMouseMovement(page: any) {
    const width = await page.evaluate(() => window.innerWidth);
    const height = await page.evaluate(() => window.innerHeight);

    for (let i = 0; i < 3; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        await page.mouse.move(x, y, { steps: 10 });
        await humanDelay(200, 500);
    }
}

Actor.main(async () => {
    const input = await Actor.getInput<{
        searchQueries?: string[];
        maxPages?: number;
        webhookUrl?: string;
        baytEmail?: string;
        baytPassword?: string;
    }>();

    const searchQueries = input?.searchQueries || [
        'accounts-receivable-jobs',
        'credit-control-jobs',
        'collections-jobs',
        'senior-accountant-jobs'
    ];
    const maxPages = input?.maxPages || 3;
    const webhookUrl = input?.webhookUrl || process.env.WEBHOOK_URL;

    const jobs: JobData[] = [];
    const requestQueue = await RequestQueue.open();

    // Add search URLs
    for (const query of searchQueries) {
        await requestQueue.addRequest({
            url: `https://www.bayt.com/en/uae/jobs/${query}/`,
            userData: { query, page: 1 }
        });
    }

    const crawler = new PlaywrightCrawler({
        requestQueue,
        headless: true,
        maxConcurrency: 1, // Single thread for human-like behavior
        navigationTimeoutSecs: 60,

        launchContext: {
            launchOptions: {
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--disable-dev-shm-usage',
                    '--no-sandbox'
                ]
            }
        },

        async requestHandler({ page, request, enqueueLinks }) {
            const { query, page: pageNum } = request.userData as { query: string; page: number };
            log.info(`Scraping ${query} - page ${pageNum}`);

            // Human-like behavior
            await humanDelay(2000, 4000);
            await simulateMouseMovement(page);
            await humanScroll(page);

            // Wait for job listings
            await page.waitForSelector('[data-js-job]', { timeout: 30000 }).catch(() => null);

            // Extract jobs
            const pageJobs = await page.evaluate(() => {
                const jobCards = document.querySelectorAll('[data-js-job]');
                const extracted: JobData[] = [];

                jobCards.forEach(card => {
                    const titleEl = card.querySelector('h2.jb-title a, .jb-title a');
                    const companyEl = card.querySelector('.jb-company a, [data-automation-id="company"]');
                    const locationEl = card.querySelector('.jb-loc span, [data-automation-id="location"]');
                    const descEl = card.querySelector('.jb-description, .job-description');

                    if (titleEl) {
                        extracted.push({
                            title: titleEl.textContent?.trim() || '',
                            company: companyEl?.textContent?.trim() || 'Unknown',
                            location: locationEl?.textContent?.trim() || 'UAE',
                            description: descEl?.textContent?.trim() || '',
                            applyUrl: (titleEl as HTMLAnchorElement).href || ''
                        });
                    }
                });

                return extracted;
            });

            jobs.push(...pageJobs);
            log.info(`Found ${pageJobs.length} jobs on this page`);

            // Pagination - add next page if within limit
            if (pageNum < maxPages) {
                const nextPageUrl = `https://www.bayt.com/en/uae/jobs/${query}/?page=${pageNum + 1}`;
                await requestQueue.addRequest({
                    url: nextPageUrl,
                    userData: { query, page: pageNum + 1 }
                });
            }

            // Random delay before next request
            await humanDelay(3000, 6000);
        },

        failedRequestHandler({ request, error }) {
            log.error(`Request failed: ${request.url}`, { error: error.message });
        }
    });

    // Login if credentials provided
    if (input?.baytEmail && input?.baytPassword) {
        log.info('Logging in to Bayt.com...');
        // Login logic would go here - handled separately
    }

    await crawler.run();

    log.info(`Scraping complete. Total jobs: ${jobs.length}`);

    // Send to webhook
    if (webhookUrl && jobs.length > 0) {
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source: 'bayt.com',
                    jobs,
                    scrapedAt: new Date().toISOString()
                })
            });
            log.info(`Webhook response: ${response.status}`);
        } catch (error) {
            log.error('Webhook failed', { error });
        }
    }

    // Store in Apify dataset
    await Actor.pushData(jobs);
});
