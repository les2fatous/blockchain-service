export const options = {
    scenarios: {
        million_voters: {
            executor: 'ramping-arrival-rate',
            startRate: 100,
            timeUnit: '1s',
            preAllocatedVUs: 5000,
            maxVUs: 50000,
            stages: [
                { duration: '10m', target: 1000 },    // 1000 votes/sec
                { duration: '30m', target: 5000 },    // 5000 votes/sec (pic)
                { duration: '20m', target: 2000 },    // Descente
            ],
        },
    },
};