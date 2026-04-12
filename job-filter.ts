// Job Filter & Scoring Engine - Based on CV Profile

export interface Job {
    id?: string;
    title: string;
    company: string;
    location: string;
    description: string;
    applyUrl: string;
    source?: string;
    scrapedAt?: string;
    score?: number;
    applied?: boolean;
    appliedAt?: string;
}

export interface FilterResult {
    qualified: Job[];
    rejected: Job[];
    stats: {
        total: number;
        qualified: number;
        rejected: number;
        avgScore: number;
    };
}

// Tier 1: Primary role keywords (highest weight)
const TIER1_KEYWORDS = [
    'accounts receivable',
    'credit control',
    'collections',
    'order to cash',
    'o2c',
    'senior accountant',
    'ar analyst',
    'ar specialist',
    'ar manager'
];

// Tier 2: Support roles
const TIER2_KEYWORDS = [
    'finance executive',
    'credit analyst',
    'billing specialist',
    'revenue accountant',
    'accountant',
    'finance analyst'
];

// Tier 3: Context validation keywords
const TIER3_KEYWORDS = [
    'ifrs',
    'ifrs 9',
    'ecl',
    'expected credit loss',
    'dso',
    'days sales outstanding',
    'aging',
    'cash application',
    'reconciliation',
    'oracle fusion',
    'oracle',
    'erp',
    'power bi',
    'sap',
    'netsuite'
];

// Negative keywords (irrelevant domains)
const NEGATIVE_KEYWORDS = [
    'software developer',
    'web developer',
    'hr manager',
    'marketing manager',
    'sales executive',
    'it support',
    'graphic designer',
    'data scientist',
    'machine learning',
    'devops'
];

// Location preferences
const PRIMARY_LOCATIONS = ['dubai', 'abu dhabi'];
const SECONDARY_LOCATIONS = ['uae', 'united arab emirates', 'ksa', 'saudi arabia', 'riyadh', 'jeddah'];

// Score thresholds
const MINIMUM_SCORE = 7;

export function scoreJob(job: Job): number {
    const titleLower = job.title.toLowerCase();
    const descLower = job.description.toLowerCase();
    const locationLower = job.location.toLowerCase();
    const combined = `${titleLower} ${descLower}`;

    let score = 0;

    // Tier 1 scoring (+4 each)
    for (const keyword of TIER1_KEYWORDS) {
        if (titleLower.includes(keyword)) {
            score += 4;
        } else if (descLower.includes(keyword)) {
            score += 2;
        }
    }

    // Tier 2 scoring (+2 each)
    for (const keyword of TIER2_KEYWORDS) {
        if (titleLower.includes(keyword)) {
            score += 2;
        } else if (descLower.includes(keyword)) {
            score += 1;
        }
    }

    // Tier 3 context validation (+2 each, max +6)
    let contextScore = 0;
    for (const keyword of TIER3_KEYWORDS) {
        if (combined.includes(keyword)) {
            contextScore += 2;
        }
    }
    score += Math.min(contextScore, 6);

    // Location bonus
    for (const loc of PRIMARY_LOCATIONS) {
        if (locationLower.includes(loc)) {
            score += 3;
            break;
        }
    }
    for (const loc of SECONDARY_LOCATIONS) {
        if (locationLower.includes(loc)) {
            score += 1;
            break;
        }
    }

    // UAE/Real estate domain bonus
    if (combined.includes('real estate') || combined.includes('property')) {
        score += 2;
    }

    // Negative scoring
    for (const keyword of NEGATIVE_KEYWORDS) {
        if (titleLower.includes(keyword)) {
            score -= 5;
        }
    }

    // Senior Accountant special logic
    if (titleLower.includes('senior accountant')) {
        const hasRelevantContext =
            descLower.includes('ar') ||
            descLower.includes('accounts receivable') ||
            descLower.includes('ifrs') ||
            descLower.includes('reporting') ||
            descLower.includes('reconciliation');

        if (hasRelevantContext) {
            score += 3;
        }
    }

    return Math.max(0, score);
}

export function filterJobs(jobs: Job[]): FilterResult {
    const qualified: Job[] = [];
    const rejected: Job[] = [];
    let totalScore = 0;

    for (const job of jobs) {
        const score = scoreJob(job);
        job.score = score;

        if (score >= MINIMUM_SCORE) {
            qualified.push(job);
            totalScore += score;
        } else {
            rejected.push(job);
        }
    }

    // Sort qualified jobs by score (highest first)
    qualified.sort((a, b) => (b.score || 0) - (a.score || 0));

    return {
        qualified,
        rejected,
        stats: {
            total: jobs.length,
            qualified: qualified.length,
            rejected: rejected.length,
            avgScore: qualified.length > 0 ? totalScore / qualified.length : 0
        }
    };
}

export function generateJobId(job: Job): string {
    const base = `${job.title}-${job.company}-${job.location}`.toLowerCase();
    return base.replace(/[^a-z0-9]/g, '-').substring(0, 64);
}
