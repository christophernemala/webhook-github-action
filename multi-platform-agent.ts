/**
 * Multi-Platform Job Application Agent
 *
 * Supports: Bayt, LinkedIn, NaukriGulf, Indeed
 * Human-like behavior with anti-detection
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { Job } from './job-filter';

// Platform credentials from environment
const CREDENTIALS = {
    bayt: {
        email: process.env.BAYT_EMAIL || '',
        password: process.env.BAYT_PASSWORD || ''
    },
    linkedin: {
        email: process.env.LINKEDIN_EMAIL || '',
        password: process.env.LINKEDIN_PASSWORD || ''
    },
    naukrigulf: {
        email: process.env.NAUKRIGULF_EMAIL || '',
        password: process.env.NAUKRIGULF_PASSWORD || ''
    },
    indeed: {
        email: process.env.INDEED_EMAIL || '',
        password: process.env.INDEED_PASSWORD || ''
    }
};

type Platform = 'bayt' | 'linkedin' | 'naukrigulf' | 'indeed';

// Human-like utilities
const humanDelay = (min = 1000, max = 3000): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));

async function humanType(page: Page, selector: string, text: string): Promise<void> {
    await page.click(selector);
    await humanDelay(200, 500);
    for (const char of text) {
        await page.keyboard.type(char, { delay: Math.random() * 150 + 50 });
        if (Math.random() < 0.05) await humanDelay(200, 400);
    }
}

async function humanScroll(page: Page): Promise<void> {
    const scrolls = Math.floor(Math.random() * 3) + 2;
    for (let i = 0; i < scrolls; i++) {
        const amount = Math.random() * 400 + 100;
        await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), amount);
        await humanDelay(500, 1500);
    }
}

async function moveMouse(page: Page): Promise<void> {
    const viewport = page.viewportSize();
    if (!viewport) return;
    const x = Math.random() * viewport.width * 0.8 + viewport.width * 0.1;
    const y = Math.random() * viewport.height * 0.8 + viewport.height * 0.1;
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
}

// Detect platform from URL
function detectPlatform(url: string): Platform {
    if (url.includes('linkedin.com')) return 'linkedin';
    if (url.includes('naukrigulf.com')) return 'naukrigulf';
    if (url.includes('indeed.com') || url.includes('indeed.ae')) return 'indeed';
    return 'bayt';
}

// Platform-specific login handlers
async function loginBayt(page: Page): Promise<boolean> {
    const { email, password } = CREDENTIALS.bayt;
    if (!email || !password) return false;

    try {
        await page.goto('https://www.bayt.com/en/login/', { waitUntil: 'networkidle' });
        await humanDelay(2000, 4000);

        if (await page.$('[data-automation-id="user-menu"], .user-menu')) return true;

        await humanType(page, 'input[name="email"], #email', email);
        await humanDelay(500, 1000);
        await humanType(page, 'input[name="password"], #password', password);
        await humanDelay(1000, 2000);
        await moveMouse(page);
        await page.click('button[type="submit"], .login-btn');
        await page.waitForNavigation({ timeout: 30000 }).catch(() => {});
        await humanDelay(3000, 5000);

        return !!(await page.$('[data-automation-id="user-menu"], .user-menu'));
    } catch (error) {
        console.error('Bayt login failed:', error);
        return false;
    }
}

async function loginLinkedIn(page: Page): Promise<boolean> {
    const { email, password } = CREDENTIALS.linkedin;
    if (!email || !password) return false;

    try {
        await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle' });
        await humanDelay(2000, 4000);

        if (await page.$('.global-nav__me')) return true;

        await humanType(page, '#username', email);
        await humanDelay(800, 1500);
        await humanType(page, '#password', password);
        await humanDelay(1000, 2000);
        await moveMouse(page);
        await page.click('button[type="submit"]');
        await page.waitForNavigation({ timeout: 30000 }).catch(() => {});
        await humanDelay(3000, 6000);

        // Handle verification if needed
        const verificationNeeded = await page.$('input[name="pin"]');
        if (verificationNeeded) {
            console.log('LinkedIn verification required - check email/phone');
            return false;
        }

        return !!(await page.$('.global-nav__me'));
    } catch (error) {
        console.error('LinkedIn login failed:', error);
        return false;
    }
}

async function loginNaukriGulf(page: Page): Promise<boolean> {
    const { email, password } = CREDENTIALS.naukrigulf;
    if (!email || !password) return false;

    try {
        await page.goto('https://www.naukrigulf.com/login', { waitUntil: 'networkidle' });
        await humanDelay(2000, 4000);

        if (await page.$('.nI-gNb-drawer__logout, .user-dropdown')) return true;

        await humanType(page, 'input[name="email"], #usernameField', email);
        await humanDelay(500, 1000);
        await humanType(page, 'input[name="password"], #passwordField', password);
        await humanDelay(1000, 2000);
        await moveMouse(page);
        await page.click('button[type="submit"], .login-button');
        await page.waitForNavigation({ timeout: 30000 }).catch(() => {});
        await humanDelay(3000, 5000);

        return !!(await page.$('.nI-gNb-drawer__logout, .user-dropdown'));
    } catch (error) {
        console.error('NaukriGulf login failed:', error);
        return false;
    }
}

async function loginIndeed(page: Page): Promise<boolean> {
    const { email, password } = CREDENTIALS.indeed;
    if (!email || !password) return false;

    try {
        await page.goto('https://secure.indeed.com/auth', { waitUntil: 'networkidle' });
        await humanDelay(2000, 4000);

        // Check if already logged in
        if (await page.$('[data-gnav-element-name="AccountMenu"]')) return true;

        // Indeed uses multi-step login
        await humanType(page, 'input[name="__email"], #ifl-InputFormField-3', email);
        await humanDelay(1000, 2000);
        await page.click('button[type="submit"]');
        await humanDelay(2000, 4000);

        // Password step
        const passwordField = await page.$('input[name="__password"], #ifl-InputFormField-7');
        if (passwordField) {
            await humanType(page, 'input[name="__password"], #ifl-InputFormField-7', password);
            await humanDelay(1000, 2000);
            await page.click('button[type="submit"]');
            await page.waitForNavigation({ timeout: 30000 }).catch(() => {});
            await humanDelay(3000, 5000);
        }

        return !!(await page.$('[data-gnav-element-name="AccountMenu"]'));
    } catch (error) {
        console.error('Indeed login failed:', error);
        return false;
    }
}

// Platform-specific apply handlers
async function applyBayt(page: Page, job: Job): Promise<boolean> {
    await page.goto(job.applyUrl, { waitUntil: 'networkidle' });
    await humanDelay(2000, 4000);
    await humanScroll(page);

    const applyBtn = await page.$('button:has-text("Apply"), .apply-btn, [data-automation-id="apply-button"]');
    if (!applyBtn) return false;

    await moveMouse(page);
    await applyBtn.click();
    await humanDelay(2000, 4000);

    const submitBtn = await page.$('button:has-text("Submit"), button:has-text("Confirm")');
    if (submitBtn) {
        await submitBtn.click();
        await humanDelay(2000, 4000);
    }

    return true;
}

async function applyLinkedIn(page: Page, job: Job): Promise<boolean> {
    await page.goto(job.applyUrl, { waitUntil: 'networkidle' });
    await humanDelay(3000, 5000);
    await humanScroll(page);

    // Check for Easy Apply
    const easyApply = await page.$('button:has-text("Easy Apply"), .jobs-apply-button');
    if (!easyApply) {
        console.log('Not an Easy Apply job - skipping');
        return false;
    }

    await moveMouse(page);
    await easyApply.click();
    await humanDelay(2000, 4000);

    // Handle multi-step application
    let hasNext = true;
    while (hasNext) {
        const nextBtn = await page.$('button:has-text("Next"), button:has-text("Continue")');
        const submitBtn = await page.$('button:has-text("Submit application"), button:has-text("Submit")');

        if (submitBtn) {
            await moveMouse(page);
            await submitBtn.click();
            await humanDelay(2000, 4000);
            hasNext = false;
        } else if (nextBtn) {
            await moveMouse(page);
            await nextBtn.click();
            await humanDelay(1500, 3000);
        } else {
            hasNext = false;
        }
    }

    return true;
}

async function applyNaukriGulf(page: Page, job: Job): Promise<boolean> {
    await page.goto(job.applyUrl, { waitUntil: 'networkidle' });
    await humanDelay(2000, 4000);
    await humanScroll(page);

    const applyBtn = await page.$('button:has-text("Apply"), .apply-button, #apply-button');
    if (!applyBtn) return false;

    await moveMouse(page);
    await applyBtn.click();
    await humanDelay(2000, 4000);

    // Quick apply confirmation
    const confirmBtn = await page.$('button:has-text("Submit"), button:has-text("Confirm"), .submit-application');
    if (confirmBtn) {
        await confirmBtn.click();
        await humanDelay(2000, 4000);
    }

    return true;
}

async function applyIndeed(page: Page, job: Job): Promise<boolean> {
    await page.goto(job.applyUrl, { waitUntil: 'networkidle' });
    await humanDelay(2000, 4000);
    await humanScroll(page);

    // Check for Indeed Apply
    const applyBtn = await page.$('button:has-text("Apply now"), .jobsearch-IndeedApplyButton, #indeedApplyButton');
    if (!applyBtn) {
        console.log('External application - skipping');
        return false;
    }

    await moveMouse(page);
    await applyBtn.click();
    await humanDelay(3000, 5000);

    // Handle application flow
    let hasNext = true;
    while (hasNext) {
        const continueBtn = await page.$('button:has-text("Continue"), button:has-text("Next")');
        const submitBtn = await page.$('button:has-text("Submit"), button:has-text("Apply")');

        if (submitBtn) {
            await moveMouse(page);
            await submitBtn.click();
            await humanDelay(2000, 4000);
            hasNext = false;
        } else if (continueBtn) {
            await moveMouse(page);
            await continueBtn.click();
            await humanDelay(1500, 3000);
        } else {
            hasNext = false;
        }
    }

    return true;
}

// Main apply function
async function applyToJob(context: BrowserContext, job: Job): Promise<{ success: boolean; error?: string }> {
    const platform = detectPlatform(job.applyUrl);
    const page = await context.newPage();

    try {
        console.log(`Applying to ${job.title} on ${platform}`);

        let success = false;
        switch (platform) {
            case 'bayt':
                success = await applyBayt(page, job);
                break;
            case 'linkedin':
                success = await applyLinkedIn(page, job);
                break;
            case 'naukrigulf':
                success = await applyNaukriGulf(page, job);
                break;
            case 'indeed':
                success = await applyIndeed(page, job);
                break;
        }

        return { success };
    } catch (error: any) {
        return { success: false, error: error.message };
    } finally {
        await page.close();
    }
}

// Create browser with stealth settings
async function createStealthBrowser(): Promise<Browser> {
    return chromium.launch({
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
}

async function createStealthContext(browser: Browser): Promise<BrowserContext> {
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'en-US',
        timezoneId: 'Asia/Dubai',
        geolocation: { latitude: 25.2048, longitude: 55.2708 }, // Dubai
        permissions: ['geolocation']
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'ar'] });
        (window as any).chrome = { runtime: {} };
    });

    return context;
}

// Login to all platforms
async function loginToAllPlatforms(context: BrowserContext): Promise<Record<Platform, boolean>> {
    const page = await context.newPage();
    const results: Record<Platform, boolean> = {
        bayt: false,
        linkedin: false,
        naukrigulf: false,
        indeed: false
    };

    console.log('Logging in to all platforms...');

    results.bayt = await loginBayt(page);
    console.log(`Bayt: ${results.bayt ? 'OK' : 'FAILED'}`);
    await humanDelay(2000, 4000);

    results.linkedin = await loginLinkedIn(page);
    console.log(`LinkedIn: ${results.linkedin ? 'OK' : 'FAILED'}`);
    await humanDelay(2000, 4000);

    results.naukrigulf = await loginNaukriGulf(page);
    console.log(`NaukriGulf: ${results.naukrigulf ? 'OK' : 'FAILED'}`);
    await humanDelay(2000, 4000);

    results.indeed = await loginIndeed(page);
    console.log(`Indeed: ${results.indeed ? 'OK' : 'FAILED'}`);

    await page.close();
    return results;
}

export {
    createStealthBrowser,
    createStealthContext,
    loginToAllPlatforms,
    applyToJob,
    detectPlatform,
    Platform,
    CREDENTIALS
};
