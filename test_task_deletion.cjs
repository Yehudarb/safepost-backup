const http = require('http');

function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3001,
            path: path,
            method: method,
            headers: { 'Content-Type': 'application/json' }
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data || '{}')));
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    console.log("1. Creating dummy task...");
    const createRes = await request('POST', '/api/posts', {
        group_ids: ["test-group"],
        content: "Delete me"
    });
    if (!createRes.success) throw new Error("Create failed");
    console.log("   Created task count:", createRes.count);

    // Get queue to find ID
    const queueRes = await request('GET', '/api/queue');
    const task = queueRes.queue.find(q => q.content === "Delete me");
    if (!task) throw new Error("Task not found in queue");
    console.log(`   Target Task ID: ${task.id}`);

    console.log("2. Testing Single Delete...");
    await request('DELETE', `/api/tasks/${task.id}`);

    // Verify
    const verifyRes = await request('GET', '/api/queue');
    if (verifyRes.queue.find(q => q.id === task.id)) {
        console.error("❌ Single delete failed - task still exists");
    } else {
        console.log("✅ Single delete successful");
    }

    console.log("3. Testing Bulk Delete...");
    // Create 2 more
    await request('POST', '/api/posts', { group_ids: ["g1", "g2"], content: "Bulk Delete Me" });
    const q2 = await request('GET', '/api/queue');
    const tasksToDelete = q2.queue.filter(q => q.content === "Bulk Delete Me").map(q => q.id);
    console.log("   Deleting IDs:", tasksToDelete);

    await request('POST', '/api/tasks/bulk-delete', { ids: tasksToDelete });

    const verify2 = await request('GET', '/api/queue');
    const remaining = verify2.queue.filter(q => tasksToDelete.includes(q.id));
    if (remaining.length > 0) {
        console.error("❌ Bulk delete failed", remaining);
        process.exit(1);
    } else {
        console.log("✅ Bulk delete successful");
    }
}

run().catch(console.error);
