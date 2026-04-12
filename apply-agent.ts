/**
 * Job Application Agent
 *
 * Applies to jobs on Bayt.com with human-like behavior
 * - Random delays and pauses
 * - Natural typing speed
 * - Mouse movement simulation
 * - Session management
 */

import { chromium, Browser, Page } from 'playwright';

interface Job {
    id?: string;
    title: string;
    company: string;
    location: string;
    description: string;
    applyUrl: string;
    score?: number;
}

interface ApplicationResult {
    job: Job;
    status: 'success' | 'failed' | 'skipped';
    error?: string;
}

// Configuration
const BAYT_EMAIL = process.env.BAYT_EMAIL || '';
const BAYT_PASSWORD = process.env.BAYT_PASSWORD || '';
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || '';
const MAX_APPLICATIONS = parseInt(process.env.MAX_APPLICATIONS || '20');

// Human-like delay
const humanDelay = (min = 1000, max = 3000): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));

// Human-like typing
async function humanType(page: Page, selector: string, text: string): Promise<void> {
    await page.click(selector);
    await humanDelay(200, 500);

    for (const char of text) {
        await page.keyboard.type(char, { delay: Math.random() * 100 + 50 });
        if (Math.random() < 0.1) {
            await humanDelay(100, 300); // Occasional pause
        }
    }
}

// Random mouse movement
async function moveMouseRandomly(page: Page): Promise<void> {
    const viewport = page.viewportSize();
    if (!viewport) return;

    for (let i = 0; i < 2; i++) {
        const x = Math.random() * viewport.width;
        const y = Math.random() * viewport.height;
        await page.mouse.move(x, y, { steps: 5 });
        await humanDelay(100, 300);
    }
}

// Natural scroll
async function naturalScroll(page: Page): Promise<void> {
    const scrollAmount = Math.random() * 300 + 100;
    await page.evaluate((amount) => {
        window.scrollBy({ top: amount, behavior: 'smooth' });
    }, scrollAmount);
    await humanDelay(500, 1000);
}

// Login to Bayt.com
async function loginToBayt(page: Page): Promise<boolean> {
    try {
        console.log('Logging in to Bayt.com...');
        await page.goto('https://www.bayt.com/en/login/', { waitUntil: 'networkidle' });
        await humanDelay(2000, 4000);

        // Check if already logged in
        const loggedIn = await page.$('[data-automation-id="user-menu"]');
        if (loggedIn) {
            console.log('Already logged in');
            return true;
        }

        // Fill login form
        await moveMouseRandomly(page);
        await humanType(page, 'input[name="email"], #email', BAYT_EMAIL);
        await humanDelay(500, 1000);
        await humanType(page, 'input[name="password"], #password', BAYT_PASSWORD);
        await humanDelay(1000, 2000);

        // Click login button
        await moveMouseRandomly(page);
        await page.click('button[type="submit"], .login-btn');
        await page.waitForNavigation({ timeout: 30000 }).catch(() => {});
        await humanDelay(3000, 5000);

        // Verify login
        const isLoggedIn = await page.$('[data-automation-id="user-menu"], .user-menu');
        if (isLoggedIn) {
            console.log('Login successful');
            return true;
        }

        console.log('Login may have failed');
        return false;
    } catch (error) {
        console.error('Login error:', error);
        return false;
    }
}

// Apply to a single job
async function applyToJob(page: Page, job: Job): Promise<ApplicationResult> {
    try {
        console.log(`Applying to: ${job.title} at ${job.company}`);

        // Navigate to job page
        await page.goto(job.applyUrl, { waitUntil: 'networkidle' });
        await humanDelay(2000, 4000);
        await naturalScroll(page);
        await moveMouseRandomly(page);

        // Look for apply button
        const applyButton = await page.$('button:has-text("Apply"), a:has-text("Apply"), .apply-btn, [data-automation-id="apply-button"]');

        if (!applyButton) {
            console.log('No apply button found - may already be applied or expired');
            return { job, status: 'skipped', error: 'No apply button found' };
        }

        // Click apply
        await moveMouseRandomly(page);
        await humanDelay(500, 1000);
        await applyButton.click();
        await humanDelay(2000, 4000);

        // Handle application modal/form if present
        const submitButton = await page.$('button:has-text("Submit"), button:has-text("Confirm"), .submit-application');
        if (submitButton) {
            await naturalScroll(page);
            await humanDelay(1000, 2000);
            await submitButton.click();
            await humanDelay(2000, 4000);
        }

        // Check for success indicator
        const successIndicator = await page.$(':has-text("Application Submitted"), :has-text("Successfully Applied"), .success-message');

        if (successIndicator) {
            console.log(`Successfully applied to ${job.title}`);
            return { job, status: 'success' };
        }

        // Assume success if no error
        return { job, status: 'success' };

    } catch (error: any) {
        console.error(`Failed to apply to ${job.title}:`, error.message);
        return { job, status: 'failed', error: error.message };
    }
}

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

    console.log(`Starting application agent with ${jobs.length} jobs`);

    // Launch browser with stealth settings
    const browser: Browser = await chromium.launch({
        headless: true,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'en-US',
        timezoneId: 'Asia/Dubai'
    });

    // Add stealth scripts
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        (window as any).chrome = { runtime: {} };
    });

    const page = await context.newPage();

    const results: ApplicationResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    try {
        // Login first
        const loggedIn = await loginToBayt(page);
        if (!loggedIn) {
            console.error('Failed to login - aborting');
            await browser.close();
            process.exit(1);
        }

        // Apply to jobs
        for (let i = 0; i < Math.min(jobs.length, MAX_APPLICATIONS); i++) {
            const job = jobs[i];

            // Random delay between applications
            if (i > 0) {
                const waitTime = Math.random() * 30000 + 20000; // 20-50 seconds
                console.log(`Waiting ${Math.round(waitTime / 1000)}s before next application...`);
                await humanDelay(waitTime, waitTime);
            }

            const result = await applyToJob(page, job);
            results.push(result);

            if (result.status === 'success') {
                successCount++;
                await reportApplication(result);
            } else if (result.status === 'failed') {
                failedCount++;
            }

            console.log(`Progress: ${i + 1}/${jobs.length} (${successCount} success, ${failedCount} failed)`);
        }

    } finally {
        await browser.close();
    }

    console.log('\n=== Application Summary ===');
    console.log(`Total: ${results.length}`);
    console.log(`Success: ${successCount}`);
    console.log(`Failed: ${failedCount}`);
    console.log(`Skipped: ${results.filter(r => r.status === 'skipped').length}`);
}

main().catch(console.error);
