// Job Storage Layer - File-based with JSON persistence

import * as fs from 'fs';
import * as path from 'path';
import { Job, generateJobId } from './job-filter';

const STORAGE_DIR = process.env.STORAGE_DIR || './data';
const JOBS_FILE = path.join(STORAGE_DIR, 'jobs.json');
const APPLIED_FILE = path.join(STORAGE_DIR, 'applied.json');

interface JobStore {
    jobs: Record<string, Job>;
    lastUpdated: string;
}

interface AppliedStore {
    applied: Record<string, { job: Job; appliedAt: string; status: string }>;
    lastUpdated: string;
}

// Ensure storage directory exists
function ensureStorageDir(): void {
    if (!fs.existsSync(STORAGE_DIR)) {
        fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
}

// Load jobs from storage
export function loadJobs(): JobStore {
    ensureStorageDir();
    try {
        if (fs.existsSync(JOBS_FILE)) {
            const data = fs.readFileSync(JOBS_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading jobs:', error);
    }
    return { jobs: {}, lastUpdated: new Date().toISOString() };
}

// Save jobs to storage
export function saveJobs(store: JobStore): void {
    ensureStorageDir();
    store.lastUpdated = new Date().toISOString();
    fs.writeFileSync(JOBS_FILE, JSON.stringify(store, null, 2));
}

// Add new jobs (deduplicates by ID)
export function addJobs(newJobs: Job[]): { added: number; duplicates: number } {
    const store = loadJobs();
    let added = 0;
    let duplicates = 0;

    for (const job of newJobs) {
        const id = generateJobId(job);
        job.id = id;
        job.scrapedAt = job.scrapedAt || new Date().toISOString();

        if (!store.jobs[id]) {
            store.jobs[id] = job;
            added++;
        } else {
            duplicates++;
        }
    }

    saveJobs(store);
    return { added, duplicates };
}

// Get qualified jobs that haven't been applied to
export function getUnappliedJobs(minScore: number = 7): Job[] {
    const store = loadJobs();
    const appliedStore = loadApplied();

    return Object.values(store.jobs)
        .filter(job => {
            const score = job.score || 0;
            const isApplied = appliedStore.applied[job.id || ''];
            return score >= minScore && !isApplied;
        })
        .sort((a, b) => (b.score || 0) - (a.score || 0));
}

// Load applied jobs
export function loadApplied(): AppliedStore {
    ensureStorageDir();
    try {
        if (fs.existsSync(APPLIED_FILE)) {
            const data = fs.readFileSync(APPLIED_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading applied jobs:', error);
    }
    return { applied: {}, lastUpdated: new Date().toISOString() };
}

// Mark job as applied
export function markAsApplied(job: Job, status: string = 'submitted'): void {
    const store = loadApplied();
    const id = job.id || generateJobId(job);

    store.applied[id] = {
        job,
        appliedAt: new Date().toISOString(),
        status
    };
    store.lastUpdated = new Date().toISOString();

    fs.writeFileSync(APPLIED_FILE, JSON.stringify(store, null, 2));

    // Also update the job in main store
    const jobStore = loadJobs();
    if (jobStore.jobs[id]) {
        jobStore.jobs[id].applied = true;
        jobStore.jobs[id].appliedAt = new Date().toISOString();
        saveJobs(jobStore);
    }
}

// Get application stats
export function getStats(): {
    totalJobs: number;
    qualifiedJobs: number;
    appliedJobs: number;
    pendingJobs: number;
} {
    const jobStore = loadJobs();
    const appliedStore = loadApplied();

    const allJobs = Object.values(jobStore.jobs);
    const qualified = allJobs.filter(j => (j.score || 0) >= 7);
    const applied = Object.keys(appliedStore.applied).length;

    return {
        totalJobs: allJobs.length,
        qualifiedJobs: qualified.length,
        appliedJobs: applied,
        pendingJobs: qualified.length - applied
    };
}

// Clear old jobs (older than N days)
export function cleanupOldJobs(daysOld: number = 30): number {
    const store = loadJobs();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    let removed = 0;
    for (const [id, job] of Object.entries(store.jobs)) {
        const scrapedAt = new Date(job.scrapedAt || 0);
        if (scrapedAt < cutoff) {
            delete store.jobs[id];
            removed++;
        }
    }

    if (removed > 0) {
        saveJobs(store);
    }
    return removed;
}
