const http = require('http');

const data = JSON.stringify({
    extension_id: "test-ext-id",
    manifest_version: "2.1.0",
    origin_folder: "SRC",
    current_url: "chrome-extension://xyz/"
});

const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/worker/heartbeat',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = http.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        console.log('Body:', body);
    });
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
});

req.write(data);
req.end();
