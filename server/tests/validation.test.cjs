const Joi = require('joi');

// Test schemas from server
const postsSchema = Joi.object({
    group_ids: Joi.array().items(Joi.string()).required().min(1),
    content: Joi.string().optional().allow('').max(50000),
    schedule: Joi.date().optional(),
    media_url: Joi.string().optional().allow(null).uri({ scheme: ['http', 'https'] }),
    ai_spin: Joi.boolean().optional().default(false),
    facebook_user: Joi.string().optional().allow(null).max(500)
});

const updateStatusSchema = Joi.object({
    taskId: Joi.alternatives(Joi.string(), Joi.number()).required(),
    status: Joi.string().required().valid('PENDING', 'SENT', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED', 'LOG'),
    failure_reason: Joi.string().optional().allow(null).max(1000),
    proof_url: Joi.string().optional().allow(null).uri({ scheme: ['http', 'https'] }),
    metadata: Joi.object().optional()
}).unknown(true);

// Test suite
const tests = [
    {
        name: 'Valid post creation',
        schema: postsSchema,
        data: { group_ids: ['123'], content: 'Hello world' },
        shouldPass: true
    },
    {
        name: 'Post with media',
        schema: postsSchema,
        data: { group_ids: ['123'], media_url: 'https://example.com/image.jpg' },
        shouldPass: true
    },
    {
        name: 'Post missing groups',
        schema: postsSchema,
        data: { content: 'Hello' },
        shouldPass: false
    },
    {
        name: 'Post content too long',
        schema: postsSchema,
        data: { group_ids: ['123'], content: 'x'.repeat(50001) },
        shouldPass: false
    },
    {
        name: 'Invalid schedule date',
        schema: postsSchema,
        data: { group_ids: ['123'], content: 'Hi', schedule: 'invalid' },
        shouldPass: false
    },
    {
        name: 'Valid status update',
        schema: updateStatusSchema,
        data: { taskId: '123', status: 'SUCCESS' },
        shouldPass: true
    },
    {
        name: 'Invalid status',
        schema: updateStatusSchema,
        data: { taskId: '123', status: 'INVALID' },
        shouldPass: false
    }
];

// Run tests
console.log('📋 Running Validation Tests\n');
let passed = 0, failed = 0;

tests.forEach(test => {
    const { error } = test.schema.validate(test.data, { abortEarly: false });
    const isValid = !error;
    const result = isValid === test.shouldPass ? '✅' : '❌';

    console.log(`${result} ${test.name}`);
    if (isValid === test.shouldPass) {
        passed++;
    } else {
        failed++;
        if (error) console.log(`   Error: ${error.details[0].message}`);
    }
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
